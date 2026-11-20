// Answers every request in its scope by asking a tab, over a port.
let tabPort = null;
let waiting = [];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  if (event.data && event.data.serve && event.ports[0]) {
    tabPort = event.ports[0];
    for (const go of waiting) go();
    waiting = [];
  }
});

// A Service Worker that was stopped has lost its port. Ask the tabs for one.
async function needPort() {
  if (tabPort) return true;
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of all) client.postMessage("need-port");
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 1500);
    waiting.push(() => { clearTimeout(timer); resolve(true); });
  });
}

function ask(url) {
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    const timer = setTimeout(() => { tabPort = null; resolve(null); }, 2000);
    port1.onmessage = (event) => { clearTimeout(timer); resolve(event.data); };
    tabPort.postMessage({ url }, [port2]);
  });
}

self.addEventListener("fetch", (event) => {
  event.respondWith((async () => {
    const answer = (await needPort()) && (await ask(event.request.url));
    if (!answer) {
      return new Response("<!doctype html><meta charset=utf-8><body style='font:15px system-ui;margin:1rem'><h1>No tab is serving this right now</h1><p>Open the patterns page and start the tab server.</p>", { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response(answer.body, { headers: answer.headers });
  })());
});
