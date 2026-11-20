// What can go down a port, in this browser, right now.
// For each kind of object we try three things for real: send it to a worker,
// send it to a frame on another origin, and store it in IndexedDB.

const canvas = () => { const c = document.createElement("canvas"); c.width = c.height = 2; c.getContext("2d").fillRect(0, 0, 2, 2); return c; };

// move: true means it goes in the transfer list (the sender loses it).
export const KINDS = [
  { name: "MessagePort", note: "A port can carry ports. Everything on this site rests on that.", move: true, make: () => new MessageChannel().port1 },
  { name: "ArrayBuffer", note: "Memory changes hands, no copy.", move: true, make: () => new ArrayBuffer(8) },
  { name: "ReadableStream", note: "The reader pulls across the boundary, with back-pressure.", move: true, make: () => new ReadableStream() },
  { name: "WritableStream", note: "Hand someone a sink to write into.", move: true, make: () => new WritableStream() },
  { name: "TransformStream", note: "Both ends of a transform at once.", move: true, make: () => new TransformStream() },
  { name: "OffscreenCanvas", note: "A drawing surface, including one tied to a canvas on your page.", move: true, make: () => new OffscreenCanvas(2, 2) },
  { name: "ImageBitmap", note: "Decoded pixels, ready to draw.", move: true, make: () => createImageBitmap(canvas()) },
  { name: "VideoFrame", note: "One frame of video, from a camera or a decoder.", move: true, make: () => new VideoFrame(canvas(), { timestamp: 0 }) },
  { name: "AudioData", note: "A buffer of raw audio samples.", move: true, make: () => new AudioData({ format: "f32", sampleRate: 48000, numberOfFrames: 1, numberOfChannels: 1, timestamp: 0, data: new Float32Array(1) }) },
  { name: "MediaStreamTrack", note: "A live camera, microphone or screen track.", move: true, make: () => canvas().captureStream().getVideoTracks()[0] },
  { name: "RTCDataChannel", note: "A peer-to-peer connection to another machine.", move: true, make: () => new RTCPeerConnection().createDataChannel("census") },
  { name: "CryptoKey", note: "Copied, not moved. A non-extractable key can be used by the receiver and read by nobody.", move: false, make: () => crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt"]) },
  { name: "FileSystemDirectoryHandle", note: "Copied, not moved. A handle to a folder.", move: false, make: () => navigator.storage.getDirectory() },
  { name: "SharedArrayBuffer", note: "Shared, not moved or copied: both sides see the same memory. Only exists on a cross-origin isolated page, and only crosses to the same site.", move: false, make: () => new SharedArrayBuffer(8) },
  { name: "WebAssembly.Module", note: "Copied, not moved. Compiled code, ready to instantiate.", move: false, make: () => new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])) },
  { name: "CropTarget", note: "Copied, not moved. A token that lets whoever is capturing the screen crop to one of your elements.", move: false, make: () => CropTarget.fromElement(document.body) },
  { name: "RTCCertificate", note: "Copied, not moved. The identity a peer connection proves itself with.", move: false, make: () => RTCPeerConnection.generateCertificate({ name: "ECDSA", namedCurve: "P-256" }) },
  { name: "FileSystemFileHandle", note: "Copied, not moved. A handle to one file in this origin's private file system.", move: false, make: async () => (await navigator.storage.getDirectory()).getFileHandle("census.txt", { create: true }) },
  { name: "ImageData", note: "Copied, not moved. Raw pixels.", move: false, make: () => new ImageData(2, 2) },
  { name: "File", note: "Copied, not moved. A blob with a name and a date.", move: false, make: () => new File(["census"], "census.txt") },
  { name: "Error", note: "Copied, not moved. The name, message and stack survive.", move: false, make: () => new RangeError("census") },
  { name: "Function", note: "Refused everywhere. Wrap it in a port instead.", move: false, make: () => () => 1 },
  { name: "Blob", note: "Copied, not moved. The bytes are shared behind the scenes.", move: false, make: () => new Blob(["census"]) },
];

const receiver = () => {
  const answer = (ok, type) => ({ ok, type });
  const handle = (port) => {
    port.onmessage = (event) => port.postMessage(answer(true, Object.prototype.toString.call(event.data.value).slice(8, -1)));
    port.onmessageerror = () => port.postMessage(answer(false, "arrived but could not be read"));
  };
  return handle;
};

function makeWorker() {
  const source = `const handle = (${receiver})(); onmessage = (e) => handle(e.ports[0]);`;
  return new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
}

function makeFrame() {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.sandbox = "allow-scripts";
    frame.hidden = true;
    frame.srcdoc = `<script>const handle = (${receiver})(); onmessage = (e) => e.ports[0] && handle(e.ports[0]);<\/script>`;
    frame.onload = () => resolve(frame);
    document.body.append(frame);
  });
}

async function trySend(kind, connect) {
  let value;
  try { value = await kind.make(); } catch (err) { return { ok: false, why: "cannot be made here" }; }
  const channel = new MessageChannel();
  connect(channel.port2);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, why: "no answer" }), 1500);
    channel.port1.onmessage = ({ data }) => { clearTimeout(timer); resolve(data.ok ? { ok: true } : { ok: false, why: data.type }); channel.port1.close(); };
    try { channel.port1.postMessage({ value }, kind.move ? [value] : []); }
    catch (err) { clearTimeout(timer); resolve({ ok: false, why: err.name }); }
  });
}

async function tryStore(kind, db) {
  let value;
  try { value = await kind.make(); } catch { return { ok: false, why: "cannot be made here" }; }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction("s", "readwrite");
      tx.objectStore("s").put(value, kind.name);
      tx.oncomplete = () => resolve({ ok: true });
      tx.onerror = tx.onabort = () => resolve({ ok: false, why: tx.error?.name || "aborted" });
    } catch (err) { resolve({ ok: false, why: err.name }); }
  });
}

export async function runCensus(table) {
  const body = table.tBodies[0];
  body.innerHTML = "";
  const worker = makeWorker();
  const frame = await makeFrame();
  const db = await new Promise((resolve, reject) => {
    const open = indexedDB.open("pa-census", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("s");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  const cell = (r) => `<td class="${r.ok ? "yes" : "no"}"><span class="jack ${r.ok ? "on" : ""}"></span>${r.ok ? "yes" : `no <span class="muted small">${r.why || ""}</span>`}</td>`;
  const results = {};
  for (const kind of KINDS) {
    const exists = kind.name === "WebAssembly.Module" ? "WebAssembly" in globalThis : kind.name in globalThis;
    const missing = kind.name === "SharedArrayBuffer" ? "Not on this page: it needs cross-origin isolation. See the isolated room." : "This browser does not have it.";
    const row = body.insertRow();
    row.innerHTML = `<th scope="row"><code>${kind.name}</code><span class="muted small">${kind.note}</span></th><td colspan="3" class="muted">testing</td>`;
    if (!exists) { row.cells[1].textContent = missing; results[kind.name] = null; continue; }
    const toWorker = await trySend(kind, (port) => worker.postMessage(null, [port]));
    const toOrigin = await trySend(kind, (port) => frame.contentWindow.postMessage(null, "*", [port]));
    const stored = await tryStore(kind, db);
    results[kind.name] = { worker: toWorker.ok, origin: toOrigin.ok, stored: stored.ok };
    row.innerHTML = `<th scope="row"><code>${kind.name}</code><span class="muted small">${kind.note}</span></th>${cell(toWorker)}${cell(toOrigin)}${cell(stored)}`;
  }
  worker.terminate();
  frame.remove();
  db.close();
  table.dataset.done = "true";
  return results;
}
