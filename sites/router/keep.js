// Ask the browser to keep a copy of the router's own pages and scripts, so
// that the router still works when its address cannot be reached. The copy is
// kept by a service worker (sw.js). A page that cannot have one, such as a
// page in a sandbox, goes on without.
try { navigator.serviceWorker?.register("/sw.js").catch(() => {}); } catch { /* not allowed here */ }
