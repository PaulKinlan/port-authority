// AI router, the part a site loads.
//
//   import { connect } from "https://llmchannel.dev/router.js";
//   const ai = await connect();
//   if (!ai.ready) await ai.choose();          // call this from a click
//   for await (const piece of ai.prompt("Write a haiku about ports")) show(piece);
//
// A site that already speaks the Chat Completions API can ask in that shape:
//
//   const answer = await ai.chat.completions.create({ messages: [{ role: "user", content: "Hello" }] });
//   show(answer.choices[0].message.content);
//
//   const stream = await ai.chat.completions.create({ messages, stream: true });
//   for await (const chunk of stream) show(chunk.choices[0]?.delta?.content || "");
//
// The site never sees an API key. It holds a MessagePort into a router page,
// and that page makes the calls. There are two ways to hold it:
//
//   ai.mode === "frame"    A hidden frame from the router's address, inside
//                          this page. The router window opens only while the
//                          person chooses, and the grant is still there after
//                          a reload. This is what connect() tries first.
//   ai.mode === "window"   The router window itself, kept open. connect()
//                          falls back to this when the frame does not load,
//                          for example because this site's own
//                          Content-Security-Policy forbids frames from other
//                          addresses. Closing the window disconnects the site,
//                          and ai.choose() opens it again.
//
// There are two kinds of page the router cannot work on. ai.choose() rejects
// on both, with a code that says which:
//
//   "cut-off"      This page is sent with Cross-Origin-Opener-Policy:
//                  same-origin. The browser cuts it off from every window it
//                  opens, so the router window cannot reach it.
//   "no-address"   This page is sandboxed, or is not http or https. It has no
//                  address to show the person or to keep a grant under.
//
// connect({ via: "window" }) skips the frame.

const ROUTER = new URL(import.meta.url).origin;

const noModel = () => Object.assign(new Error("This site is not connected to a model. Ask the person to choose one."), { code: "no-grant" });
const closed = () => Object.assign(new Error("The connection to the router was closed."), { code: "closed" });
// An error arrives in the shape the Chat Completions API uses, and is thrown
// with the same fields an OpenAI client puts on its errors.
const chatError = (e) => Object.assign(new Error(e.message), { name: e.code === "cancelled" ? "AbortError" : "Error", code: e.code, status: e.status, type: e.type, param: e.param, error: e });
const STATUS = { "no-grant": 401, closed: 503 };
const asChatError = (error) => (error && (error.code === "closed" || error.code === "no-grant") && !error.status
  ? chatError({ message: error.message, type: error.code === "closed" ? "api_error" : "authentication_error", param: null, code: error.code, status: STATUS[error.code] })
  : error);

