// The switchboard: a SharedWorker that every hub window connects to.
//
// It holds one port for each site that is offering tools, and it makes the
// introductions. For a single tool it creates a fresh MessageChannel, sends
// one end to the site with the tool and the other end to the site that asked,
// and then has nothing more to do with that conversation. For the registry and
// for the agent it keeps its end and answers on it.

const pages = new Map();     // pageId -> { port, kind }
const services = new Map();  // origin -> service
const grants = new Map();    // grantId -> grant
const log = [];
const registryPorts = new Set();
let known = {};              // origin -> { name, description, url, tools, lastSeen } (persisted)
let agentConfig = { mode: "builtin", room: null };
let seq = 1;
const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ------------------------------------------------------------ persistence

const db = new Promise((resolve, reject) => {
  const open = indexedDB.open("port-authority", 1);
  open.onupgradeneeded = () => open.result.createObjectStore("kv");
  open.onsuccess = () => resolve(open.result);
  open.onerror = () => reject(open.error);
});
async function load(key, fallback) {
  try {
    const store = (await db).transaction("kv").objectStore("kv");
    return await new Promise((resolve) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? fallback);
      req.onerror = () => resolve(fallback);
    });
  } catch { return fallback; }
}
async function save(key, value) {
  try { (await db).transaction("kv", "readwrite").objectStore("kv").put(value, key); } catch {}
}
const ready = (async () => {
  known = await load("known", {});
  agentConfig = await load("agent", agentConfig);
  if (agentConfig.mode === "relay") relay.connect();
})();

// ------------------------------------------------------------------ state

function note(text) {
  log.unshift({ at: Date.now(), text });
  log.length = Math.min(log.length, 60);
}

function snapshot() {
  const live = [...services.values()].filter((s) => s.live);
  const offline = Object.entries(known)
    .filter(([origin]) => !services.get(origin)?.live)
    .map(([origin, k]) => ({ origin, ...k, live: false }));
  return {
    t: "state",
    services: [...live.map(({ origin, name, description, url, tools }) => ({ origin, name, description, url, tools, live: true })), ...offline],
    grants: [...grants.values()].map(({ id, kind, client, service, tool, at }) => ({ id, kind, client, service, tool, at })),
    agent: { ...agentConfig, relay: relay.status, present: relay.present, info: relay.info, cwd: relay.hello?.cwd || null },
    dashboards: [...pages.values()].filter((p) => p.kind === "dashboard").length,
    log,
  };
}
let broadcastQueued = false;
function broadcast() {
  if (broadcastQueued) return;
  broadcastQueued = true;
  queueMicrotask(() => {
    broadcastQueued = false;
    const state = snapshot();
    for (const page of pages.values()) page.port.postMessage(state);
  });
}

// ------------------------------------------------------------- hub windows

onconnect = (event) => {
  const port = event.ports[0];
  const page = { id: uid(), port, kind: "popup" };
  pages.set(page.id, page);
  port.onmessage = (e) => onPage(page, e.data || {}, e.ports);
  port.postMessage({ t: "welcome", pageId: page.id });
};

function dropPage(page) {
  if (pages.delete(page.id)) broadcast();
}

async function onPage(page, msg, ports) {
  await ready;
  switch (msg.t) {
    case "hello":
      page.kind = msg.kind || "popup";
      // Each window holds a Web Lock named after itself. When we manage to
      // take that lock, the window has gone. No heartbeats, no timers.
      if (msg.lock && navigator.locks) navigator.locks.request(msg.lock, () => dropPage(page));
      broadcast();
      break;
    case "bye": dropPage(page); break;
    case "adopt":
      if (ports[0]) adoptService(ports[0], msg.origin, msg.url);
      break;
    case "grant-tool": grantTool(page, msg); break;
    case "grant-registry": grantRegistry(page, msg); break;
    case "grant-agent": grantAgent(page, msg); break;
    case "revoke": revoke(msg.grantId); break;
    case "forget":
      delete known[msg.origin];
      save("known", known);
      disconnectService(services.get(msg.origin), "forgotten");
      services.delete(msg.origin);
      broadcast();
      break;
    case "agent-config":
      agentConfig = { mode: msg.mode, room: msg.room || agentConfig.room || null };
      save("agent", agentConfig);
      if (agentConfig.mode === "relay") relay.connect(); else relay.disconnect();
      note(agentConfig.mode === "relay" ? "Agent set to your own agent, over the relay" : "Agent set to the built-in demo agent");
      broadcast();
      break;
  }
}

