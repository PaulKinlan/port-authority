// Other places a port can reach: another device, a path on your own origin,
// every tab at once, and the audio thread. Same stage as demos.js.
import { sites } from "/_sites.js";
import { far } from "/farport.js";
import { qrSvg } from "/qr.js";

const logBox = (stage, name, title, extra = "", what = {}) => {
  const box = stage.box(name, { html: `<div class="here"><h4>${title}</h4>${extra}<ul class="log"></ul></div>`, ...what });
  const ul = box.node.querySelector("ul");
  const say = (text) => { const li = document.createElement("li"); li.textContent = text; ul.prepend(li); while (ul.children.length > 6) ul.lastChild.remove(); };
  return { say, node: box.node, box };
};
const embed = (box, src, title) => {
  box.node.innerHTML = `<iframe title="${title}" src="${src}"></iframe>`;
  box.frame = box.node.querySelector("iframe");
  return new Promise((resolve) => (box.frame.onload = resolve));
};

// Runs in the composer worker of the "audio" demo. It writes the tune, sends
// each note straight to the audio thread, and paints what it is doing.
function composer() {
  const tune = [262, 330, 392, 523, 392, 330, 294, 349, 440, 587, 440, 349];
  let ctx = null, port = null, sent = 0, played = 0, look = {}, timer = null;
  const recent = [];
  const draw = () => {
    if (!ctx) return;
    const { width: w, height: h } = ctx.canvas;
    const u = h / 11.5;
    ctx.fillStyle = look.panel; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = look.color; ctx.beginPath(); ctx.arc(u * 1.2, u * 1.35, u * 0.42, 0, 7); ctx.fill();
    ctx.fillStyle = look.ink;
    ctx.font = `800 ${u}px system-ui, sans-serif`; ctx.fillText("Composer, a worker", u * 1.9, u * 1.7);
    ctx.font = `${u * 0.78}px ui-monospace, Menlo, monospace`;
    ctx.fillText(`notes sent ${sent}`, u * 0.8, u * 3.6);
    ctx.fillText(`audio thread played ${played}`, u * 0.8, u * 4.9);
    // The last few notes as bars, so the tune can be seen moving.
    const bar = (w - u * 1.6) / 16;
    recent.forEach((freq, i) => {
      const tall = ((freq - 240) / 360) * u * 4;
      ctx.fillStyle = i === recent.length - 1 ? look.color : look.ink;
      ctx.fillRect(u * 0.8 + i * bar, h - u * 0.8 - tall, bar * 0.7, tall);
    });
  };
  onmessage = (event) => {
    const data = event.data;
    if (data.surface) { ctx = data.surface.getContext("2d"); look = data.look; draw(); }
    if (data.count) postMessage({ sent, played });
    if (data.stop) { clearInterval(timer); if (port) port.close(); }
    if (event.ports[0]) {
      port = event.ports[0];
      // The audio thread says when it has started each note.
      port.onmessage = ({ data: heard }) => { played = heard.played; draw(); };
      timer = setInterval(() => {
        const freq = tune[sent % tune.length];
        port.postMessage({ freq });
        sent++; recent.push(freq); if (recent.length > 16) recent.shift();
        draw();
      }, 230);
    }
  };
}

// Runs on the audio thread. No DOM, no timers, no network. It has a port.
const BELL = `class Bell extends AudioWorkletProcessor {
  constructor() {
    super();
    this.freq = 0; this.phase = 0; this.level = 0; this.played = 0;
    this.port.onmessage = (event) => {
      const far = event.ports[0];
      if (!far) return;
      far.onmessage = ({ data }) => { this.freq = data.freq; this.level = 0.3; far.postMessage({ played: ++this.played }); };
    };
  }
  process(inputs, outputs) {
    const out = outputs[0];
    if (!out[0]) return true;
    for (let i = 0; i < out[0].length; i++) {
      const sample = Math.sin(this.phase) * this.level;
      this.phase += (2 * Math.PI * this.freq) / sampleRate;
      this.level *= 0.9997;
      for (const channel of out) channel[i] = sample;
    }
    return true;
  }
}
registerProcessor("bell", Bell);`;

