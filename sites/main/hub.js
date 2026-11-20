// Port Authority client library.
//
//   import { serve, pick, registry, agent } from "https://<hub>/hub.js";
//
// A site that has tools calls serve(). A site that needs something calls
// pick("what I want"), registry() or agent(). Every one of them ends the same
// way: you are holding a MessagePort.
//
// Two things live on the person's hub server and nothing else does:
//   - the registry: which sites offer which tools, so the picker can list them
//     without any of those sites being open
//   - the way to their agent, which runs on a machine and not in a tab
//
// A call from one site to another never goes near the server. If the tool's
// site is closed, the picker opens it in a window, gives each side one end of
// a MessageChannel, and closes. If it is already open in a tab, the server
// introduces the two tabs and they open a WebRTC channel between themselves.
//
// There is no hidden iframe here. Browsers partition storage for embedded third
// parties, so an embedded hub would be a different hub on every site. A window
// the person can see is first party, and it is where they say yes or no.

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
function askHub(kind, payload = {}) {
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
        win.postMessage({ pa: "request", kind, linked: !!link.creds, ...payload }, HUB);
      } else if (data.pa === "result") {
        win.postMessage({ pa: "ack" }, HUB);
        if (data.hub) link.use(data.hub);
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

// ----------------------------------------------------------- hub server

// This site's own line to the person's hub server. The hub window hands us a
// token once. We keep it in our own storage, which is ours alone, and the
// server only honours it when the browser says the connection comes from this
// origin. After that we reconnect by ourselves on every visit.
const STORE = `port-authority:${HUB}`;
const read = (key) => { try { return JSON.parse(localStorage.getItem(`${STORE}:${key}`)); } catch { return null; } };
const write = (key, value) => { try { value === null ? localStorage.removeItem(`${STORE}:${key}`) : localStorage.setItem(`${STORE}:${key}`, JSON.stringify(value)); } catch {} };

const link = {
  creds: read("hub"),
  ws: null, open: false, queue: [], retry: 0,
  handlers: new Set(),
  grantPorts: new Map(),
  use(creds) { this.creds = creds; write("hub", creds); this.connect(true); },
  connect(fresh) {
    if (!this.creds) return;
    if (this.ws && !fresh) return;
    try { this.ws?.close(); } catch {}
    const url = `${HUB.replace(/^http/, "ws")}/h/${this.creds.id}?role=site&token=${encodeURIComponent(this.creds.token)}`;
    const ws = this.ws = new WebSocket(url);
    let opened = false;
    ws.onopen = () => {
      opened = true; this.open = true; this.retry = 0;
      for (const fn of this.handlers) fn({ t: "open" });
      for (const frame of this.queue.splice(0)) ws.send(frame);
    };
    ws.onmessage = (event) => {
      let msg; try { msg = JSON.parse(event.data); } catch { return; }
      // The person pressed Forget in their hub. The token is dead: drop it and do not come back.
      if (msg.t === "forgotten") return this.forgotten(ws);
      if (msg.t === "rpc") this.grantPorts.get(msg.grant)?.postMessage(msg.msg);
      for (const fn of this.handlers) fn(msg);
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      if (event.code === 4001) return this.forgotten(ws);
      this.ws = null; this.open = false;
      for (const fn of this.handlers) fn({ t: "closed" });
      // Refused before it ever opened, twice running: the token is no good any more.
      if (!opened && ++this.retry > 2) { this.creds = null; write("hub", null); return; }
      setTimeout(() => this.connect(), Math.min(30000, 1000 * 2 ** this.retry));
    };
  },
  forgotten(ws) {
    if (this.ws !== ws) return;
    this.ws = null; this.open = false; this.creds = null; this.queue.length = 0;
    write("hub", null);
    try { ws.close(); } catch {}
    for (const port of this.grantPorts.values()) port.close();
    this.grantPorts.clear();
    for (const fn of this.handlers) fn({ t: "forgotten" });
  },
  send(frame) {
    const text = JSON.stringify(frame);
    if (this.open) this.ws.send(text); else { this.queue.push(text); this.connect(); }
  },
  // A real MessagePort whose far end is something the hub server reaches for
  // us (the registry, or the agent). The caller cannot tell the difference.
  grantPort(grantId) {
    const { port1, port2 } = new MessageChannel();
    this.grantPorts.set(grantId, port1);
    port1.onmessage = (event) => this.send({ t: "rpc", grant: grantId, msg: event.data });
    return port2;
  },
};

// ------------------------------------------------------------------ WebRTC
//
// When the tool's site is already open in a tab, there is no window for the
// picker to hand a port to. The hub server introduces the two tabs instead:
// it carries a WebRTC handshake between them and then steps away. What comes
// out is still a MessagePort, with a data channel behind it. This line
// carries JSON only, so ports and streams cannot ride on it.
function rtcLine(line, offerer) {
  return new Promise((resolve, reject) => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] });
    const signal = (data) => link.send({ t: "signal", line, data });
    let chain = Promise.resolve();
    const stop = () => { link.handlers.delete(onSignal); clearTimeout(timer); };
    const timer = setTimeout(() => { stop(); pc.close(); reject(new Error("The two tabs could not reach each other.")); }, 12000);
    const wire = (dc) => {
      const { port1, port2 } = new MessageChannel();
      dc.onmessage = (event) => { try { port1.postMessage(JSON.parse(event.data)); } catch {} };
      port1.onmessage = (event) => { if (dc.readyState === "open") dc.send(JSON.stringify(event.data)); };
      dc.onclose = () => { port1.close(); pc.close(); };
      const ready = () => { stop(); resolve(port2); };
      dc.readyState === "open" ? ready() : (dc.onopen = ready);
    };
    const onSignal = (msg) => {
      if (msg.t !== "signal" || msg.line !== line) return;
      chain = chain.then(async () => {
        const { description, candidate } = msg.data || {};
        if (description) {
          await pc.setRemoteDescription(description);
          if (description.type === "offer") { await pc.setLocalDescription(); signal({ description: pc.localDescription }); }
        } else if (candidate) await pc.addIceCandidate(candidate);
      }).catch(() => {});
    };
    link.handlers.add(onSignal);
    pc.onicecandidate = (event) => event.candidate && signal({ candidate: event.candidate });
    if (offerer) {
      wire(pc.createDataChannel("port-authority"));
      pc.setLocalDescription().then(() => signal({ description: pc.localDescription }), reject);
    } else pc.ondatachannel = (event) => wire(event.channel);
  });
}

