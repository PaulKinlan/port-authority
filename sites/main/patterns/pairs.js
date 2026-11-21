// Ports sent over ports. The service worker of one site joined to the service
// worker of another, and what can be built once they hold a port to each other.
// The boxes are real pages of the florist's and the library's sites, and the
// service workers are the ones those pages register on their own origins.
import { sites } from "/_sites.js";

const OTHER = { florist: "library", library: "florist" };
const TITLE = { florist: "Florist", library: "Library", planner: "Planner" };
const host = (site) => sites[site].replace(/^https?:\/\//, "");

// A real page of a site, at /pair/. `box` is its name on the stage.
function pageBox(stage, box, site, title, extra = "") {
  const b = stage.box(box, { src: `${sites[site]}/pair/?with=${OTHER[site] || ""}&id=${box}&title=${encodeURIComponent(title)}${extra}` });
  b.frame.title = title;
  return b;
}

// A box for a site's service worker. A worker has no window, so this page
// draws the box from what the worker tells its own page.
function workerBox(stage, box, site) {
  const b = stage.box(box, { kind: "service", url: `${sites[site]}/pair-sw.js`, scope: "/pair/", html: `<div class="here"><h4>${TITLE[site]}'s service worker</h4>
    <p class="small" style="margin:0 0 .25rem">Run <strong data-run>not started</strong>, started <strong data-born>-</strong></p>
    <p class="small" style="margin:0 0 .4rem">Port to the other worker: <strong data-peer>none</strong></p>
    <ul class="log"></ul></div>` });
  const ul = b.node.querySelector("ul");
  b.say = (text) => { const li = document.createElement("li"); li.textContent = text; ul.prepend(li); while (ul.children.length > 4) ul.lastChild.remove(); };
  b.show = (state) => {
    b.node.querySelector("[data-run]").textContent = state.run;
    b.node.querySelector("[data-born]").textContent = new Date(state.born).toLocaleTimeString();
    b.node.querySelector("[data-peer]").textContent = state.peer ? `held${state.peerName ? ", to the " + state.peerName + "'s worker" : ""}` : "none";
  };
  return b;
}

// Put the boxes on the stage and keep the drawing true to what the workers
// report. `pages` is a list of [box, site, title]. Returns null where there is
// no service worker.
function pairStage(stage, pages, { planner = false } = {}) {
  // The pages go in a row, with the two workers in a row underneath, so that
  // the cable between the workers does not cross a page.
  const boxes = {};
  for (const [box, site, title] of pages.filter(([, site]) => site === "florist")) boxes[box] = pageBox(stage, box, site, title);
  if (planner) boxes.m = stage.box("m", { src: `${sites.planner}/pair/?role=intro&title=${encodeURIComponent("Planner, a third site")}&color=%23f5b700` });
  for (const [box, site, title] of pages.filter(([, site]) => site === "library")) boxes[box] = pageBox(stage, box, site, title);
  const workers = { florist: workerBox(stage, "swa", "florist"), library: workerBox(stage, "swb", "library") };
  const count = Object.keys(boxes).length;
  for (const b of Object.values(boxes)) b.wrap.style.flexBasis = `max(11.5rem, ${count > 2 ? 24 : 34}%)`;
  for (const w of Object.values(workers)) w.wrap.style.flexBasis = "max(11.5rem, 34%)";
  if (!("serviceWorker" in navigator)) { workers.florist.say("this browser has no service worker"); return null; }
  const siteOf = Object.fromEntries(pages.map(([box, site]) => [box, site]));
  const seen = { florist: "", library: "" }, state = {};
  let drawn = "";
  const ups = new Map(pages.map(([box]) => { let done; const p = new Promise((r) => (done = r)); p.done = done; return [box, p]; }));
  stage.on((box, data) => {
    if (data.wire === "up") ups.get(box)?.done();
    if (data.wire === "line") data.up ? stage.cable("line-" + box, box, siteOf[box] === "florist" ? "swb" : "swa", "red") : stage.cut("line-" + box);
    if (data.wire !== "sw") return;
    // Every page of a site hears its worker, so the same report can arrive twice.
    const site = siteOf[box], w = workers[site], key = data.state.run + ":" + data.state.seq;
    if (!w || seen[site] === key) return;
    seen[site] = key; state[site] = data.state;
    w.show(data.state);
    if (data.note) w.say(data.note);
    // The cable between the workers is there while both say they hold a port.
    const both = state.florist?.peer && state.library?.peer;
    const now = both ? [state.florist.run, state.florist.joined, state.library.run, state.library.joined].join() : "";
    if (now !== drawn) { drawn = now; both ? stage.cable("direct", "swa", "swb", "yellow") : stage.cut("direct"); }
    if (data.sent) stage.pulse("direct", site === "florist" ? "swa" : "swb");
  });
  // The workers are the same two for every demo on this page, and they outlive
  // it. A demo starts from whatever they hold, and joining replaces that.
  const ready = Promise.all([...ups.values()]);
  // Give two pages a channel between them.
  const trunk = (a, b) => {
    const { port1, port2 } = new MessageChannel();
    stage.post(a, { cmd: "trunk", to: siteOf[b] }, [port1]);
    stage.post(b, { cmd: "trunk", to: siteOf[a] }, [port2]);
    stage.cable("trunk", a, b, "teal");
  };
  return { boxes, workers, ready, trunk, state };
}

const CODE_JOIN = `<span class="c">// florist's service worker: make a channel, keep one port, give the other to my page</span>
const { port1, port2 } = new MessageChannel();
peer = port1;
client.postMessage({ pair: "carry" }, [port2]);

<span class="c">// florist's page: it opened the library's window earlier and gave it one end of a channel.</span>
<span class="c">// The port from the worker goes over that port.</span>
navigator.serviceWorker.onmessage = (event) =>
  lineToLibraryPage.postMessage({ carry: true }, [event.ports[0]]);

<span class="c">// library's page: give the port to its own worker. This starts the worker if it was stopped.</span>
lineToFloristPage.onmessage = (event) =>
  registration.active.postMessage({ pair: "peer", from: "florist" }, [event.ports[0]]);

<span class="c">// library's service worker: this port now reaches the florist's worker directly</span>
onmessage = (event) => { peer = event.ports[0]; peer.onmessage = answer; peer.postMessage({ hello: "library" }); };

<span class="c">// either worker, later: a question, with a time limit, because a stopped worker says nothing</span>
const reply = new MessageChannel();
peer.postMessage({ ask: "Dune" }, [reply.port2]);
const answer = await firstMessageOrTimeout(reply.port1, 1500);
if (!answer) { peer.close(); peer = null; await join(); <span class="c">/* a new channel, carried across again */</span> }`;

export const swpair = {
  id: "swpair",
  title: "Join the service workers of two sites with a port",
  blurb: `The florist's site and the library's site each have a service worker. A service worker can post to pages of its own site and to nothing else, so the two cannot reach each other. A port can be carried between them. The florist's worker makes a channel, keeps one port and gives the other to its page. The page sends that port over a line it holds to the library's page, and the library's page gives it to the library's worker. Now each worker holds one end of the same channel, and they ask each other questions with no page taking part. The answers are read from each site's own Cache Storage. A browser stops a service worker that has been idle for about thirty seconds, and the port is lost with it. Nothing tells the other worker. So each question has a time limit of 1.5 seconds. When it passes, the asking worker closes its port, makes a new channel, and has the pages carry one end across again. In the diagram this page gave the two pages their line. On the real web the florist's page opens the library's window and gives it one, which the link under the demo does.`,
  code: CODE_JOIN,
  tour: { steps: [
    ["Give the two pages a line to each other", "This page makes a channel and gives one port to the florist's page and one to the library's page. It stands in for the florist's page opening the library's window."],
    ["Join the two workers", "The florist's worker makes a channel and gives one port to its page. The port goes over the pages' line, and the library's page gives it to the library's worker.", 3200],
    ["Florist's worker: ask about Dune", "The florist's worker posts the question into its port. The library's worker reads its own cache and answers. Neither page took part.", 2800],
    ["Library's worker: ask about tulips", "The same port carries a question the other way.", 2800],
    ["Make the library's worker forget", "The library's worker closes its port and forgets it. This is what happens when the browser stops it. The florist's worker is told nothing."],
    ["Florist's worker: ask about Dune", "No answer comes in 1.5 seconds. The florist's worker closes its port, makes a new channel, and the pages carry one end across. Then it asks again and is answered.", 5200],
    ["Close the library's page", "The library's page is destroyed. The two workers still hold their ports."],
    ["Florist's worker: ask about Dune", "It is answered. The port between the workers does not pass through any page.", 2800],
    ["Make the florist's worker forget", "The florist's worker closes its port. There is no page on the library's side to receive a new one."],
    ["Florist's worker: ask about Dune", "The florist's worker sends a new port out and nothing answers on it. Without a page on each side, the workers cannot be joined again.", 5000],
  ] },
  async setup(stage, ui) {
    const s = pairStage(stage, [["a", "florist", "Florist's page"], ["b", "library", "Library's page"]]);
    if (!s) return;
    await s.ready;
    const later = [];
    const add = (label, fn) => later.push(ui.button(label, fn, true));
    add("Join the two workers", () => stage.post("a", { cmd: "join" }));
    add("Florist's worker: ask about Dune", () => stage.post("a", { cmd: "ask", item: "Dune" }));
    const libraryAsk = ui.button("Library's worker: ask about tulips", () => stage.post("b", { cmd: "ask", item: "tulips" }), true);
    const libraryForget = ui.button("Make the library's worker forget", () => stage.post("b", { cmd: "forget" }), true);
    add("Make the florist's worker forget", () => stage.post("a", { cmd: "forget" }));
    const close = ui.button("Close the library's page", (btn) => { stage.remove("b"); btn.disabled = libraryAsk.disabled = libraryForget.disabled = true; }, true);
    ui.button("Give the two pages a line to each other", (btn) => {
      btn.disabled = true; s.trunk("a", "b");
      for (const b of [...later, libraryAsk, libraryForget, close]) b.disabled = false;
    }, false, true);
    ui.link("Open the florist's page in a tab of its own, where it opens the library's window for real", `${sites.florist}/pair/`);
  },
};

// The line between the pages and the join, in one press, for the demos that
// start from two workers that are already joined.
function joinButton(stage, ui, s, unlock) {
  ui.button("Join the two workers", (btn) => {
    btn.disabled = true; s.trunk("a", "b");
    stage.post("a", { cmd: "join" });
    for (const b of unlock) b.disabled = false;
  }, false, true);
}

export const pairBuilt = [
  {
    pattern: "swpair", use: [0], id: "built-lines",
    title: "Each tab gets its own port to the other site's service worker",
    blurb: "The two workers are joined by one port. A florist tab that wants to ask the library something could ask the florist's worker to pass the question on, and then every question from every tab would queue through that worker. Instead the tab asks its worker for a line. The florist's worker makes a new channel, gives the tab one port, and posts the other port to the library's worker over the port that joins them. From then on the tab asks the library's worker directly. The florist's worker can forget its own port, or be stopped, and the tab's line still works, because the line never passed through it. The line ends when the library's worker is stopped. The tab finds out the same way a worker does, by getting no answer, and asks for another line.",
    code: `<span class="c">// florist's service worker: a tab asked for a line</span>
const line = new MessageChannel();
tab.postMessage({ pair: "line" }, [line.port1]);
peer.postMessage({ line: true, from: "florist" }, [replyPort, line.port2]);   <span class="c">// a port, sent over a port</span>

<span class="c">// library's service worker: answer on whatever port arrives over the port</span>
peer.onmessage = (event) => {
  if (event.data.line) event.ports[1].onmessage = answer;
};

<span class="c">// florist's tab: ask the library's worker directly</span>
line.postMessage({ ask: "Dune" }, [reply.port2]);`,
    tour: { steps: [
      ["Join the two workers", "The pages carry a port across, as in the demo at the top of the page.", 3200],
      ["Tab one: get a line of its own", "The florist's worker makes a channel, gives tab one a port, and sends the other port to the library's worker over the port that joins them.", 2600],
      ["Tab two: get a line of its own", "A second channel, for the second tab.", 2600],
      ["Tab one: ask about Dune on its line", "Tab one posts to the library's worker. The florist's worker is not involved.", 2400],
      ["Make the florist's worker forget", "The florist's worker closes the port that joins it to the library's worker."],
      ["Tab two: ask about Dune on its line", "Tab two is still answered. Its line was never part of the florist's worker.", 2400],
      ["Make the library's worker forget", "The library's worker closes every port it holds, as a stop would. Both lines end there."],
      ["Tab one: ask about Dune on its line", "No answer comes in 1.5 seconds, and the tab says its line is gone.", 2600],
      ["Tab one: get a line of its own", "The florist's worker has no port either, so the pages carry a new one across first. Then tab one gets a new line.", 5000],
    ] },
    async setup(stage, ui) {
      const s = pairStage(stage, [["a", "florist", "Florist, tab one"], ["a2", "florist", "Florist, tab two"], ["b", "library", "Library's page"]]);
      if (!s) return;
      await s.ready;
      const buttons = [
        ui.button("Tab one: get a line of its own", () => stage.post("a", { cmd: "line" }), true),
        ui.button("Tab two: get a line of its own", () => stage.post("a2", { cmd: "line" }), true),
        ui.button("Tab one: ask about Dune on its line", () => stage.post("a", { cmd: "askline", item: "Dune" }), true),
        ui.button("Tab two: ask about Dune on its line", () => stage.post("a2", { cmd: "askline", item: "Dune" }), true),
        ui.button("Make the florist's worker forget", () => stage.post("a", { cmd: "forget" }), true),
        ui.button("Make the library's worker forget", () => stage.post("b", { cmd: "forget" }), true),
      ];
      joinButton(stage, ui, s, buttons);
    },
  },
  {
    pattern: "swpair", use: [1], id: "built-swfetch",
    title: "An address on the florist's site, answered by the library's service worker",
    blurb: "The florist's page fetches <code>/pair/from-other/shelf.txt</code>, an address on the florist's own site. No such file exists on the florist's server, and the request never leaves the browser. The florist's worker takes the request and asks the library's worker for the file over the port that joins them. The library's worker reads its cache and posts back a status, headers and a <code>ReadableStream</code>. The stream is transferred, so the florist's worker returns it as the body of the response while the library's worker is still writing into it. The page reads the file a line at a time as the lines are written. The library's server is not contacted, and the library's page does nothing. If the library's worker was stopped, the first try gets no answer, a new port is carried across, and the same fetch still succeeds, a little later.",
    code: `<span class="c">// florist's service worker</span>
addEventListener("fetch", (event) => {
  if (!new URL(event.request.url).pathname.startsWith("/pair/from-other/")) return;
  event.respondWith(askPeer({ get: "shelf.txt" }).then((a) => new Response(a.body, a)));
});

<span class="c">// library's service worker: the body is a stream, and it is moved, not copied</span>
peer.onmessage = async (event) => {
  const body = new ReadableStream({ pull(controller) { <span class="c">/* a line every 350 ms */</span> } });
  event.ports[0].postMessage({ status: 200, headers, body }, [body]);
};`,
    tour: { steps: [
      ["Join the two workers", "The pages carry a port across, as in the demo at the top of the page.", 3200],
      ["Florist's page: fetch the library's shelf", "The page fetches an address on its own site. Its worker asks the library's worker, which answers with a stream and writes four lines into it.", 4200],
      ["Make the library's worker forget", "The library's worker closes its port, as a stop would."],
      ["Florist's page: fetch the library's shelf", "The first try gets no answer. A new port is carried across, and the same fetch is answered.", 6500],
      ["Florist's page: fetch a file the library does not have", "The library's worker answers 404, and that is the status the page sees.", 2600],
    ] },
    async setup(stage, ui) {
      const s = pairStage(stage, [["a", "florist", "Florist's page"], ["b", "library", "Library's page"]]);
      if (!s) return;
      await s.ready;
      const buttons = [
        ui.button("Florist's page: fetch the library's shelf", () => stage.post("a", { cmd: "fetch", file: "shelf.txt" }), true),
        ui.button("Florist's page: fetch a file the library does not have", () => stage.post("a", { cmd: "fetch", file: "prices.txt" }), true),
        ui.button("Make the library's worker forget", () => stage.post("b", { cmd: "forget" }), true),
      ];
      joinButton(stage, ui, s, buttons);
    },
  },
  {
    pattern: "swpair", use: [2], id: "built-matchmaker",
    title: "A third site introduces two service workers and closes",
    blurb: "Here neither site opens the other. A third site, the planner, has a frame of each. It makes one channel and posts a port to each page, addressed so that only that site can receive it. Each page gives its port to its own worker. The planner keeps nothing, and when its frame is destroyed the two workers go on talking. This is the cheapest way to join two workers, and it is the least durable. With the planner gone there is nobody who can carry a new port, so the link lasts until either worker is next stopped and then it cannot be repaired. Each page is trusting the planner about who holds the other port: the page accepts a port only from the planner's origin, and what it tells its worker about the other end is what the planner said.",
    code: `<span class="c">// planner's page: one channel, one port to each site, addressed</span>
const { port1, port2 } = new MessageChannel();
floristFrame.postMessage({ pair: "adopt", from: "library" }, floristOrigin, [port1]);
libraryFrame.postMessage({ pair: "adopt", from: "florist" }, libraryOrigin, [port2]);

<span class="c">// each site's page: take a port only from the planner, and give it to my worker</span>
addEventListener("message", (event) => {
  if (event.origin !== plannerOrigin) return;
  registration.active.postMessage({ pair: "peer", from: event.data.from }, [event.ports[0]]);
});`,
    tour: { steps: [
      ["Planner: introduce the two sites", "The planner makes a channel and posts one port to each page. Each page gives its port to its worker.", 3000],
      ["Close the planner", "The planner's frame is destroyed. It held no port, so nothing changes for the workers."],
      ["Florist's worker: ask about Dune", "The florist's worker asks, and the library's worker answers.", 2600],
      ["Library's worker: ask about tulips", "And the other way.", 2600],
      ["Make the library's worker forget", "The library's worker closes its port, as a stop would."],
      ["Florist's worker: ask about Dune", "No answer comes. The florist's worker looks for a page that can carry a new port. There is none, because the planner is gone.", 4500],
    ] },
    async setup(stage, ui) {
      const s = pairStage(stage, [["a", "florist", "Florist's page"], ["b", "library", "Library's page"]], { planner: true });
      if (!s) return;
      await Promise.all([s.ready, s.boxes.m.whenReady]);
      // The planner posts to the frames beside it. It is told which they are.
      const index = (box) => { for (let i = 0; i < frames.length; i++) if (frames[i] === s.boxes[box].frame.contentWindow) return i; };
      const buttons = [
        ui.button("Florist's worker: ask about Dune", () => stage.post("a", { cmd: "ask", item: "Dune" }), true),
        ui.button("Library's worker: ask about tulips", () => stage.post("b", { cmd: "ask", item: "tulips" }), true),
        ui.button("Make the library's worker forget", () => stage.post("b", { cmd: "forget" }), true),
      ];
      const close = ui.button("Close the planner", (btn) => { stage.remove("m"); btn.disabled = true; }, true);
      ui.button("Planner: introduce the two sites", (btn) => {
        btn.disabled = true;
        stage.post("m", { cmd: "introduce", a: { site: "florist", frame: index("a") }, b: { site: "library", frame: index("b") } });
        for (const b of [...buttons, close]) b.disabled = false;
      }, false, true);
    },
  },
];

// Shared workers: joined once, and the link lasts while either site has a tab.
function sharedStage(stage) {
  const tab = (box, site, name) => {
    const b = stage.box(box, { src: `${sites[site]}/pair/tab.html?name=${encodeURIComponent(name)}&title=${encodeURIComponent(name[0].toUpperCase() + name.slice(1))}` });
    b.frame.title = name; b.wrap.style.flexBasis = "max(9rem, 17%)";
    return b;
  };
  const tabs = { ft1: tab("ft1", "florist", "florist tab one"), ft2: tab("ft2", "florist", "florist tab two"), lt1: tab("lt1", "library", "library tab one"), lt2: tab("lt2", "library", "library tab two") };
  const worker = (box, site) => {
    const b = stage.box(box, { kind: "shared", url: `${sites[site]}/pair-shared.js`, html: `<div class="here"><h4>${TITLE[site]}'s shared worker</h4>
      <p class="small" style="margin:0 0 .25rem">Tabs: <strong data-tabs>none</strong></p>
      <p class="small" style="margin:0 0 .4rem">Port to the other worker: <strong data-peer>none</strong></p><ul class="log"></ul></div>` });
    b.wrap.style.flexBasis = "max(11.5rem, 34%)";
    const ul = b.node.querySelector("ul");
    b.say = (text) => { const li = document.createElement("li"); li.textContent = text; ul.prepend(li); while (ul.children.length > 3) ul.lastChild.remove(); };
    b.show = (st) => {
      b.node.querySelector("[data-tabs]").textContent = st.tabs.join(", ") || "none";
      b.node.querySelector("[data-peer]").textContent = st.peer ? `held, to the ${st.peerName}'s shared worker` : "none";
    };
    return b;
  };
  const workers = { florist: worker("swa", "florist"), library: worker("swb", "library") };
  const siteOf = { ft1: "florist", ft2: "florist", lt1: "library", lt2: "library" };
  const last = {}, peers = {};
  stage.on((box, data) => {
    if (data.wire !== "shared") return;
    const site = siteOf[box], key = JSON.stringify(data.state) + data.note;
    if (last[site] === key) return;   // every tab of a site hears the same report
    last[site] = key; peers[site] = data.state.peer;
    workers[site].show(data.state);
    if (data.note) workers[site].say(data.note);
    if (/over the link/.test(data.note || "")) stage.pulse("direct", site === "florist" ? "swa" : "swb");
    peers.florist && peers.library ? stage.cables.has("direct") || stage.cable("direct", "swa", "swb", "yellow") : stage.cut("direct");
  });
  // Each tab holds a port to its own site's worker.
  const ready = Promise.all(Object.values(tabs).map((t) => t.whenReady)).then(() => {
    for (const [box, site] of Object.entries(siteOf)) stage.cable("own-" + box, box, site === "florist" ? "swa" : "swb", "ink");
  });
  return { tabs, workers, ready };
}

// A frame offering a port whose other end it holds, and saying who it is.
// Runs inside a sandboxed frame, so it has an origin of its own that is opaque.
function offerer() {
  let keys = null;
  const ALG = { name: "ECDSA", namedCurve: "P-256" }, SIGN = { name: "ECDSA", hash: "SHA-256" };
  crypto.subtle.generateKey(ALG, false, ["sign", "verify"]).then((k) => { keys = k; tell("publickey", { key: k.publicKey }); log("made a key pair. Nobody can read the private key, me included"); });
  on("offer", (data) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = async ({ data: asked }) => {
      if (!asked.prove) return;
      const signature = await crypto.subtle.sign(SIGN, keys.privateKey, asked.prove);
      port1.postMessage({ signature });
      log("asked to sign a random value. Signed it with my own private key");
      tell("pulse", { cable: "c-" + data.name });
    };
    port1.postMessage({ hello: "I am the florist" });
    parent.postMessage({ wire: "port", name: data.name }, "*", [port2]);
    log("made a channel. Sent one port out. The first thing on it says: I am the florist");
  });
}