export const places = [
  {
    id: "far",
    title: "A port whose other end is on another device",
    blurb: "This page meets another device through a pairing code, the two connect directly with WebRTC, and each side wraps its end of that connection in a <code>MessagePort</code>. Then this page hands its port on. The counter at the end of the yellow cable is a sandboxed frame that was given a port and knows nothing more. Your phone is now pressing its buttons. The server carried a few messages so the two could find each other, and nothing since. The port carries more than text: bytes, other ports and streams can be posted into it, and each is rebuilt on the other device. Two demos further down this page do that.",
    code: `<span class="c">// both devices</span>
const port = await far({ code });               <span class="c">// a real MessagePort</span>

<span class="c">// this page: give it away like any other port</span>
counterFrame.postMessage({ cmd: "port" }, "*", [port]);

<span class="c">// the other device: ordinary port code</span>
port.postMessage({ do: "add" });
port.onmessage = ({ data }) => show(data.count);`,
    async setup(stage, ui) {
      const farBox = stage.box("far", { html: `<div class="here"><h4>Another device</h4><p class="small muted">Nobody yet. Open the link on a phone, or let a stand-in play the part.</p></div>` });
      const me = logBox(stage, "page", "This page, in the middle", `<p class="small" data-code style="margin:0 0 .4rem" hidden></p>`);
      await stage.frame("tool", {
        title: "Counter, a sandboxed frame", color: "yellow",
        script: () => {
          const colours = ["#f5b700", "#e0364c", "#0e9f8e", "#7a5cff"];
          let count = 0, c = 0;
          const big = document.createElement("p");
          big.style.cssText = "font:800 2rem/1 system-ui;margin:0 0 .4rem;display:flex;align-items:center;gap:.5rem";
          big.innerHTML = '<span style="width:.6em;height:.6em;border-radius:50%;display:inline-block"></span><span>0</span>';
          document.getElementById("log").before(big);
          const show = () => { big.firstChild.style.background = colours[c]; big.lastChild.textContent = count; };
          show();
          on("port", (data, ports) => {
            const port = ports[0];
            log("given a port. I do not know where it goes.");
            port.onmessage = ({ data: msg }) => {
              if (msg.do === "add") { count++; log("asked to add one"); }
              if (msg.do === "colour") { c = (c + 1) % colours.length; log("asked for another colour"); }
              show();
              port.postMessage({ count, colour: colours[c] });
              tell("pulse", { cable: "port" });
            };
          });
        },
      });
      if (!("RTCPeerConnection" in self)) return me.say("no WebRTC in this browser");
      const codeEl = me.node.querySelector("[data-code]");
      let line = null, code = null;
      const WORDS = { waiting: "waiting for the other device", found: "the other device is here, connecting directly", direct: "connected directly. The server is out of it.", gone: "the other device hung up", failed: "could not connect" };
      const standIn = ui.button("Use a stand-in for the other device", async (btn) => {
        btn.disabled = true;
        await embed(farBox, `/far/?embed=1#${code}`, "A stand-in for another device");
      }, true);
      const add = ui.button("Other device: add one", () => stage.post("far", { cmd: "add" }), true);
      const colour = ui.button("Other device: change the colour", () => stage.post("far", { cmd: "colour" }), true);
      const hang = ui.button("Hang up", (btn) => { line?.close(); line = null; stage.cut("air"); stage.cut("port"); btn.disabled = add.disabled = colour.disabled = true; me.say("closed the connection"); }, true);
      ui.button("Open a line for another device", (btn) => {
        btn.disabled = true;
        code = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
        const url = `${location.origin}/far/#${code}`;
        codeEl.hidden = false;
        codeEl.innerHTML = `Code <strong>${code}</strong>. On a phone: <a href="${url}" target="_blank">${location.host}/far/#${code}</a>`;
        farBox.node.innerHTML = `<div class="here" style="display:flex;gap:.6rem;align-items:flex-start"><a href="${url}" target="_blank" data-qr style="flex:none;width:6.6rem;line-height:0;border-radius:6px;overflow:hidden">${qrSvg(url, { label: "QR code for " + url })}</a><div><h4>Another device</h4><p class="small muted" style="margin:0">Scan this with a phone, or let a stand-in play the part.</p></div></div>`;
        standIn.disabled = false;
        line = far({
          code, host: true,
          onState(state) {
            me.say(WORDS[state] || state);
            if (state === "gone") { stage.cut("air"); add.disabled = colour.disabled = true; }
          },
          onPort(port) {
            // The port that stands for the other device goes to the counter.
            // This page keeps nothing, and the two talk without it.
            stage.post("tool", { cmd: "port" }, [port]);
            if (!farBox.frame) { farBox.node.dataset.link = "up"; farBox.node.innerHTML = `<div class="here"><h4>Another device</h4><p class="small">Connected. It is a real device, so its screen is not shown here.</p></div>`; }
            stage.cable("air", "far", "page", "teal", "rtc");
            stage.cable("port", "page", "tool", "yellow");
            me.say("gave the far port to the counter");
            standIn.disabled = true; hang.disabled = false;
            if (farBox.frame) add.disabled = colour.disabled = false;
          },
        });
        // Leaving the page or starting again hangs up.
        const watch = setInterval(() => { if (!me.node.isConnected) { clearInterval(watch); line?.close(); } }, 1000);
      }, false, true);
    },
  },
  {
    id: "mounted",
    title: "Mount another site at a path on yours",
    blurb: "A service worker can answer a request by asking a port, and the other end of that port can be on another origin. This page introduces a service worker to the florist's site. From then on, every request under <code>/patterns/mounted/florist/</code> is answered by the florist: pages, images, and a file whose body is a stream that the florist is still writing while this origin reads it. The florist's server is never contacted. Its page, open in a frame, is the server. The same worker script, registered again for <code>/patterns/mounted/library/</code> and given a port to the library's site, mounts that site beside it. What is mounted here runs as this origin, so mount only what you would let act as you.",
    code: `<span class="c">// this page: a worker for the path, and a port to the site that will serve it</span>
const reg = await navigator.serviceWorker.register("/mount-sw.js", { scope: "/mounted/florist/" });
const { port1, port2 } = new MessageChannel();
floristFrame.postMessage({ cmd: "serve" }, floristOrigin, [port1]);
reg.active.postMessage({ mount: true }, [port2]);

<span class="c">// service worker</span>
origin.postMessage({ path }, [replyPort]);
<span class="c">// the florist answers with a body that is a ReadableStream, transferred</span>
return new Response(answer.body, answer);`,
    tour: { steps: [
      ["Mount the florist's site here", "This page gives one end of a channel to the florist's site and the other to a service worker for that path."],
      ["Open the catalogue", "A page at an address on this origin. Its HTML, its picture and a slowly written file all come from the florist, down the port.", 4200],
      ["Mount the library's site too", "The same worker script is registered for a second path and given a port to the library's site."],
      ["Open the library's catalogue", "A second address on this origin, served by a second site.", 4200],
      ["Unmount", "The florist's worker drops its port. That address has nothing behind it, and the library's still works."],
    ] },
    async setup(stage, ui) {
      const shelfSrc = (site, title, color) => `${sites[site]}/actor.html?role=shelf&shelf=${site}&title=${encodeURIComponent(title)}&color=${encodeURIComponent(color)}`;
      const shelf = stage.box("shelf", { src: shelfSrc("florist", "Florist, a real site", "#e0364c") });
      shelf.frame.title = "Florist, a real site";
      const shelf2 = stage.box("shelf2", { src: shelfSrc("library", "Library, a real site", "#0e9f8e") });
      shelf2.frame.title = "Library, a real site";
      const sw = logBox(stage, "sw", "This site's service worker", "", { kind: "service", url: "/patterns/mount-sw.js", scope: "/patterns/mounted/florist/ and /patterns/mounted/library/" });
      const view = stage.box("view", { kind: "iframe", html: `<div class="here"><h4>/patterns/mounted/</h4><p class="small muted">Nothing is mounted here yet.</p></div>` });
      if (!("serviceWorker" in navigator)) return sw.say("no service worker support here");
      await Promise.all([shelf.whenReady, shelf2.whenReady]);
      // One registration of the same script for each mounted site.
      const mounts = { florist: { box: "shelf", cable: "mount", color: "yellow" }, library: { box: "shelf2", cable: "mount2", color: "teal" } };
      const introduce = (name) => {
        const { port1, port2 } = new MessageChannel();
        stage.post(mounts[name].box, { cmd: "serve" }, [port1]);
        mounts[name].registration.active.postMessage({ mount: true }, [port2]);
      };
      const onMessage = (event) => {
        if (!sw.node.isConnected) return navigator.serviceWorker.removeEventListener("message", onMessage);
        const name = event.data?.needMount;
        if (name && mounts[name]?.mounted) return introduce(name);
        if (event.data?.mounted) { sw.say(`${event.data.status} ${event.data.site}/${event.data.mounted}, asked the ${event.data.site}`); stage.pulse("down", "view"); stage.pulse(mounts[event.data.site]?.cable, "sw"); }
      };
      navigator.serviceWorker.addEventListener("message", onMessage);
      const load = (name, file) => { stage.cable("down", "view", "sw", "ink", "fetch"); return embed(view, `/patterns/mounted/${name}/${file}?${Date.now()}`, `A page on this origin, served by the ${name}`); };
      const mount = async (name) => {
        const m = mounts[name];
        try {
          m.registration = await navigator.serviceWorker.register("/patterns/mount-sw.js", { scope: `/patterns/mounted/${name}/` });
          const worker = m.registration.active || m.registration.waiting || m.registration.installing;
          if (worker.state !== "activated") await new Promise((resolve) => worker.addEventListener("statechange", () => worker.state === "activated" && resolve()));
        } catch (err) { sw.say("could not start: " + err.message); return false; }
        m.mounted = true; introduce(name);
        stage.cable(m.cable, m.box, "sw", m.color);
        sw.say(`holding a port to the ${name}'s site, for /mounted/${name}/`);
        return true;
      };
      const open = ui.button("Open the catalogue", () => load("florist", "catalogue.html"), true);
      const open2 = ui.button("Open the library's catalogue", () => load("library", "catalogue.html"), true);
      const gone = ui.button("Unmount", (btn) => {
        mounts.florist.mounted = false; mounts.florist.registration.active.postMessage({ unmount: true });
        stage.cut("mount"); sw.say("dropped the port to the florist. Its path is empty again.");
        btn.disabled = true; load("florist", "catalogue.html");
      }, true);
      const second = ui.button("Mount the library's site too", async (btn) => { btn.disabled = true; if (await mount("library")) open2.disabled = false; }, true);
      ui.button("Mount the florist's site here", async (btn) => {
        btn.disabled = true;
        if (await mount("florist")) open.disabled = gone.disabled = second.disabled = false;
      }, false, true);
      ui.link("Open the mounted catalogue in a new tab", "/patterns/mounted/florist/catalogue.html");
    },
  },
  {
    id: "socket",
    title: "One connection to the server, shared by every tab",
    blurb: "Ten tabs of the same site usually means ten connections to the server. Here no tab has one. A shared worker holds the only WebSocket, and each tab holds a port to the worker. A tab speaks by posting to its port. The worker numbers each question, and the answer with that number goes back down the port of the tab that asked, so replies are never mixed up. Close a tab and the worker notices and carries on. Drop the connection and the worker opens another and asks again anything that was not answered. The tabs have no code for any of that. The two boxes on the outside are real pages of this site, and the link opens a third in a real tab that joins the same socket.",
    tour: { steps: [
      ["Tab one: say hello", "Tab one posts to its port. The worker sends it on the only socket, and the server's answer comes back to tab one alone."],
      ["Tab two: say hello", "Tab two does the same, on the same socket."],
      ["Close tab one", "Tab one is destroyed. The worker notices, and the socket stays open for the other."],
      ["Drop the connection", "The worker's socket is closed, as a failed network would close it. The worker opens another. Tab two did nothing and was told nothing.", 2600],
      ["Tab two: say hello", "Tab two posts to the same port as before, and the answer arrives over the new socket."],
    ] },
    code: `<span class="c">// every tab</span>
const { port } = new SharedWorker("/socket-worker.js");
port.postMessage({ say: "hello" });
port.onmessage = ({ data }) => show(data.answer);

<span class="c">// the worker: one socket, and a note of who asked what</span>
port.onmessage = ({ data }) => {
  const id = ++ids;
  pending.set(id, { port, text: data.say });
  socket.send(JSON.stringify({ id, text: data.say }));
};
socket.onmessage = ({ data }) => {
  const { id, text } = JSON.parse(data);
  pending.get(id).port.postMessage({ answer: text });
  pending.delete(id);
};
<span class="c">// a dropped connection: open another and ask again what is still waiting</span>
socket.onclose = () => setTimeout(connect, 300);`,
    async setup(stage, ui) {
      const one = stage.box("tab1", { kind: "iframe" });
      const hub = stage.box("worker", { kind: "shared", url: "/patterns/socket-worker.js", html: `<div class="here"><h4>Shared worker</h4><p class="small" style="margin:0 0 .3rem">Sockets it has opened: <strong data-opened>0</strong></p><p class="small" style="margin:0 0 .3rem">Open now: <strong data-open>0</strong></p><p class="small" style="margin:0">Tabs on it: <strong data-tabs>none</strong></p></div>` });
      const two = stage.box("tab2", { kind: "iframe" });
      if (!("SharedWorker" in self)) { hub.node.querySelector(".here").insertAdjacentHTML("beforeend", `<p class="small muted">This browser has no SharedWorker.</p>`); return; }
      // This page only watches. It is not one of the tabs.
      const watch = new SharedWorker("/patterns/socket-worker.js").port;
      watch.onmessage = ({ data }) => {
        if (!hub.node.isConnected) return watch.close();
        const { state } = data; if (!state) return;
        hub.node.querySelector("[data-opened]").textContent = state.opened;
        hub.node.querySelector("[data-open]").textContent = state.open ? 1 : 0;
        hub.node.querySelector("[data-tabs]").textContent = state.tabs.join(", ") || "none";
      };
      watch.postMessage({ watch: true });
      await Promise.all([embed(one, "/patterns/tab.html?cable=c1", "A tab of this site"), embed(two, "/patterns/tab.html?cable=c2", "Another tab of this site")]);
      stage.cable("c1", "tab1", "worker", "red");
      stage.cable("c2", "tab2", "worker", "teal");
      const b1 = ui.button("Tab one: say hello", () => stage.post("tab1", { cmd: "say" }), false, true);
      ui.button("Tab two: say hello", () => stage.post("tab2", { cmd: "say" }));
      ui.button("Close tab one", (btn) => { stage.remove("tab1"); btn.disabled = b1.disabled = true; });
      ui.button("Drop the connection", () => watch.postMessage({ drop: true }));
      ui.link("Open a third tab for real", "/patterns/tab.html");
    },
  },
  {
    id: "audio",
    title: "A worker that plays music while this page is frozen",
    blurb: "Sound is made on a thread of its own, and that thread accepts a port. This page starts an audio processor and a worker, gives each one end of a channel, and steps away. The worker writes the tune and sends each note straight to the audio thread, which plays it and says so. Freeze this page for three seconds: the buttons stop working and its counter stops, but the music keeps time because none of it passes through here. The audio thread has no DOM, no timers and no network. A port is the only way to reach it, and anything that holds the other end can.",
    code: `const node = new AudioWorkletNode(audio, "bell");
const { port1, port2 } = new MessageChannel();
composerWorker.postMessage({}, [port1]);
node.port.postMessage({}, [port2]);        <span class="c">// the audio thread now holds a port</span>

<span class="c">// the worker, every beat. The page is not involved.</span>
port.postMessage({ freq: 440 });`,
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page", `<p class="small" style="margin:0 0 .4rem">Main thread ticks: <strong data-ticks>0</strong></p>`);
      const box = stage.box("composer", { kind: "worker", url: "blob:", html: `<canvas style="width:100%;height:100%;display:block" aria-label="The composer worker, painted by the worker itself"></canvas>` });
      stage.box("audio", { kind: "worklet", url: "blob:", html: `<div class="here"><h4>The audio thread</h4><p class="small muted" style="margin:0">No DOM, no timers, no network. It turns numbers into sound 48,000 times a second, and it has one port.</p></div>` });
      const ticks = me.node.querySelector("[data-ticks]");
      let n = 0, audio = null;
      if (!("AudioWorkletNode" in self) || !("OffscreenCanvas" in self)) return me.say("this browser lacks an audio worklet or an offscreen canvas");
      const canvas = box.node.querySelector("canvas");
      const ratio = Math.min(2, devicePixelRatio || 1);
      canvas.width = box.node.clientWidth * ratio; canvas.height = box.node.clientHeight * ratio;
      const worker = new Worker(URL.createObjectURL(new Blob([`(${composer})()`], { type: "text/javascript" })));
      const surface = canvas.transferControlToOffscreen();
      const look = { color: getComputedStyle(document.documentElement).getPropertyValue("--teal").trim(), panel: getComputedStyle(box.node).backgroundColor, ink: getComputedStyle(box.node).color };
      worker.postMessage({ surface, look }, [surface]);
      const stop = () => { worker.postMessage({ stop: true }); audio?.close(); audio = null; };
      const beat = setInterval(() => { if (!ticks.isConnected) { clearInterval(beat); stop(); worker.terminate(); return; } ticks.textContent = ++n; }, 100);
      const count = () => new Promise((resolve) => { worker.onmessage = ({ data }) => resolve(data.played); worker.postMessage({ count: true }); });
      const freeze = ui.button("Freeze this page for 3 seconds", async () => {
        const before = await count();
        const mine = n;
        me.say("frozen");
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
        const until = performance.now() + 3000;
        while (performance.now() < until) { /* the main thread is stuck here */ }
        const after = await count();
        me.say(`3 s frozen: I ticked ${n - mine} times, the audio thread played ${after - before} notes`);
      }, true);
      const quiet = ui.button("Stop the music", (btn) => { stop(); stage.cut("notes"); btn.disabled = freeze.disabled = true; me.say("stopped"); }, true);
      ui.button("Start the music", async (btn) => {
        btn.disabled = true;
        try {
          audio = new AudioContext();
          await audio.audioWorklet.addModule(URL.createObjectURL(new Blob([BELL], { type: "text/javascript" })));
          const node = new AudioWorkletNode(audio, "bell", { outputChannelCount: [2] });
          const volume = audio.createGain(); volume.gain.value = 0.5;
          node.connect(volume).connect(audio.destination);
          const { port1, port2 } = new MessageChannel();
          worker.postMessage({}, [port1]);
          node.port.postMessage({}, [port2]);
          audio.resume();   // may wait for a tap, so it is not awaited
          await new Promise((r) => setTimeout(r, 250));
        } catch (err) { return me.say("could not start: " + err.message); }
        stage.cable("notes", "composer", "audio", "teal");
        me.say(audio.state === "running" ? "introduced the worker to the audio thread, and kept no port" : "the browser is holding the sound until you tap");
        freeze.disabled = quiet.disabled = false;
      }, false, true);
    },
  },
];
