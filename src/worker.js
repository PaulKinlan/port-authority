// Port Authority worker.
//
// 1. Serves a different folder of /sites depending on the hostname, so one
//    script can stand in for several unrelated origins (the hub, and the demo
//    sites that talk through it).
// 2. Runs the relay: a Durable Object per room that forwards WebSocket frames
//    between the hub in the browser and an agent bridge on someone's machine.

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

    if (url.pathname.startsWith("/relay/")) {
      const room = url.pathname.slice(7);
      if (!/^[A-Za-z0-9_-]{16,64}$/.test(room)) return new Response("bad room", { status: 400 });
      if (request.headers.get("upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      return env.RELAY.get(env.RELAY.idFromName(room)).fetch(request);
    }

    if (url.pathname === "/_sites.js") {
      const body = "export const sites = " + JSON.stringify(siteOrigins(url)) + ";\nexport const site = " + JSON.stringify(site) + ";\n";
      return new Response(body, { headers: { "content-type": TYPES.js, "access-control-allow-origin": "*", "cache-control": "no-cache" } });
    }

    // Interim deploy path: files are pushed into KV until the repository has a
    // normal `wrangler deploy` with static assets.
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

// One room per hub. Frames from the hub go to the agent bridge and back.
// The room name is a long random secret that the hub generates.
export class Relay {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const role = new URL(request.url).searchParams.get("role") === "agent" ? "agent" : "hub";
    const other = role === "agent" ? "hub" : "agent";
    for (const old of this.state.getWebSockets(role)) old.close(4000, "replaced by a newer connection");
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1], [role]);
    const others = this.state.getWebSockets(other);
    pair[1].send(JSON.stringify({ ch: "ctl", peer: other, present: others.length > 0 }));
    for (const ws of others) ws.send(JSON.stringify({ ch: "ctl", peer: role, present: true }));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  roleOf(ws) { return this.state.getTags(ws)[0]; }

  webSocketMessage(ws, message) {
    const other = this.roleOf(ws) === "agent" ? "hub" : "agent";
    for (const peer of this.state.getWebSockets(other)) peer.send(message);
  }

  webSocketClose(ws) {
    const role = this.roleOf(ws);
    const other = role === "agent" ? "hub" : "agent";
    const still = this.state.getWebSockets(role).some((s) => s !== ws);
    if (!still) for (const peer of this.state.getWebSockets(other)) peer.send(JSON.stringify({ ch: "ctl", peer: role, present: false }));
  }

  webSocketError(ws) { this.webSocketClose(ws); }
}
