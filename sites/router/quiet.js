// A service worker that does nothing, on purpose.
//
// The router's other service worker (sw.js) keeps a copy of the router's files,
// and a service worker is shown every request made by what it answers for. The
// call worker makes the one request that carries an API key. So the call worker
// is put under this service worker instead: its address is under /call-worker/,
// and this one is registered for /call-worker/ and nothing else.
//
// This file has no fetch handler. A browser does not hand requests to a service
// worker that has none. So the call to a provider is shown to no service
// worker's code at all, and neither is the call worker's own script.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
