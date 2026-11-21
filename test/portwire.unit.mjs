// Unit tests for portwire.js: a MessagePort over a pipe of bytes.
// No browser. Two bridges are joined by a pipe in memory.
//   node --test test/portwire.unit.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { bridge } from "../sites/shared/portwire.js";

// Two ends of a pipe. Frames arrive later and in order, as on a network.
function pair({ delay = 0 } = {}) {
  const a = { frames: 0 }, b = { frames: 0 };
  const end = (me, other) => Object.assign(me, {
    send(bytes) { me.frames++; const copy = bytes.slice(); return new Promise((resolve) => setTimeout(() => { if (!other.dead) other.onmessage?.(copy); resolve(); }, delay)); },
    close() { if (me.dead) return; me.dead = true; setTimeout(() => { me.onclose?.(); if (!other.dead) { other.dead = true; other.onclose?.(); } }, 0); },
  });
  end(a, b); end(b, a);
  return [a, b];
}
function link(options) {
  const [pa, pb] = pair(options);
  const errors = [];
  const a = bridge(pa, { onerror: (e) => errors.push(e) }), b = bridge(pb, { onerror: (e) => errors.push(e) });
  return { a, b, pa, pb, errors, done() { a.close(); b.close(); a.port.close(); b.port.close(); } };
}
const next = (port) => new Promise((resolve) => { port.onmessage = (event) => resolve(event); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("plain data arrives as it was sent", async () => {
  const l = link();
  const value = { text: "hello", n: 4.5, list: [1, null, true, undefined], nan: NaN, minus: -0, big: 12345678901234567890n, when: new Date(1e12), map: new Map([["k", new Set([1, 2])]]), err: new RangeError("too far") };
  l.a.port.postMessage(value);
  const { data } = await next(l.b.port);
  assert.equal(data.text, "hello"); assert.equal(data.n, 4.5);
  assert.deepEqual(data.list, [1, null, true, undefined]);
  assert.ok(Number.isNaN(data.nan)); assert.ok(Object.is(data.minus, -0));
  assert.equal(data.big, 12345678901234567890n);
  assert.equal(data.when.getTime(), 1e12);
  assert.deepEqual([...data.map.get("k")], [1, 2]);
  assert.equal(data.err.name, "RangeError"); assert.equal(data.err.message, "too far");
  l.done();
});

test("messages keep their order, both ways", async () => {
  const l = link({ delay: 1 });
  const heard = [];
  l.b.port.onmessage = ({ data }) => { heard.push(data); l.b.port.postMessage(data * 2); };
  const back = [];
  l.a.port.onmessage = ({ data }) => back.push(data);
  for (let i = 0; i < 20; i++) l.a.port.postMessage(i);
  while (back.length < 20) await sleep(5);
  assert.deepEqual(heard, [...Array(20).keys()]);
  assert.deepEqual(back, [...Array(20).keys()].map((i) => i * 2));
  l.done();
});

test("bytes cross as bytes, and a large buffer is cut into frames", async () => {
  const l = link();
  const big = new Uint8Array(100000); for (let i = 0; i < big.length; i++) big[i] = i % 251;
  const floats = new Float32Array([1.5, -2.25, 3]);
  l.a.port.postMessage({ big, floats, raw: new Uint8Array([9, 8, 7]).buffer, part: new Uint8Array([0, 1, 2, 3, 4, 5]).subarray(2, 4) });
  const { data } = await next(l.b.port);
  assert.ok(data.big instanceof Uint8Array); assert.equal(data.big.length, 100000);
  assert.ok(data.big.every((v, i) => v === i % 251));
  assert.ok(data.floats instanceof Float32Array); assert.deepEqual([...data.floats], [1.5, -2.25, 3]);
  assert.ok(data.raw instanceof ArrayBuffer); assert.deepEqual([...new Uint8Array(data.raw)], [9, 8, 7]);
  assert.deepEqual([...data.part], [2, 3]);
  assert.ok(l.pa.frames >= 7, "100 kB took " + l.pa.frames + " frames");
  l.done();
});

test("a port sent through the port works on the other side", async () => {
  const l = link();
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = ({ data }) => port1.postMessage("tool heard " + data);
  l.a.port.postMessage({ tool: "counter", port: port2 }, [port2]);
  const { data } = await next(l.b.port);
  assert.equal(data.tool, "counter");
  assert.equal(data.port.constructor.name, "MessagePort");
  data.port.postMessage("add");
  assert.equal((await next(data.port)).data, "tool heard add");
  // Closing the original closes nothing else: the root port still works.
  port1.close();
  l.a.port.postMessage("still here");
  assert.equal((await next(l.b.port)).data, "still here");
  data.port.close(); l.done();
});

test("a port can carry a port that carries a port", async () => {
  const l = link();
  const outer = new MessageChannel(), inner = new MessageChannel();
  l.a.port.postMessage(outer.port2, [outer.port2]);
  const farOuter = (await next(l.b.port)).data;
  outer.port1.postMessage(inner.port2, [inner.port2]);
  const farInner = (await next(farOuter)).data;
  farInner.postMessage("deep");
  assert.equal((await next(inner.port1)).data, "deep");
  // And a port made on the far side comes back the same way.
  const home = new MessageChannel();
  farInner.postMessage(home.port2, [home.port2]);
  const back = (await next(inner.port1)).data;
  back.postMessage("from a"); 
  assert.equal((await next(home.port1)).data, "from a");
  for (const p of [outer.port1, inner.port1, farOuter, farInner, home.port1, back]) p.close();
  l.done();
});

test("a readable stream is read only as fast as the far side reads", async () => {
  const l = link();
  let produced = 0;
  const source = new ReadableStream({ pull(c) { c.enqueue("chunk " + ++produced); if (produced === 50) c.close(); } }, { highWaterMark: 0 });
  l.a.port.postMessage({ feed: source }, [source]);
  const { data } = await next(l.b.port);
  const reader = data.feed.getReader();
  assert.equal((await reader.read()).value, "chunk 1");
  await sleep(60);
  assert.ok(produced <= 4, "nobody is reading, and the source made " + produced);
  const rest = [];
  for (;;) { const { value, done } = await reader.read(); if (done) break; rest.push(value); }
  assert.equal(rest.length, 49); assert.equal(rest.at(-1), "chunk 50");
  l.done();
});

test("cancelling the far reader cancels the source", async () => {
  const l = link();
  let cancelled = null;
  const source = new ReadableStream({ pull(c) { c.enqueue(1); }, cancel(reason) { cancelled = reason; } });
  l.a.port.postMessage(source, [source]);
  const reader = (await next(l.b.port)).data.getReader();
  await reader.read();
  await reader.cancel("seen enough");
  await sleep(30);
  assert.equal(cancelled, "seen enough");
  l.done();
});

test("an error in the source reaches the far reader", async () => {
  const l = link();
  let n = 0;
  const source = new ReadableStream({ pull(c) { if (++n > 2) c.error(new Error("camera unplugged")); else c.enqueue(n); } }, { highWaterMark: 0 });
  l.a.port.postMessage(source, [source]);
  const reader = (await next(l.b.port)).data.getReader();
  await reader.read(); await reader.read();
  await assert.rejects(reader.read(), /camera unplugged/);
  l.done();
});

test("a file's bytes cross as a stream and arrive whole", async () => {
  const l = link();
  const bytes = new Uint8Array(300000); for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) % 256;
  const file = new Blob([bytes]).stream();
  l.a.port.postMessage({ name: "photo.bin", size: bytes.length, body: file }, [file]);
  const { data } = await next(l.b.port);
  const got = new Uint8Array(await new Response(data.body).arrayBuffer());
  assert.equal(got.length, bytes.length);
  assert.ok(got.every((v, i) => v === bytes[i]));
  l.done();
});

test("writes on the far side land in the real stream, in order, and close waits for them", async () => {
  const l = link();
  const landed = [];
  let closedAt = 0;
  const box = new WritableStream({ async write(chunk) { await sleep(20); landed.push(chunk); }, close() { closedAt = landed.length; } });
  l.a.port.postMessage(box, [box]);
  const writer = (await next(l.b.port)).data.getWriter();
  writer.write("note 1"); writer.write("note 2"); writer.write("note 3");
  await writer.close();
  while (!closedAt) await sleep(10);
  assert.deepEqual(landed, ["note 1", "note 2", "note 3"]);
  assert.equal(closedAt, 3);
  l.done();
});

test("a slow real stream slows the far writer", async () => {
  const l = link();
  let landed = 0;
  const box = new WritableStream({ async write() { await sleep(25); landed++; } });
  l.a.port.postMessage(box, [box]);
  const writer = (await next(l.b.port)).data.getWriter();
  let accepted = 0;
  (async () => { try { for (let i = 0; i < 40; i++) { await writer.ready; writer.write(i).catch(() => {}); accepted++; } } catch {} })();
  await sleep(150);
  assert.ok(accepted < 20, `far writer got ${accepted} writes in while only ${landed} had landed`);
  l.done();
});

test("a write refused by the owner is refused on the far side", async () => {
  const l = link();
  let shutIt;
  const box = new WritableStream({ start(c) { shutIt = () => c.error(new Error("the box is shut")); }, write() {} });
  l.a.port.postMessage(box, [box]);
  const writer = (await next(l.b.port)).data.getWriter();
  await writer.write("first");
  shutIt();
  await sleep(30);
  await assert.rejects(writer.write("late"), /the box is shut/);
  l.done();
});

test("a value that cannot cross is reported and nothing is sent", async () => {
  const l = link();
  const loop = {}; loop.me = loop;
  l.a.port.postMessage(loop);
  l.a.port.postMessage("after");
  assert.equal((await next(l.b.port)).data, "after");
  assert.equal(l.errors.length, 1); assert.match(l.errors[0].message, /contains itself/);
  l.done();
});

test("when the pipe closes, the ports and streams riding on it end", async () => {
  const l = link();
  const source = new ReadableStream({ pull(c) { c.enqueue(1); } }, { highWaterMark: 0 });
  let aborted = null;
  const box = new WritableStream({ write() {}, abort(reason) { aborted = reason; } });
  l.a.port.postMessage({ source, box }, [source, box]);
  const { data } = await next(l.b.port);
  const reader = data.source.getReader(); await reader.read();
  const writer = data.box.getWriter(); await writer.write("x");
  assert.deepEqual(l.b.counts.streams, 2);
  l.pa.close();
  await sleep(30);
  assert.ok(l.a.closed && l.b.closed);
  await assert.rejects(reader.read());
  await assert.rejects(writer.write("y"));
  assert.ok(aborted);
  l.done();
});

test("malformed frames and unknown typed-array tags are rejected safely", async () => {
  const errors = [];
  const pipe = { send() {}, close() {}, onmessage: null, onclose: null };
  const b = bridge(pipe, { onerror: (e) => errors.push(e) });
  let received = 0;
  b.port.onmessage = () => received++;

  // Untrusted constructor name in a typed-array tag ("t") must not touch globalThis.
  const head = new TextEncoder().encode(JSON.stringify({ m: { t: "m", p: "0", v: ["t", "Date", 0] }, b: [8] }));
  const badView = new Uint8Array(1 + 4 + head.byteLength + 8);
  badView[0] = 1;
  new DataView(badView.buffer, 1).setUint32(0, head.byteLength);
  badView.set(head, 5);
  pipe.onmessage(badView);

  // Truncated frame with a header length larger than the payload.
  const truncated = new Uint8Array([1, 0, 0, 1, 0, 123, 125]);
  pipe.onmessage(truncated);

  await sleep(10);
  assert.equal(received, 0);
  assert.equal(errors.length, 2);
  assert.match(errors[0].message, /unknown typed array/);
  assert.match(errors[1].message, /truncated header/);
  b.close(); b.port.close();
});
