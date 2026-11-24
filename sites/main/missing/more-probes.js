// More checks for /missing/: things that cannot be sent at all, and
// primitives that are not there. Each returns { gap, text } like the others.

const { sites } = await import("/_sites.js");
const OTHER = sites.florist;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024;

// Try to send one value inside this page, moved if `move`, and say what happened.
const attempt = async (what, make, { move = false, lossy } = {}) => {
  let value;
  try { value = await make(); } catch (err) { return { gap: null, text: `This browser could not make ${what} to try (${err.name}).` }; }
  try {
    const back = structuredClone(value, move ? { transfer: [value] } : undefined);
    const lost = lossy && lossy(back);
    return lost ? { gap: true, text: `${what[0].toUpperCase() + what.slice(1)} was ${move ? "moved" : "copied"}, and ${lost}.` } : { gap: false, text: `${what[0].toUpperCase() + what.slice(1)} can be ${move ? "moved" : "copied"} here.` };
  } catch (err) { return { gap: true, text: `Trying to ${move ? "move" : "copy"} ${what} threw ${err.name}.` }; }
};

export const MORE = {
  "file-writer": () => attempt("the writer for one file", async () => (await (await navigator.storage.getDirectory()).getFileHandle("missing.txt", { create: true })).createWritable(), { move: true }),
  "request-copy": () => attempt("a Request", () => new Request("https://example.com/", { method: "POST", body: "x" })),
  "response-copy": () => attempt("a Response", () => new Response("x")),
  "headers-copy": () => attempt("a Headers object", () => new Headers({ a: "b" })),
  "compression-move": () => attempt("a CompressionStream", () => new CompressionStream("gzip"), { move: true }),
  "canvas-drawn": () => attempt("a canvas that has been drawn on", () => { const c = new OffscreenCanvas(2, 2); c.getContext("2d").fillRect(0, 0, 1, 1); return c; }, { move: true }),
  "audiobuffer-copy": () => attempt("an AudioBuffer", () => new AudioBuffer({ length: 8, sampleRate: 48000 })),
  "websocket-move": () => attempt("a WebSocket", () => new Promise((resolve, reject) => { const w = new WebSocket(location.origin.replace(/^http/, "ws") + "/echo"); w.onopen = () => { setTimeout(() => w.close(), 500); resolve(w); }; w.onerror = () => reject(Object.assign(new Error("no socket"), { name: "no socket" })); }), { move: true }),
  "gpu-move": () => attempt("a GPUBuffer", async () => { const a = await navigator.gpu.requestAdapter(); if (!a) throw Object.assign(new Error(), { name: "no graphics adapter" }); return (await a.requestDevice()).createBuffer({ size: 8, usage: GPUBufferUsage.COPY_SRC }); }, { move: true }),
  "key-move": () => attempt("a CryptoKey", () => crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt"]), { move: true }),
  "class-copy": () => attempt("an instance of a class", () => new (class Money { constructor() { this.pence = 5; } total() { return this.pence; } })(), { lossy: (v) => typeof v.total !== "function" && "it arrived as a plain object with no class and no methods" }),
  "error-copy": () => attempt("an error with an extra field", () => Object.assign(new RangeError("x"), { code: 7 }), { lossy: (v) => v.code !== 7 && "the extra field was dropped" }),

  // A worker whose script is on another origin.
  async "worker-other-origin"() {
    const url = OTHER + "/lab/receiver-worker.js";
    try {
      const w = new Worker(url);
      const failed = await Promise.race([new Promise((r) => { w.onerror = () => r(true); }), wait(1500).then(() => false)]);
      w.terminate();
      return failed ? { gap: true, text: `new Worker("${url}") made a worker that failed to start, with an error event that gives no reason.` } : { gap: false, text: `new Worker("${url}") started.` };
    } catch (err) { return { gap: true, text: `new Worker("${url}") threw ${err.name}.` }; }
  },

  // Post a lot into a port whose receiver is busy, and look for any sign of the queue.
  async backpressure() {
    // Yield briefly so initial paint and lightweight probes run first without hitching the main thread.
    await wait(60);
    const url = URL.createObjectURL(new Blob([`onmessage = (e) => { const port = e.ports[0]; let n = 0; port.onmessage = () => { n++; }; const until = Date.now() + 600; while (Date.now() < until); postMessage("free"); };`], { type: "text/javascript" }));
    const w = new Worker(url);
    const { port1, port2 } = new MessageChannel();
    w.postMessage(null, [port2]);
    await wait(50);
    const chunk = new Uint8Array(64 * 1024), count = 800;
    const started = performance.now();
    for (let i = 0; i < count; i++) port1.postMessage(chunk);
    const took = Math.round(performance.now() - started);
    const signs = ["bufferedAmount", "desiredSize", "ready", "ondrain"].filter((k) => k in port1);
    w.terminate(); port1.close(); URL.revokeObjectURL(url);
    return { gap: signs.length === 0, text: `I posted ${count} messages of 64 KB (${Math.round(count * 64 / 1024)} MB) into a port whose receiver was busy. Every call returned at once, ${took} ms in all. ${signs.length ? "The port has: " + signs.join(", ") + "." : "The port has no bufferedAmount, no desiredSize and no drain event, so the sender cannot tell how much is waiting."}` };
  },

  // Write one large buffer into a stream that has been transferred, and see whether it was moved.
  async "stream-copy"() {
    // Stagger slightly behind backpressure so the two large allocations don't collide on first paint.
    await wait(120);
    const size = 32 * MB;
    const { readable, writable } = new TransformStream();
    const far = structuredClone(readable, { transfer: [readable] });
    const reader = far.getReader(), writer = writable.getWriter();
    const buffer = new Uint8Array(size);
    let t = performance.now();
    const [, got] = await Promise.all([writer.write(buffer), reader.read()]);
    const viaStream = Math.round(performance.now() - t);
    const copied = buffer.byteLength === size && got.value?.byteLength === size;
    const { port1, port2 } = new MessageChannel();
    const arrived = new Promise((r) => { port2.onmessage = r; });
    t = performance.now();
    port1.postMessage(buffer, [buffer.buffer]); await arrived;
    const viaPort = Math.round(performance.now() - t);
    port1.close(); port2.close();
    return { gap: copied, text: `I wrote a 32 MB buffer into a stream that had been transferred. ${copied ? "It was copied: the writer still held all 32 MB afterwards." : "The writer no longer held it afterwards."} That took ${viaStream} ms. Moving the same buffer through a port took ${viaPort} ms.` };
  },

  // Waiting for a message without giving up the thread.
  async "sync-receive"() {
    const shared = typeof SharedArrayBuffer !== "undefined";
    return { gap: !shared, text: shared ? "This page is cross-origin isolated, so a worker here can block on shared memory while it waits." : "This page has no SharedArrayBuffer, because it is not cross-origin isolated. A worker started here has no way to stop and wait for an answer." };
  },
};
