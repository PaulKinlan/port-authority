// Unit tests for sites/router/chat.js: the Chat Completions face of the AI
// router. The calls cross a real MessageChannel with Hawser, as they do
// between a site and the router's worker.
//   node --test test/chat.unit.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { expose, wrap, share } from "../sites/shared/hawser.js";
import { chatApi, readRequest, errorBody } from "../sites/router/chat.js";

const open = new Set();
test.afterEach(() => { for (const p of open) p.close(); open.clear(); });

// A stand-in for the worker: it answers in three pieces, a little apart, and
// records what it was asked and whether it was stopped.
function model({ fail = null, pause = 5 } = {}) {
  const log = { asks: [], stopped: 0, finished: 0 };
  async function* answer(ask, signal) {
    log.asks.push(ask);
    if (fail) throw Object.assign(new Error(fail.message), { code: fail.code });
    try {
      for (const piece of ["Dear Ada, ", "well done ", "on passing."]) {
        await sleep(pause);
        if (signal.aborted) throw signal.reason;
        yield piece;
      }
      return { usage: { tokensIn: 21, tokensOut: 9 } };
    } finally { log.finished++; if (signal.aborted) log.stopped++; }
  }
  const { port1, port2 } = new MessageChannel();
  open.add(port1); open.add(port2);
  expose(chatApi(answer, () => "claude-sonnet-5-5"), port2, { only: ["chat.completions.create"] });
  return { api: wrap(port1), log };
}
const hello = [{ role: "user", content: "Write a card for Ada" }];

test("a request gets a chat.completion object back", async () => {
  const { api, log } = model();
  const answer = await api.chat.completions.create({ model: "gpt-anything", messages: hello });
  assert.equal(answer.object, "chat.completion");
  assert.match(answer.id, /^chatcmpl-[0-9a-f]{24}$/);
  assert.ok(Math.abs(answer.created - Date.now() / 1000) < 5);
  // The person chose the model, so the answer names that one and not the one the site asked for.
  assert.equal(answer.model, "claude-sonnet-5-5");
  assert.deepEqual(answer.choices, [{ index: 0, message: { role: "assistant", content: "Dear Ada, well done on passing.", refusal: null }, logprobs: null, finish_reason: "stop" }]);
  assert.deepEqual(answer.usage, { prompt_tokens: 21, completion_tokens: 9, total_tokens: 30 });
  assert.deepEqual(log.asks[0].messages, hello);
});

test("with stream: true the answer arrives as chat.completion.chunk objects", async () => {
  const { api } = model();
  const chunks = [];
  for await (const chunk of await api.chat.completions.create({ messages: hello, stream: true })) chunks.push(chunk);
  assert.equal(chunks.length, 5);
  assert.ok(chunks.every((c) => c.object === "chat.completion.chunk" && c.id === chunks[0].id && c.model === "claude-sonnet-5-5" && !("usage" in c)));
  assert.deepEqual(chunks[0].choices[0], { index: 0, delta: { role: "assistant", content: "" }, logprobs: null, finish_reason: null });
  assert.equal(chunks.slice(1, 4).map((c) => c.choices[0].delta.content).join(""), "Dear Ada, well done on passing.");
  assert.deepEqual(chunks[4].choices[0], { index: 0, delta: {}, logprobs: null, finish_reason: "stop" });
});

test("stream_options.include_usage adds a last chunk with the usage and no choices", async () => {
  const { api } = model();
  const chunks = [];
  for await (const chunk of await api.chat.completions.create({ messages: hello, stream: true, stream_options: { include_usage: true } })) chunks.push(chunk);
  assert.equal(chunks.length, 6);
  assert.ok(chunks.slice(0, 5).every((c) => c.usage === null));
  assert.deepEqual(chunks[5].choices, []);
  assert.deepEqual(chunks[5].usage, { prompt_tokens: 21, completion_tokens: 9, total_tokens: 30 });
});