// ---------------------------------------------------------------- services

function adoptService(port, origin, url) {
  disconnectService(services.get(origin), "replaced");
  const service = { origin, url, name: origin, description: "", tools: [], port, live: false, pending: new Map(), missed: 0 };
  services.set(origin, service);
  port.onmessage = (event) => {
    const msg = event.data || {};
    if (services.get(origin) !== service) return;
    service.missed = 0;
    if (msg.t === "register") {
      Object.assign(service, {
        name: String(msg.name || origin).slice(0, 80),
        description: String(msg.description || "").slice(0, 300),
        url: sameOrigin(msg.url, origin) ? msg.url : origin + "/",
        tools: cleanTools(msg.tools),
        live: true,
      });
      known[origin] = { name: service.name, description: service.description, url: service.url, tools: service.tools, lastSeen: Date.now() };
      save("known", known);
      note(`${service.name} connected with ${service.tools.length} tool${service.tools.length === 1 ? "" : "s"}`);
      toolsChanged();
    } else if (msg.t === "result") {
      service.pending.get(msg.id)?.(msg.result);
      service.pending.delete(msg.id);
    } else if (msg.t === "bye") {
      disconnectService(service, "closed");
    }
  };
  // Nothing reliable tells us when the other end of a port goes away, so the
  // "bye" above and the ping below cover it.
}

function sameOrigin(url, origin) {
  try { return new URL(url).origin === origin; } catch { return false; }
}

function cleanTools(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.slice(0, 50).filter((t) => t && /^[A-Za-z0-9_-]{1,48}$/.test(t.name)).map((t) => ({
    name: t.name,
    description: String(t.description || "").slice(0, 500),
    inputSchema: t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} },
  }));
}

function disconnectService(service, why) {
  if (!service || service.gone) return;
  service.gone = true;
  service.live = false;
  try { service.port.close(); } catch {}
  for (const done of service.pending.values()) done({ content: [{ type: "text", text: "The site went away." }], isError: true });
  service.pending.clear();
  if (services.get(service.origin) === service) services.delete(service.origin);
  for (const grant of [...grants.values()]) if (grant.kind === "tool" && grant.service === service.origin) grants.delete(grant.id);
  if (why !== "replaced") note(`${service.name} disconnected`);
  toolsChanged();
}

setInterval(() => {
  for (const service of [...services.values()]) {
    if (!service.live) continue;
    if (++service.missed > 3) disconnectService(service, "timeout");
    else service.port.postMessage({ t: "ping" });
  }
}, 5000);

function callService(service, name, args, peer) {
  return new Promise((resolve) => {
    const id = uid();
    const timer = setTimeout(() => {
      service.pending.delete(id);
      resolve({ content: [{ type: "text", text: "The site did not answer in time." }], isError: true });
    }, 30000);
    service.pending.set(id, (result) => { clearTimeout(timer); resolve(result); });
    service.port.postMessage({ t: "call", id, name, args, peer });
  });
}

