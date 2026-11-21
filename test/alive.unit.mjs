// Unit tests for alive.js. No browser: Node's MessageChannel stands in.
//   node --test test/alive.unit.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { watch, answer, beat, listen } from "../sites/shared/alive.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const recorder = () => { const seen = []; return { seen, onState: (state, why) => seen.push(state) }; };

test("pings that are answered are alive", async () => {
  const { port1, port2 } = new MessageChannel();
  const far = answer(port2), r = recorder();
  const w = watch(port1, { every: 40, onState: r.onState });
  await sleep(200);
  assert.equal(w.state, "alive");
  w.stop(); far.stop(); port1.close();
});

test("unanswered pings go late, then silent after three, then alive again", async () => {
  const { port1, port2 } = new MessageChannel();
  const r = recorder();
  let answering = false;
  port2.onmessage = ({ data }) => { if (answering) port2.postMessage({ pong: data.ping }); };
  answering = true;
  const w = watch(port1, { every: 40, misses: 3, onState: r.onState });
  await sleep(100);
  answering = false;
  await sleep(250);
  assert.equal(w.state, "silent");
  answering = true;
  await sleep(120);
  assert.equal(w.state, "alive");
  assert.deepEqual(r.seen, ["alive", "late", "silent", "alive"]);
  w.stop(); port1.close();
});

test("a goodbye is final", async () => {
  const { port1, port2 } = new MessageChannel();
  const far = answer(port2), r = recorder();
  const w = watch(port1, { every: 40, onState: r.onState });
  await sleep(80);
  far.bye();
  await sleep(150);
  assert.equal(w.state, "closed");
  port2.postMessage({ pong: 99 });
  await sleep(50);
  assert.equal(w.state, "closed");
  w.stop(); port1.close();
});

test("paused is not silent, until it has gone on too long", async () => {
  const { port1, port2 } = new MessageChannel();
  const r = recorder();
  const w = watch(port1, { every: 30, pausedFor: 300, onState: r.onState });
  port2.postMessage({ paused: "back/forward cache" });
  await sleep(200);
  assert.equal(w.state, "paused");
  await sleep(250);
  assert.equal(w.state, "silent");
  w.stop(); port1.close();
});

test("a hidden far side is allowed hiddenEvery between answers", async () => {
  const { port1, port2 } = new MessageChannel();
  let answering = true;
  port2.onmessage = ({ data }) => { if (answering) port2.postMessage({ pong: data.ping, hidden: true }); };
  const w = watch(port1, { every: 30, misses: 3, hiddenEvery: 200, onState: () => {} });
  await sleep(80);
  answering = false;
  await sleep(200);
  assert.equal(w.state, "alive");     // 6 pings missed, but the far side is hidden
  await sleep(300);
  assert.equal(w.state, "late");
  await sleep(350);
  assert.equal(w.state, "silent");
  w.stop(); port1.close();
});

test("beats heard are alive, and silent when they stop", async () => {
  const { port1, port2 } = new MessageChannel();
  const b = beat(port1, { every: 40 }), r = recorder();
  const l = listen(port2, { onState: r.onState });
  await sleep(150);
  assert.equal(l.state, "alive");
  b.stop();
  await sleep(500);
  assert.equal(l.state, "silent");
  assert.deepEqual(r.seen, ["alive", "late", "silent"]);
  l.stop(); port1.close();
});

test("a beat that says it is hidden gets the longer allowance", async () => {
  const { port1, port2 } = new MessageChannel();
  const l = listen(port2, { hiddenEvery: 1000, onState: () => {} });
  port1.postMessage({ beat: 1, every: 40, hidden: true });
  await sleep(500);
  assert.equal(l.state, "alive");
  l.stop(); port1.close();
});
