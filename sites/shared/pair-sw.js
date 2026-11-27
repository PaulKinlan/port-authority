// A service worker that holds a port to the service worker of another origin.
//
// This one script is served on every demo site and registered for /pair/.
// Two of them, on two origins, end up holding the two ends of one
// MessageChannel. Neither can reach the other alone: a page of each site has to
// carry the port across once. After that the two workers post to each other
// with no page in between.
//
// A browser stops a service worker that has been idle, and everything in this
// file's variables goes with it, the port included. Nothing announces that. So
// every question to the other worker has a time limit. When the limit passes,
// this worker drops the port, makes a new channel, and asks a page to carry
// one end across again.

const SITE = location.hostname.split(".")[0].replace(/^pa-/, "");
const run = Math.random().toString(36).slice(2, 6);   // changes every time the browser starts this worker
const born = Date.now();
const WAIT = 1500;

// What this site keeps. It is written to this origin's Cache Storage when the
// worker is installed, and every answer is read back from there.
const SHELVES = {
  florist: { tulips: "24 bunches", roses: "9 bunches", peonies: "3 bunches" },
  library: { Dune: "out until Friday", Middlemarch: "on the shelf", Beloved: "on the shelf" },
};
const SHELF_URL = "/pair/shelf.json";

let peer = null;        // the port whose other end is the other origin's service worker
let peerName = null;    // which site my own page says that is
const lines = new Set();  // ports whose other ends are tabs of the other site
const counts = { joined: 0, asked: 0, answered: 0, lines: 0 };
let seq = 0;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open("pair").then((cache) => cache.put(SHELF_URL, new Response(JSON.stringify(SHELVES[SITE] || {}), { headers: { "content-type": "application/json" } }))));
});
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const pages = () => self.clients.matchAll({ type: "window", includeUncontrolled: true });
async function shelf() {
  const hit = await (await caches.open("pair")).match(SHELF_URL);
  return hit ? hit.json() : SHELVES[SITE] || {};
}

// Tell my pages what I hold, so they can show it. `sent` and `got` say that a
// message has just crossed the port to the other worker.
async function report(note, extra = {}) {
  const state = { site: SITE, run, born, seq: ++seq, peer: !!peer, peerName, lines: lines.size, ...counts };
  for (const client of await pages()) client.postMessage({ pair: "state", state, note, ...extra });
}

// ---- joining

// Take a port as my end of the link to the other worker.
function adopt(port, name) {
  if (peer) peer.close();
  peer = port; peerName = name; counts.joined++;
  port.onmessage = (event) => serve(event, "peer");
}

// Ask my pages which of them can pass a port to the other site.
// Several pages of this site may be open at once (for example, several demos on
// one page, one of which has already closed the other site's frame). Collect
// every page that answers, and put the page that asked first.
let collectCarrier = null;
function findCarriers(preferId = null) {
  return new Promise(async (resolve) => {
    const found = [], seen = new Set();
    let shortTimer = 0;
    const finish = () => {
      clearTimeout(longTimer); clearTimeout(shortTimer);
      collectCarrier = null;
      found.sort((a, b) => (b.client.id === preferId) - (a.client.id === preferId));
      resolve(found);
    };
    const longTimer = setTimeout(finish, 1200);
    collectCarrier = (entry) => {
      if (seen.has(entry.client.id)) return;
      seen.add(entry.client.id);
      found.push(entry);
      if (preferId && entry.client.id === preferId) {
        if (!shortTimer) shortTimer = setTimeout(finish, 80);
      } else if (!shortTimer) {
        shortTimer = setTimeout(finish, 200);
      }
    };
    const clients = await pages();
    if (!clients.length) return finish();
    for (const client of clients) client.postMessage({ pair: "need-carrier" });
  });
}

// Make a channel, keep one port, and send the other out through a page.
let joining = null, heardHello = null;
function join(preferId = null) {
  return (joining ||= (async () => {
    try {
      const carriers = await findCarriers(preferId);
      if (!carriers.length) { await report("none of my pages has a line to the other site, so I cannot be joined to its worker"); return false; }
      for (const carrier of carriers) {
        const { port1, port2 } = new MessageChannel();
        adopt(port1, carrier.to);
        const heard = new Promise((resolve) => { heardHello = () => resolve(true); setTimeout(() => resolve(false), 2500); });
        carrier.client.postMessage({ pair: "carry" }, [port2]);
        await report("made a channel. Kept one port and gave the other to my page to pass on");
        if (await heard) {
          await report(`the ${peerName}'s worker answered on the new port. We are joined, and no page is in between`, { got: true });
          return true;
        }
        if (peer === port1) { peer.close(); peer = null; peerName = null; }
        else port1.close();
      }
      await report("nothing answered on the port I sent out. I have closed my end");
      return false;
    } finally { joining = null; heardHello = null; }
  })());
}

