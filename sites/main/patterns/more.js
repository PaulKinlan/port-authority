// Further out: experiments about what a port can carry and where it can go.
// Same stage as demos.js. Every frame is a sandboxed context on its own origin.

const pageBox = (stage, title = "This page", extra = "") => {
  const box = stage.box("page", { html: `<div class="here"><div class="box-title">${title}</div>${extra}<ul class="log" role="log" aria-live="polite"></ul></div>` });
  const ul = box.node.querySelector("ul");
  const say = (text) => { const li = document.createElement("li"); li.textContent = text; ul.prepend(li); while (ul.children.length > 6) ul.lastChild.remove(); };
  return { say, node: box.node };
};

export const more = [
  {
    id: "canvas",
    title: "Let another origin paint on your page",
    blurb: "The painter is a frame on another origin. It draws on a canvas of its own and sends each finished frame down a port as an <code>ImageBitmap</code>, which is moved and not copied. This page shows each one in a canvas it owns. The painter cannot read or touch anything here. Handing over the canvas's own drawing surface would be shorter, but Chrome crashes a frame in another process that draws on one, so that is kept for workers.",
    code: `<span class="c">// the other origin: draw, then send the finished frame</span>
const mine = new OffscreenCanvas(width, height);
const ctx = mine.getContext("2d");
requestAnimationFrame(async function draw(t) {
  paint(ctx, t);
  const frame = await createImageBitmap(mine);
  port.postMessage({ frame }, [frame]);       <span class="c">// moved</span>
  requestAnimationFrame(draw);
});

<span class="c">// this page: show it</span>
const show = canvas.getContext("bitmaprenderer");
port.onmessage = ({ data }) => show.transferFromImageBitmap(data.frame);`,
    async setup(stage, ui) {
      const box = stage.box("page", { html: `<canvas width="460" height="230" style="width:100%;height:100%;display:block" aria-label="A canvas in this page, painted by another origin"></canvas>` });
      const canvas = box.node.querySelector("canvas");
      await stage.frame("painter", {
        title: "Painter on another origin", color: "red",
        script: () => {
          log("waiting — no channel yet");
          on("port", (_, [port]) => {
            let hue = 350, frames = 0, going = false;
            log("holding a port to the page");
            port.onmessage = ({ data }) => {
              if (data.hue !== undefined) { hue = data.hue; return log("told to use hue " + hue); }
              if (!data.size || going) return;
              going = true;
              const [w, h] = data.size;
              const mine = new OffscreenCanvas(w, h), ctx = mine.getContext("2d");
              log("painting frames for a page I cannot see");
              const draw = async (t) => {
                ctx.fillStyle = "rgba(15,28,63,0.12)"; ctx.fillRect(0, 0, w, h);
                for (let i = 0; i < 5; i++) {
                  const a = t / 700 + i * 1.26;
                  ctx.beginPath();
                  ctx.arc(w / 2 + Math.cos(a) * w * 0.32, h / 2 + Math.sin(a * 1.7) * h * 0.32, 12 + i * 3, 0, 7);
                  ctx.fillStyle = `hsl(${hue + i * 14} 85% 58%)`; ctx.fill();
                }
                const frame = await createImageBitmap(mine);
                port.postMessage({ frame, frames: ++frames }, [frame]);
                requestAnimationFrame(draw);
              };
              requestAnimationFrame(draw);
            };
          });
        },
      });
      let port = null;
      const show = canvas.getContext("bitmaprenderer");
      stage.cleanup(() => port?.close());
      const hueBtn = ui.button("Ask for another colour", () => { port.postMessage({ hue: Math.floor(Math.random() * 360) }); stage.pulse("line", "page"); }, true);
      const paintBtn = ui.button("Ask the painter to paint", (btn) => {
        port.postMessage({ size: [canvas.width, canvas.height] });
        stage.pulse("line", "page");
        btn.disabled = true; hueBtn.disabled = false;
      }, true);
      ui.button("Open a channel to the painter", (btn) => {
        btn.disabled = true;
        const channel = new MessageChannel();
        port = channel.port1;
        port.onmessage = ({ data }) => {
          if (!data.frame) return;
          if (!canvas.isConnected) { data.frame.close(); return port.close(); }
          show.transferFromImageBitmap(data.frame);
          if (data.frames % 45 === 1) stage.pulse("line", "painter");
        };
        stage.post("painter", { cmd: "port" }, [channel.port2]);
        stage.cable("line", "page", "painter", "red", "bitmaps");
        paintBtn.disabled = false;
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
        script: () => {
          let onTick = null, timer = null;
          log("waiting for a function handle");
          on("lend", (_, [port]) => {
            onTick = (...args) => { port.postMessage(args); tell("pulse", { cable: "fn" }); };
            log("I was lent a function");
          });
          on("start", (data) => {
            if (!onTick) return log("no function lent yet");
            clearInterval(timer);
            let n = data.from;
            const step = () => {
              log(`calling onTick(${n})`);
              onTick(n, n === 0 ? "lift off" : "counting");
              if (n-- === 0) clearInterval(timer);
            };
            step();
            timer = setInterval(step, 700);
          });
        },
      });
      let lent = null;
      stage.cleanup(() => lent?.close());
      const startBtn = ui.button("Start the countdown", (btn) => {
        btn.disabled = true;
        stage.post("worker", { cmd: "start", from: 6 });
        say("told the other origin to begin counting down");
      }, true);
      const takeBtn = ui.button("Take the function back", (btn) => {
        lent?.close(); lent = null;
        stage.cut("fn");
        btn.disabled = true;
        say("closed it. Their calls now go nowhere.");
      }, true);
      ui.button("Lend onTick()", (btn) => {
        btn.disabled = true;
        const onTick = (n, word) => say(`onTick(${n}, "${word}") ran here`);
        const { port1, port2 } = new MessageChannel();
        port1.onmessage = (e) => onTick(...e.data);
        lent = port1;
        stage.post("worker", { cmd: "lend" }, [port2]);
        stage.cable("fn", "page", "worker", "teal", "onTick()");
        say("wrapped onTick() in a channel and sent one end");
        startBtn.disabled = takeBtn.disabled = false;
      }, false, true);
    },
  },
  {
    id: "zerocopy",
    noAutoplay: true,
    title: "Move 64 MB between origins without copying it",
    blurb: "Post an <code>ArrayBuffer</code> and it is copied. Put it in the transfer list and the memory itself changes hands: the sender's buffer drops to zero bytes and the cost stops depending on size. Each button sends 64 MB to another origin and back, and times the round trip.",
    code: `port.postMessage(buffer);            <span class="c">// structured clone: a copy each way</span>
port.postMessage(buffer, [buffer]);  <span class="c">// transfer: buffer.byteLength is now 0</span>`,
    async setup(stage, ui) {
      const { say } = pageBox(stage);
      await stage.frame("far", {
        title: "Another origin", color: "yellow",
        script: () => {
          log("waiting — no channel yet");
          on("port", (_, [port]) => {
            log("holding a channel to this page");
            port.onmessage = ({ data }) => {
              log(`received ${data.buffer.byteLength / 2 ** 20} MB, sending it back`);
              send(port, "line", { buffer: data.buffer }, data.transfer ? [data.buffer] : []);
            };
          });
        },
      });
      let port = null;
      stage.cleanup(() => port?.close());
      const run = (transfer) => new Promise((resolve) => {
        const buffer = new ArrayBuffer(64 * 2 ** 20);
        new Uint8Array(buffer).fill(7);
        const start = performance.now();
        port.onmessage = () => {
          const ms = performance.now() - start;
          say(`${transfer ? "transfer" : "copy"}: ${ms.toFixed(1)} ms round trip${transfer ? `, sender held ${held} bytes meanwhile` : ""}`);
          resolve(ms);
        };
        port.postMessage({ buffer, transfer }, transfer ? [buffer] : []);
        const held = buffer.byteLength;
        stage.pulse("line", "page");
      });
      const transferBtn = ui.button("Transfer 64 MB there and back", () => run(true), true);
      const copyBtn = ui.button("Copy 64 MB there and back", () => run(false), true);
      ui.button("Open a channel", (btn) => {
        btn.disabled = true;
        const channel = new MessageChannel();
        port = channel.port1;
        stage.post("far", { cmd: "port" }, [channel.port2]);
        stage.cable("line", "page", "far", "yellow", "channel");
        say("opened a channel to the other origin");
        transferBtn.disabled = copyBtn.disabled = false;
      }, false, true);
    },
  },
  {
    id: "tearoff",
    title: "Tear a live widget off into its own window",
    blurb: "A port works the same in whichever window holds it. The meter here is fed by a service on another origin. Tear it off and the port is posted to a new window, which carries on from the next tick with no reconnect. Put it back and it returns the port.",
    code: `const win = window.open("/meter.html", "", "popup");
<span class="c">// once it says it is ready</span>
win.postMessage({ feed: port }, location.origin, [port]);`,
    async setup(stage, ui) {
      const { say, node } = pageBox(stage, "Meter", `<p class="meter" style="font:800 2.6rem/1 var(--display);margin:.2rem 0 .4rem">0</p>`);
      const meter = node.querySelector(".meter");
      await stage.frame("feed", {
        title: "Feed on another origin", color: "teal",
        script: () => {
          log("waiting — no channel yet");
          on("port", (_, [port]) => {
            let n = 0;
            log("ticking into one port, wherever it is");
            setInterval(() => send(port, "line", ++n), 900);
          });
        },
      });
      let port = null, activeListener = null, closedCheck = null, popup = null;
      const clearPopupWatch = () => {
        if (activeListener) { removeEventListener("message", activeListener); activeListener = null; }
        if (closedCheck) { clearInterval(closedCheck); closedCheck = null; }
      };
      stage.cleanup(() => { clearPopupWatch(); port?.close(); try { popup?.close(); } catch {} });
      const listen = () => { port.onmessage = (e) => { meter.textContent = e.data; }; };
      const tearBtn = ui.button("Tear it off", (btn) => {
        const win = window.open("/patterns/meter.html", "pa_meter", "popup,width=320,height=260");
        if (!win) {
          say("Your browser blocked the popup window. Allow popups for this site and press Tear it off again.");
          return;
        }
        popup = win;
        let handedOff = false;
        clearPopupWatch();
        activeListener = (event) => {
          if (event.source !== win || event.origin !== location.origin) return;
          if (event.data === "ready" && port) {
            handedOff = true;
            port.onmessage = null;
            win.postMessage({ feed: port }, location.origin, [port]);
            port = null;
            meter.textContent = "away";
            say("the port left for the other window");
            stage.cut("line");
            btn.disabled = true;
          } else if (event.data?.back) {
            clearPopupWatch();
            port = event.ports[0];
            listen();
            say("the port came back");
            stage.cable("line", "page", "feed", "teal", "feed");
            btn.disabled = false;
            popup = null;
          }
        };
        addEventListener("message", activeListener);
        closedCheck = setInterval(() => {
          if (!win.closed) return;
          clearPopupWatch();
          popup = null;
          if (handedOff && !port) {
            meter.textContent = "closed";
            say("the popup closed without returning the port. Press Start again to reconnect.");
          }
        }, 400);
      }, true);
      ui.button("Connect to the feed", (btn) => {
        btn.disabled = true;
        const channel = new MessageChannel();
        port = channel.port1;
        listen();
        stage.post("feed", { cmd: "port" }, [channel.port2]);
        stage.cable("line", "page", "feed", "teal", "feed");
        say("connected to the feed — ticks are arriving");
        tearBtn.disabled = false;
      }, false, true);
    },
  },
  {
    id: "tabserver",
    title: "Serve pages to other tabs from this tab",
    blurb: "A Service Worker can answer a fetch any way it likes, including by asking someone else. This page hands the worker a port. Every request under <code>/patterns/served/</code> is sent up that port, and whatever you type on the left is the response. The page on the right is a real navigation to a real URL, and so is the new tab.",
    code: `<span class="c">// Service Worker</span>
onfetch = (event) => event.respondWith(new Promise((resolve) => {
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = (e) => resolve(new Response(e.data.body, { headers: e.data.headers }));
  tabPort.postMessage({ url: event.request.url }, [port2]);
}));`,
    async setup(stage, ui) {
      const box = stage.box("page", { html: `<div class="here" style="height:100%;display:grid;grid-template-rows:auto 1fr"><div class="box-title">This tab is the server</div><textarea aria-label="HTML to serve" style="font:12px/1.4 var(--mono);resize:none;border-width:1px;padding:.4rem">&lt;h1&gt;Hello from another tab&lt;/h1&gt;\n&lt;p&gt;Edit me, then reload.&lt;/p&gt;</textarea></div>` });
      const source = box.node.querySelector("textarea");
      const swBox = stage.box("sw", { kind: "service", url: "/patterns/tabserver-sw.js", scope: "/patterns/served/", html: `<div class="here"><div class="box-title">Service Worker</div><ul class="log" role="log" aria-live="polite"><li>not connected yet</li></ul></div>` });
      const swLog = (text) => { const ul = swBox.node.querySelector("ul"); const li = document.createElement("li"); li.textContent = text; ul.prepend(li); while (ul.children.length > 5) ul.lastChild.remove(); };
      const served = stage.box("served", { kind: "iframe", html: `<div class="here"><div class="box-title">/patterns/served/</div><p class="small muted">Nothing loaded yet.</p></div>` });
      if (!("serviceWorker" in navigator)) {
        swLog("no Service Worker support here");
        ui.unsupported("This browser does not support Service Workers.");
        return;
      }

      let hits = 0, registration = null, onSwMessage = null;
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
      stage.cleanup(() => { if (onSwMessage) navigator.serviceWorker.removeEventListener("message", onSwMessage); });

      const loadBtn = ui.button("Load the served page", () => {
        served.node.innerHTML = `<iframe title="A page served by this tab" src="/patterns/served/index.html?${Date.now()}"></iframe>`;
        stage.cable("down", "served", "sw", "teal", "fetch");
        setTimeout(() => stage.pulse("down", "sw"), 220);
      }, true);
      ui.button("Connect this tab to the Service Worker", async (btn) => {
        btn.disabled = true;
        try {
          registration = await navigator.serviceWorker.register("/patterns/tabserver-sw.js", { scope: "/patterns/served/" });
          const worker = registration.active || registration.waiting || registration.installing;
          if (worker.state !== "activated") await new Promise((resolve) => worker.addEventListener("statechange", () => worker.state === "activated" && resolve()));
          offer(registration.active);
          onSwMessage = (event) => { if (event.data === "need-port" && registration.active && swBox.node.isConnected) offer(registration.active); };
          navigator.serviceWorker.addEventListener("message", onSwMessage);
          swLog("holding a port to this tab");
          stage.cable("up", "page", "sw", "yellow", "serve port");
          loadBtn.disabled = false;
        } catch (err) {
          swLog("could not start Service Worker: " + err.message);
          btn.disabled = false;
        }
      }, false, true);
      ui.link("Open the served page in a new tab", "/patterns/served/anything-you-like");
    },
  },
];

