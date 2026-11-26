// Unit tests for generate() in sites/router/providers.js: what the router sends
// to each kind of provider, and what it makes of the stream that comes back.
// There is no network here. fetch is replaced with a stand-in that records the
// request and answers with a stream the test wrote.
//   node --test test/providers.unit.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { generate, endpointOf } from "../sites/router/providers.js";

let sent = null;
let reply = [];
globalThis.fetch = async (url, init) => {
  sent = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
  const text = reply.map((event) => (event.type ? `event: ${event.type}\n` : "") + `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
};
async function run(provider, ask, events = []) {
  reply = events;
  const pieces = [];
  const stream = generate({ provider, key: "sk-test", model: "the-model" }, ask);
  for (;;) {
    const { value, done } = await stream.next();
    if (done) return { pieces, result: value, body: sent.body, url: sent.url, headers: sent.headers };
    pieces.push(value);
  }
}

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const weather = { name: "get_weather", description: "The weather in a town.", parameters: { type: "object", properties: { town: { type: "string" } }, required: ["town"] } };
const talk = [
  { role: "user", content: [{ type: "text", text: "What is this?" }, { type: "image", url: PNG }, { type: "image", url: "https://example.com/a.jpg" }] },
  { role: "assistant", content: "Let me look.", toolCalls: [{ id: "c1", name: "get_weather", arguments: '{"town":"Hull"}' }, { id: "c2", name: "get_weather", arguments: '{"town":"York"}' }] },
  { role: "tool", id: "c1", content: "Rain" },
  { role: "tool", id: "c2", content: "Sun" },
  { role: "user", content: "Thanks" },
];

test("plain text goes to each provider as it always did", async () => {
  const ask = { system: "Be brief.", messages: [{ role: "user", content: "Hello" }, { role: "assistant", content: "Hi" }, { role: "user", content: "Again" }], maxTokens: 50 };
  const a = await run("anthropic", ask);
  assert.equal(a.url, "https://api.anthropic.com/v1/messages");
  assert.equal(a.url, endpointOf("anthropic"));
  assert.deepEqual(a.body, { model: "the-model", max_tokens: 50, stream: true, system: "Be brief.", messages: [{ role: "user", content: "Hello" }, { role: "assistant", content: "Hi" }, { role: "user", content: "Again" }] });
  assert.equal(a.headers["x-api-key"], "sk-test");
  const o = await run("openai", ask);
  assert.equal(o.url, "https://api.openai.com/v1/chat/completions");
  assert.deepEqual(o.body, { model: "the-model", stream: true, stream_options: { include_usage: true }, max_completion_tokens: 50, messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "Hello" }, { role: "assistant", content: "Hi" }, { role: "user", content: "Again" }] });
  assert.equal(o.headers.authorization, "Bearer sk-test");
  assert.equal((await run("gemini", ask)).body.max_tokens, 50);
  assert.equal((await run("ollama", ask)).url, "http://localhost:11434/v1/chat/completions");
});

test("Anthropic: images, tool calls and their results become blocks", async () => {
  const { body } = await run("anthropic", { messages: talk, tools: [weather, { name: "now" }] });
  assert.deepEqual(body.messages, [
    { role: "user", content: [
      { type: "text", text: "What is this?" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
      { type: "image", source: { type: "url", url: "https://example.com/a.jpg" } },
    ] },
    { role: "assistant", content: [
      { type: "text", text: "Let me look." },
      { type: "tool_use", id: "c1", name: "get_weather", input: { town: "Hull" } },
      { type: "tool_use", id: "c2", name: "get_weather", input: { town: "York" } },
    ] },
    // Both results, and the words after them, are one message from the user: Anthropic wants the results together.
    { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "Rain" }, { type: "tool_result", tool_use_id: "c2", content: "Sun" }, { type: "text", text: "Thanks" }] },
  ]);
  assert.deepEqual(body.tools, [
    { name: "get_weather", description: "The weather in a town.", input_schema: weather.parameters },
    { name: "now", input_schema: { type: "object", properties: {} } },
  ]);
  assert.equal(body.tool_choice, undefined);
});

test("Anthropic: how a tool is to be chosen", async () => {
  const choice = async (toolChoice, parallel) => (await run("anthropic", { messages: [{ role: "user", content: "x" }], tools: [weather], toolChoice, parallel })).body.tool_choice;
  assert.deepEqual(await choice("auto"), { type: "auto" });
  assert.deepEqual(await choice("required"), { type: "any" });
  assert.deepEqual(await choice("none"), { type: "none" });
  assert.deepEqual(await choice({ name: "get_weather" }), { type: "tool", name: "get_weather" });
  assert.deepEqual(await choice(undefined, false), { type: "auto", disable_parallel_tool_use: true });
  assert.deepEqual(await choice("required", false), { type: "any", disable_parallel_tool_use: true });
  assert.deepEqual(await choice("none", false), { type: "none" });
  // With no tools, nothing about tools is sent.
  const bare = (await run("anthropic", { messages: [{ role: "user", content: "x" }], toolChoice: "required", parallel: false })).body;
  assert.ok(!("tools" in bare) && !("tool_choice" in bare));
  // Arguments that are not JSON are sent as an empty object, not as broken JSON.
  const odd = await run("anthropic", { messages: [{ role: "user", content: "x" }, { role: "assistant", content: "", toolCalls: [{ id: "c", name: "now", arguments: "not json" }] }, { role: "tool", id: "c", content: "y" }], tools: [{ name: "now" }] });
  assert.deepEqual(odd.body.messages[1], { role: "assistant", content: [{ type: "tool_use", id: "c", name: "now", input: {} }] });
});

test("Anthropic: a tool call in the answer, as it streams", async () => {
  const { pieces, result } = await run("anthropic", { messages: [{ role: "user", content: "x" }], tools: [weather] }, [
    { type: "message_start", message: { usage: { input_tokens: 30 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Looking. " } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "get_weather", input: {} } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"town":' } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"Hull"}' } },
    { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_2", name: "get_weather", input: {} } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"town":"York"}' } },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 12 } },
    { type: "message_stop" },
  ]);
  assert.deepEqual(pieces, [
    "Looking. ",
    { tool: { index: 0, id: "toolu_1", name: "get_weather", arguments: "" } }, { tool: { index: 0, arguments: '{"town":' } }, { tool: { index: 0, arguments: '"Hull"}' } },
    { tool: { index: 1, id: "toolu_2", name: "get_weather", arguments: "" } }, { tool: { index: 1, arguments: '{"town":"York"}' } },
  ]);
  assert.deepEqual(result, { tokensIn: 30, tokensOut: 12, finish: "tool_calls" });
  const cut = await run("anthropic", { messages: [{ role: "user", content: "x" }] }, [{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Half an" } }, { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 2 } }]);
  assert.equal(cut.result.finish, "length");
  const whole = await run("anthropic", { messages: [{ role: "user", content: "x" }] }, [{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done." } }, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } }]);
  assert.equal(whole.result.finish, "stop");
});

test("Chat Completions providers: images, tools and results in that API's own shapes", async () => {
  const { body } = await run("openai", { system: "Be brief.", messages: talk, tools: [weather, { name: "now" }], toolChoice: { name: "now" }, parallel: false });
  assert.deepEqual(body.messages, [
    { role: "system", content: "Be brief." },
    { role: "user", content: [{ type: "text", text: "What is this?" }, { type: "image_url", image_url: { url: PNG } }, { type: "image_url", image_url: { url: "https://example.com/a.jpg" } }] },
    { role: "assistant", content: "Let me look.", tool_calls: [{ id: "c1", type: "function", function: { name: "get_weather", arguments: '{"town":"Hull"}' } }, { id: "c2", type: "function", function: { name: "get_weather", arguments: '{"town":"York"}' } }] },
    { role: "tool", tool_call_id: "c1", content: "Rain" },
    { role: "tool", tool_call_id: "c2", content: "Sun" },
    { role: "user", content: "Thanks" },
  ]);
  assert.deepEqual(body.tools, [
    { type: "function", function: { name: "get_weather", description: "The weather in a town.", parameters: weather.parameters } },
    { type: "function", function: { name: "now", parameters: { type: "object", properties: {} } } },
  ]);
  assert.deepEqual(body.tool_choice, { type: "function", function: { name: "now" } });
  assert.equal(body.parallel_tool_calls, false);
  assert.equal((await run("openrouter", { messages: [{ role: "user", content: "x" }], tools: [weather], toolChoice: "required" })).body.tool_choice, "required");
  // An assistant message that only made calls has null for its words.
  const only = await run("openai", { messages: [{ role: "user", content: "x" }, { role: "assistant", content: "", toolCalls: [{ id: "c", name: "now", arguments: "{}" }] }, { role: "tool", id: "c", content: "y" }], tools: [{ name: "now" }] });
  assert.equal(only.body.messages[1].content, null);
  const bare = (await run("openai", { messages: [{ role: "user", content: "x" }], toolChoice: "required", parallel: false })).body;
  assert.ok(!("tools" in bare) && !("tool_choice" in bare) && !("parallel_tool_calls" in bare));
});

test("Chat Completions providers: a tool call in the answer, as it streams", async () => {
  const delta = (d, finish_reason = null) => ({ choices: [{ index: 0, delta: d, finish_reason }] });
  const { pieces, result } = await run("openai", { messages: [{ role: "user", content: "x" }], tools: [weather] }, [
    delta({ role: "assistant", content: "Looking. " }),
    delta({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_weather", arguments: "" } }] }),
    delta({ tool_calls: [{ index: 0, function: { arguments: '{"town":' } }] }),
    delta({ tool_calls: [{ index: 0, function: { arguments: '"Hull"}' } }, { index: 1, id: "call_2", type: "function", function: { name: "get_weather", arguments: '{"town":"York"}' } }] }),
    delta({}, "tool_calls"),
    { choices: [], usage: { prompt_tokens: 40, completion_tokens: 9 } },
  ]);
  assert.deepEqual(pieces, [
    "Looking. ",
    { tool: { index: 0, id: "call_1", name: "get_weather", arguments: "" } }, { tool: { index: 0, arguments: '{"town":' } }, { tool: { index: 0, arguments: '"Hull"}' } },
    { tool: { index: 1, id: "call_2", name: "get_weather", arguments: '{"town":"York"}' } },
  ]);
  assert.deepEqual(result, { tokensIn: 40, tokensOut: 9, finish: "tool_calls" });
  // Some providers give a call an id and no number. The calls are numbered in the order they arrive.
  const unnumbered = await run("gemini", { messages: [{ role: "user", content: "x" }], tools: [weather] }, [
    delta({ tool_calls: [{ id: "a", type: "function", function: { name: "get_weather", arguments: '{"town":"Hull"}' } }] }),
    delta({ tool_calls: [{ id: "b", type: "function", function: { name: "get_weather", arguments: '{"town":"York"}' } }] }, "tool_calls"),
  ]);
  assert.deepEqual(unnumbered.pieces.map((p) => [p.tool.index, p.tool.id]), [[0, "a"], [1, "b"]]);
  assert.equal((await run("openai", { messages: [{ role: "user", content: "x" }] }, [delta({ content: "Half an" }, "length")])).result.finish, "length");
  assert.equal((await run("openai", { messages: [{ role: "user", content: "x" }] }, [delta({ content: "Done." }, "stop")])).result.finish, "stop");
});

test("the browser's built-in model is given text only, and says so", async () => {
  const refused = async (ask) => { try { await generate({ provider: "builtin" }, ask).next(); return null; } catch (error) { return error.code; } };
  assert.equal(await refused({ messages: [{ role: "user", content: "x" }], tools: [weather] }), "unsupported");
  assert.equal(await refused({ messages: [{ role: "user", content: [{ type: "text", text: "x" }, { type: "image", url: PNG }] }] }), "unsupported");
  assert.equal(await refused({ messages: [{ role: "user", content: "x" }, { role: "assistant", content: "", toolCalls: [{ id: "c", name: "now", arguments: "{}" }] }, { role: "tool", id: "c", content: "y" }] }), "unsupported");
});

test("what is not a message, a tool or an image is left out before anything is sent", async () => {
  const { body } = await run("openai", {
    messages: [null, 7, { role: "user", content: [{ type: "text", text: "hi" }, { type: "video", url: "x" }, { type: "image" }, null] }, { role: "assistant", content: null, toolCalls: [null, { id: 1 }] }],
    tools: [null, { description: "no name" }, { name: "ok", parameters: "not an object" }],
  });
  assert.deepEqual(body.messages, [{ role: "user", content: [{ type: "text", text: "hi" }] }, { role: "assistant", content: "" }]);
  assert.deepEqual(body.tools, [{ type: "function", function: { name: "ok", parameters: { type: "object", properties: {} } } }]);
});