// Everything a site can do with a port into the router. The port can be put
// in later and taken away again, because in window mode it comes and goes
// with the router window.
function channel() {
  let port = null;
  let current = { ready: false };
  let count = 0;                 // numbers the requests for another port
  const waiting = new Map();     // those requests, until the port arrives
  const changed = new Set();
  const drops = new Set();       // told when the port goes, so that nothing waits for ever
  let remote = null;             // the Chat Completions calls travel on a port of their own
  let first;
  const started = new Promise((resolve) => { first = resolve; });
  const notify = () => { for (const fn of changed) fn(api); };

  // A promise that rejects if the port goes away. Call off() when done with it.
  const untilDropped = () => {
    let drop;
    const lost = new Promise((_, reject) => { drop = reject; });
    lost.catch(() => {});
    drops.add(drop);
    return { lost, off: () => drops.delete(drop) };
  };
  const askForPort = (message) => {
    if (!port) return Promise.reject(noModel());
    const n = ++count;
    return new Promise((resolve, reject) => { waiting.set(n, { resolve, reject }); port.postMessage({ ...message, n }); });
  };

  function attach(next) {
    detach(true);
    port = next;
    port.onmessage = (event) => {
      if (port !== next) return;
      const message = event.data || {};
      if (message.t === "state") { current = message; first(); notify(); }
      else if (message.t === "lent" || message.t === "api") { waiting.get(message.n)?.resolve(event.ports[0]); waiting.delete(message.n); }
    };
    port.postMessage({ t: "state" });
  }
  function detach(quiet = false) {
    if (!port) return;
    try { port.close(); } catch { /* already closed */ }
    port = null;
    remote = null;
    current = { ready: false };
    const error = closed();
    for (const { reject } of waiting.values()) reject(error);
    waiting.clear();
    for (const drop of [...drops]) drop(error);
    drops.clear();
    if (!quiet) notify();
  }

  // Hawser carries the Chat Completions calls. It and the port are fetched the
  // first time a site calls create().
  const chatRemote = () => {
    if (!remote) {
      remote = Promise.all([import(ROUTER + "/hawser.js"), askForPort({ t: "api" })]).then(([{ wrap }, line]) => ({ api: wrap(line) }));
      remote.catch(() => {});
    }
    return remote;
  };

  const api = {
    get ready() { return !!current.ready; },
    get model() { return current.model || null; },      // { id, provider, name, account }: name is the model, account is what the person called their account
    get left() { return current.left ?? null; },         // requests left on the grant
    get expires() { return current.expires ?? null; },
    started,
    onchange(fn) { changed.add(fn); return () => changed.delete(fn); },

    // Send a prompt. Each request gets a port of its own for the answer.
    // Returns something you can `for await` over, with text() for the whole
    // answer and cancel() to stop it.
    prompt(input, options = {}) {
      const ask = typeof input === "string" ? { messages: [{ role: "user", content: input }] } : input;
      const line = new MessageChannel();
      const queue = [];
      let wake = null, finished = false, failure = null, result = null;
      const end = (error) => { if (finished) return; finished = true; failure = error || null; drops.delete(end); try { line.port1.close(); } catch { /* closed */ } wake?.(); wake = null; };
      line.port1.onmessage = (event) => {
        const m = event.data;
        if (m.t === "text") { queue.push(m.text); wake?.(); wake = null; }
        else if (m.t === "done") { result = m; end(); }
        else if (m.t === "error") end(Object.assign(new Error(m.message), { code: m.code }));
      };
      if (port) {
        drops.add(end);
        port.postMessage({ t: "prompt", system: ask.system || options.system, messages: ask.messages, maxTokens: ask.maxTokens || options.maxTokens }, [line.port2]);
      } else end(noModel());
      const pieces = (async function* () {
        for (;;) {
          while (queue.length) yield queue.shift();
          if (failure) throw failure;
          if (finished) return;
          await new Promise((resolve) => { wake = resolve; });
        }
      })();
      return {
        [Symbol.asyncIterator]: () => pieces,
        async text() { let all = ""; for await (const piece of pieces) all += piece; return all; },
        cancel() { try { line.port1.postMessage({ t: "cancel" }); } catch { /* closed */ } },
        get usage() { return result ? result.usage : null; },
      };
    },

    // The same model in the shape of the Chat Completions API: the same
    // request in, and the same completion object out, or with stream: true
    // something you can `for await` over for the same chunks. The person
    // chose the model, so `model` in the request is ignored and the answer
    // says which model it was. A user message can carry images, and the
    // request can list tools: the answer then names the calls the model
    // wants made, and this site decides whether to make them. A setting the
    // router does not pass on is refused, not quietly dropped. Pass
    // { signal } as the second argument to stop it.
    chat: {
      completions: {
        async create(body, options = {}) {
          const whole = untilDropped();
          try {
            if (!port) throw noModel();
            const { api: far } = await Promise.race([chatRemote(), whole.lost]);
            const answer = await Promise.race([far.chat.completions.create(body, options.signal ? { signal: options.signal } : {}), whole.lost]);
            if (answer && answer.error) throw chatError(answer.error);
            if (!answer || typeof answer[Symbol.asyncIterator] !== "function") return answer;
            const chunks = answer[Symbol.asyncIterator]();
            const each = untilDropped();
            return (async function* () {
              try {
                for (;;) {
                  const { value, done } = await Promise.race([chunks.next(), each.lost]);
                  if (done) return;
                  if (value.error) throw chatError(value.error);
                  yield value;
                }
              } catch (error) { throw asChatError(error); } finally {
                each.off();
                Promise.resolve().then(() => chunks.return?.()).catch(() => {});   // tells the router to stop, if it has not finished
              }
            })();
          } catch (error) { throw asChatError(error); } finally { whole.off(); }
        },
      },
    },

    // Ask for another port into the same grant, to give to a worker or to
    // someone else. With { requests: n } it stops working after n requests.
    // A lent port cannot lend again.
    lend(limits = {}) { return askForPort({ t: "lend", requests: limits.requests }); },

    // Drop this site's grant from this browser.
    forget() { if (port) port.postMessage({ t: "forget" }); },
  };
  return { api, attach, detach, begin: () => first() };
}

