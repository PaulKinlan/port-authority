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
function model({ fail = null, pause = 5, pieces = ["Dear Ada, ", "well done ", "on passing."], finish = undefined } = {}) {
  const log = { asks: [], stopped: 0, finished: 0 };
  async function* answer(ask, signal) {
    log.asks.push(ask);
    if (fail) throw Object.assign(new Error(fail.message), { code: fail.code });
    try {
      for (const piece of pieces) {
        await sleep(pause);
        if (signal.aborted) throw signal.reason;
        yield piece;
      }
      return { usage: { tokensIn: 21, tokensOut: 9, ...(finish ? { finish } : {}) } };
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
    [{ messages: hello, tools: [{ type: "web_search" }] }, "tools[0].type", "unsupported"],
    [{ messages: hello, tools: [{ type: "function", function: { name: "f", strict: true } }] }, "tools[0].function.strict", "unsupported"],
    [{ messages: hello, tools: [{ type: "function", function: { name: "not a name!" } }] }, "tools[0].function.name", "invalid"],
    [{ messages: hello, tools: [{ type: "function", function: { name: "f" } }, { type: "function", function: { name: "f" } }] }, "tools[1].function.name", "invalid"],
    [{ messages: hello, tools: [{ type: "function", function: { name: "f", parameters: "string" } }] }, "tools[0].function.parameters", "invalid"],
    [{ messages: hello, tools: "f" }, "tools", "invalid"],
    [{ messages: hello, tool_choice: "auto" }, "tool_choice", "invalid"],
    [{ messages: hello, tools: [{ type: "function", function: { name: "f" } }], tool_choice: { type: "function", function: { name: "g" } } }, "tool_choice", "invalid"],
    [{ messages: hello, tools: [{ type: "function", function: { name: "f" } }], tool_choice: "sometimes" }, "tool_choice", "invalid"],
    [{ messages: hello, tools: [{ type: "function", function: { name: "f" } }], parallel_tool_calls: "yes" }, "parallel_tool_calls", "invalid"],
    [{ messages: hello, functions: [{ name: "f" }] }, "functions", "unsupported"],
    [{ messages: hello, response_format: { type: "json_object" } }, "response_format", "unsupported"],
    [{ messages: hello, n: 2 }, "n", "unsupported"],
    [{ messages: hello, seed: 7 }, "seed", "unsupported"],
    [{ messages: hello, frequency_penalty: 0.5 }, "frequency_penalty", "unsupported"],
    [{ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "http://example.com/a.png" } }] }] }, "messages[0].content[0].image_url.url", "invalid"],
    [{ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:text/html;base64,PHNjcmlwdD4=" } }] }] }, "messages[0].content[0].image_url.url", "invalid"],
    [{ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "javascript:alert(1)" } }] }] }, "messages[0].content[0].image_url.url", "invalid"],
    [{ messages: [{ role: "user", content: [{ type: "image_url", image_url: "https://example.com/a.png" }] }] }, "messages[0].content[0].image_url.url", "invalid"],
    [{ messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: "AAAA", format: "wav" } }] }] }, "messages[0].content[0]", "unsupported"],
    [{ messages: [{ role: "system", content: [{ type: "image_url", image_url: { url: "https://example.com/a.png" } }] }, ...hello] }, "messages[0].content[0]", "unsupported"],
    [{ messages: [...hello, { role: "assistant", content: [{ type: "image_url", image_url: { url: "https://example.com/a.png" } }] }] }, "messages[1].content[0]", "unsupported"],
    [{ messages: [{ role: "user", content: Array.from({ length: 21 }, () => ({ type: "image_url", image_url: { url: "https://example.com/a.png" } })) }] }, "messages[0].content[20]", "invalid"],
    [{ messages: [...hello, { role: "tool", content: "4" }] }, "messages[1].tool_call_id", "invalid"],
    [{ messages: [...hello, { role: "function", name: "f", content: "4" }] }, "messages[1]", "unsupported"],
    [{ messages: [...hello, { role: "assistant", content: null, function_call: { name: "f", arguments: "{}" } }] }, "messages[1]", "unsupported"],
    [{ messages: [{ role: "assistant", content: null, tool_calls: [] }] }, "messages[0].content", "invalid"],
    [{ messages: [...hello, { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: { a: 1 } } }] }] }, "messages[1].tool_calls[0]", "invalid"],
    [{ messages: [...hello, { role: "assistant", content: null, tool_calls: "c1" }] }, "messages[1].tool_calls", "invalid"],
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
    { messages: hello, tools: trap },
    { messages: hello, tools: [{ type: "function", function: trap }] },
    { messages: hello, tools: [{ type: "function", function: { name: "f", parameters: { type: "object", properties: { a: trap } } } }] },
    { messages: hello, tools: [{ type: "function", function: { name: "f", parameters: share(new Sneaky()) } }] },
    { messages: hello, tools: [{ type: "function", function: { name: "f" } }], tool_choice: trap },
    { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: trap } }] }] },
    { messages: [...hello, { role: "assistant", content: null, tool_calls: [trap] }] },
  ]) {
    const answer = await api.chat.completions.create(body);
    assert.equal(answer.error && answer.error.status, 400, Object.keys(body).join());
  }
  assert.equal(called, 0);
  assert.equal(log.asks.length, 0);
});