// Ask the other worker something and wait a short time for the answer. Each
// question carries a port of its own for the answer to come back on. `make`
// is called once per try, because a port that was posted cannot be posted again.
async function askPeer(make, tries = 2, preferId = null) {
  for (let i = 0; i < tries; i++) {
    if (!peer && !(await join(preferId))) return null;
    const current = peer;
    if (!current) continue;
    const { message, transfer = [] } = make();
    const answer = await new Promise((resolve) => {
      const { port1, port2 } = new MessageChannel();
      const timer = setTimeout(() => { port1.close(); resolve(null); }, WAIT);
      port1.onmessage = (event) => { clearTimeout(timer); port1.close(); resolve(event.data); };
      try {
        current.postMessage(message, [port2, ...transfer]);
        report(null, { sent: true });
      } catch {
        clearTimeout(timer); port1.close(); resolve(null);
      }
    });
    if (answer) return answer;
    if (peer === current) { peer.close(); peer = null; }
    await report(`no answer in ${WAIT / 1000} seconds. The other worker has lost its end of the port` + (i + 1 < tries ? ". Making a new channel" : ""));
  }
  return null;
}

// ---- what arrives over a port from the other origin: from its worker, or from one of its tabs on a line of its own

async function serve(event, via) {
  const data = event.data || {}, reply = event.ports[0];
  const who = via === "line" ? `a tab of the ${data.from}` : `the ${peerName || "other"}'s worker`;
  if (data.hello) { heardHello?.(); return; }
  if (data.ask) {
    counts.answered++;
    const answer = (await shelf())[data.ask] ?? "not something I keep";
    reply.postMessage({ answer, by: SITE, run });
    return report(`${who} asked about ${data.ask}. Read my cache and answered: ${answer}`, { got: true, via });
  }
  // A port that came over the port. Its other end is a tab of the other site,
  // which from now on asks me directly.
  if (data.line && event.ports[1]) {
    const line = event.ports[1];
    lines.add(line); counts.lines++;
    line.onmessage = (e) => serve(e, "line");
    reply.postMessage({ ok: true, by: SITE, run });
    return report(`the ${peerName || "other"}'s worker sent me a port over our port. Its other end is one of that site's tabs. I will answer on it`, { got: true });
  }
  // A file for the other site's fetch. The body is a stream, written a line at a time.
  if (data.get) {
    if (data.get !== "shelf.txt") return reply.postMessage({ status: 404, headers: { "content-type": "text/plain; charset=utf-8" }, body: `The ${SITE} has no ${data.get}.` });
    const rows = [`Written by the ${SITE}'s service worker, run ${run}, at ${location.host}`, ...Object.entries(await shelf()).map(([name, state]) => `${name}: ${state}`)];
    let i = 0;
    const body = new ReadableStream({
      async pull(controller) {
        if (i >= rows.length) return controller.close();
        if (i) await new Promise((r) => setTimeout(r, 350));
        controller.enqueue(new TextEncoder().encode(rows[i++] + "\n"));
      },
    });
    reply.postMessage({ status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }, body }, [body]);
    return report(`${who} asked for ${data.get}. Sent back a stream and am writing the file into it`, { got: true });
  }
}

// ---- what my own pages ask of me

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || !data.pair) return;
  const from = event.source;
  const work = {
    hello: () => report(),
    // My page was handed a port by the other site. It is my end now.
    peer: () => {
      adopt(event.ports[0], data.from);
      peer.postMessage({ hello: SITE, run });
      return report(`my page gave me a port and says the other end is the ${data.from}'s worker. Said hello on it`, { sent: true });
    },
    carrier: () => collectCarrier?.({ client: from, to: data.to }),
    join: () => join(from?.id),
    ask: async () => {
      counts.asked++;
      const answer = await askPeer(() => ({ message: { ask: data.item, from: SITE } }), 2, from?.id);
      from.postMessage({ pair: "answer", item: data.item, answer });
      return report(answer ? `asked the ${peerName}'s worker about ${data.item}. It said: ${answer.answer}` : `could not ask about ${data.item}. There is no way to the other worker`);
    },
    // A tab of mine wants its own line to the other worker. Make a channel,
    // give the tab one port, and send the other over my port to the other worker.
    line: async () => {
      let mine = null;
      const ok = await askPeer(() => { const channel = new MessageChannel(); mine = channel.port1; return { message: { line: true, from: SITE }, transfer: [channel.port2] }; }, 2, from?.id);
      if (!ok) { from.postMessage({ pair: "line", failed: true }); return report("could not get a line for my tab. There is no way to the other worker"); }
      from.postMessage({ pair: "line", by: ok.by, run: ok.run }, [mine]);
      return report(`made a channel for one of my tabs. Sent one port to the ${peerName}'s worker over our port, and gave the tab the other`);
    },
    // A page cannot ask the browser to stop a service worker. This stands in
    // for a stop: the ports are closed and forgotten, as they would be.
    forget: () => {
      peer?.close(); peer = null; peerName = null;
      for (const line of lines) line.close();
      lines.clear();
      return report("closed every port I held and forgot them, which is what being stopped does to me");
    },
  }[data.pair];
  if (work) event.waitUntil(Promise.resolve(work()));
});

// ---- a path on this site that the other site's worker answers

const FROM = "/pair/from-other/";
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(FROM)) return;
  event.respondWith((async () => {
    const name = url.pathname.slice(FROM.length);
    const answer = await askPeer(() => ({ message: { get: name, from: SITE } }), 2, event.clientId);
    if (!answer) return new Response("The other site's worker could not be reached.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
    report(`a page of mine fetched ${FROM}${name}. The ${peerName}'s worker answered with ${answer.status}, and I passed its body on as the response`);
    return new Response(answer.body, { status: answer.status, headers: answer.headers });
  })());
});
