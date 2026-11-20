// Port Authority worker.
//
// 1. Serves a different folder of /sites depending on the hostname, so one
//    script can stand in for several unrelated origins (the hub, and the demo
//    sites that talk through it).
// 2. Runs the hub: one Durable Object per person. It is the part that is
//    always on, so nobody has to keep a tab open. Sites, the hub window and
//    the agent bridge each hold a WebSocket to it.

const LABELS = {
  portauthority: "main", hub: "main", localhost: "main",
  "pa-florist": "florist", florist: "florist",
  "pa-library": "library", library: "library",
  "pa-planner": "planner", planner: "planner",
};
const PROD = { main: "portauthority", florist: "pa-florist", library: "pa-library", planner: "pa-planner" };
const LOCAL = { main: "hub", florist: "florist", library: "library", planner: "planner" };

const TYPES = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json", svg: "image/svg+xml", txt: "text/plain; charset=utf-8",
  png: "image/png", ico: "image/x-icon", md: "text/markdown; charset=utf-8",
};

function label(host) { return host.split(":")[0].split(".")[0]; }
function siteFor(host) { return LABELS[label(host)] || "main"; }

function siteOrigins(url) {
  const host = url.host;
  const first = host.split(".")[0];
  const local = host.includes("localhost") || host.startsWith("127.");
  const rest = host.includes(".") ? host.slice(first.length) : "." + host; // ".kinlan-test.workers.dev"
  const names = local ? LOCAL : PROD;
  const out = {};
  for (const [site, name] of Object.entries(names)) out[site] = url.protocol + "//" + name + rest;
  return out;
}

async function readAsset(env, key) {
  if (env.ASSETS) {
    const res = await env.ASSETS.fetch(new Request("https://assets.local/" + key));
    return res.ok ? res.body : null;
  }
  if (env.FILES) return env.FILES.get(key, "stream");
  return null;
}

async function serve(env, site, pathname) {
  let path = decodeURIComponent(pathname);
  if (path.includes("..")) return null;
  if (path.endsWith("/")) path += "index.html";
  const candidates = [site + path, "shared" + path];
  if (!/\.[a-z0-9]+$/i.test(path)) candidates.push(site + path + "/index.html");
  for (const key of candidates) {
    const body = await readAsset(env, key);
    if (body) {
      const ext = key.split(".").pop().toLowerCase();
      return new Response(body, {
        headers: {
          "content-type": TYPES[ext] || "application/octet-stream",
          "cache-control": "no-cache",
          // The hub library and bridge are loaded by other origins on purpose.
          "access-control-allow-origin": "*",
        },
      });
    }
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const site = siteFor(url.host);

    // /h/<hub id>: a WebSocket into one person's hub.
    if (url.pathname.startsWith("/h/")) {
      const id = url.pathname.slice(3);
      if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return new Response("bad hub id", { status: 400 });
      if (request.headers.get("upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      return env.HUB.get(env.HUB.idFromName(id)).fetch(request);
    }

    if (url.pathname === "/_sites.js") {
      const body = "export const sites = " + JSON.stringify(siteOrigins(url)) + ";\nexport const site = " + JSON.stringify(site) + ";\n";
      return new Response(body, { headers: { "content-type": TYPES.js, "access-control-allow-origin": "*", "cache-control": "no-cache" } });
    }

    // Interim deploy path: files are pushed into KV until the repository has a
    // normal wrangler deploy with static assets.
    if (url.pathname.startsWith("/_upload/") && request.method === "PUT") {
      if (!env.UPLOAD_TOKEN || !env.FILES) return new Response("uploads are off", { status: 404 });
      if (request.headers.get("authorization") !== "Bearer " + env.UPLOAD_TOKEN) return new Response("no", { status: 401 });
      await env.FILES.put(url.pathname.slice(9), await request.arrayBuffer());
      return new Response("ok");
    }

    if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
    return (await serve(env, site, url.pathname)) || new Response("Not found", { status: 404, headers: { "content-type": TYPES.txt } });
  },
};

// ------------------------------------------------------------------ the hub

const enc = new TextEncoder();
async function sha(text) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function rand(bytes = 24) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const hostOf = (origin) => { try { return new URL(origin).host; } catch { return String(origin); } };
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "site";
const textResult = (text, isError = false) => ({ content: [{ type: "text", text }], isError });
const STOP = new Set("a an the to of for and or me my i is it on in at with please can you some any that this want need would like".split(" "));
function tokens(text) {
  return new Set(String(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)).map((w) => w.replace(/(ing|s)$/, "")));
}
function guessArgs(schema, text) {
  const args = {};
  const quoted = text.match(/"([^"]+)"|'([^']+)'/);
  for (const [key, prop] of Object.entries((schema && schema.properties) || {})) {
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
function cleanTools(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.slice(0, 50).filter((t) => t && /^[A-Za-z0-9_-]{1,48}$/.test(t.name)).map((t) => ({
    name: t.name,
    description: String(t.description || "").slice(0, 500),
    inputSchema: t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} },
  }));
}

