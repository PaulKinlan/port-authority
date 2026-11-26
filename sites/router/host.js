// What a router page does to serve one site.
//
// Two router pages can do this job:
//   - the hidden frame inside the site (frame.js). This is the usual way.
//   - the router window itself (pick.js), for a site that cannot have the
//     frame, for example because its own Content-Security-Policy forbids it.
//     The window then has to stay open.
//
// Either way the page:
//   1. starts the worker and passes the site's port straight on to it. The
//      worker keeps that site's grant in storage, under the site's address,
//      and counts every request against it (grants.js)
//   2. takes a new grant from the router window: it makes the key pair the
//      window encrypts the API key to, and keeps the key that opens it (seal.js)
//   3. opens the one page that may call the provider the person chose, and
//      gives the worker a port to it
//   4. lends the worker a port for the browser's built-in model, which a
//      worker cannot use itself
//
// After that, prompts go from the site to the worker over the port. This page
// and its worker cannot connect to anything: there is no server, and the
// browser is told to allow them no connection at all. The call to the provider
// is made by /call/<provider>, which the browser lets connect to that one
// provider only. The API key is opened there and nowhere else. See call.js.

import { generate, PROVIDERS } from "/providers.js";
import { openCaller } from "/caller.js";
import { offer } from "/seal.js";

// site:     the origin of the site, as the browser reported it
// sitePort: the port the site passed
// Returns { current(), offer(), setGrant(grant), stop(), onstate, onforget, close() }.
export function startHost(site, sitePort) {
  // A grant from before, when the router had a server, cannot be used without it.
  try { localStorage.removeItem("router.grant:" + site); } catch { /* storage blocked */ }
  let now = null;       // what the worker last said this site's grant is: a view of it, with no key in it
  let first;
  const loaded = new Promise((resolve) => { first = resolve; });
  let mine = null;      // the key pair made for the handover that is under way
  let count = 0;
  const waiting = new Map();    // questions to the worker, until it answers
  const askWorker = (message) => new Promise((resolve) => { const n = ++count; waiting.set(n, resolve); worker.postMessage({ ...message, n }); });

  const worker = new Worker("/frame-worker.js", { type: "module" });
  let caller = null;  // { provider, close }: the page that may call this grant's provider

  // Open the page for the grant's provider, and close the one for the provider
  // before it. The browser's built-in model makes no network call, so it gets
  // no such page.
  // A request that is already with the provider is let finish first: the page it
  // is using is not closed under it. The worker says how many are under way.
  let wanted = null;    // the grant the page should be open for
  let active = 0;       // requests that are with the provider now
  const lock = (next) => { wanted = next; return fit(); };
  async function fit() {
    const next = wanted;
    const provider = next && PROVIDERS[next.provider] && PROVIDERS[next.provider].kind ? next.provider : null;
    if ((caller ? caller.provider : null) === provider) return;
    if (caller && active > 0) return;    // fit() runs again when the last of them is done
    if (caller) { caller.close(); caller = null; worker.postMessage({ t: "caller", provider: null }); }
    if (!provider) return;
    const mine = caller = { provider, close() {} };
    try {
      const opened = await openCaller(provider);
      if (caller !== mine) return opened.close();   // the person chose again while it was loading
      mine.close = opened.close;
      worker.postMessage({ t: "caller", provider }, [opened.port]);
    } catch { if (caller === mine) caller = null; }
  }

  const host = {
    onstate: null,    // called with what the site is told about its grant, each time it changes
    onforget: null,   // called when the grant is dropped
    // What this site has now, for the router window to show: the account, the model, the limits and what is used.
    // The worker reads it from storage each time: another tab of the same site may have used some since.
    current: async () => { await loaded; return (await askWorker({ t: "current" })).grant; },
    // The public half of a new key pair. The window encrypts the API key to it.
    offer: async () => { mine = await offer(); return mine.pub; },
    // A new grant from the router window. Resolves true once the worker has it in storage.
    async setGrant(grant) {
      const opens = grant.sealed && mine ? await mine.open(grant.sealed.from) : null;
      if (grant.sealed && !opens) return false;
      const kept = { ...grant, sealed: grant.sealed ? { iv: grant.sealed.iv, data: grant.sealed.data } : null, key: opens };
      return (await askWorker({ t: "grant", grant: kept })).ok !== false;
    },
    // The person pressed Stop in the router window. The grant and the key are deleted.
    stop: () => askWorker({ t: "stop" }),
    close() { worker.terminate(); if (caller) caller.close(); caller = null; },
  };

  worker.onmessage = (event) => {
    const message = event.data || {};
    if (message.t === "now") {
      // The worker says what the grant is now: after it read it, after a request, after it was dropped.
      const had = now;
      now = message.grant;
      lock(now);
      first();
      if (had && !now) host.onforget?.();
    } else if (message.t === "active") {
      active = message.n;
      if (!active) fit();
    } else if (waiting.has(message.n)) { waiting.get(message.n)(message); waiting.delete(message.n); }
  };

  // A worker cannot use the browser's built-in model, so this page lends it a
  // port that speaks the same messages a site uses: a prompt in, text out.
  const local = new MessageChannel();
  local.port1.onmessage = async (event) => {
    const reply = event.ports[0];
    const stop = new AbortController();
    reply.onmessage = (m) => { if (m.data && m.data.t === "cancel") stop.abort(new DOMException("cancelled", "AbortError")); };
    try {
      for await (const piece of generate({ provider: "builtin" }, event.data, stop.signal)) reply.postMessage({ t: "text", text: piece });
      reply.postMessage({ t: "done" });
    } catch (error) { reply.postMessage({ t: "error", code: error.code || "provider", message: String(error.message || error) }); }
    reply.close();
  };

  // A port this page only listens on, to hear what the site is told about its grant.
  const watch = new MessageChannel();
  watch.port1.onmessage = (event) => host.onstate?.(event.data);

  worker.postMessage({ t: "init", site }, [sitePort, local.port2, watch.port2]);
  return host;
}
