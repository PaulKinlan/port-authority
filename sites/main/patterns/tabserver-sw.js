// Answers every request in its scope by asking a tab, over a port.
// A tab can offer to serve everything, or only the paths under a prefix.
const tabs = new Map();   // prefix -> port
let waiting = [];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  if (event.data && event.data.serve && event.ports[0]) {
    tabs.set(event.data.prefix || "", event.ports[0]);
    for (const go of waiting.splice(0)) go();
  }
});

// The longest prefix that matches wins.
function prefixFor(path) {
  let best = null;
  for (const prefix of tabs.keys()) if (path.startsWith(prefix) && (best === null || prefix.length > best.length)) best = prefix;
  return best;
}

// A Service Worker that was stopped has lost its ports. Ask the tabs for them.
async function needPort(path) {
  if (prefixFor(path) !== null) return true;
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of all) client.postMessage("need-port");
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(prefixFor(path) !== null), 1500);
    waiting.push(() => { if (prefixFor(path) === null) return; clearTimeout(timer); resolve(true); });
  });
}

function ask(url, path) {
  return new Promise((resolve) => {
    const prefix = prefixFor(path);
    const { port1, port2 } = new MessageChannel();
    const timer = setTimeout(() => { tabs.delete(prefix); resolve(null); }, 2000);
    port1.onmessage = (event) => { clearTimeout(timer); resolve(event.data); };
    tabs.get(prefix).postMessage({ url }, [port2]);
  });
}

self.addEventListener("fetch", (event) => {
  event.respondWith((async () => {
    const path = new URL(event.request.url).pathname;
    const answer = (await needPort(path)) && (await ask(event.request.url, path));
    if (!answer) {
      return new Response("<!doctype html><meta charset=utf-8><body style='font:15px system-ui;margin:1rem'><h1>No tab is serving this right now</h1><p>Open the patterns page and start the tab server.</p>", { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response(answer.body, { status: answer.status || 200, headers: answer.headers });
  })());
});
