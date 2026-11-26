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
import "/keep.js";

let site = null;    // the origin of the page this frame is inside
let host = null;

addEventListener("message", (event) => {
  const message = event.data || {};

  // The page this frame is inside says hello and passes a port. event.origin
  // comes from the browser, so the site cannot claim to be another site.
  if (message.router === "hello" && event.source === parent && parent !== window && event.ports[0]) {
    if (site) return;     // one page, one hello
    // The page has to be the one in the tab itself. Then the address the router
    // window shows is the address in the tab's address bar. A site shown inside
    // someone else's page gets no answer, so nobody can borrow its good name.
    if (parent !== top) return;
    site = event.origin;
    host = startHost(site, event.ports[0]);
    // Tell the site the frame is here. A site that hears nothing knows the
    // frame did not load, and uses the router window in its place.
    parent.postMessage({ router: "frame-ready" }, site === "null" ? "*" : site);   // carries nothing; a sandboxed page has no address to name
    return;
  }

  // The router window found this frame. It may hand over a grant, or stop the
  // one this site has. The browser only delivers this message if the sender
  // named the router's address as the target, and event.origin proves the
  // sender is a router page. Nothing on this line comes from the site.
  if (message.router === "picker" && event.origin === location.origin && event.ports[0]) {
    const line = event.ports[0];
    if (!host) return line.close();
    const mine = host;
    line.onmessage = async (answer) => {
      const data = answer.data || {};
      if (data.t === "grant" && data.grant && data.grant.site === site) line.postMessage({ t: (await mine.setGrant(data.grant)) ? "stored" : "failed" });
      else if (data.t === "stop") { await mine.stop(); line.postMessage({ t: "stopped" }); }
    };
    // Which site this is, what it has now, and the public half of a key made
    // for this handover. The window encrypts the API key to it.
    Promise.all([mine.current(), mine.offer()]).then(([current, pub]) => line.postMessage({ t: "site", site, current, pub }));
  }
});
