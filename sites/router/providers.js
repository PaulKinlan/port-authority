// The providers the router can call. Each one turns a prompt into pieces of
// text. This file runs in pages served from the router's own address: the
// router frame inside a site, and the router's home page when it tests a key.

// A provider is only ever called from /call/<provider>, which is served with a
// Content-Security-Policy that lets it connect to the one provider named in
// its address. So this list is fixed. Adding a provider means adding it here
// and to ROUTER_PROVIDERS in src/worker.js.
//
// The model names are only what the form offers when an account is added, and
// the first one is what Test uses. They go out of date. Last checked against
// each provider on 2026-11-24.
export const PROVIDERS = {
  builtin: { name: "This browser's built-in model", needsKey: false, models: ["built-in"], note: "Runs on this device. Only offered when the browser has the Prompt API and the model is downloaded." },
  anthropic: { name: "Anthropic", needsKey: true, kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", models: ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5", "claude-fable-5-2"], note: "Your key from console.anthropic.com." },
  openai: { name: "OpenAI", needsKey: true, kind: "chat", baseUrl: "https://api.openai.com/v1", models: ["gpt-6.2-sol", "gpt-6-luna", "gpt-6.1-terra", "gpt-6.2-astra"], note: "Your key from platform.openai.com. Change the model names to the ones you use." },
  openrouter: { name: "OpenRouter", needsKey: true, kind: "chat", baseUrl: "https://openrouter.ai/api/v1", models: ["openrouter/auto"], note: "Your key from openrouter.ai. Change the model names to the ones you use." },
  gemini: { name: "Google Gemini", needsKey: true, kind: "chat", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", models: ["gemini-4-hydrogen", "gemini-4-neon", "gemini-4-carbon", "gemini-4-argon"], note: "Your key from aistudio.google.com. Change the model names to the ones you use." },
  ollama: { name: "Ollama on this computer", needsKey: false, local: true, kind: "chat", baseUrl: "http://localhost:11434/v1", models: ["gemma4", "qwen3.5", "llama3.2"], note: "No key. Ollama must be running and must allow this address: start it with OLLAMA_ORIGINS set to the router's address." },
};

// True only when the browser has the Prompt API and its model is already on
// this device. A model that still has to download is not offered.
export async function hasBuiltin() {
  if (typeof self.LanguageModel === "undefined") return false;
  // A browser can have the API and take a long time to say whether the model
  // is there, or never say. The picker window waits on this before it shows
  // anything, so the question gets a second and a half and then counts as no.
  const late = new Promise((resolve) => setTimeout(() => resolve("late"), 1500));
  try { return (await Promise.race([self.LanguageModel.availability(), late])) === "available"; } catch { return false; }
}

// Read a server-sent event stream and yield each event's data as parsed JSON.
async function* events(response) {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try { yield JSON.parse(data); } catch { /* a partial or non-JSON line */ }
    }
  }
}

async function refuse(response, who) {
  let detail = "";
  try { const body = await response.json(); detail = (body.error && (body.error.message || body.error)) || ""; } catch { /* no body */ }
  const error = new Error(`${who} answered ${response.status}${detail ? ": " + String(detail).slice(0, 300) : ""}`);
  error.code = response.status === 401 || response.status === 403 ? "key-refused" : "provider";
  return error;
}

// The one address the router calls at a provider. The page that makes the call
// is served with a rule that allows this address and no other, so it has to be
// the same as ROUTER_ENDPOINTS in src/worker.js. A unit test checks that it is.
export function endpointOf(id) {
  const provider = Object.hasOwn(PROVIDERS, id) ? PROVIDERS[id] : null;
  if (!provider || !provider.kind) return null;
  return provider.baseUrl + (provider.kind === "anthropic" ? "/messages" : "/chat/completions");
}

