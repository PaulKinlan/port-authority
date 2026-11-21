// Every kind of object this page could think of, tried three ways in the
// browser that runs it:
//
//   copy:  structuredClone(value)
//   move:  structuredClone(value, { transfer: [value] })
//   other: posted to a frame on another origin, moved if it can be and copied if not
//
// The lab (/lab/) tests fewer kinds in more places and checks that each one
// still works where it lands. This list is wider and only asks whether the
// thing gets through at all.

const canvas = () => { const c = document.createElement("canvas"); c.width = c.height = 2; c.getContext("2d").fillRect(0, 0, 2, 2); return c; };
const pc = () => new RTCPeerConnection();

// group: what the thing is for. make: builds one, or throws if this browser cannot.
export const TYPES = [
  // Messaging and control
  ["Messaging", "MessagePort", () => new MessageChannel().port1],
  ["Messaging", "BroadcastChannel", () => new BroadcastChannel("census")],
  ["Messaging", "AbortSignal", () => new AbortController().signal],
  ["Messaging", "EventTarget", () => new EventTarget()],
  ["Messaging", "Worker", () => new Worker(URL.createObjectURL(new Blob([""])))],
  ["Messaging", "Function", () => () => 1],
  ["Messaging", "Proxy", () => new Proxy({}, {})],
  ["Messaging", "WeakRef", () => new WeakRef({})],
  ["Messaging", "An instance of my own class", () => new (class Money { constructor() { this.pence = 5; } total() { return this.pence; } })(), { lossy: (v) => typeof v.total !== "function" && "arrives as a plain object, without its class or methods" }],
  ["Messaging", "Error with a cause and extra fields", () => Object.assign(new RangeError("x", { cause: "c" }), { code: 7 }), { lossy: (v) => (v.code !== 7 || v.cause !== "c") && `arrives without ${[v.cause !== "c" && "its cause", v.code !== 7 && "its extra field"].filter(Boolean).join(" and ")}` }],

  // Bytes and memory
  ["Memory", "ArrayBuffer", () => new ArrayBuffer(8)],
  ["Memory", "SharedArrayBuffer", () => new SharedArrayBuffer(8)],
  ["Memory", "WebAssembly.Module", () => new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))],
  ["Memory", "WebAssembly.Memory", () => new WebAssembly.Memory({ initial: 1 })],
  ["Memory", "Blob", () => new Blob(["x"])],
  ["Memory", "File", () => new File(["x"], "x.txt")],

  // Streams
  ["Streams", "ReadableStream", () => new ReadableStream()],
  ["Streams", "WritableStream", () => new WritableStream()],
  ["Streams", "TransformStream", () => new TransformStream()],
  ["Streams", "CompressionStream", () => new CompressionStream("gzip")],
  ["Streams", "TextDecoderStream", () => new TextDecoderStream()],
  ["Streams", "Response body", () => new Response("x").body],
  ["Streams", "Blob stream", () => new Blob(["x"]).stream()],
  ["Streams", "File writer (FileSystemWritableFileStream)", async () => (await (await navigator.storage.getDirectory()).getFileHandle("census.txt", { create: true })).createWritable()],

  // Network
  ["Network", "Request", () => new Request("https://example.com/")],
  ["Network", "Response", () => new Response("x")],
  ["Network", "Headers", () => new Headers({ a: "b" })],
  ["Network", "FormData", () => { const f = new FormData(); f.set("a", "b"); return f; }],
  ["Network", "URL", () => new URL("https://example.com/")],
  ["Network", "URLSearchParams", () => new URLSearchParams("a=b")],
  ["Network", "WebSocket", () => new Promise((resolve, reject) => { const w = new WebSocket(location.origin.replace(/^http/, "ws") + "/echo"); w.onopen = () => { setTimeout(() => w.close(), 500); resolve(w); }; w.onerror = () => reject(Object.assign(new Error("no socket"), { name: "no socket" })); })],
  ["Network", "RTCPeerConnection", pc],
  ["Network", "RTCDataChannel", () => pc().createDataChannel("c")],
  ["Network", "RTCCertificate", () => RTCPeerConnection.generateCertificate({ name: "ECDSA", namedCurve: "P-256" })],
  ["Network", "EventSource", () => new EventSource("data:text/event-stream,")],

  // Pictures, video and sound
  ["Media", "ImageBitmap", () => createImageBitmap(canvas())],
  ["Media", "ImageData", () => new ImageData(2, 2)],
  ["Media", "OffscreenCanvas", () => new OffscreenCanvas(2, 2)],
  ["Media", "OffscreenCanvas that has been drawn on", () => { const c = new OffscreenCanvas(2, 2); c.getContext("2d").fillRect(0, 0, 1, 1); return c; }],
  ["Media", "VideoFrame", () => new VideoFrame(canvas(), { timestamp: 0 })],
  ["Media", "AudioData", () => new AudioData({ format: "f32", sampleRate: 48000, numberOfFrames: 1, numberOfChannels: 1, timestamp: 0, data: new Float32Array([0.5]) })],
  ["Media", "EncodedVideoChunk", () => new EncodedVideoChunk({ type: "key", timestamp: 0, data: new Uint8Array(4) })],
  ["Media", "EncodedAudioChunk", () => new EncodedAudioChunk({ type: "key", timestamp: 0, data: new Uint8Array(4) })],
  ["Media", "AudioBuffer", () => new AudioBuffer({ length: 8, sampleRate: 48000 })],
  ["Media", "MediaStream", () => canvas().captureStream()],
  ["Media", "MediaStreamTrack", () => canvas().captureStream().getVideoTracks()[0]],
  ["Media", "MediaSource", () => new MediaSource()],
  ["Media", "Path2D", () => new Path2D("M0 0L1 1")],
  ["Media", "DOMMatrix", () => new DOMMatrix()],
  ["Media", "FontFace", () => new FontFace("census", "local(Arial)")],
  ["Media", "CSSStyleSheet", () => new CSSStyleSheet()],
  ["Media", "GPUAdapter", async () => { const a = await navigator.gpu.requestAdapter(); if (!a) throw new Error("no adapter"); return a; }],
  ["Media", "GPUDevice", async () => { const a = await navigator.gpu.requestAdapter(); if (!a) throw new Error("no adapter"); return a.requestDevice(); }],
  ["Media", "GPUBuffer", async () => { const a = await navigator.gpu.requestAdapter(); if (!a) throw new Error("no adapter"); return (await a.requestDevice()).createBuffer({ size: 8, usage: GPUBufferUsage.COPY_SRC }); }],

  // Keys, files and other grants
  ["Grants", "CryptoKey (cannot be exported)", () => crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt"])],
  ["Grants", "FileSystemFileHandle", async () => (await navigator.storage.getDirectory()).getFileHandle("census.txt", { create: true })],
  ["Grants", "FileSystemDirectoryHandle", () => navigator.storage.getDirectory()],
  ["Grants", "DataTransfer", () => new DataTransfer()],
  ["Grants", "ClipboardItem", () => new ClipboardItem({ "text/plain": new Blob(["x"], { type: "text/plain" }) })],
  ["Grants", "Notification permission", () => navigator.permissions.query({ name: "notifications" })],
  ["Grants", "Lock", () => new Promise((resolve) => navigator.locks.request("census-" + Math.random(), (lock) => { resolve(lock); }))],
  ["Grants", "Cache", () => caches.open("census")],
  ["Grants", "Built-in AI session (LanguageModel)", async () => { if ((await LanguageModel.availability()) !== "available") throw new Error("no model here"); return LanguageModel.create(); }],
];

