// The Chat Completions face of the router.
//
// Many sites and libraries already speak the Chat Completions API: a list of
// messages in, and a completion object or a stream of chunks out. This file
// lets the router answer in that shape. It makes no network call and holds no
// key. It reads the request, asks the worker for the answer as pieces of text,
// and puts the pieces into the objects that API returns.
//
// The worker exposes chatApi() on a port with Hawser, so the other side calls
//
//   const answer = await api.chat.completions.create({ messages });
//   const stream = await api.chat.completions.create({ messages, stream: true });
//
// Everything that crosses the port is plain data in the API's own shapes. That
// includes a failure, which is returned as { error: { message, type, param,
// code } } and not thrown, as the HTTP API returns it in a body. router.js
// turns it back into a thrown error for the site.
//
// What is read from a request:
//   messages             system, developer, user and assistant. Text only.
//   stream               true for chunks
//   stream_options       { include_usage: true } adds a last chunk with usage
//   max_completion_tokens, max_tokens    up to 4000
//   temperature, top_p, stop
// What is ignored: model (the person chose it), user, metadata, store,
// service_tier. Anything else is refused by name, so that a site is never
// given an answer made with different settings from the ones it asked for.

const IGNORED = new Set(["model", "user", "metadata", "store", "service_tier", "safety_identifier", "prompt_cache_key"]);
const READ = new Set(["messages", "stream", "stream_options", "max_completion_tokens", "max_tokens", "temperature", "top_p", "stop", "n", "response_format"]);

// The most tokens the router will ask a provider for. generate() in
// providers.js has the same limit, and asks for 600 when a request gives none.
const MOST_TOKENS = 4000;

const bad = (message, param = null, code = "invalid") => Object.assign(new Error(message), { code, param });
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// The text of one message. Content is a string, or a list of text parts.
function textOf(content, where) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw bad(`${where}.content must be text, or a list of text parts.`, where + ".content");
  return content.map((part, i) => {
    if (!isObject(part) || typeof part.type !== "string") throw bad(`${where}.content[${i}] must be an object with a type.`, `${where}.content[${i}]`);
    if (part.type !== "text" || typeof part.text !== "string") throw bad(`The router sends text only. ${where}.content[${i}] is of type "${part.type.slice(0, 40)}".`, `${where}.content[${i}]`, "unsupported");
    return part.text;
  }).join("");
}

function number(body, name, low, high) {
  const value = body[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high) throw bad(`"${name}" must be a number from ${low} to ${high}.`, name);
  return value;
}

// Read a Chat Completions request. Returns what the worker needs, or throws an
// error with a code and the name of the field that is wrong. Nothing in the
// request is ever called: a value that is not plain data is refused.
export function readRequest(body) {
  if (!isObject(body)) throw bad("The request must be an object with a list of messages.");
  for (const name of Object.keys(body)) {
    if (body[name] === undefined || body[name] === null || IGNORED.has(name) || READ.has(name)) continue;
    throw bad(`The router does not pass on "${name.slice(0, 40)}". It sends text prompts and returns text answers.`, name, "unsupported");
  }
  if (body.n !== undefined && body.n !== null && body.n !== 1) throw bad('The router gives one answer for each request, so "n" must be 1.', "n", "unsupported");
  if (body.response_format !== undefined && body.response_format !== null && !(isObject(body.response_format) && body.response_format.type === "text")) {
    throw bad('The router returns plain text, so "response_format" must be { type: "text" }.', "response_format", "unsupported");
  }
  if (!Array.isArray(body.messages) || !body.messages.length) throw bad('"messages" must be a list with at least one message.', "messages");

  const system = [], messages = [];
  body.messages.forEach((message, i) => {
    const where = `messages[${i}]`;
    if (!isObject(message)) throw bad(`${where} must be an object with a role and content.`, where);
    const role = message.role;
    if (role === "tool" || role === "function" || message.tool_calls != null || message.function_call != null) throw bad(`The router does not do tool calls. See ${where}.`, where, "unsupported");
    if (role !== "system" && role !== "developer" && role !== "user" && role !== "assistant") throw bad(`${where}.role must be "system", "developer", "user" or "assistant".`, where + ".role");
    const text = textOf(message.content, where);
    if (role === "system" || role === "developer") system.push(text); else messages.push({ role, content: text });
  });
  if (!messages.length) throw bad('"messages" needs at least one message from the user.', "messages");

  if (body.stream !== undefined && body.stream !== null && typeof body.stream !== "boolean") throw bad('"stream" must be true or false.', "stream");
  const options = body.stream_options;
  if (options !== undefined && options !== null && !isObject(options)) throw bad('"stream_options" must be an object.', "stream_options");
  let stop = body.stop;
  if (typeof stop === "string") stop = [stop];
  if (stop !== undefined && stop !== null && !(Array.isArray(stop) && stop.length <= 4 && stop.every((s) => typeof s === "string"))) throw bad('"stop" must be a piece of text, or a list of up to 4.', "stop");
  const maxTokens = number(body, "max_completion_tokens", 1, MOST_TOKENS) ?? number(body, "max_tokens", 1, MOST_TOKENS);

  return {
    stream: body.stream === true,
    includeUsage: !!options && options.include_usage === true,
    ask: { system: system.join("\n\n"), messages, maxTokens, temperature: number(body, "temperature", 0, 2), topP: number(body, "top_p", 0, 1), stop: stop || undefined },
  };
}