// ---------------------------------------------------------------- streams

more.push(
  {
    id: "stream-intro",
    title: "A forwarded stream stops when the page that passed it on closes. A port keeps working.",
    blurb: "You can pass a stream on, the same as a port. But a stream that was passed on keeps flowing through every context that touched it. Send one through the introducer, remove the introducer, and the reader stalls with no error and no end. So introduce with a port first, then send the stream down the direct line. Start again between the two to compare. The three boxes are frames in this page, and this page gave the source and the reader each a line to the introducer.",
    code: `<span class="c">// fragile: the middle is now part of the pipe for ever</span>
toMiddle.postMessage({ stream }, [stream]);

<span class="c">// sturdy: the middle only introduces</span>
const direct = await introducedPort();
direct.postMessage({ stream }, [stream]);`,
    async setup(stage, ui) {
      const source = () => {
        let viaIntro = null, direct = null;
        const make = () => { let n = 0; return new ReadableStream({ async pull(c) { await new Promise((r) => setTimeout(r, 600)); c.enqueue(++n); log("wrote " + n); } }, { highWaterMark: 0 }); };
        log("waiting — no lines yet");
        on("port", (_, [port]) => {
          viaIntro = port;
          log("connected to the introducer");
          port.onmessage = (e) => {
            direct = e.ports[0];
            log("received direct port to the reader");
            tell("met");
          };
        });
        on("stream-direct", () => {
          if (!direct) return log("no direct port yet");
          const s = make();
          try { send(direct, "direct", { stream: s }, [s]); log("sent a stream down the direct line"); }
          catch { log("This browser cannot transfer streams yet."); }
        });
        on("relay", () => {
          if (!viaIntro) return log("not connected to the introducer yet");
          const s = make();
          try { send(viaIntro, "i-left", { stream: s }, [s]); log("sent a stream to the introducer"); }
          catch { log("This browser cannot transfer streams yet."); }
        });
      };
      const reader = () => {
        const read = async (stream, how) => { log("reading a stream that came " + how); const r = stream.getReader(); for (;;) { const { value, done } = await r.read(); if (done) return log("ended"); log("read " + value); tell("read", { n: value }); } };
        log("waiting — no lines yet");
        on("port", (_, [port]) => {
          log("connected to the introducer");
          port.onmessage = (e) => {
            if (e.data.stream) read(e.data.stream, "through the introducer");
            else if (e.ports[0]) {
              log("received direct port from the introducer");
              tell("met");
              e.ports[0].onmessage = (m) => read(m.data.stream, "down the direct line");
            }
          };
        });
      };
      await Promise.all([
        stage.frame("left", { title: "Source", color: "red", script: source }),
        stage.frame("intro", {
          title: "Introducer", color: "yellow",
          script: () => {
            const lines = {};
            log("waiting for Source and Reader");
            on("port", (data, [port]) => {
              lines[data.side] = port;
              log(`connected to ${data.side === "left" ? "Source" : "Reader"}`);
              if (data.side === "left") port.onmessage = (e) => {
                log("passing the stream on");
                try { send(lines.right, "i-right", e.data, [e.data.stream]); }
                catch { log("This browser cannot transfer streams yet."); }
              };
            });
            on("introduce", () => {
              const { port1, port2 } = new MessageChannel();
              send(lines.left, "i-left", {}, [port1]);
              send(lines.right, "i-right", {}, [port2]);
              log("introduced them with a direct port");
            });
          },
        }),
        stage.frame("right", { title: "Reader", color: "teal", script: reader }),
      ]);
      let met = 0;
      const relayBtn = ui.button("Stream through the introducer", (btn) => {
        stage.post("left", { cmd: "relay" });
        btn.disabled = introDirectBtn.disabled = true;
        removeBtn.disabled = false;
      }, true);
      const removeBtn = ui.button("Remove the introducer", (btn) => { stage.remove("intro"); btn.disabled = true; }, true);
      const introDirectBtn = ui.button("Introduce them with a port", (btn) => {
        stage.post("intro", { cmd: "introduce" });
        btn.disabled = relayBtn.disabled = true;
      }, true);
      const streamDirectBtn = ui.button("Stream down the direct port", (btn) => {
        stage.post("left", { cmd: "stream-direct" });
        btn.disabled = true;
        removeBtn.disabled = false;
      }, true);
      stage.on((name, data) => {
        if (data.wire === "met" && ++met === 2) {
          stage.cable("direct", "left", "right", "teal", "direct");
          streamDirectBtn.disabled = false;
        }
      });
      ui.button("Connect Source and Reader to the introducer", (btn) => {
        btn.disabled = true;
        for (const name of ["left", "right"]) {
          const channel = new MessageChannel();
          stage.post(name, { cmd: "port" }, [channel.port1]);
          stage.post("intro", { cmd: "port", side: name }, [channel.port2]);
          stage.cable("i-" + name, name, "intro", "ink");
        }
        relayBtn.disabled = introDirectBtn.disabled = false;
      }, false, true);
    },
  },
  {
    id: "pipeline",
    title: "Back-pressure across three origins",
    blurb: "This page hands its stream to a frame on another origin. That frame transforms it and hands the result to a frame on a third origin, down a port it holds to that frame. Nothing is buffered without limit: pause the reader and, a few chunks later, the source stops being asked for more.",
    code: `<span class="c">// the transformer, on its own origin</span>
port.onmessage = ({ data }) => {
  const out = data.readable.pipeThrough(new TransformStream({ transform: shout }));
  toReader.postMessage({ readable: out }, [out]);   <span class="c">// a port to the third origin</span>
};`,
    async setup(stage, ui) {
      const box = stage.box("page", { html: `<div class="here"><div class="box-title">This page, the source</div><ul class="log" role="log" aria-live="polite"><li>idle — not connected yet</li></ul></div>` });
      const say = (text) => { box.node.querySelector("ul").innerHTML = `<li>${text}</li>`; };
      await Promise.all([
        stage.frame("shout", {
          title: "Transformer, origin two", color: "yellow",
          // Given two ports: one from this page, and one that leads directly to the reader.
          script: () => {
            log("waiting — not connected yet");
            on("port", (_, [port, next]) => {
              log("connected to the source and the reader");
              port.onmessage = ({ data }) => {
                let n = 0;
                const out = data.readable.pipeThrough(new TransformStream({ transform(chunk, c) { log(`shouted ${++n}`); c.enqueue(String(chunk).toUpperCase() + "!"); } }));
                try { send(next, "b", { readable: out }, [out]); }
                catch { log("This browser cannot transfer streams yet."); }
              };
            });
          },
        }),
        stage.frame("sink", {
          title: "Reader, origin three", color: "teal",
          script: () => {
            let paused = false, wake = null;
            log("waiting — not connected yet");
            on("pause", (data) => { paused = data.paused; log(paused ? "paused" : "reading again"); if (!paused) wake?.(); });
            on("port", (_, [port]) => {
              log("connected to the pipeline");
              port.onmessage = async ({ data }) => {
                const reader = data.readable.getReader();
                for (;;) {
                  if (paused) await new Promise((r) => (wake = r));
                  const { value, done } = await reader.read();
                  if (done) break;
                  log("read " + value);
                  await new Promise((r) => setTimeout(r, 350));
                }
              };
            });
          },
        }),
      ]);
      let toShout = null, paused = false;
      stage.cleanup(() => { toShout?.port1.close(); });
      const pauseBtn = ui.button("Pause the reader", (btn) => { paused = !paused; stage.post("sink", { cmd: "pause", paused }); btn.textContent = paused ? "Let the reader continue" : "Pause the reader"; }, true);
      const startBtn = ui.button("Start the pipe", (btn) => {
        let made = 0;
        const readable = new ReadableStream({ pull(c) { c.enqueue(`chunk ${++made}`); say(`asked for ${made} chunk${made === 1 ? "" : "s"} so far`); stage.pulse("a", "page"); } }, { highWaterMark: 0 });
        try {
          toShout.port1.postMessage({ readable }, [readable]);
          btn.disabled = true; pauseBtn.disabled = false;
        } catch {
          say("This browser cannot transfer streams yet.");
        }
      }, true);
      ui.button("Connect the three origins", (btn) => {
        btn.disabled = true;
        // Two channels. This page keeps one end of the first. Both ends of the
        // second are given away, so the transformed stream goes from the
        // transformer to the reader without passing through this page.
        toShout = new MessageChannel();
        const between = new MessageChannel();
        stage.post("shout", { cmd: "port" }, [toShout.port2, between.port1]);
        stage.post("sink", { cmd: "port" }, [between.port2]);
        stage.cable("a", "page", "shout", "yellow");
        stage.cable("b", "shout", "sink", "teal");
        say("connected to Transformer, and Transformer directly to Reader");
        startBtn.disabled = false;
      }, false, true);
    },
  },
  {
    id: "reload",
    title: "Keep a port across a page reload",
    blurb: "A port cannot be saved. IndexedDB, sessionStorage and history state all refuse it, because a port can be moved but never copied. But you can leave it with a SharedWorker. As this frame unloads it posts its port to the worker, and when it loads again it asks for it back. The worker is created with <code>extendedLifetime</code>, so it outlives the page even when that page was its only client. The feed doesn't notice. Ticks sent during the reload waited in the port, and the count has no gaps. The dark cable is the frame's own connection to the worker. The other one is the port that is kept, which this page made and gave to the feed and the frame.",
    code: `const bank = new SharedWorker("/bank.js", { extendedLifetime: true });
addEventListener("pagehide", () => bank.port.postMessage({ deposit: key }, [port]));

<span class="c">// next load</span>
bank.port.postMessage({ withdraw: key });
bank.port.onmessage = ({ ports }) => resume(ports[0]);`,
    async setup(stage, ui) {
      const key = "k" + Math.random().toString(36).slice(2, 8);
      await stage.frame("feed", {
        title: "Feed on another origin", color: "teal",
        script: () => {
          log("waiting — no channel yet");
          on("port", (_, [port]) => { let n = 0; log("ticking into one port"); setInterval(() => send(port, "line", ++n), 400); });
        },
      });
      const bankBox = stage.box("bank", { kind: "shared", url: "/patterns/bank.js", html: `<div class="here"><div class="box-title">Port bank, a SharedWorker</div><ul class="log" role="log" aria-live="polite"><li>empty</li></ul></div>` });
      const keeper = stage.box("keeper", { src: `/patterns/keeper.html?key=${key}&manual=1`, title: "A page that reloads" });
      if (!("SharedWorker" in self)) {
        bankBox.node.querySelector("ul").innerHTML = `<li>This browser does not support SharedWorker.</li>`;
        ui.unsupported("This browser does not support SharedWorker, so the port bank cannot run here.");
        return;
      }
      await keeper.whenReady;
      // The frame's own connection to the shared worker, which it makes again on every load.
      stage.cable("bank", "keeper", "bank", "ink");
      let refusal = "", reloads = 0;
      const note = (text) => { bankBox.node.querySelector("ul").innerHTML = `<li>${text}</li>${refusal}`; };
      const connectFeed = () => {
        const channel = new MessageChannel();
        stage.post("feed", { cmd: "port" }, [channel.port1]);
        keeper.frame.contentWindow.postMessage({ cmd: "port" }, location.origin, [channel.port2]);
        stage.cable("line", "feed", "keeper", "teal", "feed");
      };
      stage.on((name, data) => {
        if (name !== "keeper") return;
        if (data.wire === "need-port") {
          connectFeed();
          if (reloads) refusal = "<li>The bank did not survive the reload. This browser may not support extendedLifetime.</li>";
        }
        if (data.wire === "withdrew") {
          stage.pulse("bank", "bank");
          setTimeout(() => stage.cut("bank"), 900);
        }
        if (data.wire === "tick") note(`${reloads} reload${reloads === 1 ? "" : "s"}, at ${data.n}, ${data.gaps} gap${data.gaps === 1 ? "" : "s"} in the count`);
      });
      const reloadBtn = ui.button("Reload the frame", () => {
        reloads++;
        stage.cable("bank", "keeper", "bank", "yellow", "banked");
        stage.pulse("bank", "keeper");
        note("holding the port while the page is gone");
        keeper.frame.contentWindow.location.reload();
      }, true);
      ui.button("Try to store a port in IndexedDB", () => {
        try {
          const open = indexedDB.open("pa-refusal", 1);
          open.onupgradeneeded = () => open.result.createObjectStore("s");
          open.onerror = () => { refusal = `<li>IndexedDB could not open here.</li>`; note("asked IndexedDB"); };
          open.onsuccess = () => {
            try { open.result.transaction("s", "readwrite").objectStore("s").put(new MessageChannel().port1, "k"); note("stored, which is a surprise"); }
            catch (err) { refusal = `<li>IndexedDB refused the port: ${err.name}</li>`; note("asked IndexedDB"); }
          };
        } catch (err) {
          refusal = `<li>IndexedDB unavailable: ${err.name}</li>`;
          note("asked IndexedDB");
        }
      });
      ui.button("Connect the feed to the frame", (btn) => {
        btn.disabled = true;
        connectFeed();
        note("connected feed directly to the frame");
        reloadBtn.disabled = false;
      }, false, true);
    },
  },
);