function toolsChanged() {
  for (const port of registryPorts) port.postMessage({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
  broadcast();
}

// ------------------------------------------------------------------ grants

function reply(page, msg, extra, transfer = []) {
  page.port.postMessage({ t: "granted", reqId: msg.reqId, ...extra }, transfer);
}

// One tool, one caller, direct line. After this the hub is out of the path.
function grantTool(page, msg) {
  const service = services.get(msg.service);
  const tool = service?.live && service.tools.find((t) => t.name === msg.tool);
  if (!tool) return reply(page, msg, { ok: false, reason: "That site is not connected right now." });
  const grant = { id: uid(), kind: "tool", client: msg.client, service: service.origin, tool: tool.name, at: Date.now() };
  grants.set(grant.id, grant);
  const channel = new MessageChannel();
  service.port.postMessage({ t: "channel", tool: tool.name, peer: msg.client, grantId: grant.id }, [channel.port1]);
  note(`${host(msg.client)} was introduced to ${tool.name} on ${service.name}`);
  reply(page, msg, { ok: true, grantId: grant.id, tool, service: { name: service.name, origin: service.origin } }, [channel.port2]);
  broadcast();
}

function grantRegistry(page, msg) {
  const grant = { id: uid(), kind: "registry", client: msg.client, at: Date.now() };
  const channel = new MessageChannel();
  grant.port = channel.port1;
  grants.set(grant.id, grant);
  registryPorts.add(channel.port1);
  channel.port1.onmessage = async (event) => {
    const out = await mcp(event.data, msg.client);
    if (out) channel.port1.postMessage(out);
  };
  note(`${host(msg.client)} was given the tool registry`);
  reply(page, msg, { ok: true, grantId: grant.id }, [channel.port2]);
  broadcast();
}

function grantAgent(page, msg) {
  const grant = { id: uid(), kind: "agent", client: msg.client, at: Date.now() };
  const channel = new MessageChannel();
  grant.port = channel.port1;
  grant.conn = { port: channel.port1, client: msg.client, sessions: new Set() };
  grants.set(grant.id, grant);
  channel.port1.onmessage = (event) => acp(grant.conn, event.data);
  note(`${host(msg.client)} was connected to your agent`);
  reply(page, msg, { ok: true, grantId: grant.id }, [channel.port2]);
  broadcast();
}

function revoke(grantId) {
  const grant = grants.get(grantId);
  if (!grant) return;
  grants.delete(grantId);
  if (grant.kind === "tool") services.get(grant.service)?.port.postMessage({ t: "revoke", grantId });
  if (grant.port) { registryPorts.delete(grant.port); grant.port.close(); }
  note(`Access for ${host(grant.client)} was revoked`);
  broadcast();
}

const host = (origin) => { try { return new URL(origin).host; } catch { return String(origin); } };

// ---------------------------------------------------------- registry (MCP)

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "site";

function allTools() {
  const out = [];
  for (const service of services.values()) {
    if (!service.live) continue;
    for (const tool of service.tools) {
      out.push({ service, tool, name: `${slug(service.name)}__${tool.name}`.slice(0, 64) });
    }
  }
  return out;
}

// Answer one MCP message. Used for registry ports held by sites, and for the
// agent bridge, which reaches the same registry over the relay.
async function mcp(msg, peer) {
  if (!msg || !msg.method || msg.id === undefined) return null;
  const ok = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
  switch (msg.method) {
    case "initialize":
      return ok({
        protocolVersion: msg.params?.protocolVersion || "2025-06-18",
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "port-authority", version: "0.1.0" },
        instructions: "Tools offered by the websites this person has connected to their hub. Each call runs inside that website's open tab.",
      });
    case "ping": return ok({});
    case "tools/list":
      return ok({
        tools: allTools().map(({ name, tool, service }) => ({
          name, description: `${tool.description} (from ${service.name}, ${host(service.origin)})`, inputSchema: tool.inputSchema,
        })),
      });
    case "tools/call": {
      const match = allTools().find((t) => t.name === msg.params?.name);
      if (!match) return ok({ content: [{ type: "text", text: `No tool called ${msg.params?.name}` }], isError: true });
      note(`${peer === "agent" ? "Your agent" : host(peer)} called ${match.tool.name} on ${match.service.name}`);
      broadcast();
      return ok(await callService(match.service, match.tool.name, msg.params.arguments || {}, peer));
    }
    default:
      return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } };
  }
}

// -------------------------------------------------------------- agent (ACP)

// Every site that is granted the agent gets a port that speaks ACP. The hub
// stays in the middle on purpose: a website must not be able to choose the
// agent's working directory or hand it MCP servers, and one site must not see
// another site's session.
async function acp(conn, msg) {
  if (!msg || typeof msg !== "object") return;
  const backend = agentConfig.mode === "relay" ? relay : builtin;
  const send = (out) => conn.port.postMessage({ jsonrpc: "2.0", ...out });
  if (msg.method === undefined) return backend.answer?.(conn, msg); // a reply to something the agent asked
  const fail = (code, message) => msg.id !== undefined && send({ id: msg.id, error: { code, message } });
  try {
    switch (msg.method) {
      case "initialize":
        return send({ id: msg.id, result: await backend.initialize() });
      case "session/new": {
        const sessionId = await backend.newSession(conn);
        conn.sessions.add(sessionId);
        return send({ id: msg.id, result: { sessionId } });
      }
      case "session/prompt":
        if (!conn.sessions.has(msg.params?.sessionId)) return fail(-32602, "Unknown session");
        return send({ id: msg.id, result: await backend.prompt(conn, msg.params) });
      case "session/cancel":
        if (conn.sessions.has(msg.params?.sessionId)) backend.cancel?.(msg.params);
        return;
      default:
        return fail(-32601, "Method not found");
    }
  } catch (err) {
    fail(-32000, String(err.message || err));
  }
}

