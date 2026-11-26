// Every kind of object the lab tries to send, in one file that loads anywhere:
// a page, a worker, a service worker, an audio worklet, on any origin.
//
//   how:  "move" goes in the transfer list (the sender loses it)
//         "copy" is structured-cloned (both sides hold it)
//   make: builds one, in the page that sends it
//   use:  runs wherever it lands, and proves the thing still works there.
//         It returns a short note, or throws.

(() => {
  const need = (ok, why) => { if (!ok) throw new Error(why); };
  const canvas = () => { const c = document.createElement("canvas"); c.width = c.height = 2; c.getContext("2d").fillRect(0, 0, 2, 2); return c; };
  const viaWorker = (body) => new Promise((resolve, reject) => {
    const w = new Worker(URL.createObjectURL(new Blob([body], { type: "text/javascript" })));
    w.onmessage = (e) => { resolve(e.data); setTimeout(() => w.terminate(), 5000); };
    w.onerror = (e) => reject(new Error(e.message || "worker failed"));
    setTimeout(() => reject(new Error("worker did not answer")), 2000);
  });
  const text = (bytes) => new TextEncoder().encode(bytes);

  globalThis.LAB_VERSION = 1;
  globalThis.LAB_KINDS = [
    // ---- moved
    { name: "MessagePort", group: "Moved", how: "move",
      make: () => { const c = new MessageChannel(); c.port1.postMessage("hello"); return c.port2; },
      use: (v) => new Promise((resolve, reject) => { v.onmessage = (e) => resolve("got the message waiting in it: " + e.data); if (globalThis.setTimeout) setTimeout(() => reject(new Error("nothing came out of it")), 800); }) },
    { name: "ArrayBuffer", group: "Moved", how: "move",
      make: () => { const b = new ArrayBuffer(8); new Uint8Array(b)[0] = 42; return b; },
      use: (v) => { need(v.byteLength === 8 && new Uint8Array(v)[0] === 42, "bytes are wrong"); return "8 bytes intact"; } },
    { name: "ArrayBuffer (resizable)", group: "Moved", how: "move",
      make: () => new ArrayBuffer(8, { maxByteLength: 64 }),
      use: (v) => { need(v.resizable, "arrived fixed-size"); v.resize(16); return "still resizable"; } },
    { name: "ReadableStream", group: "Moved", how: "move",
      make: () => new ReadableStream({ start(c) { c.enqueue("chunk"); c.close(); } }),
      use: async (v) => { const { value } = await v.getReader().read(); need(value === "chunk", "read " + value); return "read a chunk across the boundary"; } },
    { name: "ReadableStream (bytes)", group: "Moved", how: "move",
      make: () => new ReadableStream({ type: "bytes", start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.close(); } }),
      use: async (v) => { const { value } = await v.getReader().read(); need(value && value.length === 3, "no bytes"); return "read 3 bytes"; } },
    { name: "WritableStream", group: "Moved", how: "move",
      make: () => new WritableStream({ write() {} }),
      use: async (v) => { const w = v.getWriter(); await w.write("x"); return "wrote into the sender's sink"; } },
    { name: "TransformStream", group: "Moved", how: "move",
      make: () => new TransformStream(),
      use: async (v) => { const w = v.writable.getWriter(); w.write("x"); const { value } = await v.readable.getReader().read(); need(value === "x", "nothing came through"); return "wrote and read back through it"; } },
    { name: "OffscreenCanvas", group: "Moved", how: "move",
      make: () => new OffscreenCanvas(2, 2),
      use: (v) => { const ctx = v.getContext("2d"); need(ctx, "no 2d context here"); ctx.fillRect(0, 0, 1, 1); return "drew on it"; } },
    { name: "OffscreenCanvas (from a canvas element)", group: "Moved", how: "move",
      make: () => document.createElement("canvas").transferControlToOffscreen(),
      // Chrome kills a receiver in another process when its first drawing is
      // shown, a moment after the drawing call returns. Wait for that moment,
      // so that a receiver that dies is not recorded as one that worked.
      use: async (v) => { const ctx = v.getContext("2d"); need(ctx, "no 2d context here"); ctx.fillRect(0, 0, 1, 1); if (globalThis.setTimeout) await new Promise((r) => setTimeout(r, 400)); return "drew into the sender's page"; } },
    { name: "ImageBitmap", group: "Moved", how: "move",
      make: () => createImageBitmap(canvas()),
      use: (v) => { need(v.width === 2, "empty bitmap"); return "2 by 2 pixels"; } },
    { name: "VideoFrame", group: "Moved", how: "move",
      make: () => new VideoFrame(canvas(), { timestamp: 7 }),
      use: (v) => { need(v.codedWidth === 2 && v.timestamp === 7, "frame is empty"); v.close(); return "frame intact, then closed"; } },
    { name: "AudioData", group: "Moved", how: "move",
      make: () => new AudioData({ format: "f32", sampleRate: 48000, numberOfFrames: 1, numberOfChannels: 1, timestamp: 0, data: new Float32Array([0.5]) }),
      use: (v) => { need(v.numberOfFrames === 1, "no samples"); v.close(); return "1 sample frame"; } },
    { name: "RTCDataChannel", group: "Moved", how: "move",
      make: () => new RTCPeerConnection().createDataChannel("lab"),
      use: (v) => { need(v.label === "lab", "label lost"); return "channel is " + v.readyState; } },
    { name: "MediaStreamTrack", group: "Moved", how: "move",
      make: () => canvas().captureStream().getVideoTracks()[0],
      use: (v) => { need(v.kind === "video", "not a track"); return "track is " + v.readyState; } },
    { name: "MediaSourceHandle", group: "Moved", how: "move",
      make: () => viaWorker("const h = new MediaSource().handle; postMessage(h, [h]);"),
      use: (v) => { need(String(v) === "[object MediaSourceHandle]", "not a handle"); return "handle arrived"; } },
    { name: "AbortSignal", group: "Moved", how: "move",
      make: () => new AbortController().signal,
      use: (v) => { need(typeof v.aborted === "boolean", "not a signal"); return "signal arrived"; } },

    // ---- copied
    { name: "CryptoKey (AES, non-extractable)", group: "Copied", how: "copy",
      make: () => crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]),
      use: async (v) => { need(!v.extractable, "became extractable"); await crypto.subtle.encrypt({ name: "AES-GCM", iv: new Uint8Array(12) }, v, text("x")); return "encrypted with a key it cannot read"; } },
    { name: "CryptoKey (ECDSA private, non-extractable)", group: "Copied", how: "copy",
      make: async () => (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])).privateKey,
      use: async (v) => { await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, v, text("x")); let read = true; try { await crypto.subtle.exportKey("jwk", v); } catch { read = false; } need(!read, "the key could be exported"); return "signed with a key it cannot read"; } },
    { name: "Blob", group: "Copied", how: "copy",
      make: () => new Blob(["lab"]),
      use: async (v) => { need((await v.text()) === "lab", "contents lost"); return "read its contents"; } },
    { name: "File", group: "Copied", how: "copy",
      make: () => new File(["lab"], "lab.txt"),
      use: async (v) => { need(v.name === "lab.txt" && (await v.text()) === "lab", "contents lost"); return "name and contents intact"; } },
    { name: "ImageData", group: "Copied", how: "copy",
      make: () => new ImageData(2, 2),
      use: (v) => { need(v.data.length === 16, "pixels lost"); return "16 bytes of pixels"; } },
    { name: "ImageBitmap (copied)", group: "Copied", how: "copy",
      make: () => createImageBitmap(canvas()),
      use: (v) => { need(v.width === 2, "empty bitmap"); return "2 by 2 pixels"; } },
    { name: "VideoFrame (copied)", group: "Copied", how: "copy",
      make: () => new VideoFrame(canvas(), { timestamp: 7 }),
      use: (v) => { need(v.codedWidth === 2, "frame is empty"); v.close(); return "frame intact"; } },
    { name: "EncodedVideoChunk", group: "Copied", how: "copy",
      make: () => new EncodedVideoChunk({ type: "key", timestamp: 0, data: new Uint8Array(4) }),
      use: (v) => { need(v.byteLength === 4, "empty"); return "4 bytes"; } },
    { name: "FileSystemFileHandle", group: "Copied", how: "copy",
      make: async () => (await navigator.storage.getDirectory()).getFileHandle("lab.txt", { create: true }),
      use: async (v) => { await v.getFile(); return "opened the file: " + v.name; } },
    { name: "FileSystemDirectoryHandle", group: "Copied", how: "copy",
      make: () => navigator.storage.getDirectory(),
      use: async (v) => { await v.keys().next(); return "listed the folder"; } },
    { name: "RTCCertificate", group: "Copied", how: "copy",
      make: () => RTCPeerConnection.generateCertificate({ name: "ECDSA", namedCurve: "P-256" }),
      use: (v) => { need(v.expires > 0, "not a certificate"); new RTCPeerConnection({ certificates: [v] }).close(); return "made a peer connection with it"; } },
    { name: "CropTarget", group: "Copied", how: "copy",
      make: () => CropTarget.fromElement(document.body),
      use: (v) => { need(String(v) === "[object CropTarget]", "not a crop target"); return "token arrived"; } },
    { name: "SharedArrayBuffer", group: "Copied", how: "copy",
      // A page has SharedArrayBuffer only when it is cross-origin isolated. Say so, in place of "is not defined".
      make: () => {
        if (typeof SharedArrayBuffer === "undefined") throw new Error("No SharedArrayBuffer on this page. A browser allows shared memory only on a cross-origin isolated page. The isolated lab is one.");
        const b = new SharedArrayBuffer(8); new Int32Array(b)[0] = 42; return b;
      },
      use: (v) => { need(new Int32Array(v)[0] === 42, "memory is not shared"); return "same memory on both sides"; } },
    { name: "WebAssembly.Module", group: "Copied", how: "copy",
      make: () => new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
      use: (v) => { new WebAssembly.Instance(v); return "instantiated it"; } },
    { name: "WebAssembly.Memory (shared)", group: "Copied", how: "copy",
      make: () => new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }),
      use: (v) => { need(v.buffer.byteLength === 65536, "no memory"); return "one shared page"; } },
    { name: "DOMException", group: "Copied", how: "copy",
      make: () => new DOMException("lab", "DataCloneError"),
      use: (v) => { need(v.name === "DataCloneError" && v.message === "lab", "fields lost"); return "name and message intact"; } },
    { name: "Error (RangeError with a cause)", group: "Copied", how: "copy",
      make: () => new RangeError("lab", { cause: "because" }),
      use: (v) => { need(v instanceof RangeError && v.message === "lab", "type or message lost"); return v.cause === "because" ? "type, message and cause intact" : "type and message intact, cause lost"; } },
    { name: "DOMMatrix, DOMRect, DOMPoint", group: "Copied", how: "copy",
      make: () => ({ m: new DOMMatrix([1, 2, 3, 4, 5, 6]), r: new DOMRect(1, 2, 3, 4), p: new DOMPoint(1, 2) }),
      use: (v) => { need(v.m.a === 1 && v.r.width === 3 && v.p.y === 2, "values lost"); return "geometry intact"; } },
    { name: "Map, Set, Date, RegExp, BigInt, a cycle", group: "Copied", how: "copy",
      make: () => { const o = { map: new Map([["k", 1]]), set: new Set([1]), date: new Date(0), re: /x/g, big: 2n ** 70n }; o.self = o; return o; },
      use: (v) => { need(v.map.get("k") === 1 && v.set.has(1) && v.date.getTime() === 0 && v.re.flags === "g" && v.big === 2n ** 70n && v.self === v, "something was lost"); return "all intact, cycle included"; } },

    // ---- expected to be refused: here so that a browser that starts allowing one is noticed
    { name: "Function", group: "Refused by design", how: "copy", make: () => () => 1, use: (v) => String(v()) },
    { name: "Symbol", group: "Refused by design", how: "copy", make: () => Symbol("lab"), use: (v) => String(v) },
    { name: "DOM node", group: "Refused by design", how: "copy", make: () => document.createElement("p"), use: (v) => v.nodeName },
    { name: "Proxy", group: "Refused by design", how: "copy", make: () => new Proxy({}, {}), use: () => "arrived" },
    { name: "Promise", group: "Refused by design", how: "copy", // Wrapped in an object, because the lab awaits make() and would send what the promise resolved to.
      make: () => ({ promise: Promise.resolve(1) }), use: (v) => { need(v.promise && typeof v.promise.then === "function", "arrived as an empty object, not a promise"); return "a promise arrived"; } },
    { name: "URL", group: "Refused by design", how: "copy", make: () => new URL("https://example.com/"), use: (v) => v.href },
    { name: "Response", group: "Refused by design", how: "copy", make: () => new Response("lab"), use: async (v) => v.text() },
    { name: "MediaStream", group: "Refused by design", how: "copy", make: () => canvas().captureStream(), use: (v) => v.id },
    { name: "WeakRef", group: "Refused by design", how: "copy", make: () => new WeakRef({}), use: () => "arrived" },
    { name: "Worker", group: "Refused by design", how: "copy", make: () => new Worker(URL.createObjectURL(new Blob([""]))), use: () => "arrived" },
  ];

  // Runs wherever a value lands. Values arrive on `inlet` and results go back
  // on `out`. They are the same port unless the inlet cannot answer.
  // Frames, audio and bitmaps hold memory outside the garbage collector's
  // sight, and a browser complains when one is dropped without being closed.
  // Every test closes what it made and what it received, whatever happened.
  globalThis.labRelease = (value) => {
    try { if (value && typeof value.close === "function" && /^(VideoFrame|AudioData|ImageBitmap)$/.test(Object.prototype.toString.call(value).slice(8, -1))) value.close(); } catch (err) {}
  };

  globalThis.labReceive = (out, where, inlet = out) => {
    let seq = 0;
    const kinds = new Map(globalThis.LAB_KINDS.map((k) => [k.name, k]));
    // An audio worklet has no timers, so there a stuck probe simply never answers.
    const limit = () => new Promise((_, reject) => { if (globalThis.setTimeout) setTimeout(() => reject(new Error("timed out using it")), 1500); });
    inlet.onmessage = async (event) => {
      const data = event.data;
      if (!data) return;
      if (data.next !== undefined) { seq = data.next; return; }
      if (data.ping) return out.postMessage({ seq, pong: true });
      if (!data.test) return;
      const mine = seq;
      const type = Object.prototype.toString.call(data.value).slice(8, -1);
      try {
        const note = await Promise.race([Promise.resolve().then(() => kinds.get(data.test).use(data.value)), limit()]);
        out.postMessage({ seq: mine, outcome: "works", note: String(note), type });
      } catch (err) {
        out.postMessage({ seq: mine, outcome: "arrives-broken", note: String((err && err.message) || err).slice(0, 160), type });
      } finally { globalThis.labRelease(data.value); }
    };
    // The browser could not rebuild what was sent, and fires messageerror in place of message. The event
    // has no error in it and no reason. What little it does carry is written down, so that can be seen.
    inlet.onmessageerror = (event) => {
      const data = event && "data" in event ? (event.data === null ? "null" : typeof event.data) : "absent";
      out.postMessage({ seq, outcome: "unreadable", note: `messageerror event. The browser gave no reason. event.data: ${data}. event.ports: ${event && event.ports ? event.ports.length : 0}.` });
    };
    out.postMessage({ hello: where });
  };
})();
