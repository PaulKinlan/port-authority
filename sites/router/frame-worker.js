// The worker inside the router frame. It holds the ports that sites, their
// workers and their frames send prompts on. For each prompt it asks the
// router's server whether the grant is still good, and then hands the request
// to the page that may call the provider (call.js). This worker can connect to
// the router's server and to nothing else, so it cannot reach a provider
// itself. Nothing can reach it except through a port it was given.

import { generate, PROVIDERS } from "/providers.js";
import { askOver } from "/line.js";
import { chatApi } from "/chat.js";

let grant = null;         // this site's grant, kept in storage by the frame
let info = null;          // what the server last said about the grant
let builtin = null;       // a port to the frame, for the browser's built-in model
let ready;
const started = new Promise((resolve) => { ready = resolve; });
const ports = new Set();  // every port that should hear about a change of state

const ask = async (action, extra = {}) => {
  const response = await fetch(`/r/${grant.person}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: grant.id, secret: grant.secret, ...extra }) });
  return response.json();
};
const forget = () => { grant = null; info = null; postMessage({ t: "forget" }); };

function state() {
  if (!grant) return { t: "state", ready: false };
  return { t: "state", ready: true, model: { provider: grant.providerName, name: grant.model, account: grant.label }, left: info ? info.requests - info.used : null, expires: info ? info.expires : null };
}
const announce = () => { for (const port of ports) port.postMessage(state()); };

// The page that may call this grant's provider. The frame opens it and sends a
// port to it. A request that gets here first waits a few seconds for the port.
let caller = null;        // { provider, port }
let waiting = [];
function callerFor(provider) {
  if (caller && caller.provider === provider) return Promise.resolve(caller.port);
  return new Promise((resolve, reject) => {
    const entry = { provider, resolve };
    entry.timer = setTimeout(() => {
      waiting = waiting.filter((w) => w !== entry);
      reject(Object.assign(new Error("The router could not open the page that calls the provider."), { code: "provider" }));
    }, 8000);
    waiting.push(entry);
  });
}
function setCaller(provider, port) {
  caller = provider ? { provider, port } : null;
  if (!caller) return;
  for (const entry of waiting.filter((w) => w.provider === provider)) { clearTimeout(entry.timer); entry.resolve(port); }
  waiting = waiting.filter((w) => w.provider !== provider);
}

const refuse = (code, text) => Object.assign(new Error(text), { code });

// One request: ask the server, hand the request to the page that calls the
// provider, and yield each piece of text. Returns { usage, left } at the end.
// The API key stays encrypted here: the encrypted copy and the unlock key are
// passed on together.
// request: { system, messages, maxTokens, temperature, topP, stop }
async function* answer(request, budget, signal) {
  if (!grant) throw refuse("no-grant", "This site has no model yet. Ask the person to choose one.");
  if (budget) {
    if (budget.left <= 0) throw refuse("limit", "This port was lent for a fixed number of requests and has used them all.");
    budget.left--;
  }
  let allowed;
  try { allowed = await ask("use"); } catch { if (budget) budget.left++; throw refuse("offline", "The router server could not be reached."); }
  if (!allowed.ok) {
    if (budget) budget.left++;
    const why = allowed.why;
    forget(); announce();
    throw refuse(why === "used up" ? "limit" : "no-grant", why === "used up" ? "This site has used all the requests it was given." : `The grant for this site is ${why}.`);
  }
  info = allowed.grant;
  let usage = null;
  try {
    const wanted = { system: request.system, messages: request.messages, maxTokens: request.maxTokens, temperature: request.temperature, topP: request.topP, stop: request.stop };
    const pieces = grant.provider === "builtin" ? askOver(builtin, wanted, signal)
      : PROVIDERS[grant.provider] && PROVIDERS[grant.provider].kind
        ? askOver(await callerFor(grant.provider), { account: { provider: grant.provider, model: grant.model, wrap: allowed.wrap, sealed: grant.sealed }, ask: wanted }, signal)
        : generate({ provider: grant.provider, model: grant.model }, wanted, signal);   // not a provider the router knows: generate() says so
    for (;;) {
      const { value, done } = await pieces.next();
      if (done) { usage = value; break; }
      yield value;
    }
    return { usage, left: info.requests - info.used };
  } finally {
    announce();
    if (usage && (usage.tokensIn || usage.tokensOut)) ask("report", usage).catch(() => {});
  }
}

// The router's own few messages: the answer goes to the reply port, piece by piece.
async function run(message, reply, budget) {
  const stop = new AbortController();
  reply.onmessage = (event) => { if (event.data && event.data.t === "cancel") stop.abort(new DOMException("cancelled", "AbortError")); };
  try {
    const pieces = answer({ system: message.system, messages: message.messages, maxTokens: message.maxTokens }, budget, stop.signal);
    for (;;) {
      const { value, done } = await pieces.next();
      if (done) { reply.postMessage({ t: "done", usage: value.usage, left: value.left }); break; }
      reply.postMessage({ t: "text", text: value });
    }
  } catch (error) {
    reply.postMessage({ t: "error", code: error.name === "AbortError" ? "cancelled" : error.code || "provider", message: String(error.message || error) });
  }
  reply.close();
}

// The same model in the shape of the Chat Completions API. The site asks for a
// port, and on that port this worker answers calls to chat.completions.create
// and to nothing else. It is the same grant and the same budget as the port the
// site asked on. Hawser carries the calls. See chat.js.
async function chatPort(budget) {
  const { expose } = await import("/hawser.js");
  const line = new MessageChannel();
  expose(chatApi((request, signal) => answer(request, budget, signal), () => (grant ? grant.model : null)), line.port1, { only: ["chat.completions.create"] });
  return line.port2;
}

// Every port into this worker speaks the same few messages. A lent port has a
// budget of its own and cannot lend further or forget the grant.
function serve(port, budget = null) {
  ports.add(port);
  port.onmessage = (event) => {
    const message = event.data || {};
    if (message.t === "prompt" && event.ports[0]) run(message, event.ports[0], budget);
    else if (message.t === "state") port.postMessage(state());
    else if (message.t === "lend" && !budget) {
      const line = new MessageChannel();
      const requests = Number(message.requests) > 0 ? Math.round(Number(message.requests)) : null;
      serve(line.port1, requests ? { left: requests } : null);
      port.postMessage({ t: "lent", n: message.n }, [line.port2]);
    } else if (message.t === "api") {
      chatPort(budget).then((line) => port.postMessage({ t: "api", n: message.n }, [line]));
    } else if (message.t === "forget" && !budget) { forget(); announce(); }
  };
  port.postMessage(state());
}

// Messages from the frame that started this worker.
onmessage = async (event) => {
  const message = event.data;
  if (message.t === "init") {
    grant = message.grant;
    builtin = event.ports[1];
    if (grant) {
      try { const answer = await ask("status"); if (answer.ok) info = answer.grant; else forget(); }
      catch { /* offline: keep the grant, the next request will ask again */ }
    }
    serve(event.ports[0]);    // the site's own port
    ready();
  } else if (message.t === "caller") {
    setCaller(message.provider, event.ports[0]);
  } else if (message.t === "grant") {
    await started;
    grant = message.grant;
    info = message.info;
    announce();
  }
};
