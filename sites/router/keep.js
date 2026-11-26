// The router's two service workers, and the page's part in them.
//
// sw.js keeps a copy of the router's own pages and scripts, so that the router
// still works when its address cannot be reached.
//
// quiet.js does nothing. It is registered for /call-worker/ only, which is
// where the call worker's script is. A worker is under the service worker
// whose scope its own script is in, so the call worker is under quiet.js and
// not under sw.js. quiet.js has no fetch handler, so the call to a provider,
// which carries the API key, is never shown to a service worker's code.
//
// A page that cannot have a service worker, such as a page in a sandbox, goes
// on without either.
//
// `quiet` resolves once quiet.js is in place: true when it is, false when it
// could not be. caller.js waits for it before it starts a call worker.
let settled = Promise.resolve(false);
try {
  const workers = navigator.serviceWorker;
  if (workers) {
    workers.register("/sw.js").catch(() => {});
    settled = workers.register("/quiet.js", { scope: "/call-worker/" }).then((registration) => new Promise((resolve) => {
      if (registration.active) return resolve(true);
      const coming = registration.installing || registration.waiting;
      if (!coming) return resolve(false);
      coming.addEventListener("statechange", () => { if (coming.state === "activated") resolve(true); else if (coming.state === "redundant") resolve(false); });
      setTimeout(() => resolve(!!registration.active), 3000);
    })).catch(() => false);
  }
} catch { /* not allowed here */ }
export const quiet = settled;
