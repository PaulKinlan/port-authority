// Port Authority client library.
//
//   import { serve, pick, registry, agent } from "https://<hub>/hub.js";
//
// A site that has tools calls serve(). A site that needs something calls
// pick("what I want"), registry() or agent(). Every one of them ends the same
// way: you are holding a MessagePort, and the thing on the other end is
// somewhere you never had to know about.
//
// There is no hidden iframe here. Browsers partition storage and SharedWorkers
// for embedded third parties, so an embedded hub would be a different hub on
// every site. A window the user can see is first party, so it reaches the one
// real hub, and it gives the user a place to say yes or no.

export const HUB = new URL(import.meta.url).origin;

// ---------------------------------------------------------------- JSON-RPC

// Minimal JSON-RPC 2.0 peer over a MessagePort. MCP and ACP are both JSON-RPC,
// so the same helper speaks to tools and to agents.
export function rpc(port) {
  let nextId = 1;
  const pending = new Map();
  const notes = new Set();
  let requestHandler = null;
  port.onmessage = async (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.method && msg.id !== undefined) {
      let reply;
      try {
        if (!requestHandler) throw Object.assign(new Error("Method not found"), { code: -32601 });
        reply = { jsonrpc: "2.0", id: msg.id, result: await requestHandler(msg.method, msg.params) };
      } catch (err) {
        reply = { jsonrpc: "2.0", id: msg.id, error: { code: err.code || -32000, message: String(err.message || err) } };
      }
      port.postMessage(reply);
    } else if (msg.method) {
      for (const fn of notes) fn(msg.method, msg.params);
    } else if (pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(Object.assign(new Error(msg.error.message), msg.error)) : resolve(msg.result);
    }
  };
  return {
    port,
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        port.postMessage({ jsonrpc: "2.0", id, method, params });
      });
    },
    notify(method, params) { port.postMessage({ jsonrpc: "2.0", method, params }); },
    onNotification(fn) { notes.add(fn); return () => notes.delete(fn); },
    onRequest(fn) { requestHandler = fn; },
    close() {
      port.close();
      for (const { reject } of pending.values()) reject(new Error("Port closed"));
      pending.clear();
    },
  };
}

// ------------------------------------------------------------- hub window

// Open the hub in a window of its own and run one exchange with it.
// Must be called from a click or key handler, or the browser blocks the popup.
function askHub(kind, payload = {}, transfer = []) {
  return new Promise((resolve, reject) => {
    const win = window.open(`${HUB}/hub/popup.html#${kind}`, `pa_${kind}`, "popup,width=460,height=660");
    if (!win) return reject(new Error("The hub window was blocked. Call this from a click handler."));
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      clearInterval(watch);
      fn(value);
    };
    const onMessage = (event) => {
      if (event.origin !== HUB || event.source !== win) return;
      const data = event.data || {};
      if (data.pa === "ready") {
        win.postMessage({ pa: "request", kind, ...payload }, HUB, transfer);
      } else if (data.pa === "result") {
        win.postMessage({ pa: "ack" }, HUB);
        if (data.ok) finish(resolve, { data, ports: event.ports });
        else finish(reject, new Error(data.reason || "The request was declined."));
      }
    };
    window.addEventListener("message", onMessage);
    const watch = setInterval(() => {
      if (win.closed) setTimeout(() => finish(reject, new Error("The hub window was closed.")), 300);
    }, 400);
  });
}

// ------------------------------------------------------------------ serve

function toContent(value) {
  if (value && Array.isArray(value.content)) return value;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }], structuredContent: typeof value === "object" ? value : undefined };
}

/**
 * Offer tools to the user's hub.
 *
 *   const service = serve({ name, description, tools: [{ name, description, inputSchema, execute }] });
 *   button.onclick = () => service.connect();
 *
 * The same tools are also registered with WebMCP when the browser has it, so
 * you declare them once.
 */