// A failure, as the body the Chat Completions API would send. `status` is the
// HTTP status that API would have used, for code that looks at it.
const STATUS = { invalid: 400, unsupported: 400, "no-grant": 401, "key-refused": 401, limit: 429, cancelled: 499, offline: 503 };
const TYPE = { 400: "invalid_request_error", 401: "authentication_error", 429: "rate_limit_error" };
export function errorBody(error) {
  const code = error && error.name === "AbortError" ? "cancelled" : (error && typeof error.code === "string" && error.code) || "provider";
  const status = STATUS[code] || 502;
  return { error: { message: String((error && error.message) || error), type: TYPE[status] || "api_error", param: (error && typeof error.param === "string" && error.param) || null, code, status } };
}

const usageOf = (result) => {
  const used = (result && result.usage) || {};
  const prompt_tokens = used.tokensIn || 0, completion_tokens = used.tokensOut || 0;
  return { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens };
};
const newId = () => "chatcmpl-" + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");

// answer(ask, signal) is an async generator: it yields pieces of text and
// returns { usage: { tokensIn, tokensOut } }. model() names the model in use.
export function chatApi(answer, model) {
  async function create(body, options) {
    let request;
    try { request = readRequest(body); } catch (error) { return errorBody(error); }
    // The caller's AbortSignal, if it sent one. Stopping also stops the provider call.
    const theirs = isObject(options) && typeof AbortSignal === "function" && options.signal instanceof AbortSignal ? options.signal : null;
    const stop = new AbortController();
    const cancelled = () => stop.abort(new DOMException("cancelled", "AbortError"));
    if (theirs) { if (theirs.aborted) cancelled(); else theirs.addEventListener("abort", cancelled, { once: true }); }

    const base = { id: newId(), created: Math.floor(Date.now() / 1000), model: String(model() || "") };
    const pieces = answer(request.ask, stop.signal);

    if (!request.stream) {
      let content = "", result;
      try {
        for (;;) {
          const { value, done } = await pieces.next();
          if (done) { result = value; break; }
          content += value;
        }
      } catch (error) { return errorBody(error); }
      // The router is not told why the model stopped, so this is always "stop".
      return { ...base, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content, refusal: null }, logprobs: null, finish_reason: "stop" }], usage: usageOf(result) };
    }

    const chunk = (delta, finish_reason = null) => ({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, logprobs: null, finish_reason }], ...(request.includeUsage ? { usage: null } : {}) });
    return (async function* () {
      try {
        let started = false, result;
        for (;;) {
          const { value, done } = await pieces.next();
          // The first chunk names the role. It is held back until the request
          // is known to be allowed, so that a refusal is the only thing sent.
          if (!started) { started = true; yield chunk({ role: "assistant", content: "" }); }
          if (done) { result = value; break; }
          yield chunk({ content: value });
        }
        yield chunk({}, "stop");
        if (request.includeUsage) yield { ...base, object: "chat.completion.chunk", choices: [], usage: usageOf(result) };
      } catch (error) {
        yield errorBody(error);
      } finally {
        // The caller stopped reading, or the answer is over. Either way the provider call ends here.
        stop.abort(new DOMException("cancelled", "AbortError"));
        try { await pieces.return?.(); } catch { /* already over */ }
      }
    })();
  }
  return { chat: { completions: { create } } };
}