test("a failure is returned in the API's error shape, with the status that API would use", async () => {
  for (const [code, status, type] of [["no-grant", 401, "authentication_error"], ["limit", 429, "rate_limit_error"], ["storage", 503, "api_error"], ["provider", 502, "api_error"], ["key-refused", 401, "authentication_error"]]) {
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

// ---- tools and images

const weather = { type: "function", function: { name: "get_weather", description: "The weather in a town.", parameters: { type: "object", properties: { town: { type: "string" } }, required: ["town"] } } };
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

test("readRequest: tools, a tool choice, images and the results of tool calls", () => {
  const { ask } = readRequest({
    tools: [weather, { type: "function", function: { name: "now" } }], tool_choice: { type: "function", function: { name: "get_weather" } }, parallel_tool_calls: false,
    messages: [
      { role: "user", content: [{ type: "text", text: "What is this, and what is the weather there?" }, { type: "image_url", image_url: { url: PNG, detail: "low" } }, { type: "image_url", image_url: { url: "https://example.com/a.jpg" } }] },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"town":"Hull"}' } }] },
      { role: "tool", tool_call_id: "call_1", content: [{ type: "text", text: "Rain, " }, { type: "text", text: "9 degrees" }] },
      { role: "assistant", content: "It is raining in Hull." },
    ],
  });
  assert.deepEqual(ask.tools, [{ name: "get_weather", description: "The weather in a town.", parameters: weather.function.parameters }, { name: "now" }]);
  assert.deepEqual(ask.toolChoice, { name: "get_weather" });
  assert.equal(ask.parallel, false);
  assert.deepEqual(ask.messages, [
    { role: "user", content: [{ type: "text", text: "What is this, and what is the weather there?" }, { type: "image", url: PNG }, { type: "image", url: "https://example.com/a.jpg" }] },
    { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "get_weather", arguments: '{"town":"Hull"}' }] },
    { role: "tool", id: "call_1", content: "Rain, 9 degrees" },
    { role: "assistant", content: "It is raining in Hull." },
  ]);
  for (const choice of ["auto", "none", "required"]) assert.equal(readRequest({ messages: hello, tools: [weather], tool_choice: choice }).ask.toolChoice, choice);
  // With no tools there is nothing about tools in what the worker is asked.
  assert.deepEqual(Object.keys(readRequest({ messages: hello }).ask).sort(), ["maxTokens", "messages", "stop", "system", "temperature", "topP"]);
});