// Wrap any port into the router. connect() uses it, and so does a worker or
// another page that was handed a lent port.
export function fromPort(port) {
  const link = channel();
  link.attach(port);
  return link.api;
}

// Add the hidden router frame to this page and say hello to it. Resolves
// false when the frame does not answer: this page's own
// Content-Security-Policy may forbid it, or the router may be out of reach.
function openFrame(link) {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.src = ROUTER + "/frame.html";
    frame.hidden = true;
    frame.title = "AI router";
    frame.allow = "language-model";    // lets the frame use the browser's built-in model, where there is one
    frame.referrerPolicy = "no-referrer";    // the router's server is not told which site the frame is for
    const line = new MessageChannel();
    let settled = false;
    let timer = setTimeout(() => finish(false), 10000);    // it never loaded at all
    function finish(ok) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeEventListener("message", heard);
      document.removeEventListener("securitypolicyviolation", refused);
      if (!ok) frame.remove();
      resolve(ok);
    }
    // The frame says it is there, and then the worker inside it reports on this site's grant.
    function heard(event) {
      if (event.source !== frame.contentWindow || event.origin !== ROUTER || !event.data || event.data.router !== "frame-ready") return;
      clearTimeout(timer);
      link.attach(line.port1);
      link.api.started.then(() => finish(true));
    }
    // This page's own policy would not let the frame load.
    function refused(event) {
      if (event.disposition === "enforce" && String(event.blockedURI).startsWith(ROUTER) && /^(frame-src|child-src|default-src)/.test(event.effectiveDirective || event.violatedDirective || "")) finish(false);
    }
    addEventListener("message", heard);
    document.addEventListener("securitypolicyviolation", refused);
    frame.onload = () => {
      try { frame.contentWindow.postMessage({ router: "hello" }, ROUTER, [line.port2]); } catch { return finish(false); }
      // The router frame answers at once. A page that loaded in its place does not.
      clearTimeout(timer);
      timer = setTimeout(() => finish(false), 2500);
    };
    frame.onerror = () => finish(false);
    document.body.append(frame);
  });
}

const POPUP = () => { const w = 460, h = 640; return `popup,width=${w},height=${h},left=${Math.max(0, screenX + (outerWidth - w) / 2)},top=${Math.max(0, screenY + (outerHeight - h) / 2)}`; };
const blocked = () => Object.assign(new Error("Your browser blocked the router window. Allow popups for this site and click again."), { code: "popup-blocked" });
const noAddress = () => Object.assign(new Error("This page has no address of its own: it is sandboxed, or it is not http or https. The router keeps what a person allows under a site's address, so it cannot work here."), { code: "no-address" });
const cutOff = () => Object.assign(new Error("This page is sent with Cross-Origin-Opener-Policy: same-origin, so the browser cuts it off from every window it opens. The router window cannot reach this page, and the router cannot work here."), { code: "cut-off" });
// A page is told nothing when the browser cuts it off from a window: the
// window only looks closed. Its own headers say whether that is the reason.
// They are asked for once, and only after a window has come to nothing.
let asked = null;
const isCutOff = () => asked ||= fetch(location.href, { method: "HEAD", cache: "no-store" })
  .then((response) => /^\s*same-origin\s*(;|$)/i.test(response.headers.get("cross-origin-opener-policy") || ""), () => false);

