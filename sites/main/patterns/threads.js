// Across threads and frames: workers that talk without the page, video that
// passes through a stranger, and a key that is used but never seen.
// Same stage as demos.js.

const pageBox = (stage, title = "This page", extra = "") => {
  const box = stage.box("page", { html: `<div class="here"><h4>${title}</h4>${extra}<ul class="log"></ul></div>` });
  const ul = box.node.querySelector("ul");
  const say = (text) => { const li = document.createElement("li"); li.textContent = text; ul.prepend(li); while (ul.children.length > 6) ul.lastChild.remove(); };
  return { say, node: box.node };
};

// Runs inside each worker of the "frozen" demo. It draws its own status into
// a canvas that sits in the page, so it can be seen while the page is stuck.
function talker() {
  let ctx = null, port = null, sent = 0, heard = 0, look = {};
  const draw = () => {
    if (!ctx) return;
    const { width: w, height: h } = ctx.canvas;
    const u = h / 11.5;
    ctx.fillStyle = look.panel; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = look.color; ctx.beginPath(); ctx.arc(u * 1.2, u * 1.35, u * 0.42, 0, 7); ctx.fill();
    ctx.fillStyle = look.ink;
    ctx.font = `800 ${u}px system-ui, sans-serif`; ctx.fillText(look.title, u * 1.9, u * 1.7);
    ctx.font = `${u * 0.78}px ui-monospace, Menlo, monospace`;
    ctx.fillText(look.starts ? `sent ${sent}` : `heard ${heard}`, u * 0.8, u * 3.6);
    ctx.fillText(look.starts ? `heard back ${heard}` : `answered ${sent}`, u * 0.8, u * 4.9);
    // A bar that moves with every message, so motion is visible at a glance.
    ctx.fillStyle = look.color; ctx.fillRect(u * 0.8, u * 6.2, ((heard % 20) / 19) * (w - u * 1.6), u * 0.5);
  };
  onmessage = (event) => {
    const data = event.data;
    if (data.surface) { ctx = data.surface.getContext("2d"); look = data.look; draw(); }
    if (data.count) postMessage({ heard });
    if (event.ports[0]) {
      port = event.ports[0];
      port.onmessage = ({ data: n }) => { heard = n; if (!look.starts) port.postMessage(++sent); draw(); };
      if (look.starts) setInterval(() => { port.postMessage(++sent); draw(); }, 100);
    }
  };
}

