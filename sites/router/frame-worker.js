// The worker inside the router frame, or inside the router window when that
// serves a site (see host.js). It holds the ports that sites, their workers
// and their frames send prompts on. It keeps the site's grant in storage and
// counts every prompt against it. Then it hands the request to the worker that
// may call the provider (call-worker.js). This worker cannot connect to anything: no
// server is asked, and the browser allows it no connection. Nothing can reach
// it except through a port it was given.

import { generate, PROVIDERS } from "/providers.js";
import { askOver } from "/line.js";
import { chatApi } from "/chat.js";
import { change, read, save, remove, stateOf, view } from "/grants.js";

let site = null;          // the site this worker serves
let grant = null;         // this site's grant as last read. Storage is what counts: another tab of the same site shares it
let builtin = null;       // a port to the page that started this worker, for the browser's built-in model
let active = 0;           // requests that are with the provider now
let ready;
const started = new Promise((resolve) => { ready = resolve; });
const ports = new Set();  // every port that should hear about a change of state

function state() {
  if (!grant) return { t: "state", ready: false };
  return { t: "state", ready: true, model: { id: grant.provider, provider: grant.providerName, name: grant.model, account: grant.label }, left: Math.max(0, grant.requests - grant.used), expires: grant.expires };
}
// Another page of the same site has a worker like this one, and they share the
// storage the grant is in. Each tells the others when it changes the grant, so
// that a site stopped in one tab is told so in every tab.
let others = null;
// Read the grant again from storage, where it may have been changed by one of the others.
const refresh = async () => {
  try { grant = await read(site); } catch { grant = null; }
  if (grant && stateOf(grant) !== "active") grant = null;
};
// Tell every port what the site may be told, and tell the page that started this worker the rest.
const announce = (spread = true) => {
  for (const port of ports) port.postMessage(state());
  postMessage({ t: "now", grant: view(grant) });
  if (spread && others) others.postMessage("changed");
};
const forget = async () => { grant = null; try { await remove(site); } catch { /* nothing kept */ } announce(); };

// The page that may call this grant's provider. The host page opens it and sends a
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

// One request: count it against the grant, hand it to the page that calls the
// provider, and yield each piece of text. Returns { usage, left } at the end.
// The API key stays encrypted here: the encrypted copy and the key that opens
// it are passed on together, and this worker has no code that opens it.
// request: { system, messages, maxTokens, temperature, topP, stop, tools, toolChoice, parallel }
// The shapes are set out above generate() in providers.js.
async function* answer(request, budget, signal) {
  if (budget) {
    if (budget.left <= 0) throw refuse("limit", "This port was lent for a fixed number of requests and has used them all.");
    budget.left--;
  }
  // Read the grant, see that it is still good, and count this request, in one
  // step. A grant that has run out or been used up is deleted here, with its key.
  let taken;
  try {
    taken = await change(site, (kept) => {
      const is = stateOf(kept);
      if (is !== "active") return { out: { why: is }, remove: !!kept };
      kept.used++;
      kept.last = Date.now();
      return { put: kept, out: { grant: kept } };
    });
  } catch { if (budget) budget.left++; throw refuse("storage", "The router could not read this site's grant from the browser's storage."); }
  if (!taken.grant) {
    if (budget) budget.left++;
    const had = grant;
    grant = null;
    if (had) announce();
    if (taken.why === "none") throw refuse("no-grant", "This site has no model yet. Ask the person to choose one.");
    throw refuse(taken.why === "used up" ? "limit" : "no-grant", taken.why === "used up" ? "This site has used all the requests it was given." : "The grant for this site has expired.");
  }
  grant = taken.grant;
  const mine = grant;
  let usage = null;
  // Tell the page that started this worker that a request is with the provider,
  // so that it keeps the page that makes the call open until the answer is in.
  postMessage({ t: "active", n: ++active });
  try {
    const wanted = { system: request.system, messages: request.messages, maxTokens: request.maxTokens, temperature: request.temperature, topP: request.topP, stop: request.stop, tools: request.tools, toolChoice: request.toolChoice, parallel: request.parallel };
    const pieces = mine.provider === "builtin" ? askOver(builtin, wanted, signal)
      : PROVIDERS[mine.provider] && PROVIDERS[mine.provider].kind
        ? askOver(await callerFor(mine.provider), { account: { provider: mine.provider, model: mine.model, sealed: mine.sealed, opens: mine.key }, ask: wanted }, signal)
        : generate({ provider: mine.provider, model: mine.model }, wanted, signal);   // not a provider the router knows: generate() says so
    for (;;) {
      const { value, done } = await pieces.next();
      if (done) { usage = value; break; }
      yield value;
    }
    return { usage, left: Math.max(0, mine.requests - mine.used) };
  } finally {
    // Add the tokens to the same grant, if the site still has it.
    if (usage && (usage.tokensIn || usage.tokensOut)) {
      try {
        const after = await change(site, (kept) => (kept && kept.id === mine.id ? { put: { ...kept, tokensIn: kept.tokensIn + usage.tokensIn, tokensOut: kept.tokensOut + usage.tokensOut }, out: true } : { out: false }));
        if (after && grant && grant.id === mine.id) grant = await read(site);
      } catch { /* the count of tokens is a note, not a limit */ }
    }
    postMessage({ t: "active", n: --active });
    announce();
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
      if (typeof value === "string") reply.postMessage({ t: "text", text: value });   // these few messages carry text only
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
    } else if (message.t === "forget" && !budget) forget();
  };
  port.postMessage(state());
}

// Messages from the page that started this worker.
onmessage = async (event) => {
  const message = event.data;
  if (message.t === "init") {
    site = message.site;
    builtin = event.ports[1];
    try { grant = await read(site); } catch { grant = null; }
    // A grant that is no longer good, or is for a model the router no longer has, is dropped. The site asks again.
    if (grant && (grant.site !== site || !Object.hasOwn(PROVIDERS, grant.provider) || stateOf(grant) !== "active")) { grant = null; try { await remove(site); } catch { /* nothing kept */ } }
    serve(event.ports[0]);    // the site's own port
    // The page that started this worker listens on a port of its own, to show
    // the person what the site is told. It is never served: nothing it posts is read.
    if (event.ports[2]) { ports.add(event.ports[2]); event.ports[2].postMessage(state()); }
    postMessage({ t: "now", grant: view(grant) });
    try { others = new BroadcastChannel("router.grant:" + site); others.onmessage = async () => { await refresh(); announce(false); }; } catch { /* no such channel here */ }
    ready();
  } else if (message.t === "caller") {
    setCaller(message.provider, event.ports[0]);
  } else if (message.t === "grant") {
    // A new grant from the router window, with the key that opens its API key. It replaces the one before.
    await started;
    let ok = true;
    try { await save(message.grant); grant = message.grant; } catch { ok = false; }
    announce();     // first, so that the page knows the new grant by the time it hears that it is stored
    postMessage({ t: "stored", n: message.n, ok });
  } else if (message.t === "current") {
    // The router window is asking what this site has now. Storage says, not this worker's memory.
    await started;
    await refresh();
    announce(false);
    postMessage({ t: "current", n: message.n, grant: view(grant) });
  } else if (message.t === "stop") {
    await started;
    await forget();
    postMessage({ t: "stopped", n: message.n });
  }
};
