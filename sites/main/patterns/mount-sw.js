// Mounts another origin at a path on this one. This script is registered once
// for each mounted site, with that site's path as its scope, for example
// /patterns/mounted/florist/. Every request under the scope is answered by
// asking a port whose other end is on that site. The body comes back as a stream.
const BASE = new URL(self.registration.scope).pathname;
const NAME = BASE.split("/").filter(Boolean).pop();
let origin = null;      // the port to the other site
let unmounted = false;
let waiting = [];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  if (!event.data) return;
  if (event.data.mount && event.ports[0]) {
    origin = event.ports[0]; unmounted = false;
    for (const go of waiting) go();
    waiting = [];
  }
  if (event.data.unmount) { origin = null; unmounted = true; }
});

const pages = () => self.clients.matchAll({ type: "window", includeUncontrolled: true });

// A service worker that was stopped has lost its port. Ask the pages for one.
async function needPort() {
  if (origin) return true;
  if (unmounted) return false;
  for (const client of await pages()) client.postMessage({ needMount: NAME });
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 1500);
    waiting.push(() => { clearTimeout(timer); resolve(true); });
  });
}

function ask(path) {
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    const timer = setTimeout(() => { origin = null; resolve(null); }, 2500);
    port1.onmessage = (event) => { clearTimeout(timer); resolve(event.data); };
    port1.onmessageerror = () => { clearTimeout(timer); resolve({ status: 502, headers: { "content-type": "text/plain" }, body: "The answer arrived and could not be read." }); };
    origin.postMessage({ path }, [port2]);
  });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith(BASE)) return;
  event.respondWith((async () => {
    const path = url.pathname.slice(BASE.length) || "index.html";
    const answer = (await needPort()) && (await ask(path));
    for (const client of await pages()) client.postMessage({ mounted: path, site: NAME, status: answer ? answer.status : 503 });
    if (!answer) return new Response("Nothing is mounted here right now.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
    return new Response(answer.body, { status: answer.status, headers: answer.headers });
  })());
});