function connFor(sessionId) {
  for (const grant of grants.values()) if (grant.conn?.sessions.has(sessionId)) return grant.conn;
  return null;
}

// The built-in agent has no language model. It matches words in the prompt
// against the registry and calls the best tool, which is enough to show the
// whole path working before you connect a real agent.
const builtin = {
  async initialize() {
    return {
      protocolVersion: 1,
      agentCapabilities: { loadSession: false, promptCapabilities: { image: false, audio: false, embeddedContext: false } },
      agentInfo: { name: "port-authority-demo", title: "Built-in demo agent", version: "0.1.0" },
      authMethods: [],
    };
  },
  async newSession() { return `demo-${uid()}`; },
  async prompt(conn, { sessionId, prompt }) {
    const text = (prompt || []).filter((p) => p.type === "text").map((p) => p.text).join(" ");
    const update = (u) => conn.port.postMessage({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: u } });
    const say = (t) => update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } });
    const tools = allTools();
    if (!tools.length) {
      say("I am the built-in demo agent, and no site is offering tools to your hub yet. Open the florist or the library and connect them, then ask again.");
      return { stopReason: "end_turn" };
    }
    const words = tokens(text);
    const scored = tools.map((t) => ({ ...t, score: overlap(words, tokens(`${t.tool.name} ${t.tool.description} ${t.service.name}`)) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best.score) {
      say(`I am the built-in demo agent. I match words, I do not think. Nothing in the registry matched that. I can reach: ${tools.map((t) => t.tool.name).join(", ")}.`);
      return { stopReason: "end_turn" };
    }
    const args = guessArgs(best.tool.inputSchema, text);
    const toolCallId = `call-${uid()}`;
    say(`That sounds like ${best.tool.name} on ${best.service.name}. Calling it in their tab.\n\n`);
    update({ sessionUpdate: "tool_call", toolCallId, title: `${best.service.name}: ${best.tool.name}`, kind: "other", status: "in_progress", rawInput: args });
    note(`The demo agent called ${best.tool.name} on ${best.service.name} for ${host(conn.client)}`);
    broadcast();
    const result = await callService(best.service, best.tool.name, args, "agent");
    const out = (result.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    update({
      sessionUpdate: "tool_call_update", toolCallId, status: result.isError ? "failed" : "completed",
      content: [{ type: "content", content: { type: "text", text: out } }], rawOutput: result.structuredContent,
    });
    say(result.isError ? `It failed: ${out}` : `Done. ${best.service.name} answered:\n${out}`);
    return { stopReason: "end_turn" };
  },
};

const STOP = new Set("a an the to of for and or me my i is it on in at with please can you some any that this want need would like".split(" "));
function tokens(text) {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)).map((w) => w.replace(/(ing|s)$/, "")));
}
function overlap(a, b) { let n = 0; for (const w of a) if (b.has(w)) n++; return n; }
function guessArgs(schema, text) {
  const args = {};
  const quoted = text.match(/"([^"]+)"|'([^']+)'/);
  for (const [key, prop] of Object.entries(schema?.properties || {})) {
    if (prop.enum) {
      const hit = prop.enum.find((v) => text.toLowerCase().includes(String(v).toLowerCase()));
      if (hit !== undefined) args[key] = hit;
    } else if (prop.type === "number" || prop.type === "integer") {
      const n = text.match(/\d+(\.\d+)?/);
      if (n) args[key] = Number(n[0]);
    } else if (prop.type === "string") {
      args[key] = quoted ? quoted[1] || quoted[2] : text;
    }
  }
  return args;
}

