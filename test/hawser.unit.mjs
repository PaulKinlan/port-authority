// Unit tests for sites/shared/hawser.js. Node's MessageChannel behaves like the
// browser's for everything here, so these run without a browser:
//   node --expose-gc --test test/hawser.unit.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { expose, wrap, connect, share, give, transfer, port, closed, isRemote, LinkClosedError } from "../sites/shared/hawser.js";

const open = new Set();
// A pair of ports that counts what crosses it.
function pair() {
  const { port1, port2 } = new MessageChannel();
  open.add(port1); open.add(port2);
  const count = { toServer: 0, toClient: 0 };
  const send1 = port1.postMessage.bind(port1), send2 = port2.postMessage.bind(port2);
  port1.postMessage = (...a) => { count.toServer++; return send1(...a); };
  port2.postMessage = (...a) => { count.toClient++; return send2(...a); };
  return { client: port1, server: port2, count };
}
function link(target, exposeOptions, wrapOptions) {
  const p = pair();
  const handle = expose(target, p.server, exposeOptions);
  const api = wrap(p.client, wrapOptions);
  return { api, handle, ...p };
}
test.afterEach(() => { for (const p of open) p.close(); open.clear(); });
const collect = async (until) => { for (let i = 0; i < 50 && !until(); i++) { globalThis.gc(); await sleep(20); } return until(); };

test("calls, nested paths and property reads", async () => {
  const { api } = link({ add: (a, b) => a + b, math: { double: (n) => n * 2, pi: 3.14 }, async later(v) { await sleep(5); return v; } });
  assert.equal(await api.add(2, 3), 5);
  assert.equal(await api.math.double(4), 8);
  assert.equal(await api.math.pi, 3.14);
  assert.equal(await api.later("x"), "x");
  assert.equal(isRemote(api), true);
});

