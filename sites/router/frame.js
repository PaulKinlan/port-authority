// The router frame. A site puts this page in a hidden iframe.
//
// The frame learns from the browser which site it is inside, and then serves
// that site: it keeps the site's grant, starts the worker that holds the
// site's ports, and opens the one page that may call the provider the person
// chose. All of that is in host.js, because the router window can do the same
// job for a site that cannot have this frame.
//
// What is only the frame's: the two hellos. One from the site it is inside,
// and one from the router window when the person chooses.

import { startHost } from "/host.js";

let site = null;    // the origin of the page this frame is inside
let host = null;

addEventListener("message", (event) => {
  const message = event.data || {};

  // The page this frame is inside says hello and passes a port. event.origin
  // comes from the browser, so the site cannot claim to be another site.
  if (message.router === "hello" && event.source === parent && parent !== window && event.ports[0]) {
    if (site) return;     // one page, one hello
    site = event.origin;
    host = startHost(site, event.ports[0]);
    // Tell the site the frame is here. A site that hears nothing knows the
    // frame did not load, and uses the router window in its place.
    parent.postMessage({ router: "frame-ready" }, site === "null" ? "*" : site);   // carries nothing; a sandboxed page has no address to name
    return;
  }

  // The picker window found this frame and wants to hand over a grant. The
  // browser only delivers this message if the sender named the router's
  // address as the target, and event.origin proves the sender is a router page.
  if (message.router === "picker" && event.origin === location.origin && event.ports[0]) {
    const line = event.ports[0];
    if (!host) return line.close();
    line.onmessage = (answer) => {
      const data = answer.data || {};
      if (data.t === "grant" && data.grant && data.grant.site === site) {
        host.setGrant(data.grant, data.info);
        line.postMessage({ t: "stored" });
      }
      line.close();
    };
    line.postMessage({ t: "site", site, current: host.current() });
  }
});