// ------------------------------------------------------------------ serve

function toContent(value) {
  if (value && Array.isArray(value.content)) return value;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }], structuredContent: typeof value === "object" ? value : undefined };
}

/**
 * Offer tools to the person's hub.
 *
 *   const service = serve({ name, description, tools: [{ name, description, inputSchema, execute }] });
 *   button.onclick = () => service.connect();   // first time only
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
  const api = {
    connected: false,
    linked: !!link.creds,
    calls: 0,
    onchange(fn) { listeners.add(fn); fn(api); return () => listeners.delete(fn); },
    // First visit: ask the person, in the hub window, to add this site.
    async connect() {
      if (!link.creds) await askHub("connect", { name, description });
      register();
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

  // The registry on the server, and calls that can only come through it (the
  // person's agent, or a site they gave the whole registry to).
  const register = () => link.send({ t: "register", name, description, url: location.href.split("#")[0], tools: describe() });
  link.handlers.add(async (msg) => {
    if (msg.t === "open") register();
    else if (msg.t === "registered") changed({ connected: true, linked: true });
    else if (msg.t === "closed") changed({ connected: false, linked: !!link.creds });
    else if (msg.t === "forgotten") changed({ connected: false, linked: false }, { forgotten: true });
    else if (msg.t === "call") link.send({ t: "result", id: msg.id, result: await run(msg.name, msg.args, msg.peer) });
    // The person picked one of our tools while this tab was open.
    else if (msg.t === "line") rtcLine(msg.line, false).then((port) => attach(port, msg.tool, msg.peer, "webrtc"), () => {});
  });
  if (link.creds) link.connect();

  // A direct line. The hub window opened this page because the person picked
  // one of our tools, and it hands us one end of a channel. The other end is
  // with the site that asked. The line is limited to that one tool: the limit
  // lives here, on the port, and the caller cannot widen it.
  function attach(port, tool, peer, via) {
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
    changed({}, { channel: tool, peer, via });
  }
  window.addEventListener("message", (event) => {
    if (event.origin !== HUB || event.data?.pa !== "line" || !event.ports[0]) return;
    attach(event.ports[0], event.data.tool, event.data.peer, "window");
  });
  if (window.opener) {
    try { window.opener.postMessage({ pa: "service-ready", url: location.href.split("#")[0] }, HUB); } catch {}
  }

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
 * Ask for something by intent. The person chooses which site answers.
 * Resolves to a direct line to that one tool: in a window the hub opened, or
 * over WebRTC to the tab the person already has open. Either way the calls
 * on this line do not go through a server.
 */
export async function pick(intent) {
  const { data, ports } = await askHub("pick", { intent });
  const port = data.rtc ? await rtcLine(data.rtc.line, true) : ports[0];
  const peer = rpc(port);
  return {
    tool: data.tool,
    service: data.service,
    via: data.rtc ? "webrtc" : "window",
    port,
    call: (args) => peer.request("tools/call", { name: data.tool.name, arguments: args }),
    close: () => peer.close(),
  };
}

// Use the access we were given before if it still stands, otherwise ask.
async function granted(kind, hello) {
  const saved = read(`grant:${kind}`);
  if (saved && link.creds) {
    const peer = rpc(link.grantPort(saved));
    try { return { peer, info: await hello(peer) }; } catch { write(`grant:${kind}`, null); }
  }
  const { data } = await askHub(kind);
  write(`grant:${kind}`, data.grantId);
  const peer = rpc(link.grantPort(data.grantId));
  return { peer, info: await hello(peer) };
}

/**
 * Ask for the whole registry. Resolves to an MCP connection (tools/list,
 * tools/call) that reaches every tool on every site that is open right now.
 * These calls are carried by the person's hub server.
 */
export async function registry() {
  const { peer } = await granted("registry", (p) => p.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: location.origin, version: "1" } }));
  return {
    port: peer.port,
    rpc: peer,
    listTools: async () => (await peer.request("tools/list")).tools,
    callTool: (name, args) => peer.request("tools/call", { name, arguments: args }),
    onChange: (fn) => peer.onNotification((method) => method === "notifications/tools/list_changed" && fn()),
    close: () => peer.close(),
  };
}

/**
 * Ask for the person's agent. Resolves to an Agent Client Protocol connection.
 * Which agent that is, and where it runs, is their business.
 */
export async function agent() {
  const { peer, info } = await granted("agent", (p) => p.request("initialize", {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: location.origin, version: "1" },
  }));
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
    port: peer.port,
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
 * person chose.
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
