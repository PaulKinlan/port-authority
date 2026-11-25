// What a router page does to serve one site.
//
// Two router pages can do this job:
//   - the hidden frame inside the site (frame.js). This is the usual way.
//   - the router window itself (pick.js), for a site that cannot have the
//     frame, for example because its own Content-Security-Policy forbids it.
//     The window then has to stay open.
//
// Either way the page:
//   1. keeps that site's grant in storage, under the site's address
//   2. starts the worker and passes the site's port straight on to it
//   3. opens the one page that may call the provider the person chose, and
//      gives the worker a port to it
//   4. lends the worker a port for the browser's built-in model, which a
//      worker cannot use itself
//
// After that, prompts go from the site to the worker over the port. This page
// and its worker can connect to the router's own server and to nothing else.
// The call to the provider is made by /call.html, which the browser lets
// connect to that one provider only. The API key is unlocked there and nowhere
// else. See call.js.

import { generate, PROVIDERS } from "/providers.js";
import { openCaller } from "/caller.js";

// site:     the origin of the site, as the browser reported it
// sitePort: the port the site passed
// Returns { current(), setGrant(grant, info), onstate, onforget, close() }.
export function startHost(site, sitePort) {
  const KEY = "router.grant:" + site;    // each site has its own grant
  const drop = () => { try { localStorage.removeItem(KEY); } catch { /* third-party storage blocked */ } };
  let grant = null;
  try { grant = JSON.parse(localStorage.getItem(KEY)); } catch { /* none */ }
  if (grant && grant.site !== site) grant = null;
  // A grant for a model the router no longer has is dropped, and the site asks again.
  if (grant && !Object.hasOwn(PROVIDERS, grant.provider)) { grant = null; drop(); }

  const worker = new Worker("/frame-worker.js", { type: "module" });
  let caller = null;  // { provider, close }: the page that may call this grant's provider

  // Open the page for the grant's provider, and close the one for the provider
  // before it. The browser's built-in model makes no network call, so it gets
  // no such page.
  async function lock(next) {
    const provider = next && PROVIDERS[next.provider] && PROVIDERS[next.provider].kind ? next.provider : null;
    if ((caller ? caller.provider : null) === provider) return;
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
    onstate: null,    // called with the worker's state each time it changes
    onforget: null,   // called when the grant is dropped
    // The account and model this site uses now, for the router window to show.
    current: () => (grant ? { label: grant.label, model: grant.model } : null),
    // A new grant from the router window.
    setGrant(next, info) {
      grant = next;
      try { localStorage.setItem(KEY, JSON.stringify(grant)); } catch { /* third-party storage blocked */ }
      worker.postMessage({ t: "grant", grant, info });
      lock(grant);
    },
    close() { worker.terminate(); if (caller) caller.close(); caller = null; },
  };

  worker.onmessage = (event) => {
    // The worker found out the grant is no longer good, or the site asked to forget it.
    if (event.data.t === "forget") { grant = null; lock(null); drop(); host.onforget?.(); }
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

  worker.postMessage({ t: "init", site, grant }, [sitePort, local.port2, watch.port2]);
  lock(grant);
  return host;
}
