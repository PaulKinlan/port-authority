// Knowing whether the other side of a port is still there. A port says nothing
// when its other end is destroyed, so each demo here adds a second port that
// carries health checks only, wired a different way each time.
import { sites } from "/_sites.js";
import { watch, listen, beat, whenReleased, hasCloseEvent } from "/alive.js";

const far = (stage, site, wiring, title, extra = "") =>
  stage.box("far", { src: `${sites[site]}/alive-far.html?wiring=${wiring}&title=${encodeURIComponent(title)}&color=${encodeURIComponent("#e0364c")}${extra}`, title });

const WORDS = {
  waiting: "Not connected",
  alive: "Alive",
  late: "Late",
  silent: "Silent: treat it as gone",
  paused: "Paused by the browser",
  closed: "Gone",
};

// The page's box: what it believes about the far side, and a short log.
function pageBox(stage, title, label = "The far side is") {
  const box = stage.box("page", { html: `<div class="here"><div class="box-title">${title}</div>
    <p class="small" style="margin:0 0 .2rem">${label}: <strong data-state>${WORDS.waiting}</strong></p>
    <p class="small muted" data-why style="margin:0 0 .4rem;min-height:1.3em"></p>
    <ul class="log" role="log" aria-live="polite"></ul></div>` });
  const ul = box.node.querySelector("ul");
  return {
    box,
    say(text) { const li = document.createElement("li"); li.textContent = text; ul.prepend(li); while (ul.children.length > 4) ul.lastChild.remove(); },
    show(state, why = "") { box.node.querySelector("[data-state]").textContent = WORDS[state] || state; box.node.querySelector("[data-why]").textContent = why; box.node.dataset.state = state; },
  };
}

// The buttons that make the far side go wrong, shared by the three wiring demos.
function troubles(stage, ui, me) {
  const ask = ui.button("Ask the price of tulips", () => { me.data.postMessage("tulips"); stage.pulse("data", "page"); }, true);
  const busy = ui.button("Far side: busy for 5 seconds", () => stage.post("far", { cmd: "stuck", ms: 5000 }), true);
  const close = ui.button("Far side: close its ports", () => stage.post("far", { cmd: "close" }), true);
  const gone = ui.button("Remove the far side", (b) => { stage.remove("far"); for (const x of [ask, busy, close, b]) x.disabled = true; }, true);
  return () => { for (const x of [ask, busy, close, gone]) x.disabled = false; };
}

function dataPort(stage, view) {
  const data = new MessageChannel();
  data.port1.onmessage = (e) => { view.say("answer: " + e.data); stage.pulse("data", "far"); };
  return data;
}