// Three kinds of socket connect here:
//   owner  the hub window or dashboard, on the hub's own origin, holding the owner key
//   site   a website, holding a token that only works from that website's origin
//   agent  the bridge beside the person's own agent
export class Hub {
  constructor(state) {
    this.state = state;
    this.storage = state.storage;
    this.pending = new Map();
    this.data = null;
  }

  async load() {
    if (this.data) return this.data;
    const keys = ["known", "grants", "sessions", "log", "agent", "agentInit", "agentHello", "lines"];
    const got = await this.storage.get(keys);
    this.data = {
      known: got.get("known") || {}, grants: got.get("grants") || {}, sessions: got.get("sessions") || {},
      log: got.get("log") || [], agent: got.get("agent") || { mode: "builtin", token: null },
      agentInit: got.get("agentInit") || null, agentHello: got.get("agentHello") || null,
      lines: got.get("lines") || {},
    };
    return this.data;
  }
  save(key) { return this.storage.put(key, this.data[key]); }
  note(text) {
    this.data.log.unshift({ at: Date.now(), text });
    this.data.log.length = Math.min(this.data.log.length, 60);
    this.save("log");
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    const token = url.searchParams.get("token") || "";
    const origin = request.headers.get("origin") || "";
    const d = await this.load();
    const meta = { role, id: rand(6) };
    const refuse = (why) => new Response(why, { status: 403 });
    if (role === "owner") {
      // Only pages on the hub's own origin can be the owner. The first key
      // presented claims the hub; after that only that key opens it.
      if (origin !== url.origin) return refuse("wrong origin");
      const have = await this.storage.get("owner");
      const mine = await sha(token);
      if (!have) { if (token.length < 20) return refuse("weak key"); await this.storage.put("owner", mine); }
      else if (have !== mine) return refuse("wrong key");
    } else if (role === "site") {
      // The browser sets Origin on the handshake. A page cannot fake it, so a
      // token stolen from one site is no use on another.
      const bound = await this.storage.get("site:" + (await sha(token)));
      if (!bound || bound !== origin) return refuse("unknown site");
      meta.origin = origin;
    } else if (role === "agent") {
      if (!d.agent.token || d.agent.token !== token) return refuse("unknown agent");
      for (const old of this.state.getWebSockets("agent")) old.close(4000, "replaced by a newer bridge");
    } else {
      return new Response("bad role", { status: 400 });
    }
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1], [role, meta.id]);
    pair[1].serializeAttachment(meta);
    if (role === "agent") pair[1].send(JSON.stringify({ ch: "ctl", peer: "hub", present: true }));
    if (role === "owner") pair[1].send(JSON.stringify(this.snapshot()));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // ---- who is here

  siteSockets(origin) {
    return this.state.getWebSockets("site").filter((ws) => { const m = ws.deserializeAttachment(); return m && m.origin === origin; });
  }
  serviceSocket(origin) {
    return this.state.getWebSockets("site").find((ws) => { const m = ws.deserializeAttachment(); return ws !== this.leaving && m && m.origin === origin && m.registered; });
  }
  agentSocket() { return this.state.getWebSockets("agent").find((s) => s.readyState === 1 && s !== this.leaving) || null; }
  liveServices() {
    const out = [];
    for (const [origin, k] of Object.entries(this.data.known)) if (this.serviceSocket(origin)) out.push({ origin, ...k });
    return out;
  }
  allTools() {
    const out = [];
    for (const service of this.liveServices()) for (const tool of service.tools) out.push({ service, tool, name: (slug(service.name) + "__" + tool.name).slice(0, 64) });
    return out;
  }

  snapshot() {
    const d = this.data;
    return {
      t: "state",
      services: Object.entries(d.known).map(([origin, k]) => ({ origin, ...k, live: !!this.serviceSocket(origin) })).sort((a, b) => Number(b.live) - Number(a.live)),
      grants: Object.values(d.grants),
      agent: { mode: d.agent.mode, room: d.agent.token, present: !!this.agentSocket(), info: d.agentInit, cwd: d.agentHello ? d.agentHello.cwd : null },
      log: d.log,
    };
  }
  broadcast() {
    const state = JSON.stringify(this.snapshot());
    for (const ws of this.state.getWebSockets("owner")) ws.send(state);
  }
  toolsChanged() {
    for (const grant of Object.values(this.data.grants)) {
      if (grant.kind !== "registry") continue;
      for (const ws of this.siteSockets(grant.client)) ws.send(JSON.stringify({ t: "rpc", grant: grant.id, msg: { jsonrpc: "2.0", method: "notifications/tools/list_changed" } }));
    }
    this.broadcast();
  }

  // ---- messages

  async webSocketMessage(ws, raw) {
    await this.load();
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const meta = ws.deserializeAttachment();
    if (meta.role === "owner") return this.fromOwner(ws, msg);
    if (meta.role === "site") return this.fromSite(ws, meta, msg);
    if (meta.role === "agent") return this.fromAgent(ws, msg);
  }

  async webSocketClose(ws) {
    await this.load();
    const meta = ws.deserializeAttachment() || {};
    this.leaving = ws;
    try { ws.close(); } catch {}
    if (meta.role === "site" && meta.registered) {
      const still = this.state.getWebSockets("site").some((s) => s !== ws && (s.deserializeAttachment() || {}).origin === meta.origin && (s.deserializeAttachment() || {}).registered);
      if (!still) { this.note((this.data.known[meta.origin] || {}).name + " disconnected"); this.toolsChanged(); }
    }
    if (meta.role === "agent" && !this.state.getWebSockets("agent").some((s) => s !== ws)) {
      this.data.agentInit = null; this.data.agentHello = null;
      this.save("agentInit"); this.save("agentHello");
      this.note("Your agent disconnected");
      this.broadcast();
    }
  }
  webSocketError(ws) { return this.webSocketClose(ws); }

  async fromOwner(ws, msg) {
    const d = this.data;
    const reply = (extra) => ws.send(JSON.stringify({ t: "granted", reqId: msg.reqId, ...extra }));
    const grant = (g) => { g.id = rand(9); g.at = Date.now(); d.grants[g.id] = g; this.save("grants"); return g; };
    switch (msg.t) {
      case "mint": {
        // A token for one site. It only works when the browser says the
        // connection really comes from that origin.
        const token = rand(24);
        await this.storage.put("site:" + (await sha(token)), msg.origin);
        return reply({ ok: true, token });
      }
      case "intro":
        // The tool's site is already open in a tab. Introduce the two tabs
        // so they can open a WebRTC channel between themselves: we carry the
        // handshake, and after that the calls do not come here.
        if (msg.rtc) {
          if (!this.serviceSocket(msg.service)) return reply({ ok: false });
          const now = Date.now();
          for (const [id, l] of Object.entries(d.lines)) if (now - l.at > 120000) delete d.lines[id];
          const line = rand(12);
          d.lines[line] = { client: msg.client, service: msg.service, tool: String(msg.tool), at: now };
          this.save("lines");
          this.serviceSocket(msg.service).send(JSON.stringify({ t: "line", line, tool: String(msg.tool), peer: msg.client }));
          this.note(hostOf(msg.client) + " was introduced to " + msg.tool + " in the open " + ((d.known[msg.service] || {}).name || hostOf(msg.service)) + " tab");
          reply({ ok: true, line });
          return this.broadcast();
        }
        // The picker made an introduction on the person's machine. The call
        // itself never comes here. We only write down that it happened.
        this.note(hostOf(msg.client) + " was introduced to " + msg.tool + " on " + ((d.known[msg.service] || {}).name || hostOf(msg.service)));
        return this.broadcast();
      case "grant-registry": {
        const g = grant({ kind: "registry", client: msg.client });
        this.note(hostOf(msg.client) + " was given the tool registry");
        reply({ ok: true, grantId: g.id });
        return this.broadcast();
      }
      case "grant-agent": {
        const g = grant({ kind: "agent", client: msg.client });
        this.note(hostOf(msg.client) + " was connected to your agent");
        reply({ ok: true, grantId: g.id });
        return this.broadcast();
      }
      case "revoke": {
        const g = d.grants[msg.grantId];
        if (!g) return;
        delete d.grants[msg.grantId];
        this.save("grants");
        for (const site of this.siteSockets(g.client)) site.send(JSON.stringify({ t: "revoked", grant: g.id }));
        this.note("Access for " + hostOf(g.client) + " was revoked");
        return this.broadcast();
      }
      case "forget": {
        delete d.known[msg.origin];
        this.save("known");
        for (const site of this.siteSockets(msg.origin)) site.close(4001, "forgotten");
        return this.toolsChanged();
      }
      case "agent-config": {
        d.agent = { mode: msg.mode, token: msg.fresh || !d.agent.token ? rand(24) : d.agent.token };
        this.save("agent");
        if (msg.fresh || msg.mode !== "relay") for (const a of this.state.getWebSockets("agent")) a.close(4002, "agent setting changed");
        this.note(msg.mode === "relay" ? "Agent set to your own agent" : "Agent set to the built-in demo agent");
        return this.broadcast();
      }
    }
  }

  async fromSite(ws, meta, msg) {
    const d = this.data;
    if (msg.t === "register") {
      d.known[meta.origin] = {
        name: String(msg.name || meta.origin).slice(0, 80),
        description: String(msg.description || "").slice(0, 300),
        url: String(msg.url || "").startsWith(meta.origin + "/") ? msg.url : meta.origin + "/",
        tools: cleanTools(msg.tools),
        lastSeen: Date.now(),
      };
      this.save("known");
      meta.registered = true;
      ws.serializeAttachment(meta);
      this.note(d.known[meta.origin].name + " connected with " + d.known[meta.origin].tools.length + " tools");
      ws.send(JSON.stringify({ t: "registered" }));
      return this.toolsChanged();
    }
    if (msg.t === "result") {
      const done = this.pending.get(msg.id);
      if (done) { this.pending.delete(msg.id); done(msg.result); }
      return;
    }
    if (msg.t === "signal") {
      // WebRTC handshake for a line the person made in the picker. Only the
      // two origins on that line can use it, and only to reach each other.
      const l = d.lines[msg.line];
      if (!l || Date.now() - l.at > 120000) return;
      const frame = JSON.stringify({ t: "signal", line: msg.line, data: msg.data });
      if (meta.origin === l.client) { const to = this.serviceSocket(l.service); if (to) to.send(frame); }
      else if (meta.origin === l.service) for (const to of this.siteSockets(l.client)) to.send(frame);
      return;
    }
    if (msg.t !== "rpc") return;
    const grant = d.grants[msg.grant];
    const send = (out) => ws.send(JSON.stringify({ t: "rpc", grant: msg.grant, msg: { jsonrpc: "2.0", ...out } }));
    const m = msg.msg || {};
    if (!grant || grant.client !== meta.origin) {
      if (m.id !== undefined && m.method) send({ id: m.id, error: { code: -32001, message: "This access was revoked." } });
      return ws.send(JSON.stringify({ t: "revoked", grant: msg.grant }));
    }
    if (grant.kind === "registry") {
      const out = await this.mcp(m, meta.origin);
      return out && send(out);
    }
    if (grant.kind === "agent") return this.acp(ws, meta, grant, m, send);
  }

  callService(origin, name, args, peer) {
    const ws = this.serviceSocket(origin);
    if (!ws) return Promise.resolve(textResult("That site is not open right now.", true));
    return new Promise((resolve) => {
      const id = rand(9);
      const timer = setTimeout(() => { this.pending.delete(id); resolve(textResult("The site did not answer in time.", true)); }, 30000);
      this.pending.set(id, (result) => { clearTimeout(timer); resolve(result); });
      ws.send(JSON.stringify({ t: "call", id, name, args, peer }));
    });
  }

  // The registry, as MCP. Used by sites that were granted it, and by the agent.
  async mcp(msg, peer) {
    if (!msg || !msg.method || msg.id === undefined) return null;
    const ok = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
    if (msg.method === "initialize") {
      return ok({
        protocolVersion: (msg.params && msg.params.protocolVersion) || "2025-06-18",
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "port-authority", version: "0.2.0" },
        instructions: "Tools offered by the websites this person has connected to their hub. Each call runs inside that website's open tab.",
      });
    }
    if (msg.method === "ping") return ok({});
    if (msg.method === "tools/list") {
      return ok({ tools: this.allTools().map(({ name, tool, service }) => ({ name, description: tool.description + " (from " + service.name + ", " + hostOf(service.origin) + ")", inputSchema: tool.inputSchema })) });
    }
    if (msg.method === "tools/call") {
      const match = this.allTools().find((t) => t.name === (msg.params && msg.params.name));
      if (!match) return ok(textResult("No tool called " + (msg.params && msg.params.name), true));
      this.note((peer === "agent" ? "Your agent" : hostOf(peer)) + " called " + match.tool.name + " on " + match.service.name);
      this.broadcast();
      return ok(await this.callService(match.service.origin, match.tool.name, msg.params.arguments || {}, peer));
    }
    return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } };
  }

  // ---- the agent, as ACP. The hub stays in the middle on purpose: a website
  // must not choose the agent's folder or hand it servers, and one site must
  // not see another site's session.
  async acp(ws, meta, grant, m, send) {
    const d = this.data;
    const own = (sessionId) => d.sessions[sessionId] === grant.id;
    if (d.agent.mode !== "relay") return this.builtin(grant, m, send, own);
    const agent = this.agentSocket();
    const toAgent = (out) => agent.send(JSON.stringify({ ch: "acp", msg: { jsonrpc: "2.0", ...out } }));
    if (m.method === undefined) {
      // The site is answering something the agent asked.
      if (agent && typeof m.id === "string" && m.id.startsWith("a|")) toAgent({ ...m, id: JSON.parse(m.id.slice(2)) });
      return;
    }
    const fail = (message) => m.id !== undefined && send({ id: m.id, error: { code: -32000, message } });
    if (!agent || !d.agentInit) return fail("Your agent is not connected. Start the bridge on your machine.");
    const tag = (kind) => [kind, meta.id, grant.id, JSON.stringify(m.id)].join("|");
    if (m.method === "initialize") return send({ id: m.id, result: d.agentInit });
    if (m.method === "session/new") {
      const hello = d.agentHello || {};
      const caps = (d.agentInit.agentCapabilities || {}).mcpCapabilities || {};
      const server = hello.mcp ? (caps.http && hello.mcp.http ? hello.mcp.http : hello.mcp.stdio) : null;
      return toAgent({ id: tag("n"), method: "session/new", params: { cwd: hello.cwd || "/", mcpServers: server ? [server] : [] } });
    }
    if (m.method === "session/prompt") {
      if (!own(m.params && m.params.sessionId)) return fail("Unknown session");
      return toAgent({ id: tag("p"), method: "session/prompt", params: { sessionId: m.params.sessionId, prompt: m.params.prompt } });
    }
    if (m.method === "session/cancel") {
      if (own(m.params && m.params.sessionId)) toAgent({ method: "session/cancel", params: { sessionId: m.params.sessionId } });
      return;
    }
    return fail("Method not found");
  }

  async fromAgent(ws, frame) {
    const d = this.data;
    if (frame.ch === "ctl" && frame.hello) {
      d.agentHello = frame.hello;
      this.save("agentHello");
      this.note("Your agent bridge connected (" + (frame.hello.agent || "agent") + ")");
      ws.send(JSON.stringify({ ch: "acp", msg: { jsonrpc: "2.0", id: "init", method: "initialize", params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "port-authority", title: "Port Authority hub", version: "0.2.0" },
      } } }));
      return this.broadcast();
    }
    if (frame.ch === "mcp") {
      const out = await this.mcp(frame.msg, "agent");
      if (out) ws.send(JSON.stringify({ ch: "mcp", msg: out }));
      return;
    }
    const m = frame.msg;
    if (frame.ch !== "acp" || !m) return;
    const toSite = (grantId, id, out) => {
      const target = id ? this.state.getWebSockets(id) : this.siteSockets((d.grants[grantId] || {}).client);
      for (const site of target) site.send(JSON.stringify({ t: "rpc", grant: grantId, msg: { jsonrpc: "2.0", ...out } }));
    };
    if (m.method === undefined) {
      if (m.id === "init") {
        if (m.result) { d.agentInit = m.result; this.save("agentInit"); this.broadcast(); }
        return;
      }
      const parts = String(m.id).split("|");
      const kind = parts[0], socketId = parts[1], grantId = parts[2], original = JSON.parse(parts.slice(3).join("|") || "null");
      if (kind === "n" && m.result && m.result.sessionId && d.grants[grantId]) { d.sessions[m.result.sessionId] = grantId; this.save("sessions"); }
      return toSite(grantId, socketId, m.error ? { id: original, error: m.error } : { id: original, result: m.result });
    }
    // An update, or a question, from the agent about one session.
    const grantId = d.sessions[m.params && m.params.sessionId];
    if (!grantId || !d.grants[grantId]) {
      if (m.id !== undefined) ws.send(JSON.stringify({ ch: "acp", msg: { jsonrpc: "2.0", id: m.id, error: { code: -32602, message: "Unknown session" } } }));
      return;
    }
    toSite(grantId, null, m.id === undefined ? m : { ...m, id: "a|" + JSON.stringify(m.id) });
  }

  // The built-in agent has no language model. It matches words in the prompt
  // against the registry and calls the best tool, so the whole path can be
  // seen working before a real agent is connected.
  async builtin(grant, m, send, own) {
    const d = this.data;
    if (m.method === "initialize") {
      return send({ id: m.id, result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: false, promptCapabilities: { image: false, audio: false, embeddedContext: false } },
        agentInfo: { name: "port-authority-demo", title: "Built-in demo agent", version: "0.2.0" },
        authMethods: [],
      } });
    }
    if (m.method === "session/new") {
      const sessionId = "demo-" + rand(9);
      d.sessions[sessionId] = grant.id;
      this.save("sessions");
      return send({ id: m.id, result: { sessionId } });
    }
    if (m.method !== "session/prompt") return m.id !== undefined && send({ id: m.id, error: { code: -32601, message: "Method not found" } });
    const sessionId = m.params && m.params.sessionId;
    if (!own(sessionId)) return send({ id: m.id, error: { code: -32602, message: "Unknown session" } });
    const text = ((m.params && m.params.prompt) || []).filter((p) => p.type === "text").map((p) => p.text).join(" ");
    const update = (u) => send({ method: "session/update", params: { sessionId, update: u } });
    const say = (t) => update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } });
    const done = () => send({ id: m.id, result: { stopReason: "end_turn" } });
    const tools = this.allTools();
    if (!tools.length) { say("I am the built-in demo agent, and no site is offering tools to your hub right now. Open the florist or the library, then ask again."); return done(); }
    const words = tokens(text);
    const scored = tools.map((t) => {
      const have = tokens(t.tool.name + " " + t.tool.description + " " + t.service.name);
      let score = 0; for (const w of words) if (have.has(w)) score++;
      return { ...t, score };
    }).sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best.score) { say("I am the built-in demo agent. I match words, I do not think. Nothing in the registry matched that. I can reach: " + tools.map((t) => t.tool.name).join(", ") + "."); return done(); }
    const args = guessArgs(best.tool.inputSchema, text);
    const toolCallId = "call-" + rand(6);
    say("That sounds like " + best.tool.name + " on " + best.service.name + ". Calling it in their tab.\n\n");
    update({ sessionUpdate: "tool_call", toolCallId, title: best.service.name + ": " + best.tool.name, kind: "other", status: "in_progress", rawInput: args });
    this.note("The demo agent called " + best.tool.name + " on " + best.service.name + " for " + hostOf(grant.client));
    this.broadcast();
    const result = await this.callService(best.service.origin, best.tool.name, args, "agent");
    const out = (result.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    update({ sessionUpdate: "tool_call_update", toolCallId, status: result.isError ? "failed" : "completed", content: [{ type: "content", content: { type: "text", text: out } }] });
    say(result.isError ? "It failed: " + out : "Done. " + best.service.name + " answered:\n" + out);
    return done();
  }
}