// Connect this page to the router. Resolves to the object described at the
// top of this file, with choose() and mode added.
export async function connect(options = {}) {
  const link = channel();
  const api = link.api;
  api.router = ROUTER;
  // Hawser carries the Chat Completions calls, and is only needed for the first of them. It is asked for now,
  // so that the browser has a copy of it if the router's address cannot be reached when that call comes.
  import(ROUTER + "/hawser.js").catch(() => {});
  // A sandboxed page, or one that is not http or https, has no address. The
  // router frame and the router window would both refuse it, so neither is opened.
  const homeless = self.origin === "null" || !/^https?:$/.test(location.protocol);
  const viaFrame = !homeless && options.via !== "window" && await openFrame(link);
  Object.defineProperty(api, "mode", { value: viaFrame ? "frame" : "window", enumerable: true });

  // choose() opens the router window so the person can pick an account and a
  // model. Browsers only allow a window to open during a click. It resolves
  // true when this site has a model afterwards, false if the person closed
  // the window or said no. It rejects with code "popup-blocked" if the
  // browser blocked the window, and with "cut-off" or "no-address" on a page
  // the router cannot work on.

  if (homeless) {
    link.begin();
    api.choose = () => Promise.reject(noAddress());
    return api;
  }

  if (viaFrame) {
    // The window finds the frame inside this page, hands it the grant and closes.
    api.choose = () => new Promise((resolve, reject) => {
      const picker = window.open(ROUTER + "/pick.html", "ai-router-picker", POPUP());
      if (!picker) return reject(blocked());
      const before = api.model ? JSON.stringify(api.model) + api.expires : "";
      const off = api.onchange(() => { if (api.ready && JSON.stringify(api.model) + api.expires !== before) { off(); clearInterval(timer); resolve(true); } });
      const timer = setInterval(() => {
        if (!picker.closed) return;
        clearInterval(timer);
        setTimeout(async () => {
          off();
          if (api.ready && JSON.stringify(api.model) + api.expires !== before) return resolve(true);
          // Nothing was chosen. The person may have closed the window, or the browser may have cut it off.
          if (await isCutOff()) reject(cutOff()); else resolve(false);
        }, 300);
      }, 300);
    });
    return api;
  }

  // With no frame, the window is the way through, and it stays open. This page
  // passes it a port, as it would have passed one to the frame. The browser
  // tells the window which site the port came from.
  link.begin();
  let picker = null;      // the router window, while it is open
  let watching = null;
  let answer = null;      // settles the choose() that is waiting: { resolve, reject }
  let heard = false;      // whether the window that is open has ever spoken to this page
  const settle = (ok) => {
    const done = answer;
    answer = null;
    if (!done) return;
    if (!ok || api.ready) return done.resolve(!!ok);
    // The window said yes. Wait for the port to say so too.
    const off = api.onchange(() => { if (api.ready) { off(); clearTimeout(late); done.resolve(true); } });
    const late = setTimeout(() => { off(); done.resolve(api.ready); }, 3000);
  };
  const fail = (error) => {
    const done = answer;
    answer = null;
    if (done) done.reject(error);
  };
  const lost = () => {
    clearInterval(watching);
    picker = null;
    link.detach();
    const silent = !heard;
    heard = false;
    if (!silent || !answer) return settle(false);
    // The window went without a word. The person may have closed it at once, or the browser may have cut it off.
    const done = answer;
    answer = null;
    isCutOff().then((cut) => { if (cut) done.reject(cutOff()); else done.resolve(false); });
  };
  addEventListener("message", (event) => {
    if (!picker || event.source !== picker || event.origin !== ROUTER) return;
    const message = event.data || {};
    if (message.router === "picker-ready") {
      heard = true;
      const line = new MessageChannel();
      picker.postMessage({ router: "hello" }, ROUTER, [line.port2]);   // only a page at the router's address can receive this
      link.attach(line.port1);
    } else if (message.router === "picked") settle(!!message.ok);
    else if (message.router === "closing") lost();
    else if (message.router === "refused") {
      // The window will not serve this page, and says why. The port this page passed it leads nowhere.
      clearInterval(watching);
      picker = null;
      heard = false;
      link.detach();
      fail(message.why === "no-address" ? noAddress() : closed());
    }
  });
  // The window has no reason to stay once this page has gone.
  addEventListener("pagehide", () => { try { if (picker && !picker.closed) picker.postMessage({ router: "bye" }, ROUTER); } catch { /* gone */ } });

  api.choose = () => new Promise((resolve, reject) => {
    settle(false);
    if (picker && !picker.closed) {
      // The window is open. Bring it forward so the person can choose again.
      answer = { resolve, reject };
      picker.postMessage({ router: "choose" }, ROUTER);
      try { picker.focus(); } catch { /* not allowed */ }
      return;
    }
    picker = window.open(ROUTER + "/pick.html#window", "ai-router-picker", POPUP());
    if (!picker) { picker = null; return reject(blocked()); }
    answer = { resolve, reject };
    heard = false;
    clearInterval(watching);
    watching = setInterval(() => { if (picker && picker.closed) lost(); }, 300);
  });
  return api;
}