test("methods keep their `this`", async () => {
  class Counter { #n = 0; add(by = 1) { return (this.#n += by); } get value() { return this.#n; } }
  const { api } = link(new Counter());
  await api.add(2);
  assert.equal(await api.add(3), 5);
  assert.equal(await api.value, 5);
});

test("the root proxy is not a promise", async () => {
  const { api } = link({ a: 1 });
  assert.equal(await Promise.resolve(api), api);
});

test("errors keep their class, name, message and cause", async () => {
  class QuotaError extends Error { name = "QuotaError"; }
  const { api } = link({
    range() { throw new RangeError("too big", { cause: new Error("root cause") }); },
    custom() { throw new QuotaError("no room"); },
    async value() { throw { code: 7 }; },
  });
  const range = await api.range().catch((e) => e);
  assert.ok(range instanceof RangeError);
  assert.equal(range.message, "too big");
  assert.equal(range.cause.message, "root cause");
  const custom = await api.custom().catch((e) => e);
  assert.ok(custom instanceof Error);
  assert.equal(custom.name, "QuotaError");
  assert.deepEqual(await api.value().catch((e) => e), { code: 7 });
});

test("functions cross without being marked, in both directions", async () => {
  const { api } = link({
    each(items, fn) { return Promise.all(items.map((item) => fn(item))); },
    adder: (n) => (m) => n + m,
    nested: (options) => options.on.done("ok"),
  });
  assert.deepEqual(await api.each([1, 2, 3], (n) => n * 10), [10, 20, 30]);
  const add5 = await api.adder(5);
  assert.equal(await add5(1), 6);
  assert.equal(await api.nested({ on: { done: (v) => v + "!" } }), "ok!");
});

test("a remote object sent back home is the original object", async () => {
  const token = share({ secret: 1 });
  const { api } = link({ get: () => token, same: (t) => t === token, viaPath: (fn) => fn === target.helper, helper() {} });
  const target = { helper() {} };
  const remote = await api.get();
  assert.equal(await api.same(remote), true);
  assert.equal(await api.get(), remote, "the same remote object gives the same proxy");
});

test("class instances are passed by reference, plain data by value", async () => {
  class Doc { constructor(t) { this.title = t; } rename(t) { this.title = t; return this; } }
  const doc = new Doc("a");
  const { api } = link({ doc: () => doc, data: () => ({ when: new Date(0), list: [1, new Map([[1, 2]])] }) });
  const remote = await api.doc();
  assert.equal(isRemote(remote), true);
  await remote.rename("b");
  assert.equal(doc.title, "b");
  const data = await api.data();
  assert.equal(isRemote(data), false);
  assert.ok(data.when instanceof Date && data.list[1] instanceof Map);
});

test("construct a remote class, and dispose of it with Symbol.dispose", async () => {
  let disposed = 0;
  class Session { constructor(user) { this.user = user; } who() { return this.user; } [Symbol.dispose]() { disposed++; } }
  const { api } = link({ Session });
  const session = await new api.Session("ada");
  assert.equal(await session.who(), "ada");
  session[Symbol.dispose]();
  await sleep(20);
  assert.equal(disposed, 1);
  await assert.rejects(async () => await session.who(), /released/);
});

test("shared objects are not disposed when a caller lets go, given ones are", async () => {
  let shared = 0, handed = 0;
  const a = share({ [Symbol.dispose]() { shared++; } });
  const b = give({ [Symbol.dispose]() { handed++; } });
  const { api } = link({ a: () => a, b: () => b });
  (await api.a())[Symbol.dispose]();
  (await api.b())[Symbol.dispose]();
  await sleep(20);
  assert.deepEqual([shared, handed], [0, 1]);
});

test("a dropped proxy is released by the garbage collector", async () => {
  let disposed = 0;
  class Thing { [Symbol.dispose]() { disposed++; } ping() { return 1; } }
  const { api } = link({ Thing });
  await (async () => { const thing = await new api.Thing(); await thing.ping(); })();
  assert.equal(await collect(() => disposed === 1), true);
});

test("chained calls travel as one message", async () => {
  const profile = share({ name: () => "Ada", friends: () => [share({ name: () => "Grace" })] });
  const { api, count } = link({ login: async (user) => { await sleep(5); return share({ user, profile }); } });
  await api.login("x"); await sleep(10);
  count.toServer = count.toClient = 0;
  assert.equal(await api.login("ada").profile.name(), "Ada");
  await sleep(10);
  assert.equal(count.toServer, 1);
  assert.equal(await api.login("ada").user, "ada");
});

test("a chain used after its tick still works, by waiting", async () => {
  const { api } = link({ make: () => share({ value: () => 42, deep: { n: 1 } }) });
  const made = api.make();
  await sleep(10);
  assert.equal(await made.value(), 42);
  assert.equal(await made.deep.n, 1);
});

test("a chain fails with the error of the call it hangs from", async () => {
  const { api } = link({ login() { throw new Error("bad password"); } });
  await assert.rejects(async () => await api.login().profile.name(), /bad password/);
});

test("an AbortSignal argument arrives as a signal and aborts remotely", async () => {
  let seen;
  const { api } = link({
    work(signal) { return new Promise((_, reject) => signal.addEventListener("abort", () => { seen = signal.reason; reject(signal.reason); })); },
    already: (signal) => signal.aborted,
  });
  const controller = new AbortController();
  const call = api.work(controller.signal);
  await sleep(10);
  controller.abort(new Error("stop now"));
  await assert.rejects(async () => await call, /stop now/);
  await sleep(10);
  assert.equal(seen.message, "stop now");
  assert.equal(await api.already({ nested: [AbortSignal.abort()] }.nested[0]).catch(() => "rejected locally"), "rejected locally");
});

test("timeouts", async () => {
  const { api } = link({ never: () => new Promise(() => {}) }, {}, { timeout: 30 });
  const error = await api.never().catch((e) => e);
  assert.equal(error.name, "TimeoutError");
});

test("pending calls reject when the other side closes its port", async () => {
  const { api, server } = link({ never: () => new Promise(() => {}) });
  const call = api.never();
  await sleep(10);
  server.close();
  await assert.rejects(async () => await call, LinkClosedError);
  await assert.rejects(async () => await api.never(), LinkClosedError);
  assert.ok((await closed(api)) instanceof LinkClosedError);
});

test("work in flight is told to stop when the caller goes away", async () => {
  let reason;
  const { api, client } = link({ work(signal) { signal.addEventListener("abort", () => (reason = signal.reason)); return new Promise(() => {}); } });
  api.work(new AbortController().signal).catch(() => {});
  await sleep(10);
  client.close();
  await sleep(20);
  assert.ok(reason instanceof LinkClosedError);
});

test("a heartbeat notices a side that has gone quiet", async () => {
  const p = pair();
  // Nothing is listening on the server port, as if the page had frozen.
  const api = wrap(p.client, { heartbeat: 20 });
  await assert.rejects(async () => await api.anything(), /stopped answering/);
});

test("async generators are iterated remotely, with backpressure and cleanup", async () => {
  let produced = 0, cleaned = false;
  const { api } = link({ async *ticks() { try { for (;;) yield ++produced; } finally { cleaned = true; } } });
  const got = [];
  for await (const tick of api.ticks()) { got.push(tick); if (tick === 3) break; }
  await sleep(20);
  assert.deepEqual(got, [1, 2, 3]);
  assert.equal(produced, 3, "nothing was produced that was not asked for");
  assert.equal(cleaned, true, "break ran the generator's finally block");
});

test("an abandoned iterator is cleaned up by the collector", async () => {
  let cleaned = false;
  const { api } = link({ async *ticks() { try { for (;;) yield 1; } finally { cleaned = true; } } });
  await (async () => { const it = (await api.ticks())[Symbol.asyncIterator](); await it.next(); })();
  assert.equal(await collect(() => cleaned), true);
});

test("streams and buffers move", async () => {
  const { api } = link({
    size: (buffer) => buffer.byteLength,
    stream: () => new ReadableStream({ start(c) { c.enqueue("a"); c.enqueue("b"); c.close(); } }),
  });
  const copy = new ArrayBuffer(8), moved = new ArrayBuffer(8);
  assert.equal(await api.size(copy), 8);
  assert.equal(copy.byteLength, 8, "copied by default");
  assert.equal(await api.size(transfer(moved)), 8);
  assert.equal(moved.byteLength, 0, "moved when asked");
  const chunks = [];
  for await (const chunk of await api.stream()) chunks.push(chunk);
  assert.deepEqual(chunks, ["a", "b"]);
});

test("the prototype cannot be reached", async () => {
  const { api } = link({ fn() { return 1; }, data: { a: 1 } });
  for (const attempt of [
    () => api.constructor("return process")(),
    () => api.fn.constructor("return 1")(),
    () => api.fn.call(null),
    () => api.fn.bind(null),
    () => api.__proto__.polluted,
    () => api.data.toString(),
    () => api.data.hasOwnProperty("a"),
  ]) await assert.rejects(async () => await attempt(), TypeError);
});

test("`only` limits what can be reached", async () => {
  const { api } = link({ read: () => 1, write: () => 2, admin: { wipe: () => 3, stats: { hits: () => 4 } } }, { only: ["read", "admin.stats"] });
  assert.equal(await api.read(), 1);
  assert.equal(await api.admin.stats.hits(), 4);
  const denied = await api.write().catch((e) => e);
  assert.equal(denied.name, "NotAllowedError");
  await assert.rejects(async () => await api.admin.wipe(), /not available/);
  await assert.rejects(async () => await api.admin, /not available/);
});

test("`only` cannot be bypassed by passing a forbidden path back as an argument", async () => {
  const { api } = link({ echo: (v) => v, secret: "top-secret", secretFn: () => "leaked" }, { only: ["echo"] });
  const propErr = await api.echo(api.secret).catch((e) => e);
  assert.equal(propErr.name, "NotAllowedError");
  const fnErr = await api.echo(api.secretFn).catch((e) => e);
  assert.equal(fnErr.name, "NotAllowedError");
});

test("cyclic plain objects and arrays cross without overflowing the stack", async () => {
  const { api } = link({ echo: (v) => v });
  const obj = { name: "loop" }; obj.self = obj;
  const echoed = await api.echo(obj);
  assert.equal(echoed.name, "loop");
  assert.equal(echoed.self, echoed);
  const arr = [1]; arr.push(arr);
  const echoedArr = await api.echo(arr);
  assert.equal(echoedArr[0], 1);
  assert.equal(echoedArr[1], echoedArr);
});

test("port() mints a narrowed port for a third party, and a signal revokes it", async () => {
  let n = 0;
  const { api } = link({ counter: { read: () => n, add: () => ++n } });
  const revoke = new AbortController();
  const minted = await port(api.counter, { only: ["read"], signal: revoke.signal });
  open.add(minted);
  const guest = wrap(minted);
  await api.counter.add();
  assert.equal(await guest.read(), 1);
  await assert.rejects(async () => await guest.add(), /not available/);
  // The guest cannot widen what it was given.
  const again = await port(guest); open.add(again);
  await assert.rejects(async () => await wrap(again).add(), /not available/);
  revoke.abort();
  await assert.rejects(async () => await guest.read(), LinkClosedError);
  assert.equal(await api.counter.read(), 1, "the original link is untouched");
});

test("revoke() closes a link and every port minted through it", async () => {
  const { api, handle } = link({ a: { b: () => 1 } });
  const minted = await port(api.a); open.add(minted);
  const guest = wrap(minted);
  assert.equal(await guest.b(), 1);
  handle.revoke();
  await assert.rejects(async () => await guest.b(), LinkClosedError);
  await assert.rejects(async () => await api.a.b(), LinkClosedError);
});

test("connect() gives both sides an object", async () => {
  const p = pair();
  const left = connect({ name: () => "left", ask: () => left.remote.name() }, p.client);
  const right = connect({ name: () => "right" }, p.server);
  assert.equal(await left.remote.name(), "right");
  assert.equal(await right.remote.ask(), "right");
});

test("a remote object can be passed on through a middle link", async () => {
  const origin = link({ greet: (name) => "hello " + name, child: { n: () => 7 } });
  const middle = link({ get: () => origin.api });
  const far = await middle.api.get();
  assert.equal(await far.greet("you"), "hello you");
  assert.equal(await far.child.n(), 7);
});

test("one argument that cannot be cloned fails only its own call", async () => {
  const { api } = link({ echo: (v) => v, len: (v) => v.length });
  const [good, bad, chained] = await Promise.allSettled([api.echo(1), api.echo(Symbol("no")), api.echo(Symbol("no")).length]);
  assert.equal(good.value, 1);
  assert.equal(bad.status, "rejected");
  assert.equal(chained.status, "rejected");
});

test("data that happens to look like the wire format is left alone", async () => {
  const { api } = link({ echo: (v) => v });
  assert.deepEqual(await api.echo({ "@hawser": "ref", id: 0 }), { "@hawser": "ref", id: 0 });
});

test("disposing the root proxy closes the link for both sides", async () => {
  const { api, handle } = link({ a: () => 1 });
  await api.a();
  api[Symbol.dispose]();
  assert.ok((await handle.closed) instanceof LinkClosedError);
});

test("a link can be closed and another opened on the same endpoint", async () => {
  // A Worker is not a port: it outlives any one link. Stand in for it with a
  // pair of ports that are never closed by the library.
  const { port1, port2 } = new MessageChannel();
  open.add(port1); open.add(port2);
  const plain = (p) => ({ postMessage: (m, t) => p.postMessage(m, t), addEventListener: (...a) => p.addEventListener(...a), removeEventListener: (...a) => p.removeEventListener(...a), start: () => p.start() });
  let served = 0;
  const serve = () => { served++; expose({ n: () => served }, plain(port2), { onclose: serve }); };
  serve();
  const first = wrap(plain(port1));
  assert.equal(await first.n(), 1);
  first[Symbol.dispose]();
  const second = wrap(plain(port1));
  assert.equal(await second.n(), 2);
  await sleep(20);
  assert.equal(await second.n(), 2, "the goodbye was not echoed into the new link");
});