// The user's own agent, reached through the relay. The hub is the one ACP
// client the agent sees. It rewrites request ids so several sites can share
// the connection, and it routes updates back by session.
const relay = {
  ws: null, status: "off", present: false, info: null, hello: null,
  nextId: 1, pending: new Map(), asked: new Map(), initialized: null, retry: 0, timer: null,

  connect() {
    if (!agentConfig.room) return;
    this.disconnect(true);
    this.status = "connecting";
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = this.ws = new WebSocket(`${scheme}//${location.host}/relay/${agentConfig.room}?role=hub`);
    ws.onopen = () => { this.status = "open"; this.retry = 0; broadcast(); };
    ws.onmessage = (event) => { try { this.onFrame(JSON.parse(event.data)); } catch {} };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.status = "closed"; this.present = false; this.initialized = null;
      this.failAll("The relay connection dropped.");
      broadcast();
      if (agentConfig.mode === "relay") this.timer = setTimeout(() => this.connect(), Math.min(30000, 1000 * 2 ** this.retry++));
    };
    broadcast();
  },
  disconnect(quiet) {
    clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch {}
    this.status = "off"; this.present = false; this.initialized = null; this.info = null; this.hello = null;
    this.failAll("The agent was disconnected.");
    if (!quiet) broadcast();
  },
  failAll(message) {
    for (const { reject } of this.pending.values()) reject(new Error(message));
    this.pending.clear();
  },
  frame(ch, msg) { this.ws?.readyState === 1 && this.ws.send(JSON.stringify({ ch, msg })); },
  request(method, params) {
    if (!this.present) return Promise.reject(new Error("Your agent is not connected. Start the bridge on your machine."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.frame("acp", { jsonrpc: "2.0", id, method, params });
    });
  },
  async onFrame({ ch, msg, peer, present, hello }) {
    if (ch === "ctl") {
      if (peer === "agent") {
        this.present = !!present;
        if (!present) { this.initialized = null; this.info = null; this.hello = null; this.failAll("Your agent went away."); note("Your agent disconnected"); }
      }
      if (hello) { this.hello = hello; this.present = true; note(`Your agent bridge connected (${hello.agent || "agent"})`); this.initialize().catch(() => {}); }
      return broadcast();
    }
    if (ch === "mcp") {
      const out = await mcp(msg, "agent");
      if (out) this.frame("mcp", out);
      return;
    }
    if (ch !== "acp" || !msg) return;
    if (msg.method === undefined) {
      const waiting = this.pending.get(msg.id);
      if (!waiting) return;
      this.pending.delete(msg.id);
      return msg.error ? waiting.reject(new Error(msg.error.message || "Agent error")) : waiting.resolve(msg.result);
    }
    // Something the agent sent us: an update, or a question for the site.
    const conn = connFor(msg.params?.sessionId);
    if (msg.id === undefined) return conn?.port.postMessage(msg);
    if (!conn) return this.frame("acp", { jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "Unknown session" } });
    const localId = `a${uid()}`;
    this.asked.set(localId, msg.id);
    conn.port.postMessage({ ...msg, id: localId });
  },
  answer(conn, msg) {
    if (!this.asked.has(msg.id)) return;
    const id = this.asked.get(msg.id);
    this.asked.delete(msg.id);
    this.frame("acp", { ...msg, id });
  },
  initialize() {
    return this.initialized ||= this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "port-authority", title: "Port Authority hub", version: "0.1.0" },
    }).then((info) => { this.info = info; broadcast(); return info; }, (err) => { this.initialized = null; throw err; });
  },
  async newSession() {
    const info = await this.initialize();
    // The bridge runs an MCP server that leads back to the registry in this
    // worker, so the agent can use every tool the user's sites are offering.
    const mcpServers = [];
    if (this.hello?.mcp) mcpServers.push(info.agentCapabilities?.mcpCapabilities?.http && this.hello.mcp.http ? this.hello.mcp.http : this.hello.mcp.stdio);
    const { sessionId } = await this.request("session/new", { cwd: this.hello?.cwd || "/", mcpServers: mcpServers.filter(Boolean) });
    return sessionId;
  },
  prompt(conn, params) { return this.request("session/prompt", { sessionId: params.sessionId, prompt: params.prompt }); },
  cancel(params) { this.frame("acp", { jsonrpc: "2.0", method: "session/cancel", params: { sessionId: params.sessionId } }); },
};
