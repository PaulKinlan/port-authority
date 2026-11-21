// A MessagePort over anything that carries bytes in order.
//
// bridge(pipe) returns a real MessagePort. Whatever is posted into it comes
// out of the matching port on the other side of the pipe. The other side can
// be another device: a port cannot be transferred to another machine, so this
// rebuilds one there and carries its traffic.
//
// What crosses:
//   - plain data, undefined, NaN, bigint, Date, Map, Set, Error
//   - ArrayBuffer and typed arrays, as bytes and not as text
//   - a MessagePort: the far side gets a new port, joined to the one sent
//   - a ReadableStream: the far side gets a stream, and the source is read
//     only as fast as the far side reads
//   - a WritableStream: the far side gets a stream, and a writer there is
//     held back when the real stream here is slow
// What does not: Blob, File, SharedArrayBuffer, OffscreenCanvas, VideoFrame,
// anything with a cycle. Send file.stream() for a file.
//
// The pipe is { send(bytes), close(), onmessage, onclose }. send may return a
// promise, and the bridge waits for it, which is how a slow link slows a
// stream's source. onmessage is called with an ArrayBuffer or Uint8Array.

const FRAME = 15000;          // bytes of one frame. Data channels are only sure to carry 16 KiB.
const MAX_MESSAGE = 64 << 20; // cap reassembled message bytes so malformed streams cannot grow without bound
// A key says who made the thing: L for this side, R for the other. On the wire it is flipped.
const flip = (key) => (key === "0" ? key : (key[0] === "L" ? "R" : "L") + key.slice(1));
const kind = (value) => Object.prototype.toString.call(value).slice(8, -1);
const VIEWS = ["Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array", "DataView"];
const text = (err) => String((err && err.message) || err || "closed");