export function serve({ name, description = "", tools = [] }) {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const describe = () => [...byName.values()].map(({ name, description, inputSchema }) => ({
    name, description, inputSchema: inputSchema || { type: "object", properties: {} },
  }));
  const listeners = new Set();
  const channels = new Map();
  let hubPort = null, lastPing = 0, watchdog = null;
  const api = {
    connected: false,
    calls: 0,
    onchange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async connect() {
      // Start talking on our end straight away. Messages wait in the port
      // until the hub has decided, and the hub confirms once it has heard us.
      const channel = new MessageChannel();
      attach(channel.port1, true);
      try {
        await askHub("connect", { name, description }, [channel.port2]);
        changed({ connected: true });
      } catch (err) {
        if (hubPort === channel.port1) { hubPort.close(); hubPort = null; }
        throw err;
      }
    },
    disconnect() {
      hubPort?.postMessage({ t: "bye" });
      hubPort?.close();
      hubPort = null;
      for (const port of channels.values()) port.close();
      channels.clear();
      changed({ connected: false });
    },
  };
  const changed = (patch, detail) => { Object.assign(api, patch); for (const fn of listeners) fn(api, detail); };

  async function run(toolName, args, peer) {
    const tool = byName.get(toolName);
    if (!tool) return { content: [{ type: "text", text: `No tool called ${toolName}` }], isError: true };
    try {
      const out = toContent(await tool.execute(args || {}, { peer }));
      changed({ calls: api.calls + 1 }, { tool: toolName, args, peer });
      return out;
    } catch (err) {
      return { content: [{ type: "text", text: String(err.message || err) }], isError: true };
    }
  }

  // A channel handed over by the hub. The other end is some other site. It is
  // limited to the one tool the user agreed to: that limit lives here, on the
  // port, and the caller cannot widen it.
  function serveChannel(port, { tool, peer, grantId }) {
    channels.set(grantId, port);
    const peerRpc = rpc(port);
    peerRpc.onRequest(async (method, params) => {
      if (method === "initialize") return { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name, version: "1" } };
      if (method === "tools/list") return { tools: describe().filter((t) => t.name === tool) };
      if (method === "tools/call") {
        if (params?.name !== tool) throw Object.assign(new Error(`This port only reaches ${tool}`), { code: -32602 });
        return run(tool, params.arguments, peer);
      }
      throw Object.assign(new Error("Method not found"), { code: -32601 });
    });
    changed({}, { channel: tool, peer });
  }

  function attach(port, pending = false) {
    hubPort?.close();
    hubPort = port;
    port.onmessage = async (event) => {
      const msg = event.data || {};
      lastPing = Date.now();
      if (msg.t === "ping") port.postMessage({ t: "pong" });
      else if (msg.t === "call") port.postMessage({ t: "result", id: msg.id, result: await run(msg.name, msg.args, msg.peer) });
      else if (msg.t === "channel" && event.ports[0]) serveChannel(event.ports[0], msg);
      else if (msg.t === "revoke") { channels.get(msg.grantId)?.close(); channels.delete(msg.grantId); changed({}, { revoked: msg.grantId }); }
    };
    port.postMessage({ t: "register", name, description, url: location.href.split("#")[0], tools: describe() });
    // Nothing tells us when the hub's end goes away (for example when the last
    // hub window is shut), so we listen for its pings and notice silence.
    lastPing = Date.now();
    clearInterval(watchdog);
    watchdog = setInterval(() => {
      if (hubPort === port && Date.now() - lastPing > 20000) { clearInterval(watchdog); hubPort = null; changed({ connected: false }); }
    }, 5000);
    if (!pending) changed({ connected: true });
  }

  // If the hub itself opened this page (because the user picked one of our
  // tools while we were closed) it hands us a port directly. No popup needed.
  window.addEventListener("message", (event) => {
    if (event.origin === HUB && event.data?.pa === "adopt" && event.ports[0]) attach(event.ports[0]);
  });
  if (window.opener) {
    try { window.opener.postMessage({ pa: "service-ready", url: location.href.split("#")[0] }, HUB); } catch {}
  }
  window.addEventListener("pagehide", () => hubPort?.postMessage({ t: "bye" }));

  // WebMCP: same declarations, the browser's own agent can see them too.
  const modelContext = document.modelContext || navigator.modelContext;
  if (modelContext?.registerTool) {
    for (const tool of byName.values()) {
      try {
        modelContext.registerTool({
          name: tool.name, description: tool.description,
          inputSchema: tool.inputSchema || { type: "object", properties: {} },
          execute: (args) => run(tool.name, args, "webmcp"),
        });
      } catch {}
    }
    api.webmcp = true;
  }
  return api;
}