// account: { provider, key, model }
// ask: {
//   system, maxTokens, temperature, topP, stop: ["text"],     the last three are optional
//   messages: [
//     { role: "user", content: "text" }
//     { role: "user", content: [{ type: "text", text }, { type: "image", url }] }      url is https: or data:
//     { role: "assistant", content: "text", toolCalls: [{ id, name, arguments }] }     arguments is JSON text
//     { role: "tool", id, content: "text" } ],                                          the result of one tool call
//   tools: [{ name, description, parameters }],      functions the model may ask to have called
//   toolChoice: "auto" | "none" | "required" | { name },
//   parallel: false                                   to be asked for one call at a time
// }
// Yields a string for each piece of text. For a tool call it yields
// { tool: { index, id, name, arguments } }: the first piece of a call has its
// id and name, and the arguments arrive as pieces of JSON text.
// Returns { tokensIn, tokensOut, finish }. finish is "stop", "length" when the
// answer ran out of tokens, or "tool_calls" when the model wants tools called.
// Each provider has its own shapes for all of this. They are translated here,
// so that everything outside this file deals with one.

const words = (value) => (typeof value === "string" ? value : "");
const unsupported = (text) => Object.assign(new Error(text), { code: "unsupported" });

// Put what was asked into one known shape, whoever asked.
function readMessages(list) {
  const out = [];
  for (const m of Array.isArray(list) ? list : []) {
    if (!m || typeof m !== "object") continue;
    if (m.role === "tool") out.push({ role: "tool", id: words(m.id), content: words(m.content) });
    else if (m.role === "assistant") {
      const toolCalls = (Array.isArray(m.toolCalls) ? m.toolCalls : []).filter((c) => c && typeof c.name === "string").map((c) => ({ id: words(c.id), name: c.name, arguments: words(c.arguments) || "{}" }));
      out.push({ role: "assistant", content: m.content == null ? "" : String(m.content), toolCalls });
    } else if (Array.isArray(m.content)) {
      out.push({ role: "user", content: m.content.filter((p) => p && ((p.type === "text" && typeof p.text === "string") || (p.type === "image" && typeof p.url === "string"))).map((p) => (p.type === "text" ? { type: "text", text: p.text } : { type: "image", url: p.url })) });
    } else out.push({ role: "user", content: m.content == null ? "" : String(m.content) });
  }
  return out;
}
function readTools(ask) {
  const tools = (Array.isArray(ask.tools) ? ask.tools : []).filter((t) => t && typeof t.name === "string").map((t) => ({
    name: t.name, description: words(t.description), parameters: t.parameters && typeof t.parameters === "object" ? t.parameters : { type: "object", properties: {} },
  }));
  const choice = ask.toolChoice;
  const toolChoice = !tools.length ? null : choice === "auto" || choice === "none" || choice === "required" ? choice : choice && typeof choice === "object" && typeof choice.name === "string" ? { name: choice.name } : null;
  return { tools, toolChoice, parallel: tools.length && typeof ask.parallel === "boolean" ? ask.parallel : null };
}
const parseJson = (text) => { try { const value = JSON.parse(text); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; } };

// Anthropic: a message is a list of blocks. A tool call is a block in the
// assistant's message, and its result is a block in the user's next message.
// An image is a block too, as base64 or as an address to fetch.
function forAnthropic(messages) {
  const out = [];
  const add = (role, blocks) => { if (!blocks.length) return; const last = out.at(-1); if (last && last.role === role) last.content.push(...blocks); else out.push({ role, content: blocks }); };
  for (const m of messages) {
    if (m.role === "tool") add("user", [{ type: "tool_result", tool_use_id: m.id, content: m.content }]);
    else if (m.role === "assistant") add("assistant", [...(m.content ? [{ type: "text", text: m.content }] : []), ...m.toolCalls.map((call) => ({ type: "tool_use", id: call.id, name: call.name, input: parseJson(call.arguments) }))]);
    else if (typeof m.content === "string") add("user", m.content ? [{ type: "text", text: m.content }] : []);
    else add("user", m.content.map((part) => {
      if (part.type === "text") return { type: "text", text: part.text };
      const data = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is.exec(part.url);
      return { type: "image", source: data ? { type: "base64", media_type: data[1].toLowerCase(), data: data[2] } : { type: "url", url: part.url } };
    }));
  }
  // A message that is one piece of text is sent as plain text.
  return out.map((m) => (m.content.length === 1 && m.content[0].type === "text" ? { role: m.role, content: m.content[0].text } : m));
}

