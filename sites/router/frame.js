// The router frame. A site puts this page in a hidden iframe.
//
// The frame does three small jobs and then stays out of the way:
//   1. It learns from the browser which site it is inside.
//   2. It keeps that site's grant in storage, and takes a new grant from the
//      picker window when the person chooses one.
//   3. It starts a worker and passes the site's port straight on to it.
//
// After that, prompts go from the site's page to the worker over the port.
// The worker is the only place the API key is ever unlocked.

import { generate } from "/providers.js";

let site = null;    // the origin of the page this frame is inside
let KEY = null;     // the grant is stored under that origin, so each site has its own
let grant = null;
const worker = new Worker("/frame-worker.js", { type: "module" });

worker.onmessage = (event) => {
  // The worker found out the grant is no longer good, or the site asked to forget it.
  if (event.data.t === "forget") { grant = null; localStorage.removeItem(KEY); }
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
        localStorage.setItem(KEY, JSON.stringify(grant));
        worker.postMessage({ t: "grant", grant, info: data.info });
        line.postMessage({ t: "stored" });
      }
      line.close();
    };
    line.postMessage({ t: "site", site, current: grant ? { label: grant.label, model: grant.model } : null });
  }
});
