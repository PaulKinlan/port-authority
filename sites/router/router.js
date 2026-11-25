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
// The site never sees an API key. It holds a MessagePort into a hidden frame
// served from the router's address, and that frame makes the calls.

const ROUTER = new URL(import.meta.url).origin;

// Wrap any port into the router frame. connect() uses it, and so does a
// worker or another page that was handed a lent port.
export function fromPort(port) {
  let current = { ready: false };
  let lends = 0;
  const waiting = new Map();
  const changed = new Set();
  let first;
  const started = new Promise((resolve) => { first = resolve; });
  port.onmessage = (event) => {
    const message = event.data || {};
    if (message.t === "state") { current = message; first(); for (const fn of changed) fn(api); }
    else if (message.t === "lent" || message.t === "api") { waiting.get(message.n)?.(event.ports[0]); waiting.delete(message.n); }
  };
  port.postMessage({ t: "state" });

  // The Chat Completions calls travel on a port of their own, carried by
  // Hawser. Both are fetched the first time a site calls create().
  let remote = null;
  const chatRemote = () => remote ??= (async () => {
    const n = ++lends;
    const asked = new Promise((resolve) => { waiting.set(n, resolve); port.postMessage({ t: "api", n }); });
    const [{ wrap }, line] = await Promise.all([import(ROUTER + "/hawser.js"), asked]);
    return { api: wrap(line) };
  })();
  // An error arrives in the shape the Chat Completions API uses, and is thrown
  // with the same fields an OpenAI client puts on its errors.
  const chatError = (e) => Object.assign(new Error(e.message), { name: e.code === "cancelled" ? "AbortError" : "Error", code: e.code, status: e.status, type: e.type, param: e.param, error: e });

  const api = {
    get ready() { return !!current.ready; },
    get model() { return current.model || null; },      // { provider, name, account }
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
      line.port1.onmessage = (event) => {
        const m = event.data;
        if (m.t === "text") queue.push(m.text);
        else if (m.t === "done") { finished = true; result = m; line.port1.close(); }
        else if (m.t === "error") { finished = true; failure = Object.assign(new Error(m.message), { code: m.code }); line.port1.close(); }
        wake?.(); wake = null;
      };
      port.postMessage({ t: "prompt", system: ask.system || options.system, messages: ask.messages, maxTokens: ask.maxTokens || options.maxTokens }, [line.port2]);
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
        cancel() { line.port1.postMessage({ t: "cancel" }); },
        get usage() { return result ? result.usage : null; },
      };
    },

    // The same model in the shape of the Chat Completions API: the same
    // request in, and the same completion object out, or with stream: true
    // something you can `for await` over for the same chunks. The person
    // chose the model, so `model` in the request is ignored and the answer
    // says which model it was. Text only: a request that asks for tools,
    // images or a setting the router does not pass on is refused, not
    // quietly changed. Pass { signal } as the second argument to stop it.
    chat: {
      completions: {
        async create(body, options = {}) {
          const { api } = await chatRemote();
          const answer = await api.chat.completions.create(body, options.signal ? { signal: options.signal } : {});
          if (answer && answer.error) throw chatError(answer.error);
          if (!answer || typeof answer[Symbol.asyncIterator] !== "function") return answer;
          return (async function* () {
            for await (const chunk of answer) {
              if (chunk.error) throw chatError(chunk.error);
              yield chunk;
            }
          })();
        },
      },
    },

    // Ask for another port into the same grant, to give to a worker or to
    // someone else. With { requests: n } it stops working after n requests.
    // A lent port cannot lend again.
    lend(limits = {}) {
      const n = ++lends;
      return new Promise((resolve) => { waiting.set(n, resolve); port.postMessage({ t: "lend", n, requests: limits.requests }); });
    },

    // Drop this site's grant from this browser.
    forget() { port.postMessage({ t: "forget" }); },
  };
  return api;
}

// Add the hidden router frame to this page and open a port to it.
export async function connect() {
  const frame = document.createElement("iframe");
  frame.src = ROUTER + "/frame.html";
  frame.hidden = true;
  frame.title = "AI router";
  frame.allow = "language-model";    // lets the frame use the browser's built-in model, where there is one
  const loaded = new Promise((resolve, reject) => { frame.onload = resolve; frame.onerror = () => reject(new Error("The router frame did not load.")); });
  document.body.append(frame);
  await loaded;
  const line = new MessageChannel();
  frame.contentWindow.postMessage({ router: "hello" }, ROUTER, [line.port2]);
  const api = fromPort(line.port1);
  await api.started;

  // Open the router window so the person can pick an account and a model.
  // Browsers only allow a window to open during a click. Resolves true when
  // this site has a model afterwards, false if the person closed it without
  // choosing, and rejects with code "popup-blocked" if the browser blocked the
  // window.
  api.choose = () => new Promise((resolve, reject) => {
    const w = 460, h = 640;
    const picker = window.open(ROUTER + "/pick.html", "ai-router-picker", `popup,width=${w},height=${h},left=${Math.max(0, screenX + (outerWidth - w) / 2)},top=${Math.max(0, screenY + (outerHeight - h) / 2)}`);
    if (!picker) return reject(Object.assign(new Error("Your browser blocked the router window. Allow popups for this site and click again."), { code: "popup-blocked" }));
    const before = api.model ? JSON.stringify(api.model) + api.expires : "";
    const off = api.onchange(() => { if (api.ready && JSON.stringify(api.model) + api.expires !== before) { off(); clearInterval(timer); resolve(true); } });
    const timer = setInterval(() => { if (picker.closed) { clearInterval(timer); setTimeout(() => { off(); resolve(api.ready && JSON.stringify(api.model) + api.expires !== before); }, 300); } }, 300);
  });
  api.router = ROUTER;
  return api;
}
