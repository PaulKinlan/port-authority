// Unit tests for sites/shared/oneway.js. No browser: Node's MessageChannel stands in.
//   node --test test/oneway.unit.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { oneWay } from "../sites/shared/oneway.js";

const next = (port) => new Promise((resolve) => { port.onmessage = (event) => resolve(event.data); });

test("messages travel forward and never backward", async () => {
  const drops = [];
  const link = oneWay({ onDrop: (dir) => drops.push(dir) });
  try {
    const heardBack = [];
    link.send.onmessage = (e) => heardBack.push(e.data);

    link.send.postMessage({ price: 4.2 });
    assert.deepEqual(await next(link.receive), { price: 4.2 });

    link.receive.postMessage({ reply: "secret" });
    await sleep(20);
    assert.deepEqual(heardBack, []);
    assert.equal(link.counts.passed, 1);
    assert.equal(link.counts.dropped, 1);
    assert.deepEqual(drops, ["back"]);
  } finally {
    link.send.close();
    link.receive.close();
    link.cut();
  }
});

test("ports and shared memory (including inside Error.cause) are refused forward", async () => {
  const refused = [];
  const link = oneWay({ onDrop: (dir, err) => { if (dir === "forward") refused.push(err); } });
  const smuggled = new MessageChannel();
  try {
    const received = [];
    link.receive.onmessage = (e) => received.push(e.data);

    link.send.postMessage({ line: smuggled.port2 }, [smuggled.port2]);

    const sab = new SharedArrayBuffer(4);
    link.send.postMessage(sab);
    link.send.postMessage({ view: new Int32Array(sab) });
    link.send.postMessage(new Error("oops", { cause: sab }));
    link.send.postMessage(new Error("outer", { cause: new Error("nested", { cause: new Uint8Array(sab) }) }));

    link.send.postMessage("clean");
    await sleep(30);

    assert.deepEqual(received, ["clean"]);
    assert.equal(link.counts.refused, 5);
    assert.equal(refused.length, 5);
  } finally {
    smuggled.port1.close();
    link.send.close();
    link.receive.close();
    link.cut();
  }
});