// Chat Completions: the shape OpenAI, OpenRouter, Gemini and Ollama take.
function forChat(messages, system) {
  const out = system ? [{ role: "system", content: system }] : [];
  for (const m of messages) {
    if (m.role === "tool") out.push({ role: "tool", tool_call_id: m.id, content: m.content });
    else if (m.role === "assistant") out.push({ role: "assistant", content: m.content || (m.toolCalls.length ? null : ""), ...(m.toolCalls.length ? { tool_calls: m.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })) } : {}) });
    else out.push({ role: "user", content: typeof m.content === "string" ? m.content : m.content.map((part) => (part.type === "text" ? { type: "text", text: part.text } : { type: "image_url", image_url: { url: part.url } })) });
  }
  return out;
}

export async function* generate(account, ask, signal) {
  const messages = readMessages(ask.messages);
  const { tools, toolChoice, parallel } = readTools(ask);
  const system = ask.system ? String(ask.system) : "";
  const maxTokens = Math.min(Math.max(Number(ask.maxTokens) || 600, 1), 4000);
  const usage = { tokensIn: 0, tokensOut: 0, finish: "stop" };
  // Settings a site may set. They are sent to the provider only when the site
  // set them. The browser's built-in model takes no notice of them.
  const temperature = Number.isFinite(ask.temperature) ? Math.min(Math.max(ask.temperature, 0), 2) : null;
  const topP = Number.isFinite(ask.topP) ? Math.min(Math.max(ask.topP, 0), 1) : null;
  const stop = Array.isArray(ask.stop) ? ask.stop.filter((s) => typeof s === "string" && s).slice(0, 4) : [];

  if (account.provider === "builtin") {
    // The built-in model is given text, and gives text back.
    if (tools.length || messages.some((m) => m.role === "tool" || (m.toolCalls && m.toolCalls.length))) throw unsupported("This browser's built-in model cannot be given tools through the router. Choose another model for that.");
    if (messages.some((m) => Array.isArray(m.content) && m.content.some((part) => part.type === "image"))) throw unsupported("This browser's built-in model cannot be given images through the router. Choose another model for that.");
    if (!(await hasBuiltin())) { const e = new Error("This browser has no built-in model ready to use."); e.code = "provider"; throw e; }
    const plain = messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : m.content.map((part) => part.text).join("") }));
    const session = await self.LanguageModel.create({ initialPrompts: [...(system ? [{ role: "system", content: system }] : []), ...plain.slice(0, -1)], signal });
    try {
      for await (const piece of session.promptStreaming(plain.at(-1)?.content || "", { signal })) yield piece;
    } finally { session.destroy?.(); }
    return usage;
  }

  const kind = PROVIDERS[account.provider]?.kind;
  if (kind === "anthropic") {
    // Anthropic says how to choose a tool, and whether to ask for one at a time, in one object.
    let choice = toolChoice === "required" ? { type: "any" } : toolChoice === "none" ? { type: "none" } : toolChoice === "auto" ? { type: "auto" } : toolChoice ? { type: "tool", name: toolChoice.name } : null;
    if (parallel === false && (!choice || choice.type !== "none")) choice = { ...(choice || { type: "auto" }), disable_parallel_tool_use: true };
    const response = await fetch(endpointOf(account.provider), {
      method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": account.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({
        model: account.model, max_tokens: maxTokens, stream: true, messages: forAnthropic(messages), ...(system ? { system } : {}),
        // Anthropic counts temperature from 0 to 1.
        ...(temperature !== null ? { temperature: Math.min(temperature, 1) } : {}), ...(topP !== null ? { top_p: topP } : {}), ...(stop.length ? { stop_sequences: stop } : {}),
        ...(tools.length ? { tools: tools.map((t) => ({ name: t.name, ...(t.description ? { description: t.description } : {}), input_schema: t.parameters })), ...(choice ? { tool_choice: choice } : {}) } : {}),
      }),
    });
    if (!response.ok) throw await refuse(response, "Anthropic");
    const callAt = new Map();    // which block of the answer is which tool call
    for await (const event of events(response)) {
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") yield event.delta.text;
      else if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
        callAt.set(event.index, callAt.size);
        yield { tool: { index: callAt.get(event.index), id: String(event.content_block.id || ""), name: String(event.content_block.name || ""), arguments: "" } };
      } else if (event.type === "content_block_delta" && event.delta?.type === "input_json_delta" && callAt.has(event.index)) {
        if (event.delta.partial_json) yield { tool: { index: callAt.get(event.index), arguments: String(event.delta.partial_json) } };
      } else if (event.type === "message_start") usage.tokensIn = event.message?.usage?.input_tokens || 0;
      else if (event.type === "message_delta") {
        usage.tokensOut = event.usage?.output_tokens || usage.tokensOut;
        const why = event.delta?.stop_reason;
        if (why) usage.finish = why === "tool_use" ? "tool_calls" : why === "max_tokens" ? "length" : "stop";
      } else if (event.type === "error") { const e = new Error("Anthropic: " + (event.error?.message || "error")); e.code = "provider"; throw e; }
    }
    return usage;
  }

  if (kind === "chat") {
    const base = PROVIDERS[account.provider].baseUrl;
    const limit = base.includes("api.openai.com") ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
    const response = await fetch(endpointOf(account.provider), {
      method: "POST", signal,
      headers: { "content-type": "application/json", ...(account.key ? { authorization: "Bearer " + account.key } : {}) },
      body: JSON.stringify({
        model: account.model, stream: true, stream_options: { include_usage: true }, ...limit, messages: forChat(messages, system),
        ...(temperature !== null ? { temperature } : {}), ...(topP !== null ? { top_p: topP } : {}), ...(stop.length ? { stop } : {}),
        ...(tools.length ? {
          tools: tools.map((t) => ({ type: "function", function: { name: t.name, ...(t.description ? { description: t.description } : {}), parameters: t.parameters } })),
          ...(toolChoice ? { tool_choice: typeof toolChoice === "string" ? toolChoice : { type: "function", function: { name: toolChoice.name } } } : {}),
          ...(parallel !== null ? { parallel_tool_calls: parallel } : {}),
        } : {}),
      }),
    });
    if (!response.ok) throw await refuse(response, PROVIDERS[account.provider].name);
    const seen = new Map();      // for a provider that names a call by its id and gives it no number
    for await (const event of events(response)) {
      const choice = event.choices?.[0];
      const piece = choice?.delta?.content;
      if (piece) yield piece;
      for (const call of Array.isArray(choice?.delta?.tool_calls) ? choice.delta.tool_calls : []) {
        if (!call) continue;
        let index = call.index;
        if (!Number.isInteger(index)) { if (call.id && !seen.has(call.id)) seen.set(call.id, seen.size); index = call.id ? seen.get(call.id) : Math.max(seen.size - 1, 0); }
        yield { tool: { index, ...(call.id ? { id: String(call.id) } : {}), ...(call.function?.name ? { name: String(call.function.name) } : {}), arguments: words(call.function?.arguments) } };
      }
      const why = choice?.finish_reason;
      if (why) usage.finish = why === "tool_calls" || why === "function_call" ? "tool_calls" : why === "length" ? "length" : "stop";
      if (event.usage) { usage.tokensIn = event.usage.prompt_tokens || 0; usage.tokensOut = event.usage.completion_tokens || 0; }
    }
    return usage;
  }

  const e = new Error("The router does not know the provider \"" + account.provider + "\"."); e.code = "provider"; throw e;
}