export function bridge(pipe, { onerror = () => {}, onclose = () => {} } = {}) {
  let made = 0, closed = false;
  const ports = new Map();      // key -> the local port whose traffic we carry
  const sources = new Map();    // key -> a real ReadableStream being read for the far side
  const readers = new Map();    // key -> a stream we made for a ReadableStream that lives over there
  const sinks = new Map();      // key -> a real WritableStream being written for the far side
  const writers = new Map();    // key -> a stream we made for a WritableStream that lives over there
  const stats = { sent: 0, received: 0 };

  // ---- frames. One message is a JSON head and some byte blocks, cut into frames.
  let line = Promise.resolve();
  const post = (message, blobs = []) => {
    if (closed) return Promise.resolve();
    const head = new TextEncoder().encode(JSON.stringify({ m: message, b: blobs.map((b) => b.byteLength) }));
    const whole = new Uint8Array(4 + head.byteLength + blobs.reduce((sum, b) => sum + b.byteLength, 0));
    new DataView(whole.buffer).setUint32(0, head.byteLength);
    whole.set(head, 4);
    let at = 4 + head.byteLength;
    for (const b of blobs) { whole.set(b, at); at += b.byteLength; }
    // Frames of different messages must not interleave, so everything waits its turn.
    line = line.then(async () => {
      for (let i = 0; i < whole.byteLength && !closed; i += FRAME) {
        const frame = new Uint8Array(Math.min(FRAME, whole.byteLength - i) + 1);
        frame[0] = i + FRAME >= whole.byteLength ? 1 : 0;
        frame.set(whole.subarray(i, i + FRAME), 1);
        stats.sent += frame.byteLength;
        await pipe.send(frame);
      }
    }).catch((err) => shut(err));
    return line;
  };

  let parts = [], partsBytes = 0;
  pipe.onmessage = (data) => {
    const frame = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (!frame.byteLength) return;
    stats.received += frame.byteLength;
    const chunk = frame.subarray(1);
    partsBytes += chunk.byteLength;
    if (partsBytes > MAX_MESSAGE) { parts = []; partsBytes = 0; return onerror(new Error("message exceeds size limit")); }
    parts.push(chunk);
    if (!frame[0]) return;
    const whole = new Uint8Array(partsBytes);
    let at = 0;
    for (const p of parts) { whole.set(p, at); at += p.byteLength; }
    parts = []; partsBytes = 0;
    try {
      if (whole.byteLength < 4) throw new Error("truncated message");
      const headLength = new DataView(whole.buffer).getUint32(0);
      if (4 + headLength > whole.byteLength) throw new Error("truncated header");
      const head = JSON.parse(new TextDecoder().decode(whole.subarray(4, 4 + headLength)));
      if (!head || !Array.isArray(head.b)) throw new Error("malformed header");
      let from = 4 + headLength;
      // Each block gets a buffer of its own, so it can be transferred onwards.
      const blobs = head.b.map((length) => {
        if (!Number.isInteger(length) || length < 0 || from + length > whole.byteLength) throw new Error("invalid blob length");
        const b = whole.slice(from, from + length); from += length; return b;
      });
      receive(head.m, blobs);
    } catch (err) { onerror(err); }
  };
  pipe.onclose = () => shut();

  // ---- values
  function encode(value, blobs, seen = new Set()) {
    if (value === null || typeof value === "boolean" || typeof value === "string") return value;
    if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0) ? value : ["n", String(Object.is(value, -0) ? "-0" : value)];
    if (value === undefined) return ["u"];
    if (typeof value === "bigint") return ["i", String(value)];
    if (typeof value !== "object") throw new Error(`a ${typeof value} cannot cross`);
    if (value instanceof MessagePort) return ["p", flip(carry(value))];
    if (value instanceof ReadableStream) return ["r", flip(readFor(value))];
    if (value instanceof WritableStream) return ["w", flip(writeFor(value))];
    const type = kind(value);
    if (type === "ArrayBuffer") { blobs.push(new Uint8Array(value)); return ["b", blobs.length - 1]; }
    if (ArrayBuffer.isView(value)) {
      if (kind(value.buffer) !== "ArrayBuffer") throw new Error("shared memory cannot cross");
      blobs.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      return ["t", VIEWS.includes(type) ? type : "Uint8Array", blobs.length - 1];
    }
    if (type === "Date") return ["d", value.getTime()];
    if (value instanceof Error) return ["e", value.name, value.message];
    if (seen.has(value)) throw new Error("a value that contains itself cannot cross");
    seen.add(value);
    let out;
    if (Array.isArray(value)) out = ["a", value.map((item) => encode(item, blobs, seen))];
    else if (type === "Map") out = ["M", [...value].map(([k, v]) => [encode(k, blobs, seen), encode(v, blobs, seen)])];
    else if (type === "Set") out = ["S", [...value].map((item) => encode(item, blobs, seen))];
    else if (type === "Object") out = ["o", Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v, blobs, seen)]))];
    else throw new Error(`a ${type} cannot cross`);
    seen.delete(value);
    return out;
  }

  function decode(node, blobs, transfer) {
    if (!Array.isArray(node)) return node;
    const [tag, a, b] = node;
    switch (tag) {
      case "n": return a === "-0" ? -0 : Number(a);
      case "u": return undefined;
      case "i": return BigInt(a);
      case "d": return new Date(a);
      case "e": { const err = new Error(b); err.name = a; return err; }
      case "a": return a.map((item) => decode(item, blobs, transfer));
      case "M": return new Map(a.map(([k, v]) => [decode(k, blobs, transfer), decode(v, blobs, transfer)]));
      case "S": return new Set(a.map((item) => decode(item, blobs, transfer)));
      case "o": return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, decode(v, blobs, transfer)]));
      case "b": {
        const bytes = blobs[a];
        if (!bytes) throw new Error("missing bytes on the wire");
        transfer.push(bytes.buffer);
        return bytes.buffer;
      }
      case "t": {
        if (!VIEWS.includes(a)) throw new Error("unknown typed array on the wire");
        const bytes = blobs[b];
        if (!bytes) throw new Error("missing bytes on the wire");
        transfer.push(bytes.buffer);
        if (a === "DataView") return new DataView(bytes.buffer);
        const View = globalThis[a];
        return new View(bytes.buffer, 0, bytes.byteLength / (View.BYTES_PER_ELEMENT || 1));
      }
      case "p": { const { port1, port2 } = new MessageChannel(); carry(port1, a); transfer.push(port2); return port2; }
      case "r": { const stream = readerFor(a); transfer.push(stream); return stream; }
      case "w": { const stream = writerFor(a); transfer.push(stream); return stream; }
    }
    throw new Error("unknown value on the wire");
  }

  // Send a value. If part of it cannot cross, say so and send nothing.
  const pack = (message, value) => {
    const blobs = [];
    try { message.v = encode(value, blobs); } catch (err) { onerror(err); return null; }
    return post(message, blobs);
  };

  // ---- ports
  function carry(port, key = "L" + ++made) {
    ports.set(key, port);
    port.onmessage = (event) => pack({ t: "m", p: flip(key) }, event.data);
    // Where the browser says when a port's other end has gone, pass that on.
    port.addEventListener?.("close", () => { if (ports.delete(key)) post({ t: "pc", p: flip(key) }); });
    return key;
  }

  // ---- a ReadableStream that lives here, read for the far side
  function readFor(stream, key = "L" + ++made) {
    const reader = stream.getReader();
    const source = { reader, credit: 0, wake: null, over: false };
    sources.set(key, source);
    (async () => {
      try {
        for (;;) {
          // Read only when the far side has asked. That is the back-pressure.
          while (!source.credit && !source.over) await new Promise((resolve) => (source.wake = resolve));
          if (source.over) return;
          const { value, done } = await reader.read();
          if (source.over) return;
          if (done) { post({ t: "se", s: flip(key) }); break; }
          source.credit--;
          const sent = pack({ t: "sc", s: flip(key) }, value);
          if (!sent) throw new Error("a chunk of the stream could not cross");
          await sent;
        }
      } catch (err) { if (!source.over) post({ t: "sx", s: flip(key), e: text(err) }); reader.cancel(err).catch(() => {}); }
      sources.delete(key);
    })();
    return key;
  }

  // ---- the stream we hand out for a ReadableStream that lives over there
  function readerFor(key) {
    const entry = { controller: null, pulled: null };
    readers.set(key, entry);
    return new ReadableStream({
      start(controller) { entry.controller = controller; },
      pull() { post({ t: "sp", s: flip(key) }); return new Promise((resolve) => (entry.pulled = resolve)); },
      cancel(reason) { readers.delete(key); post({ t: "sq", s: flip(key), e: text(reason) }); },
    }, { highWaterMark: 1 });
  }

  // ---- a WritableStream that lives here, written for the far side
  function writeFor(stream, key = "L" + ++made) {
    const writer = stream.getWriter();
    const sink = { writer, chain: Promise.resolve(), over: false };
    sinks.set(key, sink);
    const failed = (err) => { if (sink.over) return; sink.over = true; sinks.delete(key); post({ t: "wx", s: flip(key), e: text(err) }); };
    // The owner can shut it at any time. The far side hears at once.
    writer.closed.catch(failed);
    return key;
  }

  // ---- the stream we hand out for a WritableStream that lives over there
  function writerFor(key) {
    const entry = { controller: null, waiting: [], closing: null };
    writers.set(key, entry);
    const answered = () => new Promise((resolve, reject) => entry.waiting.push({ resolve, reject }));
    return new WritableStream({
      start(controller) { entry.controller = controller; },
      write(chunk) {
        if (!pack({ t: "wc", s: flip(key) }, chunk)) throw new Error("that chunk cannot cross");
        return answered();      // resolves when the real write has finished over there
      },
      close() { post({ t: "we", s: flip(key) }); return answered(); },
      abort(reason) { writers.delete(key); post({ t: "wq", s: flip(key), e: text(reason) }); },
    });
  }

  // ---- what arrives
  function receive(message, blobs) {
    const key = message.p || message.s;
    const value = () => { const transfer = []; return [decode(message.v, blobs, transfer), transfer]; };
    switch (message.t) {
      case "m": { const port = ports.get(key); if (port) { const [v, transfer] = value(); port.postMessage(v, transfer); } break; }
      case "pc": { const port = ports.get(key); if (port) { ports.delete(key); port.close(); } break; }
      // readable, far side asking or giving up
      case "sp": { const source = sources.get(key); if (source) { source.credit++; source.wake?.(); } break; }
      case "sq": { const source = sources.get(key); if (source) { source.over = true; source.wake?.(); sources.delete(key); source.reader.cancel(message.e).catch(() => {}); } break; }
      // readable, chunks arriving here
      case "sc": { const entry = readers.get(key); if (entry) { entry.controller.enqueue(value()[0]); entry.pulled?.(); } break; }
      case "se": { const entry = readers.get(key); if (entry) { readers.delete(key); entry.controller.close(); entry.pulled?.(); } break; }
      case "sx": { const entry = readers.get(key); if (entry) { readers.delete(key); entry.controller.error(new Error(message.e)); entry.pulled?.(); } break; }
      // writable, far side writing into a stream that lives here
      case "wc": case "we": {
        const sink = sinks.get(key); if (!sink) break;
        const chunk = message.t === "wc" ? value()[0] : null;
        sink.chain = sink.chain.then(() => (message.t === "wc" ? sink.writer.write(chunk) : sink.writer.close())).then(
          () => { if (!sink.over) post({ t: "wa", s: flip(key) }); if (message.t === "we") { sink.over = true; sinks.delete(key); } },
          (err) => { if (!sink.over) { sink.over = true; sinks.delete(key); post({ t: "wx", s: flip(key), e: text(err) }); } });
        break;
      }
      case "wq": { const sink = sinks.get(key); if (sink) { sink.over = true; sinks.delete(key); sink.writer.abort(message.e).catch(() => {}); } break; }
      // writable, answers to writes made here
      case "wa": { writers.get(key)?.waiting.shift()?.resolve(); break; }
      case "wx": {
        const entry = writers.get(key); if (!entry) break;
        writers.delete(key);
        const err = new Error(message.e);
        for (const w of entry.waiting) w.reject(err);
        try { entry.controller.error(err); } catch {}
        break;
      }
    }
  }

  // ---- the end of the pipe ends everything that was riding on it
  function shut(err) {
    if (closed) return;
    closed = true;
    const gone = new Error(err ? text(err) : "the connection to the other side closed");
    for (const port of ports.values()) { try { port.close(); } catch {} }
    for (const source of sources.values()) { source.over = true; source.wake?.(); source.reader.cancel(gone).catch(() => {}); }
    for (const entry of readers.values()) { try { entry.controller.error(gone); } catch {} entry.pulled?.(); }
    for (const sink of sinks.values()) { sink.over = true; sink.writer.abort(gone).catch(() => {}); }
    for (const entry of writers.values()) { for (const w of entry.waiting) w.reject(gone); try { entry.controller.error(gone); } catch {} }
    ports.clear(); sources.clear(); readers.clear(); sinks.clear(); writers.clear();
    try { pipe.close(); } catch {}
    onclose(err);
  }

  const { port1, port2 } = new MessageChannel();
  carry(port1, "0");
  return {
    port: port2,
    close: () => shut(),
    get closed() { return closed; },
    // What is riding on the pipe right now, for a page that wants to show it.
    get counts() { return { ports: ports.size - 1, streams: sources.size + readers.size + sinks.size + writers.size, ...stats }; },
  };
}
