// Further out: experiments about what a port can carry and where it can go.
// Same stage as demos.js. Every frame is a sandboxed context on its own origin.

const pageBox = (stage, title = "This page", extra = "") => {
  const box = stage.box("page", { html: `<div class="here"><h4>${title}</h4>${extra}<ul class="log"></ul></div>` });
  const ul = box.node.querySelector("ul");
  const say = (text) => { const li = document.createElement("li"); li.textContent = text; ul.prepend(li); while (ul.children.length > 6) ul.lastChild.remove(); };
  return { say, node: box.node };
};

export const more = [
  {
    id: "canvas",
    title: "Let another origin paint on your page",
    blurb: "An <code>OffscreenCanvas</code> is transferable. The canvas on the left is in this page's DOM. Hand its drawing surface down a port and a site on another origin paints into it, frame by frame, without being able to read or touch anything else here. An embed with no iframe around the pixels.",
    code: `const surface = canvas.transferControlToOffscreen();
port.postMessage({ surface }, [surface]);

<span class="c">// the other origin</span>
port.onmessage = ({ data }) => {
  const ctx = data.surface.getContext("2d");
  requestAnimationFrame(function draw(t) { paint(ctx, t); requestAnimationFrame(draw); });
};`,
    async setup(stage, ui) {
      const box = stage.box("page", { html: `<canvas width="460" height="230" style="width:100%;height:100%;display:block" aria-label="A canvas in this page, painted by another origin"></canvas>` });
      const canvas = box.node.querySelector("canvas");
      await stage.frame("painter", {
        title: "Painter on another origin", color: "red",
        script: () => on("port", (_, [port]) => {
          let hue = 350, ctx = null, frames = 0;
          port.onmessage = ({ data }) => {
            if (data.hue !== undefined) { hue = data.hue; return log("told to use hue " + hue); }
            ctx = data.surface.getContext("2d");
            log("holding a canvas I cannot see the page of");
            const draw = (t) => {
              const { width: w, height: h } = ctx.canvas;
              ctx.fillStyle = "rgba(15,28,63,0.12)"; ctx.fillRect(0, 0, w, h);
              for (let i = 0; i < 5; i++) {
                const a = t / 700 + i * 1.26;
                ctx.beginPath();
                ctx.arc(w / 2 + Math.cos(a) * w * 0.32, h / 2 + Math.sin(a * 1.7) * h * 0.32, 12 + i * 3, 0, 7);
                ctx.fillStyle = `hsl(${hue + i * 14} 85% 58%)`; ctx.fill();
              }
              if (++frames % 60 === 0) port.postMessage({ frames });
              requestAnimationFrame(draw);
            };
            requestAnimationFrame(draw);
          };
        }),
      });
      const channel = new MessageChannel();
      stage.post("painter", { cmd: "port" }, [channel.port2]);
      stage.cable("line", "page", "painter", "red");
      const hueBtn = ui.button("Ask for another colour", () => { channel.port1.postMessage({ hue: Math.floor(Math.random() * 360) }); stage.pulse("line", "page"); }, true);
      channel.port1.onmessage = () => stage.pulse("line", "painter");
      ui.button("Hand over the canvas", (btn) => {
        try {
          const surface = canvas.transferControlToOffscreen();
          channel.port1.postMessage({ surface }, [surface]);
          stage.pulse("line", "page");
          btn.disabled = true; hueBtn.disabled = false;
        } catch (err) { box.node.insertAdjacentHTML("beforeend", `<p class="small" style="position:absolute;inset:auto 0 0 0;padding:.5rem">This browser cannot do it: ${err.message}</p>`); }
      }, false, true);
    },
  },
  {
    id: "functions",
    title: "Pass a function to another origin",
    blurb: "A function cannot be cloned, but a port can stand in for one. Wrap the function in a channel, send the other end, and the receiver gets something it can call. Arguments can be functions too, the same way. Close the port and the function stops existing for them. This is how Comlink works underneath.",
    code: `const lend = (fn) => {
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = (e) => fn(...e.data);
  return port2;                              <span class="c">// send this</span>
};
const borrow = (port) => (...args) => port.postMessage(args);`,
    async setup(stage, ui) {
      const { say } = pageBox(stage, "This page owns onTick()");
      await stage.frame("worker", {
        title: "Countdown on another origin", color: "teal",
        script: () => on("count", (data, [port]) => {
          const onTick = (...args) => { port.postMessage(args); tell("pulse", { cable: "fn" }); };
          log("I was lent a function");
          let n = data.from;
          const timer = setInterval(() => { log(`calling onTick(${n})`); onTick(n, n === 0 ? "lift off" : "counting"); if (n-- === 0) clearInterval(timer); }, 700);
        }),
      });
      let lent = null;
      ui.button("Take the function back", () => { lent?.close(); stage.cut("fn"); say("closed it. Their calls now go nowhere."); });
      ui.button("Lend onTick and start a countdown", () => {
        const onTick = (n, word) => say(`onTick(${n}, "${word}") ran here`);
        const { port1, port2 } = new MessageChannel();
        port1.onmessage = (e) => onTick(...e.data);
        lent = port1;
        stage.post("worker", { cmd: "count", from: 6 }, [port2]);
        stage.cable("fn", "page", "worker", "teal");
      }, false, true);
    },
  },
  {
    id: "zerocopy",
    title: "Move 64 MB between origins without copying it",
    blurb: "Post an <code>ArrayBuffer</code> and it is copied. Put it in the transfer list and the memory itself changes hands: the sender's buffer drops to zero bytes and the cost stops depending on size. Each button sends 64 MB to another origin and back, and times the round trip.",
    code: `port.postMessage(buffer);            <span class="c">// structured clone: a copy each way</span>
port.postMessage(buffer, [buffer]);  <span class="c">// transfer: buffer.byteLength is now 0</span>`,
    async setup(stage, ui) {
      const { say } = pageBox(stage);
      await stage.frame("far", {
        title: "Another origin", color: "yellow",
        script: () => on("port", (_, [port]) => {
          port.onmessage = ({ data }) => {
            log(`received ${data.buffer.byteLength / 2 ** 20} MB, sending it back`);
            send(port, "line", { buffer: data.buffer }, data.transfer ? [data.buffer] : []);
          };
        }),
      });
      const channel = new MessageChannel();
      stage.post("far", { cmd: "port" }, [channel.port2]);
      stage.cable("line", "page", "far", "yellow");
      const run = (transfer) => new Promise((resolve) => {
        const buffer = new ArrayBuffer(64 * 2 ** 20);
        new Uint8Array(buffer).fill(7);
        const start = performance.now();
        channel.port1.onmessage = ({ data }) => {
          const ms = performance.now() - start;
          say(`${transfer ? "transfer" : "copy"}: ${ms.toFixed(1)} ms round trip${transfer ? `, sender held ${held} bytes meanwhile` : ""}`);
          resolve(ms);
        };
        channel.port1.postMessage({ buffer, transfer }, transfer ? [buffer] : []);
        const held = buffer.byteLength;
        stage.pulse("line", "page");
      });
      ui.button("Copy 64 MB there and back", () => run(false));
      ui.button("Transfer 64 MB there and back", () => run(true), false, true);
    },
  },
  {
    id: "tearoff",
    title: "Tear a live widget off into its own window",
    blurb: "A port does not care which window holds it. The meter here is fed by a service on another origin. Tear it off and the port is posted to a new window, which carries on from the next tick with no reconnect, because there was never a connection to this page as such. Put it back and it returns the port.",
    code: `const win = window.open("/meter.html", "", "popup");
<span class="c">// once it says it is ready</span>
win.postMessage({ feed: port }, location.origin, [port]);`,
    async setup(stage, ui) {
      const { say, node } = pageBox(stage, "Meter", `<p class="meter" style="font:800 2.6rem/1 var(--display);margin:.2rem 0 .4rem">0</p>`);
      const meter = node.querySelector(".meter");
      await stage.frame("feed", {
        title: "Feed on another origin", color: "teal",
        script: () => on("port", (_, [port]) => {
          let n = 0;
          log("ticking into one port, wherever it is");
          setInterval(() => send(port, "line", ++n), 900);
        }),
      });
      const channel = new MessageChannel();
      let port = channel.port1;
      const listen = () => { port.onmessage = (e) => { meter.textContent = e.data; }; };
      listen();
      stage.post("feed", { cmd: "port" }, [channel.port2]);
      stage.cable("line", "page", "feed", "teal");
      ui.button("Tear it off", (btn) => {
        const win = window.open("/patterns/meter.html", "pa_meter", "popup,width=320,height=260");
        if (!win) return say("the window was blocked");
        const onMessage = (event) => {
          if (event.source !== win || event.origin !== location.origin) return;
          if (event.data === "ready") {
            port.onmessage = null;
            win.postMessage({ feed: port }, location.origin, [port]);
            meter.textContent = "away"; say("the port left for the other window"); stage.cut("line"); btn.disabled = true;
          } else if (event.data?.back) {
            port = event.ports[0]; listen();
            say("the port came back"); stage.cable("line", "page", "feed", "teal"); btn.disabled = false;
            removeEventListener("message", onMessage);
          }
        };
        addEventListener("message", onMessage);
      }, false, true);
    },
  },
  {
    id: "tabserver",
    title: "A tab that is a web server for other tabs",
    blurb: "A Service Worker can answer a fetch any way it likes, including by asking someone else. This page hands the worker a port. Every request under <code>/patterns/served/</code> is sent up that port, and whatever you type on the left is the response. The page on the right is a real navigation to a real URL, and so is the new tab.",
    code: `<span class="c">// service worker</span>
onfetch = (event) => event.respondWith(new Promise((resolve) => {
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = (e) => resolve(new Response(e.data.body, { headers: e.data.headers }));
  tabPort.postMessage({ url: event.request.url }, [port2]);
}));`,
    async setup(stage, ui) {
      const box = stage.box("page", { html: `<div class="here" style="height:100%;display:grid;grid-template-rows:auto 1fr"><h4>This tab is the server</h4><textarea aria-label="HTML to serve" style="font:12px/1.4 var(--mono);resize:none;border-width:1px;padding:.4rem">&lt;h1&gt;Hello from another tab&lt;/h1&gt;\n&lt;p&gt;Edit me, then reload.&lt;/p&gt;</textarea></div>` });
      const source = box.node.querySelector("textarea");
      const swBox = stage.box("sw", { html: `<div class="here"><h4>Service Worker</h4><ul class="log"><li>not registered</li></ul></div>` });
      const swLog = (text) => { const ul = swBox.node.querySelector("ul"); const li = document.createElement("li"); li.textContent = text; ul.prepend(li); while (ul.children.length > 5) ul.lastChild.remove(); };
      const served = stage.box("served", { html: `<div class="here"><h4>/patterns/served/</h4><p class="small muted">Nothing loaded yet.</p></div>` });
      if (!("serviceWorker" in navigator)) return swLog("no Service Worker support here");

      let hits = 0;
      const offer = (worker) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => {
          // One request. The reply port came with it.
          const path = new URL(event.data.url).pathname;
          swLog(`asked this tab for ${path.replace("/patterns/served", "") || "/"}`);
          stage.pulse("up", "sw");
          event.ports[0].postMessage({
            body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{font:15px system-ui;margin:.8rem;color-scheme:light dark}h1{font-size:1.2rem}</style>${source.value}<p><small>Response ${++hits}, written by another tab for ${path}</small></p>`,
            headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
          });
        };
        worker.postMessage({ serve: true }, [channel.port2]);
      };
      const registration = await navigator.serviceWorker.register("/patterns/tabserver-sw.js", { scope: "/patterns/served/" });
      const worker = registration.active || registration.waiting || registration.installing;
      if (worker.state !== "activated") await new Promise((resolve) => worker.addEventListener("statechange", () => worker.state === "activated" && resolve()));
      offer(registration.active);
      // Service Workers are stopped when idle and forget the port. When one
      // wakes with no port it asks for a new one.
      navigator.serviceWorker.addEventListener("message", (event) => { if (event.data === "need-port" && registration.active) offer(registration.active); });
      swLog("holding a port to this tab");
      stage.cable("up", "page", "sw", "yellow");
      ui.link("Open the served page in a new tab", "/patterns/served/anything-you-like");
      ui.button("Load the served page", () => {
        served.node.innerHTML = `<iframe title="A page served by this tab" src="/patterns/served/index.html?${Date.now()}"></iframe>`;
        stage.cable("down", "sw", "served", "teal");
        setTimeout(() => stage.pulse("down", "sw"), 300);
      }, false, true);
    },
  },
];