// ------------------------------------------------------------------ clients

/**
 * Ask for something by intent. The user chooses which site answers.
 * Resolves to a direct line to that one tool on that site.
 */
export async function pick(intent) {
  const { data, ports } = await askHub("pick", { intent });
  const peer = rpc(ports[0]);
  return {
    tool: data.tool,
    service: data.service,
    port: ports[0],
    call: (args) => peer.request("tools/call", { name: data.tool.name, arguments: args }),
    close: () => peer.close(),
  };
}

/**
 * Ask for the whole registry. Resolves to an MCP connection (tools/list,
 * tools/call) that reaches every tool on every site connected to the hub.
 */
export async function registry() {
  const { ports } = await askHub("registry");
  const peer = rpc(ports[0]);
  await peer.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: location.origin, version: "1" } });
  return {
    port: ports[0],
    rpc: peer,
    listTools: async () => (await peer.request("tools/list")).tools,
    callTool: (name, args) => peer.request("tools/call", { name, arguments: args }),
    onChange: (fn) => peer.onNotification((method) => method === "notifications/tools/list_changed" && fn()),
    close: () => peer.close(),
  };
}

/**
 * Ask for the user's agent. Resolves to an Agent Client Protocol connection.
 * Which agent that is, and where it runs, is the user's business.
 */
export async function agent() {
  const { ports } = await askHub("agent");
  const peer = rpc(ports[0]);
  const info = await peer.request("initialize", {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: location.origin, version: "1" },
  });
  const updates = new Set();
  peer.onNotification((method, params) => { if (method === "session/update") for (const fn of updates) fn(params); });
  // Agents may ask before running a tool. Sites can replace this handler.
  peer.onRequest(async (method, params) => {
    if (method === "session/request_permission") {
      const allow = params.options?.find((o) => o.kind?.startsWith("allow")) || params.options?.[0];
      return { outcome: allow ? { outcome: "selected", optionId: allow.optionId } : { outcome: "cancelled" } };
    }
    throw Object.assign(new Error("Method not found"), { code: -32601 });
  });
  return {
    port: ports[0],
    rpc: peer,
    info,
    newSession: async () => (await peer.request("session/new", { cwd: "/", mcpServers: [] })).sessionId,
    prompt: (sessionId, text) => peer.request("session/prompt", { sessionId, prompt: [{ type: "text", text }] }),
    cancel: (sessionId) => peer.notify("session/cancel", { sessionId }),
    onUpdate: (fn) => { updates.add(fn); return () => updates.delete(fn); },
    onRequest: (fn) => peer.onRequest(fn),
    close: () => peer.close(),
  };
}

/**
 * Make <a href="intent:find a book about chickens"> links work: a click asks
 * the hub, and the handler you pass receives the line to whichever tool the
 * user chose.
 */
export function intentLinks(onPicked, root = document) {
  root.addEventListener("click", async (event) => {
    const link = event.target.closest?.('a[href^="intent:"]');
    if (!link) return;
    event.preventDefault();
    const intent = decodeURIComponent(link.getAttribute("href").slice(7).replace(/\+/g, " "));
    try { onPicked(await pick(intent), intent, link); } catch (err) { onPicked(null, intent, link, err); }
  });
}