export const threads = [
  {
    id: "frozen",
    title: "Two workers that keep talking while this page is frozen",
    blurb: "A port given to a worker belongs to that worker's thread. Introduce two workers to each other and their messages never touch the page again. Freeze this page for three seconds: its own counter stops, the buttons go dead, and the two workers carry on. You can watch them do it, because each one paints its numbers into a canvas whose drawing surface it was handed, and a transferred canvas does not wait for the page either.",
    code: `const { port1, port2 } = new MessageChannel();
workerA.postMessage({}, [port1]);
workerB.postMessage({}, [port2]);
<span class="c">// this page is now out of the conversation, and can stall without harm</span>
while (performance.now() < until) {}`,
    async setup(stage, ui) {
      const { say, node } = pageBox(stage, "This page", `<p class="small" style="margin:0 0 .4rem">Main thread ticks: <strong data-ticks>0</strong></p>`);
      const ticks = node.querySelector("[data-ticks]");
      let n = 0;
      const beat = setInterval(() => { if (!ticks.isConnected) return clearInterval(beat); ticks.textContent = ++n; }, 100);
      const css = getComputedStyle(document.documentElement);
      const url = URL.createObjectURL(new Blob([`(${talker})()`], { type: "text/javascript" }));
      const make = (name, title, color, starts) => {
        const box = stage.box(name, { html: `<canvas style="width:100%;height:100%;display:block" aria-label="${title}, painted by the worker itself"></canvas>` });
        const canvas = box.node.querySelector("canvas");
        const ratio = Math.min(2, devicePixelRatio || 1);
        canvas.width = box.node.clientWidth * ratio; canvas.height = box.node.clientHeight * ratio;
        const worker = new Worker(url);
        const surface = canvas.transferControlToOffscreen();
        const look = { title, starts, color, panel: getComputedStyle(box.node).backgroundColor, ink: getComputedStyle(box.node).color };
        worker.postMessage({ surface, look }, [surface]);
        return worker;
      };
      const a = make("a", "Worker A", css.getPropertyValue("--red").trim(), true);
      const b = make("b", "Worker B", css.getPropertyValue("--teal").trim(), false);
      const count = () => new Promise((resolve) => { b.onmessage = ({ data }) => resolve(data.heard); b.postMessage({ count: true }); });
      const freeze = ui.button("Freeze this page for 3 seconds", async () => {
        const before = await count();
        const mine = n;
        say("frozen");
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
        const until = performance.now() + 3000;
        while (performance.now() < until) { /* the main thread is stuck here */ }
        const after = await count();
        say(`3 s frozen: I ticked ${n - mine} times, the workers exchanged ${after - before} messages`);
      }, true);
      ui.button("Introduce the two workers", (btn) => {
        const { port1, port2 } = new MessageChannel();
        a.postMessage({}, [port1]);
        b.postMessage({}, [port2]);
        stage.cable("line", "a", "b", "teal");
        say("introduced them, and kept no port");
        btn.disabled = true; freeze.disabled = false;
      }, false, true);
    },
  },
  {
    id: "filter",
    title: "Run live video through a filter on another origin",
    blurb: "A <code>VideoFrame</code> is transferable, so video can leave your page one frame at a time and come back changed. The filter here lives on another origin in a sandbox. It has no camera, cannot see this page, and holds each frame only until it sends it on. Frames are moved, not copied: after sending, this page's own handle to the frame is empty. A plug-in system for video where the plug-in gets pixels and nothing else.",
    code: `const frame = new VideoFrame(source, { timestamp });
port.postMessage({ frame }, [frame]);          <span class="c">// frame is now closed here</span>

<span class="c">// the filter, on its own origin</span>
port.onmessage = ({ data }) => {
  ctx.filter = "invert(1)"; ctx.drawImage(data.frame, 0, 0); data.frame.close();
  const out = new VideoFrame(canvas, { timestamp: data.frame.timestamp });
  port.postMessage({ frame: out }, [out]);
};`,
    async setup(stage, ui) {
      const src = stage.box("page", { html: `<canvas width="320" height="180" style="width:100%;height:100%;display:block" aria-label="The source video, drawn by this page"></canvas>` });
      await stage.frame("filter", {
        title: "Filter on another origin", color: "yellow",
        script: () => on("port", (_, [port]) => {
          const effects = ["invert(1) hue-rotate(40deg)", "mosaic", "grayscale(1) contrast(2.2)", "blur(3px) saturate(3)"];
          let effect = 0, canvas = null, ctx = null, small = null, done = 0;
          log("waiting for frames");
          port.onmessage = ({ data }) => {
            if (data.next) { effect = (effect + 1) % effects.length; return log("effect: " + effects[effect]); }
            const frame = data.frame;
            if (!canvas) { canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight); ctx = canvas.getContext("2d"); small = new OffscreenCanvas(40, 22); }
            if (effects[effect] === "mosaic") {
              small.getContext("2d").drawImage(frame, 0, 0, small.width, small.height);
              ctx.filter = "none"; ctx.imageSmoothingEnabled = false;
              ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
            } else { ctx.filter = effects[effect]; ctx.drawImage(frame, 0, 0); }
            const timestamp = frame.timestamp;
            frame.close();
            const out = new VideoFrame(canvas, { timestamp });
            send(port, "back", { frame: out }, [out]);
            if (++done % 30 === 0) log(`filtered ${done} frames, kept none`);
          };
        }),
      });
      const out = stage.box("out", { html: `<canvas width="320" height="180" style="width:100%;height:100%;display:block" aria-label="The video after the filter"></canvas><p class="small" data-note style="position:absolute;inset:auto 0 0 0;margin:0;padding:.35rem .6rem;background:var(--panel)">Nothing has come back yet.</p>` });
      const source = src.node.querySelector("canvas"), sctx = source.getContext("2d");
      const octx = out.node.querySelector("canvas").getContext("2d");
      const note = out.node.querySelector("[data-note]");
      const paint = (t) => {
        const { width: w, height: h } = source;
        sctx.fillStyle = "#0f1c3f"; sctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 6; i++) {
          sctx.fillStyle = ["#f5b700", "#e0364c", "#0e9f8e"][i % 3];
          sctx.beginPath(); sctx.arc(w / 2 + Math.cos(t / 600 + i) * w * 0.34, h / 2 + Math.sin(t / 450 + i * 2) * h * 0.3, 14 + i * 4, 0, 7); sctx.fill();
        }
        sctx.fillStyle = "#fff"; sctx.font = "700 20px system-ui"; sctx.fillText((t / 1000).toFixed(1) + " s", 12, 28);
      };
      let alive = true, running = false, waiting = false, shown = 0, closedHere = null;
      const loop = (t) => { if (!source.isConnected) return; paint(t); if (running && alive && !waiting) sendFrame(t); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      const channel = new MessageChannel();
      stage.post("filter", { cmd: "port" }, [channel.port2]);
      stage.cable("there", "page", "filter", "yellow");
      stage.cable("back", "filter", "out", "yellow");
      // One frame in flight at a time: the next leaves when the last comes back.
      const sendFrame = (t) => {
        try {
          const frame = new VideoFrame(source, { timestamp: Math.round(t * 1000) });
          channel.port1.postMessage({ frame }, [frame]);
          closedHere = frame.codedWidth === 0;
          frame.close();   // already empty after the transfer, and harmless to say so
          waiting = true;
          if (shown % 6 === 0) stage.pulse("there", "page");
        } catch (err) { running = false; note.textContent = `This browser cannot do it: ${err.message}`; }
      };
      channel.port1.onmessage = ({ data }) => {
        octx.drawImage(data.frame, 0, 0); data.frame.close();
        waiting = false;
        if (removing) { removing = false; setTimeout(remove); }
        note.textContent = `${++shown} frames back from the filter${closedHere ? ". Each one left this page empty-handed." : "."}`;
      };
      const next = ui.button("Ask for another effect", () => channel.port1.postMessage({ next: true }), true);
      // Stop sending first, and let the frame that is out there come home, so none is lost inside a dead context.
      let removing = false;
      const remove = () => { stage.remove("filter"); note.textContent += " The filter is gone and the video stops with it."; };
      const kill = ui.button("Remove the filter", (btn) => { alive = false; btn.disabled = true; waiting ? (removing = true) : remove(); }, true);
      ui.button("Start the video", (btn) => { running = true; btn.disabled = true; next.disabled = kill.disabled = false; }, false, true);
    },
  },
  {
    id: "signer",
    title: "A key that never leaves, and a port that can use it",
    blurb: "The vault makes a signing key the browser will not let anyone read, itself included. It gives this page a port that signs. This page lends the shop a weaker port: orders only, three uses. The shop gets real signatures that anyone can check against the public key, and at no point does the key, or the full port, move. Authority is handed on by passing ports, and narrowed at each hop by whoever is passing.",
    code: `<span class="c">// the vault</span>
const { privateKey, publicKey } = await crypto.subtle.generateKey(ECDSA, false, ["sign", "verify"]);
port.onmessage = async ({ data }) => port.postMessage({ id: data.id, signature: await sign(privateKey, data.text) });

<span class="c">// this page, lending less than it has</span>
lent.onmessage = ({ data }) => {
  if (uses-- > 0 && data.text.startsWith("order:")) vault.postMessage(data); else refuse(data);
};`,
    async setup(stage, ui) {
      const ECDSA = { name: "ECDSA", namedCurve: "P-256" }, SIGN = { name: "ECDSA", hash: "SHA-256" };
      await stage.frame("vault", {
        title: "Vault, origin one", color: "yellow",
        script: () => on("port", async (_, [port]) => {
          try {
            const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
            let readable = "no";
            try { await crypto.subtle.exportKey("jwk", pair.privateKey); readable = "yes"; } catch {}
            log("made a key. can I read it myself? " + readable);
            const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
            let n = 0;
            port.onmessage = async ({ data }) => {
              const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(data.text));
              log(`signed #${++n}: ${data.text}`);
              send(port, "vault", { id: data.id, signature });
            };
            send(port, "vault", { publicKey: jwk });
          } catch (err) { log("no WebCrypto here: " + err.message); }
        }),
      });
      const { say } = pageBox(stage, "This page holds the signing port");
      await stage.frame("shop", {
        title: "Shop, origin two", color: "teal",
        script: () => {
          let port = null, n = 0;
          on("port", (_, [p]) => {
            port = p; log("lent a signing port");
            port.onmessage = ({ data }) => {
              if (data.refused) return log("refused: " + data.refused);
              log("got a signature, showing it to the page");
              tell("signed", { text: data.text, signature: data.signature });
            };
          });
          on("sign", (data) => {
            if (!port) return log("I have nothing to sign with");
            const text = data.text.replace("#", ++n);
            log("asking to sign: " + text);
            send(port, "lent", { id: n, text });
          });
        },
      });
      const vault = new MessageChannel();
      let publicKey = null, lent = null, uses = 0;
      const texts = new Map();
      vault.port1.onmessage = async ({ data }) => {
        if (data.publicKey) {
          publicKey = await crypto.subtle.importKey("jwk", data.publicKey, ECDSA, true, ["verify"]);
          say("holding a port that signs, and the public key");
          lendBtn.disabled = false;
          return;
        }
        // An answer for the shop: pass it down the weaker port.
        const text = texts.get(data.id); texts.delete(data.id);
        lent?.postMessage({ text, signature: data.signature });
        stage.pulse("lent", "page");
      };
      stage.on(async (name, data) => {
        if (name !== "shop" || data.wire !== "signed") return;
        const ok = await crypto.subtle.verify(SIGN, publicKey, data.signature, new TextEncoder().encode(data.text));
        say(`${ok ? "verified" : "NOT valid"}: "${data.text}" was signed by the vault's key`);
      });
      const lendBtn = ui.button("Lend the shop a weaker port: orders only, 3 uses", (btn) => {
        const channel = new MessageChannel();
        lent = channel.port1; uses = 3;
        lent.onmessage = ({ data }) => {
          const why = !String(data.text).startsWith("order:") ? "this port only signs orders" : uses <= 0 ? "this port is used up" : "";
          if (why) { lent.postMessage({ refused: why }); stage.pulse("lent", "page"); return say(`refused the shop: ${why}`); }
          uses--;
          const id = "s" + Math.random().toString(36).slice(2, 8);
          texts.set(id, data.text);
          vault.port1.postMessage({ id, text: data.text });
          stage.pulse("vault", "page");
          say(`passed an order to the vault, ${uses} use${uses === 1 ? "" : "s"} left`);
        };
        stage.post("shop", { cmd: "port" }, [channel.port2]);
        stage.cable("lent", "page", "shop", "teal");
        btn.disabled = true; orderBtn.disabled = moneyBtn.disabled = backBtn.disabled = false;
      }, true);
      const orderBtn = ui.button("Shop: sign an order", () => stage.post("shop", { cmd: "sign", text: "order: # dozen tulips" }), true);
      const moneyBtn = ui.button("Shop: try to sign a payment", () => stage.post("shop", { cmd: "sign", text: "pay: 5000 to the shop (#)" }), true);
      const backBtn = ui.button("Take the port back", () => { lent?.close(); lent = null; stage.cut("lent"); say("closed the shop's port. The vault never knew the shop existed."); }, true);
      ui.button("Ask the vault for a signing port", (btn) => {
        stage.post("vault", { cmd: "port" }, [vault.port2]);
        stage.cable("vault", "vault", "page", "yellow");
        btn.disabled = true;
      }, false, true);
    },
  },
];
