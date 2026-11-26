// The router's service worker. It keeps a copy of the router's own pages and
// scripts in the browser, so that the router still works when its address
// cannot be reached, or answers slowly, or answers with an error.
//
// It asks the network first, every time. When the network answers, that
// answer is used and the copy is replaced. So nobody is given old code while
// the router can be reached. Only when it cannot is the last good copy used.
//
// What it must not do:
//   - It answers for the router's own files and for nothing else. A request to
//     any other address, such as the call to a model provider that carries the
//     API key, is not its business. Where the browser allows it, such requests
//     are sent straight to the network and this code is never shown them
//     (addRoutes below). Elsewhere it is shown them and leaves them alone.
//   - It keeps each page with the headers it came with. A page taken from the
//     copy has the same Content-Security-Policy as one from the network.
//   - It is sent with a policy of its own that lets it connect to the router's
//     address and nowhere else. It cannot reach a provider.
//
// A browser keeps storage apart for each site the router's frame is inside,
// and that includes this. The frame inside each site has a service worker and
// a copy of its own, made the first time that site is visited.

const COPY = "router-files-1";

// Every file a router page can ask for. A test checks this list against the
// files (test/worker.unit.mjs). There is one call worker and one call page for
// each provider, and each is kept with the policy that names its provider.
const FILES = [
  "/", "/frame.html", "/pick.html",
  "/call/anthropic", "/call/openai", "/call/openrouter", "/call/gemini", "/call/ollama",
  "/call/anthropic.js", "/call/openai.js", "/call/openrouter.js", "/call/gemini.js", "/call/ollama.js",
  "/router.css", "/base.css", "/favicon.svg", "/_sites.js", "/hawser.js",
  "/account-form.js", "/call.js", "/caller.js", "/calling.js", "/chat.js", "/frame-worker.js", "/frame.js", "/grants.js", "/home.js", "/host.js",
  "/keep.js", "/line.js", "/pick.js", "/providers.js", "/router.js", "/seal.js", "/store.js",
];
const SLOW = 4000;     // after this long with no answer, the copy is used and the network is left to finish

let passedBy = 0;      // requests for other addresses that this code was shown, and left alone

self.addEventListener("install", (event) => {
  // Requests for any other address go straight to the network, and are never shown to this code.
  try {
    if (event.addRoutes) event.addRoutes([{ condition: { not: { urlPattern: new URLPattern({ protocol: location.protocol.slice(0, -1), hostname: location.hostname, port: location.port }) } }, source: "network" }]);
  } catch { /* this browser has no such rule. The fetch handler below leaves those requests alone */ }
  // Take a first copy of everything, so that a page not yet visited is there when it is needed.
  event.waitUntil((async () => {
    const copy = await caches.open(COPY);
    await Promise.all(FILES.map(async (path) => {
      try { const answer = await fetch(path, { cache: "no-cache" }); if (answer.ok) await copy.put(path, answer); } catch { /* it is copied the first time it is asked for */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== COPY) await caches.delete(name);
    await self.clients.claim();
  })());
});

const kept = async (request) => (await caches.open(COPY)).match(request, { ignoreSearch: true });

async function answer(request) {
  let late;
  const slow = new Promise((resolve) => { late = setTimeout(() => resolve("slow"), SLOW); });
  const asked = (async () => {
    const fresh = await fetch(request);
    // Keep a good answer. A redirect or an error is passed on and not kept.
    if (fresh.ok && fresh.type === "basic") (await caches.open(COPY)).put(request.url.split(/[?#]/)[0], fresh.clone()).catch(() => {});
    return fresh;
  })();
  asked.catch(() => {});
  try {
    const first = await Promise.race([asked, slow]);
    if (first === "slow") return (await kept(request)) || asked;         // nothing kept: wait for the network after all
    if (first.status >= 500) return (await kept(request)) || first;      // the router's address is there but broken
    return first;
  } catch (error) {
    const copy = await kept(request);      // the router's address cannot be reached
    if (copy) return copy;
    throw error;
  } finally { clearTimeout(late); }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) { passedBy++; return; }      // not the router's file. The browser deals with it as if this code were not here
  if (event.request.method !== "GET") return;
  event.respondWith(answer(event.request));
});

// A page can ask what this worker has seen. Used by the tests.
self.addEventListener("message", (event) => {
  if (event.data === "seen" && event.ports[0]) event.ports[0].postMessage({ passedBy, copy: COPY, files: FILES.length });
});