test("system and developer messages, text parts and the settings are passed on", async () => {
  const { api, log } = model();
  await api.chat.completions.create({
    messages: [
      { role: "system", content: "You write cards." }, { role: "developer", content: [{ type: "text", text: "Keep it short." }] },
      { role: "user", content: [{ type: "text", text: "For " }, { type: "text", text: "Ada" }] }, { role: "assistant", content: "Dear Ada," }, { role: "user", content: "Go on" },
    ],
    max_completion_tokens: 200, max_tokens: 50, temperature: 0.2, top_p: 0.9, stop: "END", user: "someone", n: 1, response_format: { type: "text" },
  });
  assert.deepEqual(log.asks[0], {
    system: "You write cards.\n\nKeep it short.",
    messages: [{ role: "user", content: "For Ada" }, { role: "assistant", content: "Dear Ada," }, { role: "user", content: "Go on" }],
    maxTokens: 200, temperature: 0.2, topP: 0.9, stop: ["END"],
  });
});

test("a request the router cannot honour is refused by name, and the model is not asked", async () => {
  const { api, log } = model();
  const refused = async (body) => (await api.chat.completions.create(body)).error;
  for (const [body, param, code] of [
    [{ messages: hello, tools: [{ type: "function", function: { name: "f" } }] }, "tools", "unsupported"],
    [{ messages: hello, response_format: { type: "json_object" } }, "response_format", "unsupported"],
    [{ messages: hello, n: 2 }, "n", "unsupported"],
    [{ messages: hello, seed: 7 }, "seed", "unsupported"],
    [{ messages: hello, frequency_penalty: 0.5 }, "frequency_penalty", "unsupported"],
    [{ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.com/a.png" } }] }] }, "messages[0].content[0]", "unsupported"],
    [{ messages: [...hello, { role: "tool", tool_call_id: "1", content: "4" }] }, "messages[1]", "unsupported"],
    [{ messages: [{ role: "assistant", content: null, tool_calls: [] }] }, "messages[0]", "unsupported"],
    [{ messages: [] }, "messages", "invalid"],
    [{}, "messages", "invalid"],
    [{ messages: [{ role: "system", content: "Only a system message" }] }, "messages", "invalid"],
    [{ messages: [{ role: "robot", content: "hi" }] }, "messages[0].role", "invalid"],
    [{ messages: [{ role: "user", content: 7 }] }, "messages[0].content", "invalid"],
    [{ messages: hello, temperature: 3 }, "temperature", "invalid"],
    [{ messages: hello, temperature: "hot" }, "temperature", "invalid"],
    [{ messages: hello, max_tokens: 0 }, "max_tokens", "invalid"],
    [{ messages: hello, max_completion_tokens: 8192 }, "max_completion_tokens", "invalid"],
    [{ messages: hello, stop: ["a", "b", "c", "d", "e"] }, "stop", "invalid"],
    [{ messages: hello, stream: "yes" }, "stream", "invalid"],
  ]) {
    const error = await refused(body);
    assert.ok(error, JSON.stringify(body));
    assert.deepEqual({ param: error.param, code: error.code, status: error.status, type: error.type }, { param, code, status: 400, type: "invalid_request_error" }, JSON.stringify(body));
    assert.equal(typeof error.message, "string");
  }
  assert.equal((await refused("hello")).code, "invalid");
  assert.equal((await refused(null)).code, "invalid");
  assert.equal(log.asks.length, 0);
});

test("a function or an object sent by reference is never called, only refused", async () => {
  const { api, log } = model();
  let called = 0;
  const trap = () => { called++; return "user"; };
  class Sneaky { get role() { called++; return "user"; } get content() { called++; return "hi"; } }
  for (const body of [
    { messages: trap },
    { messages: [share(new Sneaky())] },
    { messages: [{ role: trap, content: "hi" }] },
    { messages: [{ role: "user", content: trap }] },
    { messages: hello, temperature: trap },
    { messages: hello, stream: trap },
    { messages: hello, response_format: trap },
  ]) {
    const answer = await api.chat.completions.create(body);
    assert.equal(answer.error && answer.error.status, 400, Object.keys(body).join());
  }
  assert.equal(called, 0);
  assert.equal(log.asks.length, 0);
});

test("a failure is returned in the API's error shape, with the status that API would use", async () => {
  for (const [code, status, type] of [["no-grant", 401, "authentication_error"], ["limit", 429, "rate_limit_error"], ["offline", 503, "api_error"], ["provider", 502, "api_error"], ["key-refused", 401, "authentication_error"]]) {
    const { api } = model({ fail: { code, message: "No: " + code } });
    assert.deepEqual(await api.chat.completions.create({ messages: hello }), { error: { message: "No: " + code, type, param: null, code, status } });
    // In a stream, the refusal is the only thing sent.
    const chunks = [];
    for await (const chunk of await api.chat.completions.create({ messages: hello, stream: true })) chunks.push(chunk);
    assert.deepEqual(chunks, [{ error: { message: "No: " + code, type, param: null, code, status } }]);
  }
  assert.equal(errorBody(new Error("odd")).error.code, "provider");
});

test("an AbortSignal stops the answer and the work behind it", async () => {
  const { api, log } = model({ pause: 30 });
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 45);
  // Hawser rejects a call whose signal aborts, and tells the other side to stop.
  await assert.rejects(async () => await api.chat.completions.create({ messages: hello }, { signal: stop.signal }), { name: "AbortError" });
  for (let i = 0; i < 50 && !log.finished; i++) await sleep(10);
  assert.deepEqual([log.finished, log.stopped], [1, 1]);

  const second = model({ pause: 30 });
  const halt = new AbortController();
  const chunks = [];
  for await (const chunk of await second.api.chat.completions.create({ messages: hello, stream: true }, { signal: halt.signal })) {
    chunks.push(chunk);
    if (chunks.length === 2) halt.abort();
  }
  assert.equal(chunks.at(-1).error.code, "cancelled");
  assert.deepEqual([second.log.finished, second.log.stopped], [1, 1]);
});

test("a caller that stops reading a stream stops the work behind it", async () => {
  const { api, log } = model({ pause: 20 });
  let read = 0;
  for await (const chunk of await api.chat.completions.create({ messages: hello, stream: true })) {
    assert.equal(chunk.object, "chat.completion.chunk");
    if (++read === 2) break;
  }
  for (let i = 0; i < 50 && !log.finished; i++) await sleep(10);
  assert.deepEqual([log.finished, log.stopped], [1, 1]);
});

test("the port reaches chat.completions.create and nothing else", async () => {
  const { port1, port2 } = new MessageChannel();
  open.add(port1); open.add(port2);
  const target = { ...chatApi(async function* () { yield "x"; return {}; }, () => "m"), secret: "the key", grant: () => "the grant" };
  expose(target, port2, { only: ["chat.completions.create"] });
  const api = wrap(port1);
  await assert.rejects(async () => await api.secret);
  await assert.rejects(async () => await api.grant());
  await assert.rejects(async () => await api.chat.completions.create.constructor("return 1")());
  assert.equal((await api.chat.completions.create({ messages: hello })).choices[0].message.content, "x");
});

test("readRequest: what is left out stays left out", () => {
  const request = readRequest({ messages: hello });
  assert.deepEqual(request, { stream: false, includeUsage: false, ask: { system: "", messages: hello, maxTokens: undefined, temperature: undefined, topP: undefined, stop: undefined } });
  assert.equal(readRequest({ messages: hello, max_tokens: 50 }).ask.maxTokens, 50);
  assert.deepEqual(readRequest({ messages: hello, stop: ["a", "b"], temperature: null, tools: null }).ask.stop, ["a", "b"]);
});