// The receiver. It is given the florist's public key, and then two ports.
function receiver() {
  const SIGN = { name: "ECDSA", hash: "SHA-256" };
  let florist = null;
  const held = [];
  on("key", (data) => { florist = data.key; log("given the florist's public key"); });
  on("port", (data, [port]) => {
    const n = held.length + 1;
    const entry = { port, n, pending: null };
    held.push(entry);
    port.onmessage = (event) => {
      if (event.data.hello) {
        const origin = JSON.stringify(event.origin), source = String(event.source), ports = event.ports.length;
        log(`port ${n} says "${event.data.hello}". event.origin is ${origin}, event.source is ${source}, ${ports} ports attached`);
        return tell("seen", { n, origin: event.origin, source });
      }
      entry.pending?.(event.data.signature);
    };
  });
  on("check", async () => {
    for (const entry of held) {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const signature = await new Promise((resolve) => { entry.pending = resolve; entry.port.postMessage({ prove: challenge }); setTimeout(() => resolve(null), 1500); });
      const ok = !!signature && !!florist && await crypto.subtle.verify(SIGN, florist, signature, challenge);
      log(ok ? `port ${entry.n}: signed my random value with the florist's key. The florist holds this port` : `port ${entry.n}: the signature does not match the florist's key. Closed it`);
      tell("checked", { n: entry.n, ok });
      if (!ok) entry.port.close();
    }
  });
}

