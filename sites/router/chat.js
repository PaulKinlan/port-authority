// The Chat Completions face of the router.
//
// Many sites and libraries already speak the Chat Completions API: a list of
// messages in, and a completion object or a stream of chunks out. This file
// lets the router answer in that shape. It makes no network call and holds no
// key. It reads the request, asks the worker for the answer as pieces, and
// puts the pieces into the objects that API returns.
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
//   messages             system, developer, user, assistant and tool.
//                        A user message can carry images beside its text.
//                        An assistant message can carry the tool calls it made,
//                        and a tool message carries the result of one.
//   tools                functions the model may ask to have called
//   tool_choice          "auto", "none", "required", or one function by name
//   parallel_tool_calls  false to be asked for one call at a time
//   stream               true for chunks
//   stream_options       { include_usage: true } adds a last chunk with usage
//   max_completion_tokens, max_tokens    up to 4000
//   temperature, top_p, stop
// What is ignored: model (the person chose it), user, metadata, store,
// service_tier. Anything else is refused by name, so that a site is never
// given an answer made with different settings from the ones it asked for.
//
// The router never calls a tool. It passes on what the model asked for, and
// the site decides whether to do it.

const IGNORED = new Set(["model", "user", "metadata", "store", "service_tier", "safety_identifier", "prompt_cache_key"]);
const READ = new Set(["messages", "stream", "stream_options", "max_completion_tokens", "max_tokens", "temperature", "top_p", "stop", "n", "response_format", "tools", "tool_choice", "parallel_tool_calls"]);

// The most tokens the router will ask a provider for. generate() in
// providers.js has the same limit, and asks for 600 when a request gives none.
const MOST_TOKENS = 4000;
const MOST_TOOLS = 64;
const MOST_IMAGES = 20;
const MOST_IMAGE = 8 * 1024 * 1024;     // characters of one image's address, which for a data: address is the image itself
const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,/;
const WEB_IMAGE = /^https:\/\/[^\s]+$/;
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

const bad = (message, param = null, code = "invalid") => Object.assign(new Error(message), { code, param });
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// True for a value made only of what JSON can hold. A request arrives over a
// port, and anything else in it would be a function or an object on the other
// side. Those are never touched.
function isJson(value, depth = 0) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (depth > 24 || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.every((item) => isJson(item, depth + 1));
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.keys(value).every((key) => isJson(value[key], depth + 1));
}

// What a message says. Content is a string, or a list of parts. A part is
// text, or for a user message an image. Returns a string when it is all text.
function contentOf(content, where, images, count) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw bad(`${where}.content must be text, or a list of parts.`, where + ".content");
  const parts = content.map((part, i) => {
    const at = `${where}.content[${i}]`;
    if (!isObject(part) || typeof part.type !== "string") throw bad(`${at} must be an object with a type.`, at);
    if (part.type === "text" && typeof part.text === "string") return { type: "text", text: part.text };
    if (part.type === "image_url" && images) {
      const url = isObject(part.image_url) ? part.image_url.url : null;
      if (typeof url !== "string" || !(DATA_IMAGE.test(url) || WEB_IMAGE.test(url))) {
        throw bad(`${at}.image_url.url must be an https address, or a data: address of a PNG, JPEG, GIF or WebP image.`, at + ".image_url.url");
      }
      if (url.length > MOST_IMAGE) throw bad(`${at} is too large. An image can be up to 8 MB.`, at + ".image_url.url");
      if (++count.images > MOST_IMAGES) throw bad(`A request can carry up to ${MOST_IMAGES} images.`, at);
      return { type: "image", url };
    }
    throw bad(`The router sends ${images ? "text and images" : "text"} here. ${at} is of type "${part.type.slice(0, 40)}".`, at, "unsupported");
  });
  return parts.every((part) => part.type === "text") ? parts.map((part) => part.text).join("") : parts;
}

function number(body, name, low, high) {
  const value = body[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high) throw bad(`"${name}" must be a number from ${low} to ${high}.`, name);
  return value;
}