const tag = (v) => Object.prototype.toString.call(v).slice(8, -1);
const release = (v) => { try { if (v && /^(VideoFrame|AudioData|ImageBitmap)$/.test(tag(v))) v.close(); if (v && tag(v) === "RTCPeerConnection") v.close(); if (v && /^(Worker)$/.test(tag(v))) v.terminate(); if (v && /^(WebSocket|EventSource|BroadcastChannel)$/.test(tag(v))) v.close(); } catch {} };

// Try one way of sending inside this page. Returns "yes", a loss, or the error name.
const local = (value, transfer, lossy) => {
  try {
    const back = structuredClone(value, transfer ? { transfer: [value] } : undefined);
    const lost = lossy && lossy(back);
    release(back);
    return lost ? { ok: "lossy", note: lost } : { ok: true };
  } catch (err) { return { ok: false, note: err.name }; }
};

// `peer` is { post(message, transfer) => Promise<{type}|{unreadable}|null> }, a frame on another origin.
export async function tryOne([group, name, make, opts = {}], peer) {
  const fresh = async () => make();
  const row = { group, name };
  let v;
  try { v = await fresh(); } catch (err) { return { ...row, made: false, note: String(err.message || err.name).slice(0, 80) }; }
  row.made = true;
  row.copy = local(v, false, opts.lossy); release(v);
  try { v = await fresh(); row.move = local(v, true); release(v); } catch { row.move = { ok: false, note: "could not make a second one" }; }
  if (peer) {
    const how = row.move.ok === true ? "move" : row.copy.ok ? "copy" : null;
    if (!how) row.other = { ok: false, note: "cannot leave this page at all" };
    else {
      try {
        v = await fresh();
        const answer = await peer.post({ census: name, value: v }, how === "move" ? [v] : []);
        if (how === "copy") release(v);
        row.other = answer === null ? { ok: false, note: "no answer" } : answer.unreadable ? { ok: false, note: "messageerror on the other side" } : answer.threw ? { ok: false, note: answer.threw } : { ok: true, note: how === "move" ? "moved" : "copied" };
      } catch (err) { row.other = { ok: false, note: err.name || String(err) }; }
    }
  }
  return row;
}

export async function runCensus(peer, onRow = () => {}) {
  const rows = [];
  for (const type of TYPES) { const row = await tryOne(type, peer); rows.push(row); onRow(row); }
  return rows;
}
