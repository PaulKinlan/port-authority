// Unit tests for the part of sites/main/chat/db.js that reads a conversation
// from a file somebody chose. The file is not trusted.
//   node --test test/chatdb.unit.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { clean } from "../sites/main/chat/db.js";

test("a conversation from a file keeps its words and gets ids of its own", () => {
  const got = clean({ id: "theirs", title: "Tea", named: true, created: 5, updated: 9, system: "Be brief.", messages: [
    { id: "m1", role: "user", content: "Hello", at: 6 },
    { id: "m2", role: "assistant", content: "Hi", at: 7, model: "claude-sonnet-5-5", stopped: true, usage: { total_tokens: 3 } },
  ] });
  assert.equal(got.title, "Tea");
  assert.equal(got.named, true);
  assert.deepEqual([got.created, got.updated, got.system], [5, 9, "Be brief."]);
  assert.notEqual(got.id, "theirs");
  assert.match(got.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(got.messages.map(({ id, ...rest }) => rest), [
    { role: "user", content: "Hello", at: 6 },
    { role: "assistant", content: "Hi", at: 7, model: "claude-sonnet-5-5", stopped: true },
  ]);
  assert.ok(got.messages.every((m) => m.id !== "m1" && m.id !== "m2"));
});

test("anything that is not a conversation is left out", () => {
  for (const bad of [null, undefined, 7, "text", [], {}, { messages: "no" }, { messages: [] }, { messages: [{ role: "system", content: "x" }] }, { messages: [{ role: "user", content: 7 }] }, { messages: [null, 3, "x"] }]) {
    assert.equal(clean(bad), null, JSON.stringify(bad));
  }
});

test("fields of the wrong kind are replaced, not kept", () => {
  const got = clean({ title: { toString: () => "<b>" }, named: "yes", created: "now", system: ["x"], messages: [
    { role: "user", content: "kept", at: "soon", model: { name: "x" }, stopped: "yes", error: "bad" },
    { role: "tool", content: "dropped" },
    { role: "assistant", content: "", error: { message: "It failed", code: "limit", extra: { deep: true } } },
  ] });
  assert.equal(got.title, "Imported conversation");
  assert.equal(got.named, false);
  assert.equal(got.system, "");
  assert.equal(typeof got.created, "number");
  assert.equal(got.messages.length, 2);
  assert.deepEqual(Object.keys(got.messages[0]).sort(), ["at", "content", "id", "role"]);
  assert.equal(typeof got.messages[0].at, "number");
  assert.deepEqual(got.messages[1].error, { message: "It failed", code: "limit" });
});