// The functions a model may ask to have called.
function toolsOf(body) {
  const list = body.tools;
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > MOST_TOOLS) throw bad(`"tools" must be a list of up to ${MOST_TOOLS} functions.`, "tools");
  const names = new Set();
  return list.map((tool, i) => {
    const at = `tools[${i}]`;
    if (!isObject(tool)) throw bad(`${at} must be an object.`, at);
    if (tool.type !== "function") throw bad(`The router passes on functions only. ${at} is of type "${String(tool.type).slice(0, 40)}".`, at + ".type", "unsupported");
    const fn = tool.function;
    if (!isObject(fn) || typeof fn.name !== "string" || !TOOL_NAME.test(fn.name)) throw bad(`${at}.function.name must be 1 to 64 letters, digits, underscores or hyphens.`, at + ".function.name");
    if (names.has(fn.name)) throw bad(`Two tools are called "${fn.name}".`, at + ".function.name");
    names.add(fn.name);
    if (fn.description != null && typeof fn.description !== "string") throw bad(`${at}.function.description must be text.`, at + ".function.description");
    if (fn.parameters != null && !(isObject(fn.parameters) && isJson(fn.parameters))) throw bad(`${at}.function.parameters must be a JSON Schema object.`, at + ".function.parameters");
    if (fn.strict === true) throw bad(`The router cannot promise "strict" for every provider. See ${at}.function.strict.`, at + ".function.strict", "unsupported");
    return { name: fn.name, ...(fn.description ? { description: fn.description.slice(0, 4000) } : {}), ...(fn.parameters ? { parameters: fn.parameters } : {}) };
  });
}

function toolChoiceOf(body, tools) {
  const choice = body.tool_choice;
  if (choice === undefined || choice === null) return undefined;
  if (!tools.length) throw bad('"tool_choice" needs "tools".', "tool_choice");
  if (choice === "auto" || choice === "none" || choice === "required") return choice;
  if (isObject(choice) && choice.type === "function" && isObject(choice.function) && typeof choice.function.name === "string") {
    if (!tools.some((tool) => tool.name === choice.function.name)) throw bad(`"tool_choice" names "${choice.function.name.slice(0, 64)}", which is not in "tools".`, "tool_choice");
    return { name: choice.function.name };
  }
  throw bad('"tool_choice" must be "auto", "none", "required", or { type: "function", function: { name } }.', "tool_choice");
}

// Read a Chat Completions request. Returns what the worker needs, or throws an
// error with a code and the name of the field that is wrong. Nothing in the
// request is ever called: a value that is not plain data is refused.
export function readRequest(body) {
  if (!isObject(body)) throw bad("The request must be an object with a list of messages.");
  for (const name of Object.keys(body)) {
    if (body[name] === undefined || body[name] === null || IGNORED.has(name) || READ.has(name)) continue;
    throw bad(`The router does not pass on "${name.slice(0, 40)}".`, name, "unsupported");
  }
  if (body.n !== undefined && body.n !== null && body.n !== 1) throw bad('The router gives one answer for each request, so "n" must be 1.', "n", "unsupported");
  if (body.response_format !== undefined && body.response_format !== null && !(isObject(body.response_format) && body.response_format.type === "text")) {
    throw bad('The router returns plain text, so "response_format" must be { type: "text" }.', "response_format", "unsupported");
  }
  if (!Array.isArray(body.messages) || !body.messages.length) throw bad('"messages" must be a list with at least one message.', "messages");

  const system = [], messages = [], count = { images: 0 };
  body.messages.forEach((message, i) => {
    const where = `messages[${i}]`;
    if (!isObject(message)) throw bad(`${where} must be an object with a role and content.`, where);
    const role = message.role;
    if (role === "function" || message.function_call != null) throw bad(`The router does tool calls, not the older function calls. See ${where}.`, where, "unsupported");
    if (role === "system" || role === "developer") system.push(contentOf(message.content, where, false, count));
    else if (role === "user") messages.push({ role, content: contentOf(message.content, where, true, count) });
    else if (role === "assistant") {
      const calls = message.tool_calls;
      if (calls != null && !Array.isArray(calls)) throw bad(`${where}.tool_calls must be a list.`, where + ".tool_calls");
      const toolCalls = (calls || []).map((call, n) => {
        const at = `${where}.tool_calls[${n}]`;
        if (!isObject(call) || typeof call.id !== "string" || !call.id || call.type !== "function" || !isObject(call.function) || typeof call.function.name !== "string" || typeof call.function.arguments !== "string") {
          throw bad(`${at} must be { id, type: "function", function: { name, arguments } }, with arguments as JSON text.`, at);
        }
        return { id: call.id.slice(0, 200), name: call.function.name.slice(0, 64), arguments: call.function.arguments };
      });
      // An assistant message that only made tool calls has no words in it.
      const text = message.content == null && toolCalls.length ? "" : contentOf(message.content, where, false, count);
      messages.push({ role, content: text, ...(toolCalls.length ? { toolCalls } : {}) });
    } else if (role === "tool") {
      if (typeof message.tool_call_id !== "string" || !message.tool_call_id) throw bad(`${where}.tool_call_id must name the tool call this is the result of.`, where + ".tool_call_id");
      messages.push({ role, id: message.tool_call_id.slice(0, 200), content: contentOf(message.content, where, false, count) });
    } else throw bad(`${where}.role must be "system", "developer", "user", "assistant" or "tool".`, where + ".role");
  });
  if (!messages.length) throw bad('"messages" needs at least one message from the user.', "messages");

  if (body.stream !== undefined && body.stream !== null && typeof body.stream !== "boolean") throw bad('"stream" must be true or false.', "stream");
  const options = body.stream_options;
  if (options !== undefined && options !== null && !isObject(options)) throw bad('"stream_options" must be an object.', "stream_options");
  let stop = body.stop;
  if (typeof stop === "string") stop = [stop];
  if (stop !== undefined && stop !== null && !(Array.isArray(stop) && stop.length <= 4 && stop.every((s) => typeof s === "string"))) throw bad('"stop" must be a piece of text, or a list of up to 4.', "stop");
  const maxTokens = number(body, "max_completion_tokens", 1, MOST_TOKENS) ?? number(body, "max_tokens", 1, MOST_TOKENS);
  const tools = toolsOf(body);
  const toolChoice = toolChoiceOf(body, tools);
  const parallel = body.parallel_tool_calls;
  if (parallel !== undefined && parallel !== null && typeof parallel !== "boolean") throw bad('"parallel_tool_calls" must be true or false.', "parallel_tool_calls");

  return {
    stream: body.stream === true,
    includeUsage: !!options && options.include_usage === true,
    ask: {
      system: system.join("\n\n"), messages, maxTokens, temperature: number(body, "temperature", 0, 2), topP: number(body, "top_p", 0, 1), stop: stop || undefined,
      ...(tools.length ? { tools } : {}), ...(toolChoice !== undefined ? { toolChoice } : {}), ...(typeof parallel === "boolean" && tools.length ? { parallel } : {}),
    },
  };
}