export const alive = [
  {
    id: "health-pair",
    title: "Send a second port with the first, only for health checks",
    blurb: "A port does not tell you when its other end has gone. Posting into it still works, and nothing comes back. So this page sends the far side two ports at once. The first carries the work: a flower name goes in, a price comes out, and that is the whole protocol. The second carries pings and their answers and nothing else. The page pings once a second. One missed answer is late. Three in a row and the page treats the far side as gone. A page that is closing says goodbye on the health port as it goes, so most endings are seen at once and the pings are there for the ones that are not.",
    code: `import { watch, answer } from "/alive.js";

<span class="c">// this page</span>
const data = new MessageChannel(), health = new MessageChannel();
frame.postMessage("ports", origin, [data.port2, health.port2]);
watch(health.port1, { every: 1000, misses: 3,
  onState: (state) => state === "silent" || state === "closed" ? giveUp() : null });

<span class="c">// the far side</span>
onmessage = ({ ports: [data, health] }) => {
  data.onmessage = (e) => data.postMessage(price(e.data)); <span class="c">// no health logic here</span>
  answer(health);  <span class="c">// answers pings, and says goodbye on pagehide</span>
};`,
    tour: { steps: [
      ["Connect", "This page makes two channels and sends one end of each to a page on the florist's site. Pings start on the second."],
      ["Ask the price of tulips", "The question and the answer go on the first port. The health port is not involved."],
      ["Far side: busy for 5 seconds", "The far side runs a long loop and answers nothing. One missed ping is late, three is silent. When the loop ends it answers again and is alive.", 7500],
      ["Remove the far side", "The frame is destroyed. Its page said goodbye on the health port as it went, so this page knew at once."],
    ] },
    async setup(stage, ui) {
      const box = far(stage, "florist", "pair", "Price list, on the florist's site");
      const view = pageBox(stage, "This page");
      await box.whenReady;
      const me = {};
      let watcher = null;
      stage.cleanup(() => { watcher?.stop(); me.data?.close(); });
      const enable = troubles(stage, ui, me);
      ui.button("Connect", (b) => {
        b.disabled = true;
        const data = dataPort(stage, view), health = new MessageChannel();
        me.data = data.port1;
        stage.post("far", { cmd: "port" }, [data.port2, health.port2]);
        stage.cable("data", "page", "far", "teal", "work");
        stage.cable("health", "page", "far", "ink", "health");
        watcher = watch(health.port1, { every: 1000, misses: 3, onState: (state, why) => { view.show(state, why); view.say(state + (why ? ": " + why : "")); }, onPing: () => stage.pulse("health", "page") });
        view.say("sent a data port and a health port");
        enable();
      }, false, true);
    },
  },
  {
    id: "health-back",
    title: "Let the far side make the health channel and send a port back",
    blurb: "Here the page sends only one port, the one for work, the same as it would with no health checks at all. When the far side receives it, it makes a channel of its own for health checks and sends one end back. Each side set up exactly one channel. The page does not have to know in advance that the far side does health checks: if a port comes back, it watches it. If none comes, it carries on without. The far side decides how it is watched.",
    code: `<span class="c">// this page: one port, as usual</span>
const data = new MessageChannel();
frame.postMessage("port", origin, [data.port2]);
addEventListener("message", (e) => {
  if (e.source === frame && e.data === "health") watch(e.ports[0], { onState });
});

<span class="c">// the far side: make the health channel, keep one end, send the other back</span>
onmessage = ({ source, ports: [data] }) => {
  serve(data);
  const health = new MessageChannel();
  answer(health.port1);
  source.postMessage("health", "*", [health.port2]);
};`,
    tour: { steps: [
      ["Connect", "This page sends one port. The far side makes a second channel and sends an end back. That end is drawn as it arrives."],
      ["Ask the price of tulips", "Work goes on the port this page made."],
      ["Far side: close its ports", "The far side calls close() on both of its ports. Nothing is said: close() is silent. The pings stop being answered, and after three this page gives up.", 5000],
    ] },
    async setup(stage, ui) {
      const box = far(stage, "florist", "back", "Price list, on the florist's site");
      const view = pageBox(stage, "This page");
      await box.whenReady;
      const me = {};
      let watcher = null;
      stage.cleanup(() => { watcher?.stop(); me.data?.close(); });
      const enable = troubles(stage, ui, me);
      stage.on((name, data, ports) => {
        if (name !== "far") return;
        if (data.wire === "health" && ports[0]) {
          stage.cable("health", "far", "page", "ink", "health");
          view.say("a health port came back");
          watcher = watch(ports[0], { every: 1000, misses: 3, onState: (state, why) => { view.show(state, why); view.say(state + (why ? ": " + why : "")); }, onPing: () => stage.pulse("health", "page") });
        }
      });
      ui.button("Connect", (b) => {
        b.disabled = true;
        const data = dataPort(stage, view);
        me.data = data.port1;
        stage.post("far", { cmd: "port" }, [data.port2]);
        stage.cable("data", "page", "far", "teal", "work");
        view.say("sent one port, for work");
        enable();
      }, false, true);
    },
  },
  {
    id: "health-beats",
    title: "Send a beat each way on two one-way ports",
    blurb: "Each side makes a channel, keeps the end it posts into and gives the other side the end to listen on. Then it posts a beat on a timer and never reads its own port. Each side only listens to the other's. Both sides learn whether the other is there, with half the messages of ping and answer, and neither side's code has to match an answer to a question. Each beat says how often beats will come, and whether the page that sent it is hidden, because a browser slows the timers of a hidden page.",
    code: `import { beat, listen } from "/alive.js";

<span class="c">// each side does the same</span>
const mine = new MessageChannel();
beat(mine.port1, { every: 1000 });           <span class="c">// post into this end, never read it</span>
other.postMessage("beats", origin, [mine.port2]);
<span class="c">// ...and listens on the end the other side sent</span>
listen(theirs, { onState: (state) => show(state) });`,
    tour: { steps: [
      ["Connect", "This page sends a data port and the end of its beat channel. The far side sends back the end of its own."],
      ["This page: stop sending beats", "This page stops its timer. The far side, which only listens, sees the beats stop and says so in its log.", 5500],
      ["Remove the far side", "The far side is destroyed. Its goodbye arrives on its beat port."],
    ] },
    async setup(stage, ui) {
      const box = far(stage, "florist", "beats", "Price list, on the florist's site", "&every=1000");
      const view = pageBox(stage, "This page");
      await box.whenReady;
      const me = {};
      const enable = troubles(stage, ui, me);
      let mine = null, listener = null;
      stage.cleanup(() => { mine?.stop(); listener?.stop(); me.data?.close(); });
      stage.on((name, data, ports) => {
        if (name !== "far") return;
        if (data.wire === "beats" && ports[0]) {
          stage.cable("beats-far", "far", "page", "red", "← beats");
          listener = listen(ports[0], { onState: (state, why) => { view.show(state, why); view.say(state + (why ? ": " + why : "")); } });
        }
      });
      const stop = ui.button("This page: stop sending beats", (b) => { mine.stop(); b.disabled = true; view.say("stopped my beats"); }, true);
      ui.button("Connect", (b) => {
        b.disabled = true;
        const data = dataPort(stage, view), out = new MessageChannel();
        me.data = data.port1;
        mine = beat(out.port1, { every: 1000, onBeat: () => stage.pulse("beats-page", "page") });
        stage.post("far", { cmd: "port" }, [data.port2, out.port2]);
        stage.cable("data", "page", "far", "teal", "work");
        stage.cable("beats-page", "page", "far", "yellow", "beats →");
        view.say("sent a data port and my beat port");
        enable(); stop.disabled = false;
      }, false, true);
    },
  },
  {
    id: "alive-signals",
    noAutoplay: true,
    title: "Which signal notices which ending, and how quickly",
    blurb: "Every way of knowing the far side has gone, side by side, measured in your browser. For each row a fresh far side is made on this site's own origin and given every signal at once: a port that only carries its goodbye, a port it answers pings on every half second, a port it beats on every half second, and a Web Lock it holds. Then it is ended in one way, and the table shows how long each signal took to say so. The last column is the port <code>close</code> event. It was added to the HTML standard in 2024, never switched on in any browser, and taken out again in October 2026.",
    code: `<span class="c">// the far side holds a lock with a name only it uses, and tells the page the name</span>
const name = "alive-" + crypto.randomUUID();
navigator.locks.request(name, () => new Promise(() => {}));  <span class="c">// never let go</span>

<span class="c">// this page queues for the same lock. It is granted when the holder is destroyed.</span>
await navigator.locks.request(name, () => {});
farSideIsGone();`,
    tour: { steps: [
      ["Run every row", "Each ending is tried in turn on a fresh far side. A row takes a few seconds.", 30000],
    ], then: "Run any row again with its own button. The numbers are from your browser, now." },
    async setup(stage, ui) {
      const ENDINGS = [
        ["remove", "The frame is removed from the page"],
        ["leave", "The frame navigates to another page"],
        ["close", "The far side calls close() on its ports"],
        ["worker", "A worker is terminated"],
        ["stuck", "A worker is busy for 4 seconds, then fine"],
      ];
      const COLS = ["goodbye", "pings", "beats", "lock", "close"];
      const table = stage.box("page", { wide: true, html: `<div class="here"><div class="box-title">This page, timing each signal</div>
        <div style="overflow-x:auto" tabindex="0"><table class="census" style="min-width:40rem"><thead><tr><th scope="col">How it ends</th><th scope="col">Goodbye on pagehide</th><th scope="col">Pings, 0.5 s, 3 misses</th><th scope="col">Beats, 0.5 s</th><th scope="col">Web Lock released</th><th scope="col">Port close event</th></tr></thead>
        <tbody>${ENDINGS.map(([id, label]) => `<tr data-row="${id}"><th scope="row">${label}</th>${COLS.map((c) => `<td data-col="${c}" class="no">not run</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>` });
      const slot = stage.box("far", { kind: "iframe", html: `<div class="here"><div class="box-title">Nothing yet</div><p class="small">Each row makes a new far side here, then ends it.</p></div>` });
      const cell = (row, col, text, good) => { const td = table.node.querySelector(`[data-row="${row}"] [data-col="${col}"]`); if (td) { td.textContent = text; td.className = good ? "" : "no"; } };
      const secs = (ms) => ms < 1000 ? `${Math.max(0, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`;
      let running = false, cancelled = false;
      const activeCleanups = new Set();
      stage.cleanup(() => { cancelled = true; for (const fn of activeCleanups) { try { fn(); } catch {} } activeCleanups.clear(); });

      async function run(ending) {
        if (cancelled) return;
        for (const c of COLS) cell(ending, c, "…", false);
        const seen = {};
        let t0 = 0, worker = null, frame = null, workerUrl = null;
        const mark = (col, text) => { if (t0 && !(col in seen) && !cancelled) { seen[col] = text ?? secs(performance.now() - t0); cell(ending, col, seen[col], true); } };
        const chans = [0, 1, 2, 3, 4].map(() => new MessageChannel());
        let lockName;
        const inWorker = ending === "worker" || ending === "stuck";
        const abort = new AbortController();
        let pings = null, beats = null;
        const teardown = () => {
          pings?.stop(); beats?.stop(); abort.abort();
          if (worker) { worker.terminate(); worker = null; }
          if (workerUrl) { URL.revokeObjectURL(workerUrl); workerUrl = null; }
          frame?.remove(); frame = null;
        };
        activeCleanups.add(teardown);
        try {
          if (inWorker) {
            slot.node.innerHTML = `<div class="here"><div class="box-title">A worker</div><p class="small">Answering pings, sending beats, holding a lock.</p></div>`;
            slot.kind = "worker"; slot.url = "blob:"; stage.describe(slot);
            const src = `import { answer, beat, holdLock } from "${location.origin}/alive.js";
              onmessage = async ({ data, ports }) => {
                if (data && data.stuck) { const end = Date.now() + data.stuck; while (Date.now() < end); return; }
                answer(ports[1], { announce: false }); beat(ports[2], { every: 500, announce: false }); postMessage(await holdLock());
              };`;
            workerUrl = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
            worker = new Worker(workerUrl, { type: "module" });
            const got = new Promise((r) => (worker.onmessage = (e) => r(e.data)));
            worker.postMessage(0, chans.slice(0, 4).map((c) => c.port2));
            lockName = await got;
          } else {
            slot.kind = "iframe";
            slot.node.innerHTML = "";
            frame = document.createElement("iframe");
            frame.title = "The far side";
            frame.src = `/alive-far.html?wiring=all&every=500&title=${encodeURIComponent("The far side, this origin")}`;
            slot.node.append(frame);
            await new Promise((resolve) => { const off = stage.on((name, data) => { if (name === "far" && data.wire === "ready") { off(); resolve(); } }); });
            if (cancelled) return;
            const got = new Promise((resolve) => { const off = stage.on((name, data) => { if (name === "far" && data.wire === "lock") { off(); resolve(data.name); } }); });
            frame.contentWindow.postMessage({ cmd: "port" }, "*", chans.slice(0, 4).map((c) => c.port2));
            lockName = await got;
          }
          if (cancelled) return;
          chans[3].port1.onmessage = ({ data }) => { if (data.bye) mark("goodbye"); };
          if (inWorker) cell(ending, "goodbye", "none: a worker has no pagehide", false), (seen.goodbye = 1);
          const back = (col) => (state) => {
            if (!t0 || cancelled) return;
            if (state === "silent" || state === "closed") mark(col);
            if (state === "alive" && seen[col] && ending === "stuck" && !seen[col + "+"]) { seen[col + "+"] = 1; cell(ending, col, `${seen[col]}, then alive again`, true); }
          };
          pings = watch(chans[1].port1, { every: 500, misses: 3, closeEvent: false, onState: back("pings") });
          beats = listen(chans[2].port1, { closeEvent: false, onState: back("beats") });
          whenReleased(lockName, { signal: abort.signal }).then(() => mark("lock"), () => {});
          if (hasCloseEvent) chans[0].port1.addEventListener("close", () => mark("close"));
          chans[0].port1.start();
          await new Promise((r) => setTimeout(r, 1200));
          if (cancelled) return;
          t0 = performance.now();
          if (ending === "remove") { frame.remove(); slot.node.innerHTML = ""; }
          else if (ending === "leave") frame.contentWindow.postMessage({ cmd: "leave" }, "*");
          else if (ending === "close") frame.contentWindow.postMessage({ cmd: "close" }, "*");
          else if (ending === "stuck") worker.postMessage({ stuck: 4000 });
          else if (ending === "worker") worker.terminate();
          await new Promise((r) => setTimeout(r, ending === "stuck" ? 6500 : 4000));
          if (cancelled) return;
          t0 = 0;   // what happens while tidying up is not part of the result
          for (const col of COLS) if (!(col in seen)) cell(ending, col, col === "close" && !hasCloseEvent ? "not in this browser" : "nothing", false);
          slot.node.innerHTML = `<div class="here"><div class="box-title">Ended</div><p class="small">Each row makes a new far side here, then ends it.</p></div>`;
        } finally {
          teardown();
          activeCleanups.delete(teardown);
        }
      }

      const buttons = ENDINGS.map(([id, label]) => ui.button("Run: " + label.toLowerCase(), async () => {
        if (running) return; running = true; for (const b of buttons) b.disabled = true;
        try { await run(id); } finally { running = false; for (const b of buttons) b.disabled = false; }
      }));
      ui.button("Run every row", async () => {
        if (running) return; running = true; for (const b of buttons) b.disabled = true;
        try { for (const [id] of ENDINGS) { if (cancelled) break; await run(id); } } finally { running = false; for (const b of buttons) b.disabled = false; }
      }, false, true);
    },
  },
  {
    id: "alive-restart",
    title: "Restart a worker that has stopped answering, and ask again",
    blurb: "A worker counts prime numbers for this page. It is given a port for the work and a port to answer health pings on. If it stops answering, because it is stuck in a loop or has closed itself, the page waits for three missed pings, terminates it, starts a new one and sends it every question that was not answered. Nothing about health is in the work protocol, so the restart is invisible to the code that asked: it gets its answer, later than usual.",
    code: `function start() {
  const worker = new Worker("/patterns/alive-worker.js", { type: "module" });
  const work = new MessageChannel(), health = new MessageChannel();
  worker.postMessage({ ports: true }, [work.port2, health.port2]);
  work.port1.onmessage = ({ data }) => { pending.get(data.id).resolve(data.count); pending.delete(data.id); };
  watch(health.port1, { every: 500, misses: 3, onState(state) {
    if (state !== "silent") return;
    worker.terminate();
    start();                                       <span class="c">// a new worker</span>
    for (const [id, ask] of pending) current.postMessage({ id, n: ask.n }); <span class="c">// ask again</span>
  } });
}`,
    tour: { steps: [
      ["Start the worker", "This page starts a worker and sends it two ports: one for prime calculations and one for health pings."],
      ["Ask: primes below 5 million", "The question goes on the work port and the answer comes back on it."],
      ["Make the worker hang", "The worker is sent into a loop that never ends. It cannot answer pings or work."],
      ["Ask: primes below 5 million", "This question waits. After three missed pings the page terminates the worker, starts a new one, and asks it again.", 4500],
      ["Make the worker close itself", "The worker calls close(). Nothing is said to this page. The pings go unanswered and it is replaced.", 3500],
    ] },
    async setup(stage, ui) {
      const view = pageBox(stage, "This page", "The worker is");
      const wbox = stage.box("worker", { kind: "worker", url: "/patterns/alive-worker.js", html: `<div class="here"><div class="box-title">Worker</div><p class="small" style="margin:0">Number <strong data-gen>not started</strong></p><p class="small" style="margin:0">Questions answered: <strong data-done>0</strong></p></div>` });
      const pending = new Map();
      let worker = null, work = null, health = null, gen = 0, next = 0, done = 0, restartTimer = null, alive = true;
      stage.cleanup(() => {
        alive = false;
        clearTimeout(restartTimer);
        health?.stop();
        work?.close();
        worker?.terminate();
      });
      function start() {
        if (!alive) return;
        gen++;
        wbox.node.querySelector("[data-gen]").textContent = gen;
        wbox.node.classList.remove("gone"); wbox.wrap.classList.remove("gone");
        worker = new Worker("/patterns/alive-worker.js", { type: "module" });
        const w = new MessageChannel(), h = new MessageChannel();
        worker.postMessage({ ports: true }, [w.port2, h.port2]);
        work = w.port1;
        work.onmessage = ({ data }) => {
          if (!pending.has(data.id)) return;
          pending.delete(data.id);
          wbox.node.querySelector("[data-done]").textContent = ++done;
          stage.pulse("work", "worker");
          view.say(`answer #${data.id}: ${data.count.toLocaleString("en-GB")} primes below ${data.n.toLocaleString("en-GB")}`);
        };
        const mine = gen;
        health = watch(h.port1, { every: 500, misses: 3, onPing: () => stage.pulse("health", "page"), onState(state, why) {
          if (!alive || mine !== gen) return;
          view.show(state, why);
          if (state !== "silent") return;
          view.say(`worker ${mine} is silent. terminating it and starting another`);
          health.stop(); worker.terminate();
          stage.cut("work"); stage.cut("health");
          restartTimer = setTimeout(() => {
            if (!alive) return;
            start();
            for (const [id, ask] of pending) { work.postMessage({ id, n: ask.n }); view.say(`asked #${id} again`); }
          }, 400);
        } });
        stage.cable("work", "page", "worker", "teal", "work");
        stage.cable("health", "page", "worker", "ink", "health");
      }
      const askBtn = ui.button("Ask: primes below 5 million", () => {
        const id = ++next, n = 5_000_000;
        pending.set(id, { n });
        work.postMessage({ id, n });
        stage.pulse("work", "page");
        view.say(`asked #${id}`);
      }, true);
      const hangBtn = ui.button("Make the worker hang", () => { worker.postMessage({ hang: true }); view.say("told the worker to loop for ever"); }, true);
      const quitBtn = ui.button("Make the worker close itself", () => { worker.postMessage({ quit: true }); view.say("told the worker to call close()"); }, true);
      ui.button("Start the worker", (btn) => {
        btn.disabled = true;
        start();
        view.say("started worker 1 with a work port and a health port");
        askBtn.disabled = hangBtn.disabled = quitBtn.disabled = false;
      }, false, true);
    },
  },
];