pairBuilt.push(
  {
    pattern: "swpair", use: [3], id: "built-sharedpair",
    title: "Join the shared workers of two sites once, and use the link from every tab",
    blurb: "The same join, with shared workers. Each site has one shared worker, and every tab of that site holds a port to it. Tab one of each site carries a port across once. From then on, a note posted by any tab of either site goes to its own worker, over the link, and to every tab of the other site. Close the two tabs that made the link and nothing changes. A shared worker is not stopped while one of its tabs is open, so this link needs no time limits and is never rejoined. It ends when the last tab of either site closes. A shared worker is not told when a tab goes, so each tab says goodbye on <code>pagehide</code>. Inside a frame, as here, a shared worker belongs to the top-level site as well as its own, so these two workers are the florist's and the library's workers for pages embedded on port-authority.dev.",
    code: `<span class="c">// florist's shared worker: every florist tab is connected</span>
onconnect = ({ ports: [tab] }) => {
  tab.onmessage = ({ data, ports }) => {
    if (data.join) { const c = new MessageChannel(); link = c.port1; tab.postMessage({ carry: true }, [c.port2]); }
    if (data.peer) link = ports[0];   <span class="c">// on the library's side</span>
    if (data.note) { everyTab(data.note); link?.postMessage({ note: data.note }); }
  };
};
link.onmessage = ({ data }) => everyTab(data.note);

<span class="c">// a tab: one port to its own worker, and goodbye when it goes</span>
const { port } = new SharedWorker("/pair-shared.js");
addEventListener("pagehide", () => port.postMessage({ bye: name }));`,
    tour: { steps: [
      ["Join the two shared workers", "Tab one of each site is given a line to the other. The florist's worker makes a channel and tab one carries a port across to the library's worker.", 3000],
      ["Florist tab two: post a note", "Florist tab two did not take part in the join. Its note reaches both florist tabs and both library tabs.", 2600],
      ["Close tab one of each site", "The two tabs that carried the port are destroyed. Each says goodbye to its worker as it goes."],
      ["Library tab two: post a note", "The link is still there. The note reaches florist tab two.", 2600],
      ["Close library tab two", "That was the library's last tab, so the browser ends the library's shared worker, and its port with it."],
      ["Florist tab two: post a note", "The florist's worker posts into the link as before. Nothing is at the other end, and nothing says so.", 2600],
    ] },
    async setup(stage, ui) {
      if (!("SharedWorker" in self)) { stage.box("none", { html: `<div class="here"><h4>No SharedWorker</h4><p class="small">This browser has no shared workers.</p></div>` }); return; }
      const s = sharedStage(stage);
      await s.ready;
      let n = 0;
      const NOTES = ["the van leaves at four", "two copies of Dune are back", "peonies are sold out"];
      const note = (box) => stage.post(box, { cmd: "note", text: NOTES[n++ % NOTES.length] });
      const later = [
        ui.button("Florist tab two: post a note", () => note("ft2"), true),
        ui.button("Library tab two: post a note", () => note("lt2"), true),
        ui.button("Close tab one of each site", (btn) => { btn.disabled = true; stage.remove("ft1"); stage.remove("lt1"); }, true),
        ui.button("Close library tab two", (btn) => {
          btn.disabled = true; stage.remove("lt2"); later[1].disabled = true;
          // With no tab left, nothing on the library's side can report. Draw what the browser does.
          setTimeout(() => { stage.remove("swb"); stage.cut("direct"); }, 300);
        }, true),
      ];
      ui.button("Join the two shared workers", (btn) => {
        btn.disabled = true;
        const { port1, port2 } = new MessageChannel();
        stage.post("ft1", { cmd: "trunk", to: "library" }, [port1]);
        stage.post("lt1", { cmd: "trunk", to: "florist" }, [port2]);
        stage.cable("trunk", "ft1", "lt1", "teal");
        setTimeout(() => stage.post("ft1", { cmd: "join", to: "library" }), 200);
        for (const b of later) b.disabled = false;
      }, false, true);
    },
  },
  {
    pattern: "swpair", use: [4], id: "built-whoholds",
    title: "Check who holds the other end of a port that came over a port",
    blurb: "A port carries no name. When a port has come over another port, the receiver has only what the sender of the outer message said about it, and the sender may have been told something false by whoever gave it the port. Here this page passes the library two ports, as a page would pass on ports from whoever asked it to. Both ports say \"I am the florist\" as their first message. One is held by the florist and one by a stranger. The library looks at everything the browser tells it about each message, and it is the same for both: <code>event.origin</code> is an empty string and <code>event.source</code> is null. So the library checks. It has the florist's public key, which a site would publish at an address of its own. It posts a random value into each port and asks for it to be signed. Only the florist has the private key. The port whose signature does not match is closed.",
    code: `<span class="c">// the receiver: nothing about a port's messages says who holds the other end</span>
port.onmessage = (event) => { event.origin; <span class="c">// ""</span>  event.source; <span class="c">// null</span> };

<span class="c">// so ask the other end to prove it, with a key only the real holder has</span>
const challenge = crypto.getRandomValues(new Uint8Array(32));
port.postMessage({ prove: challenge });
const { signature } = await nextMessage(port);
const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, floristPublicKey, signature, challenge);
if (!ok) port.close();

<span class="c">// the florist: its private key cannot be read, so it cannot be given away by mistake</span>
const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);`,
    tour: { steps: [
      ["Give the library the florist's public key", "The florist made a key pair when it started. This page passes its public half to the library."],
      ["Pass the library a port from the florist", "The florist makes a channel and sends one port out. This page passes it on. Its first message says: I am the florist.", 2200],
      ["Pass the library a port from the stranger", "The stranger does exactly the same, with the same first message.", 2600],
      ["Library: check both ports", "The library posts a random value into each port and asks for a signature. The florist's is good. The stranger signs with a key of its own, the signature does not match, and the library closes that port.", 3600],
    ] },
    async setup(stage, ui) {
      let key = null, gotKey;
      const keyReady = new Promise((resolve) => (gotKey = resolve));
      const ports = {};
      stage.on((name, data, transferred) => {
        if (data.wire === "publickey" && name === "florist") { key = data.key; gotKey(); }
        if (data.wire === "port") ports[name] = transferred[0];
        if (data.wire === "checked") stage.boxes.get("library").node.dataset.checked = (stage.boxes.get("library").node.dataset.checked || "") + (data.ok ? "y" : "n");
      });
      // The two that offer ports, with this page between them, and the library underneath.
      const florist = stage.frame("florist", { title: "Florist", color: "red", script: offerer });
      const box = stage.box("page", { html: `<div class="here"><h4>This page, passing ports on</h4><p class="small" style="margin:0">It does not know what is at the other end of the ports it passes on. Neither does the library.</p></div>` });
      const stranger = stage.frame("stranger", { title: "A stranger", color: "yellow", script: offerer });
      const library = stage.frame("library", { title: "Library", color: "teal", script: receiver });
      await Promise.all([florist, stranger, library]);
      for (const name of ["florist", "page", "stranger"]) stage.boxes.get(name).wrap.style.flexBasis = "max(11.5rem, 26%)";
      stage.boxes.get("library").wrap.style.flexBasis = "100%";
      const pass = (from, color) => () => {
        stage.post(from, { cmd: "offer", name: from });
        const wait = setInterval(() => {
          if (!ports[from]) return;
          clearInterval(wait);
          stage.post("library", { cmd: "port" }, [ports[from]]);
          stage.pulse("via-" + from, from);
          stage.cable("c-" + from, from, "library", color);
        }, 50);
      };
      const later = [
        ui.button("Pass the library a port from the florist", pass("florist", "red"), true),
        ui.button("Pass the library a port from the stranger", pass("stranger", "yellow"), true),
        ui.button("Library: check both ports", () => stage.post("library", { cmd: "check" }), true),
      ];
      await keyReady;
      ui.button("Give the library the florist's public key", (btn) => {
        btn.disabled = true;
        stage.post("library", { cmd: "key", key });
        for (const b of later) b.disabled = false;
      }, false, true);
    },
  },
);