test("a tool call comes back as tool_calls on the message, with finish_reason tool_calls", async () => {
  const pieces = [
    "Let me look. ",
    { tool: { index: 0, id: "toolu_1", name: "get_weather", arguments: "" } }, { tool: { index: 0, arguments: '{"town":' } }, { tool: { index: 0, arguments: '"Hull"}' } },
    { tool: { index: 1, id: "toolu_2", name: "now", arguments: "" } },
  ];
  const { api, log } = model({ pieces, finish: "tool_calls" });
  const answer = await api.chat.completions.create({ messages: hello, tools: [weather, { type: "function", function: { name: "now" } }] });
  assert.deepEqual(answer.choices[0], {
    index: 0, logprobs: null, finish_reason: "tool_calls",
    message: { role: "assistant", content: "Let me look. ", refusal: null, tool_calls: [
      { id: "toolu_1", type: "function", function: { name: "get_weather", arguments: '{"town":"Hull"}' } },
      { id: "toolu_2", type: "function", function: { name: "now", arguments: "{}" } },
    ] },
  });
  assert.deepEqual(log.asks[0].tools.map((t) => t.name), ["get_weather", "now"]);

  // With no words before the calls, content is null, as the API has it.
  const quiet = model({ pieces: pieces.slice(1), finish: "tool_calls" });
  const silent = await quiet.api.chat.completions.create({ messages: hello, tools: [weather, { type: "function", function: { name: "now" } }] });
  assert.equal(silent.choices[0].message.content, null);
  assert.equal(silent.choices[0].message.tool_calls.length, 2);
});

test("in a stream, a tool call arrives as its name and then its arguments in pieces", async () => {
  const { api } = model({ pieces: [{ tool: { index: 0, id: "toolu_1", name: "get_weather", arguments: "" } }, { tool: { index: 0, arguments: '{"town":' } }, { tool: { index: 0, arguments: '"Hull"}' } }], finish: "tool_calls" });
  const deltas = [];
  let finish = null;
  for await (const chunk of await api.chat.completions.create({ messages: hello, tools: [weather], stream: true })) { deltas.push(chunk.choices[0].delta); finish = chunk.choices[0].finish_reason || finish; }
  assert.deepEqual(deltas, [
    { role: "assistant", content: "" },
    { tool_calls: [{ index: 0, id: "toolu_1", type: "function", function: { name: "get_weather", arguments: "" } }] },
    { tool_calls: [{ index: 0, function: { arguments: '{"town":' } }] },
    { tool_calls: [{ index: 0, function: { arguments: '"Hull"}' } }] },
    {},
  ]);
  assert.equal(finish, "tool_calls");
  // Put together the way a client does, the arguments are the JSON that was sent.
  assert.deepEqual(JSON.parse(deltas.flatMap((d) => d.tool_calls || []).map((c) => c.function.arguments).join("")), { town: "Hull" });
});

test("finish_reason says when an answer ran out of tokens", async () => {
  const cut = model({ finish: "length" });
  assert.equal((await cut.api.chat.completions.create({ messages: hello })).choices[0].finish_reason, "length");
  const chunks = [];
  for await (const chunk of await model({ finish: "length" }).api.chat.completions.create({ messages: hello, stream: true })) chunks.push(chunk);
  assert.equal(chunks.at(-1).choices[0].finish_reason, "length");
  // A worker that says nothing, or something odd, about why it stopped is taken to have stopped.
  assert.equal((await model({ finish: "exploded" }).api.chat.completions.create({ messages: hello })).choices[0].finish_reason, "stop");
});

test("an odd piece from the worker is left out, not passed on", async () => {
  const { api } = model({ pieces: ["a", { tool: { index: -1, name: "x" } }, { tool: { index: 9999, name: "x" } }, { tool: "x" }, { other: true }, 7, null, "b"] });
  const answer = await api.chat.completions.create({ messages: hello });
  assert.equal(answer.choices[0].message.content, "ab");
  assert.equal(answer.choices[0].message.tool_calls, undefined);
});