// A failure, as the body the Chat Completions API would send. `status` is the
// HTTP status that API would have used, for code that looks at it.
const STATUS = { invalid: 400, unsupported: 400, "no-grant": 401, "key-refused": 401, limit: 429, cancelled: 499, storage: 503 };
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
// Why the model stopped: "stop", "length" when it ran out of tokens, or
// "tool_calls" when it is waiting for the results of the calls it asked for.
const finishOf = (result, calls) => {
  const said = result && result.usage && result.usage.finish;
  return said === "length" || said === "tool_calls" || said === "stop" ? said : calls ? "tool_calls" : "stop";
};
const hex = (bytes) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
const newId = () => "chatcmpl-" + hex(12);

// answer(ask, signal) is an async generator. It yields a string for each piece
// of text, and { tool: { index, id, name, arguments } } for each piece of a
// tool call: the first piece of a call has its id and name, and the arguments
// arrive as pieces of JSON text. It returns { usage: { tokensIn, tokensOut,
// finish } }. model() names the model in use.
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
    const isTool = (value) => isObject(value) && isObject(value.tool) && Number.isInteger(value.tool.index) && value.tool.index >= 0 && value.tool.index < MOST_TOOLS;

    if (!request.stream) {
      let content = "", result;
      const calls = [];
      try {
        for (;;) {
          const { value, done } = await pieces.next();
          if (done) { result = value; break; }
          if (typeof value === "string") content += value;
          else if (isTool(value)) {
            const call = calls[value.tool.index] ??= { id: "", name: "", arguments: "" };
            if (value.tool.id) call.id = String(value.tool.id);
            if (value.tool.name) call.name = String(value.tool.name);
            if (value.tool.arguments) call.arguments += String(value.tool.arguments);
          }
        }
      } catch (error) { return errorBody(error); }
      const made = calls.filter(Boolean).map((call) => ({ id: call.id || "call_" + hex(8), type: "function", function: { name: call.name, arguments: call.arguments || "{}" } }));
      const message = { role: "assistant", content: made.length && !content ? null : content, ...(made.length ? { tool_calls: made } : {}), refusal: null };
      return { ...base, object: "chat.completion", choices: [{ index: 0, message, logprobs: null, finish_reason: finishOf(result, made.length) }], usage: usageOf(result) };
    }

    const chunk = (delta, finish_reason = null) => ({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, logprobs: null, finish_reason }], ...(request.includeUsage ? { usage: null } : {}) });
    return (async function* () {
      try {
        let started = false, result, calls = 0;
        for (;;) {
          const { value, done } = await pieces.next();
          // The first chunk names the role. It is held back until the request
          // is known to be allowed, so that a refusal is the only thing sent.
          if (!started) { started = true; yield chunk({ role: "assistant", content: "" }); }
          if (done) { result = value; break; }
          if (typeof value === "string") yield chunk({ content: value });
          else if (isTool(value)) {
            const { index, id, name } = value.tool;
            calls = Math.max(calls, index + 1);
            // The first piece of a call says which function. The rest add to its arguments.
            yield chunk({ tool_calls: [{ index, ...(id ? { id: String(id), type: "function" } : {}), function: { ...(name ? { name: String(name) } : {}), arguments: String(value.tool.arguments || "") } }] });
          }
        }
        yield chunk({}, finishOf(result, calls));
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
