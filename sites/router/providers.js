// The providers the router can call. Each one turns a prompt into pieces of
// text. This file runs in pages served from the router's own address: the
// router frame inside a site, and the router's home page when it tests a key.

// A provider is only ever called from /call.html, which is served with a
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

// account: { provider, key, model }
// ask:     { system, messages: [{ role: "user" | "assistant", content: "text" }], maxTokens,
//            temperature, topP, stop: ["text"] }   the last three are optional
// Yields strings. Returns { tokensIn, tokensOut } when the provider reports them.
export async function* generate(account, ask, signal) {
  const messages = (ask.messages || []).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content) }));
  const system = ask.system ? String(ask.system) : "";
  const maxTokens = Math.min(Math.max(Number(ask.maxTokens) || 600, 1), 4000);
  const usage = { tokensIn: 0, tokensOut: 0 };
  // Settings a site may set. They are sent to the provider only when the site
  // set them. The browser's built-in model takes no notice of them.
  const temperature = Number.isFinite(ask.temperature) ? Math.min(Math.max(ask.temperature, 0), 2) : null;
  const topP = Number.isFinite(ask.topP) ? Math.min(Math.max(ask.topP, 0), 1) : null;
  const stop = Array.isArray(ask.stop) ? ask.stop.filter((s) => typeof s === "string" && s).slice(0, 4) : [];

  if (account.provider === "builtin") {
    if (!(await hasBuiltin())) { const e = new Error("This browser has no built-in model ready to use."); e.code = "provider"; throw e; }
    const session = await self.LanguageModel.create({ initialPrompts: [...(system ? [{ role: "system", content: system }] : []), ...messages.slice(0, -1)], signal });
    try {
      for await (const piece of session.promptStreaming(messages.at(-1)?.content || "", { signal })) yield piece;
    } finally { session.destroy?.(); }
    return usage;
  }

  const kind = PROVIDERS[account.provider]?.kind;
  if (kind === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": account.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({
        model: account.model, max_tokens: maxTokens, stream: true, messages, ...(system ? { system } : {}),
        // Anthropic counts temperature from 0 to 1.
        ...(temperature !== null ? { temperature: Math.min(temperature, 1) } : {}), ...(topP !== null ? { top_p: topP } : {}), ...(stop.length ? { stop_sequences: stop } : {}),
      }),
    });
    if (!response.ok) throw await refuse(response, "Anthropic");
    for await (const event of events(response)) {
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") yield event.delta.text;
      else if (event.type === "message_start") usage.tokensIn = event.message?.usage?.input_tokens || 0;
      else if (event.type === "message_delta") usage.tokensOut = event.usage?.output_tokens || usage.tokensOut;
      else if (event.type === "error") { const e = new Error("Anthropic: " + (event.error?.message || "error")); e.code = "provider"; throw e; }
    }
    return usage;
  }

  if (kind === "chat") {
    const base = PROVIDERS[account.provider].baseUrl;
    const limit = base.includes("api.openai.com") ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
    const response = await fetch(base + "/chat/completions", {
      method: "POST", signal,
      headers: { "content-type": "application/json", ...(account.key ? { authorization: "Bearer " + account.key } : {}) },
      body: JSON.stringify({
        model: account.model, stream: true, stream_options: { include_usage: true }, ...limit, messages: [...(system ? [{ role: "system", content: system }] : []), ...messages],
        ...(temperature !== null ? { temperature } : {}), ...(topP !== null ? { top_p: topP } : {}), ...(stop.length ? { stop } : {}),
      }),
    });
    if (!response.ok) throw await refuse(response, PROVIDERS[account.provider].name);
    for await (const event of events(response)) {
      const piece = event.choices?.[0]?.delta?.content;
      if (piece) yield piece;
      if (event.usage) { usage.tokensIn = event.usage.prompt_tokens || 0; usage.tokensOut = event.usage.completion_tokens || 0; }
    }
    return usage;
  }

  const e = new Error("The router does not know the provider \"" + account.provider + "\"."); e.code = "provider"; throw e;
}
