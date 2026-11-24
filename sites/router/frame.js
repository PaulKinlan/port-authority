// The router frame. A site puts this page in a hidden iframe.
//
// The frame does four small jobs and then stays out of the way:
//   1. It learns from the browser which site it is inside.
//   2. It keeps that site's grant in storage, and takes a new grant from the
//      picker window when the person chooses one.
//   3. It starts a worker and passes the site's port straight on to it.
//   4. It opens the one page that may call the provider the person chose, and
//      gives the worker a port to it.
//
// After that, prompts go from the site's page to the worker over the port.
// This frame and its worker can connect to the router's own server and to
// nothing else. The call to the provider is made by /call.html, which the
// browser lets connect to that one provider only. The API key is unlocked
// there and nowhere else. See call.js.

import { generate, PROVIDERS } from "/providers.js";
import { openCaller } from "/caller.js";

let site = null;    // the origin of the page this frame is inside
let KEY = null;     // the grant is stored under that origin, so each site has its own
let grant = null;
let caller = null;  // { provider, close }: the page that may call this grant's provider
const worker = new Worker("/frame-worker.js", { type: "module" });

// Open the page for the grant's provider, and close the one for the provider
// before it. The built-in model and the practice model make no network call,
// so they get no such page.
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

worker.onmessage = (event) => {
  // The worker found out the grant is no longer good, or the site asked to forget it.
  if (event.data.t === "forget") { grant = null; lock(null); try { localStorage.removeItem(KEY); } catch { /* third-party storage blocked */ } }
};

// A worker cannot use the browser's built-in model, so the frame lends it a
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

addEventListener("message", (event) => {
  const message = event.data || {};

  // The page this frame is inside says hello and passes a port. event.origin
  // comes from the browser, so the site cannot claim to be another site.
  if (message.router === "hello" && event.source === parent && parent !== window && event.ports[0]) {
    if (site) return;     // one page, one hello
    site = event.origin;
    KEY = "router.grant:" + site;
    try { grant = JSON.parse(localStorage.getItem(KEY)); } catch { /* none */ }
    if (grant && grant.site !== site) grant = null;
    worker.postMessage({ t: "init", site, grant }, [event.ports[0], local.port2]);
    lock(grant);
    return;
  }

  // The picker window found this frame and wants to hand over a grant. The
  // browser only delivers this message if the sender named the router's
  // address as the target, and event.origin proves the sender is a router page.
  if (message.router === "picker" && event.origin === location.origin && event.ports[0]) {
    const line = event.ports[0];
    line.onmessage = (answer) => {
      const data = answer.data || {};
      if (data.t === "grant" && data.grant && site && data.grant.site === site) {
        grant = data.grant;
        try { localStorage.setItem(KEY, JSON.stringify(grant)); } catch { /* third-party storage blocked */ }
        worker.postMessage({ t: "grant", grant, info: data.info });
        lock(grant);
        line.postMessage({ t: "stored" });
      }
      line.close();
    };
    line.postMessage({ t: "site", site, current: grant ? { label: grant.label, model: grant.model } : null });
  }
});
