// The call page: a hidden page that calls one model provider.
//
// This is how the call is made in a browser that does not hold a worker to a
// policy of its own. Where the browser does, a worker makes the call instead
// (call-worker.js), and this page is never loaded.
//
// A router page puts this page in a hidden iframe, with the provider in the
// address: /call/anthropic. The server sends this page with a
// Content-Security-Policy whose connect-src is that one provider. So the API
// key is opened here, in a page the browser will not let connect anywhere
// else. The frame and the worker around it cannot reach any provider at all.
// What it does is in calling.js.

import { serveCalls } from "/calling.js";

const named = /^\/call\/([^/]+)$/.exec(location.pathname);
const provider = named ? decodeURIComponent(named[1]) : null;

// Only the router page that this page is inside can hand it a port.
addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.source !== parent || parent === window) return;
  if (event.data && event.data.router === "caller" && event.ports[0]) serveCalls(event.ports[0], provider);
});
