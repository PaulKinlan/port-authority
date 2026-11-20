// The same router as router-worker.js, as a service worker. It has no ports:
// it reaches each window through the Clients API. A service worker is stopped
// when it is idle and wakes with an empty table, so when it cannot place a
// name it asks every open window to say who it is, and tries again.
const table = new Map();        // name -> client id
let routed = 0, undelivered = 0, rollcalls = 0;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const everyone = () => self.clients.matchAll({ type: "window", includeUncontrolled: true });
const report = async (last) => { for (const client of await everyone()) client.postMessage({ state: { table: [...table.keys()], routed, undelivered, rollcalls, last } }); };
const nameOf = (id) => { for (const [name, client] of table) if (client === id) return name; return null; };
const find = async (name) => { const id = table.get(name); const client = id && (await self.clients.get(id)); if (id && !client) table.delete(name); return client || null; };

async function rollCall() {
  rollcalls++;
  for (const client of await everyone()) client.postMessage({ rollcall: true });
  await new Promise((resolve) => setTimeout(resolve, 300));
}

self.addEventListener("message", (event) => {
  const data = event.data || {}, source = event.source;
  if (data.iam) { table.set(data.iam, source.id); return void event.waitUntil(report()); }
  if (data.watch) return void event.waitUntil(report());
  // Stands in for what happens when the browser stops an idle service worker.
  if (data.forget) { table.clear(); return void event.waitUntil(report()); }
  if (data.to) event.waitUntil((async () => {
    let target = await find(data.to);
    if (!target || !nameOf(source.id)) { await rollCall(); target = await find(data.to); }
    const from = nameOf(source.id);
    if (!target) { undelivered++; source.postMessage({ undelivered: data.to }); return report({ from, to: data.to, ok: false }); }
    routed++;
    target.postMessage({ from, text: data.text });
    return report({ from, to: data.to, ok: true });
  })());
});
