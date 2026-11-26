// Unit tests for the Hub Durable Object in src/worker.js, and for what the Worker sends for the AI router's pages.
//   node --test test/worker.unit.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import worker, * as everything from "../src/worker.js";
const { Hub } = everything;

function memoryStorage() {
  const map = new Map();
  return {
    async get(key) {
      if (Array.isArray(key)) {
        const out = new Map();
        for (const k of key) if (map.has(k)) out.set(k, structuredClone(map.get(k)));
        return out;
      }
      return map.has(key) ? structuredClone(map.get(key)) : undefined;
    },
    async put(key, value) { map.set(key, structuredClone(value)); },
    async delete(keys) { for (const k of [keys].flat()) map.delete(k); },
    async list({ prefix = "" } = {}) {
      const out = new Map();
      for (const [k, v] of map) if (k.startsWith(prefix)) out.set(k, structuredClone(v));
      return out;
    },
  };
}

function fakeSocket(tags, attachment) {
  const sent = [];
  let att = structuredClone(attachment);
  return {
    readyState: 1,
    tags,
    sent,
    send(text) { sent.push(JSON.parse(text)); },
    close() { this.readyState = 3; },
    serializeAttachment(v) { att = structuredClone(v); },
    deserializeAttachment() { return structuredClone(att); },
  };
}

function makeHub() {
  const sockets = [];
  const state = {
    storage: memoryStorage(),
    getWebSockets(tag) {
      return sockets.filter((s) => s.readyState === 1 && (!tag || s.tags.includes(tag)));
    },
  };
  const hub = new Hub(state);
  const attach = (role, extra = {}) => {
    const id = extra.id || `${role}-${sockets.length + 1}`;
    const ws = fakeSocket([role, id], { role, id, ...extra });
    sockets.push(ws);
    return ws;
  };
  return { hub, attach, state };
}

test("Hub routes ACP session/request_permission to the owner, not the requesting site", async () => {
  const { hub, attach } = makeHub();
  await hub.load();
  hub.data.agent = { mode: "relay", token: "agent-token-12345678901234567890" };
  hub.data.agentInit = { protocolVersion: 1 };
  hub.data.grants.g1 = { id: "g1", kind: "agent", client: "https://site-a.example", at: 1 };
  hub.data.sessions.s1 = "g1";

  const owner = attach("owner");
  const siteA = attach("site", { origin: "https://site-a.example" });
  const agent = attach("agent");

  await hub.fromAgent(agent, {
    ch: "acp",
    msg: {
      jsonrpc: "2.0", id: 7, method: "session/request_permission",
      params: { sessionId: "s1", toolCall: { title: "Run shell command", kind: "execute" }, options: [{ optionId: "allow_once", name: "Allow once", kind: "allow_once" }] },
    },
  });

  // Site A never receives the permission prompt.
  assert.equal(siteA.sent.length, 0);
  // Owner receives it in the state broadcast.
  const stateMsg = owner.sent.at(-1);
  assert.equal(stateMsg.permissions.length, 1);
  assert.equal(stateMsg.permissions[0].client, "https://site-a.example");
  assert.equal(stateMsg.permissions[0].toolCall.title, "Run shell command");

  // Owner approves it; agent receives the selected option.
  await hub.fromOwner(owner, { t: "permission", id: stateMsg.permissions[0].id, optionId: "allow_once" });
  assert.deepEqual(agent.sent.at(-1), { ch: "acp", msg: { jsonrpc: "2.0", id: 7, result: { outcome: { outcome: "selected", optionId: "allow_once" } } } });
  assert.equal(owner.sent.at(-1).permissions.length, 0);

  // If no owner tab is open, permission requests fail closed immediately.
  owner.close();
  await hub.fromAgent(agent, {
    ch: "acp",
    msg: { jsonrpc: "2.0", id: 8, method: "session/request_permission", params: { sessionId: "s1", options: [{ optionId: "allow_once", kind: "allow_once" }] } },
  });
  assert.deepEqual(agent.sent.at(-1), { ch: "acp", msg: { jsonrpc: "2.0", id: 8, result: { outcome: { outcome: "cancelled" } } } });
});

test("Hub binds non-permission agent requests to their grant and handles malformed IDs", async () => {
  const { hub, attach } = makeHub();
  await hub.load();
  hub.data.agent = { mode: "relay", token: "agent-token-12345678901234567890" };
  hub.data.agentInit = { protocolVersion: 1 };
  hub.data.grants.g1 = { id: "g1", kind: "agent", client: "https://site-a.example", at: 1 };
  hub.data.grants.g2 = { id: "g2", kind: "agent", client: "https://site-b.example", at: 1 };
  hub.data.sessions.s1 = "g1";

  const siteA = attach("site", { origin: "https://site-a.example" });
  const siteB = attach("site", { origin: "https://site-b.example" });
  const agent = attach("agent");

  // Agent asks site A a non-permission question.
  await hub.fromAgent(agent, { ch: "acp", msg: { jsonrpc: "2.0", id: 42, method: "custom/ask", params: { sessionId: "s1" } } });
  assert.equal(siteA.sent.length, 1);
  const opaqueId = siteA.sent[0].msg.id;
  assert.ok(typeof opaqueId === "string" && opaqueId.startsWith("a|"));

  // Site B cannot spoof a reply even if it knows the opaque ID, nor crash the hub with malformed JSON.
  await hub.fromSite(siteB, siteB.deserializeAttachment(), { t: "rpc", grant: "g2", msg: { id: opaqueId, result: { spoofed: true } } });
  await hub.fromSite(siteB, siteB.deserializeAttachment(), { t: "rpc", grant: "g2", msg: { id: "a|{invalid", result: {} } });
  assert.equal(agent.sent.length, 0);

  // Site A's genuine reply is forwarded with the original agent ID, and only once.
  await hub.fromSite(siteA, siteA.deserializeAttachment(), { t: "rpc", grant: "g1", msg: { id: opaqueId, result: { ok: true } } });
  assert.deepEqual(agent.sent, [{ ch: "acp", msg: { jsonrpc: "2.0", id: 42, result: { ok: true } } }]);

  // Clearing this.leaving on socket close.
  await hub.webSocketClose(siteA);
  assert.equal(hub.leaving, null);
});

// The AI router's own domain. /_sites.js is what tells every page which site
// it is on and where the others live, so it is asked here as a browser would.
const hosts = async (address, vars = {}) => {
  const env = { MAIN_HOST: "port-authority.dev", DEMO_SUFFIX: ".kinlan-test.workers.dev", ...vars };
  const source = await (await worker.fetch(new Request(address + "/_sites.js"), env)).text();
  return { site: JSON.parse(source.match(/export const site = (.*);/)[1]), sites: JSON.parse(source.match(/export const sites = (.*);/)[1]) };
};

test("without ROUTER_HOST the router stays at its workers.dev address", async () => {
  const router = await hosts("https://pa-router.kinlan-test.workers.dev");
  assert.equal(router.site, "router");
  assert.equal(router.sites.router, "https://pa-router.kinlan-test.workers.dev");
  assert.equal(router.sites.main, "https://port-authority.dev");
});

test("with ROUTER_HOST the router's domain is the router, and every site is told so", async () => {
  const vars = { ROUTER_HOST: "llmchannel.dev" };
  const router = await hosts("https://llmchannel.dev", vars);
  assert.equal(router.site, "router");
  assert.equal(router.sites.router, "https://llmchannel.dev");

  const main = await hosts("https://port-authority.dev", vars);
  assert.equal(main.site, "main");
  assert.equal(main.sites.router, "https://llmchannel.dev");
  assert.equal(main.sites.florist, "https://pa-florist.kinlan-test.workers.dev");

  // The old address still answers as the router, so keys saved there can be removed.
  const old = await hosts("https://pa-router.kinlan-test.workers.dev", vars);
  assert.equal(old.site, "router");
  assert.equal(old.sites.router, "https://llmchannel.dev");
});

test("a domain nobody named is the main site, which is why ROUTER_HOST is needed", async () => {
  assert.equal((await hosts("https://llmchannel.dev")).site, "main");
});

// What each router page may connect to. The header is read the way a browser
// gets it: by asking the Worker for the page.
const assetsAsked = [];
const routerEnv = () => ({
  MAIN_HOST: "port-authority.dev", DEMO_SUFFIX: ".kinlan-test.workers.dev", ROUTER_HOST: "llmchannel.dev",
  ASSETS: { fetch: async (request) => { assetsAsked.push(new URL(request.url).pathname); return new Response("<!doctype html>"); } },
});
const policy = async (path) => {
  const header = (await worker.fetch(new Request("https://llmchannel.dev" + path), routerEnv())).headers.get("content-security-policy") || "";
  return Object.fromEntries(header.split("; ").map((part) => [part.split(" ")[0], part.split(" ").slice(1).join(" ")]));
};

test("the class that kept the router's grants on the server is gone", () => {
  assert.equal("Router" in everything, false);
});

test("the router has no server: the address that kept grants answers that it has gone", async () => {
  let reached = false;
  const env = { ...routerEnv(), ROUTER: { idFromName: () => "id", get: () => ({ fetch: async () => { reached = true; return new Response("{}"); } }) } };
  for (const action of ["grant", "list", "use", "status", "report", "revoke"]) {
    const response = await worker.fetch(new Request("https://llmchannel.dev/r/person1234567890abcd/" + action, { method: "POST", headers: { origin: "https://llmchannel.dev", "content-type": "application/json" }, body: "{}" }), env);
    assert.equal(response.status, 410, action);
  }
  assert.equal(reached, false);
});

test("every /call-worker/<provider>.js is the one call worker, sent with the policy it checks itself against", async () => {
  const { PROVIDERS, callWorkerPolicy } = await import("../sites/router/providers.js");
  const header = async (path) => (await worker.fetch(new Request("https://llmchannel.dev" + path), routerEnv())).headers.get("content-security-policy");
  assetsAsked.length = 0;
  for (const [id, provider] of Object.entries(PROVIDERS)) {
    if (!provider.kind) continue;
    assert.equal(await header("/call-worker/" + id + ".js"), callWorkerPolicy(id), id);
    assert.equal(assetsAsked.at(-1), "/router/call-worker.js", id);
  }
  assert.equal(await header("/call-worker/anthropic.js"), "default-src 'none'; script-src 'self'; connect-src https://api.anthropic.com/v1/messages");
  // A worker for a provider the router does not have may connect to nothing, and will not judge itself fit.
  assert.equal(await header("/call-worker/nothing.js"), "default-src 'none'; script-src 'self'; connect-src 'none'");
  assert.equal(callWorkerPolicy("nothing"), null);
  // The call page keeps its own, longer policy.
  assert.equal(await header("/call/anthropic"), "default-src 'none'; script-src 'self'; connect-src https://api.anthropic.com/v1/messages; base-uri 'none'; form-action 'none'");
});

test("the two scripts a site's own page loads may be used from the browser's copy while a new one is fetched", async () => {
  const cache = async (path) => (await worker.fetch(new Request("https://llmchannel.dev" + path), routerEnv())).headers.get("cache-control");
  assert.equal(await cache("/router.js"), "max-age=60, stale-while-revalidate=604800");
  assert.equal(await cache("/hawser.js"), "max-age=60, stale-while-revalidate=604800");
  // Everything else is checked with the server every time. The router's own pages have the service worker for when it is gone.
  for (const path of ["/", "/frame.html", "/frame.js", "/pick.html", "/sw.js", "/call-worker/anthropic.js", "/call/anthropic", "/providers.js"]) assert.equal(await cache(path), "no-cache", path);
  // And only at the router's address: the main site's copy of hawser.js is as it was.
  assert.equal((await worker.fetch(new Request("https://port-authority.dev/hawser.js"), routerEnv())).headers.get("cache-control"), "no-cache");
});

test("the service worker may fetch the router's own files, and nothing else", async () => {
  assert.deepEqual(await policy("/sw.js"), { "default-src": "'none'", "connect-src": "'self'" });
  // The one the call worker is under may do nothing at all, and has no fetch handler to be shown a request with.
  assert.deepEqual(await policy("/quiet.js"), { "default-src": "'none'" });
  const { readFile } = await import("node:fs/promises");
  const quiet = await readFile(new URL("../sites/router/quiet.js", import.meta.url), "utf8");
  assert.ok(!/addEventListener\(\s*["']fetch["']|onfetch/.test(quiet));
  const keep = await readFile(new URL("../sites/router/keep.js", import.meta.url), "utf8");
  assert.ok(keep.includes('register("/quiet.js", { scope: "/call-worker/" })'));
});

test("the service worker keeps a copy of every file a router page can ask for", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const { PROVIDERS } = await import("../sites/router/providers.js");
  const source = await readFile(new URL("../sites/router/sw.js", import.meta.url), "utf8");
  const listed = JSON.parse(/const FILES = (\[[^\]]*\]);/.exec(source)[1].replace(/,\s*\]/, "]"));
  const files = (await readdir(new URL("../sites/router/", import.meta.url))).filter((name) => !["sw.js", "call.html", "call-worker.js", "index.html"].includes(name)).map((name) => "/" + name);
  // The call page and the call worker are each served once for every provider, at an address that names it.
  const calls = Object.entries(PROVIDERS).filter(([, provider]) => provider.kind).map(([id]) => "/call/" + id);
  // The call worker is left out on purpose: it is under the service worker that does nothing, so that this one is never shown its requests.
  assert.ok(!listed.some((path) => path.startsWith("/call-worker/")));
  // What the pages ask for that is not a file in that folder: the home page, shared files, and the list of sites.
  const others = ["/", "/base.css", "/favicon.svg", "/hawser.js", "/_sites.js"];
  assert.deepEqual([...listed].sort(), [...files, ...calls, ...others].sort());
  // Each of them is something the pages really ask for, by that address.
  const pages = (await Promise.all(["index.html", "frame.html", "pick.html", "call.html", "home.js", "pick.js", "frame.js", "host.js", "frame-worker.js"].map((name) => readFile(new URL("../sites/router/" + name, import.meta.url), "utf8")))).join("\n");
  for (const path of others.slice(1)) assert.ok(pages.includes('"' + path + '"'), path + " is asked for by a router page");
});

test("a router page, and the router's worker, may connect to nothing at all", async () => {
  for (const path of ["/", "/frame.html", "/pick.html", "/frame-worker.js", "/grants.js", "/call.js", "/caller.js", "/providers.js"]) {
    const rules = await policy(path);
    assert.equal(rules["connect-src"], "'none'", path);
    assert.equal(rules["default-src"], "'none'", path);
    assert.equal(rules["script-src"], "'self'", path);
  }
});

test("the page that calls a provider may connect to that provider's one chat address and to nothing else", async () => {
  const { PROVIDERS, endpointOf } = await import("../sites/router/providers.js");
  const network = Object.entries(PROVIDERS).filter(([, provider]) => provider.kind);
  assert.ok(network.length >= 5);
  for (const [id] of network) {
    // One address, with its path, and it is the address providers.js calls.
    const allowed = (await policy("/call/" + id))["connect-src"];
    assert.equal(allowed, endpointOf(id), id);
    assert.match(allowed, /^https?:\/\/[^/ ]+\/.+(\/messages|\/chat\/completions)$/, id);
    assert.ok(!allowed.includes(" ") && !allowed.endsWith("/"), id);
  }
  assert.equal((await policy("/call/anthropic"))["connect-src"], "https://api.anthropic.com/v1/messages");
  assert.equal((await policy("/call/openai"))["connect-src"], "https://api.openai.com/v1/chat/completions");
  // A model with no network call has no address.
  assert.equal(endpointOf("builtin"), null);
  assert.equal(endpointOf("constructor"), null);
});

test("every /call/<provider> is the one call page, served with the policy for the provider in its address", async () => {
  assetsAsked.length = 0;
  const response = await worker.fetch(new Request("https://llmchannel.dev/call/anthropic"), routerEnv());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/);
  assert.deepEqual(assetsAsked, ["/router/call.html"]);
  // Only the router has such pages.
  const elsewhere = await worker.fetch(new Request("https://port-authority.dev/call/anthropic"), { ...routerEnv(), ASSETS: { fetch: async () => new Response("no", { status: 404 }) } });
  assert.equal(elsewhere.status, 404);
});

test("a call page that names no provider, or one that is not listed, may connect to nothing", async () => {
  for (const path of ["/call.html", "/call.html?provider=anthropic", "/call/builtin", "/call/example.com", "/call/https:%2F%2Fexample.com", "/call/anthropic%20https:%2F%2Fexample.com", "/call/__proto__", "/call/constructor", "/call/toString", "/call/ANTHROPIC", "/call/anthropic.html"]) {
    assert.equal((await policy(path))["connect-src"], "'none'", path);
  }
  // A query cannot name a provider or add to the policy.
  assert.equal((await policy("/call/anthropic?provider=openai"))["connect-src"], "https://api.anthropic.com/v1/messages");
  assert.equal((await policy("/call/nothing?provider=anthropic"))["connect-src"], "'none'");
});

test("the call page and the frame are sent with the least a page can have", async () => {
  // The call page: its own scripts, one address, and nothing else at all.
  assert.deepEqual(await policy("/call/anthropic"), {
    "default-src": "'none'", "script-src": "'self'", "connect-src": "https://api.anthropic.com/v1/messages", "base-uri": "'none'", "form-action": "'none'",
  });
  // The frame: its own scripts, its worker and the call page. No connection to anything.
  assert.deepEqual(await policy("/frame.html"), {
    "default-src": "'none'", "script-src": "'self'", "worker-src": "'self'", "frame-src": "'self'", "connect-src": "'none'", "base-uri": "'none'", "form-action": "'none'",
  });
  // No policy on any router page lets code in by another way.
  for (const path of ["/", "/pick.html", "/frame.html", "/call/anthropic", "/call/nope", "/call.html"]) {
    const header = (await worker.fetch(new Request("https://llmchannel.dev" + path), routerEnv())).headers.get("content-security-policy");
    assert.ok(!/unsafe-inline|unsafe-eval|unsafe-hashes|wasm-unsafe-eval|\*|data:(?!;)|blob:/.test(header.replace("img-src 'self' data:", "")), path + ": " + header);
    assert.match(header, /(^|; )script-src 'self'(;|$)/, path);
  }
  // The only address other than the router's own in a call page's policy is the provider's.
  const call = (await worker.fetch(new Request("https://llmchannel.dev/call/openai"), routerEnv())).headers.get("content-security-policy");
  assert.deepEqual(call.match(/https?:\/\/[^\s;]+/g), ["https://api.openai.com/v1/chat/completions"]);
});

test("only the frame and the call page can be put inside another page", async () => {
  assert.equal((await policy("/"))["frame-ancestors"], "'none'");
  assert.equal((await policy("/pick.html"))["frame-ancestors"], "'none'");
  assert.equal((await policy("/frame.html"))["frame-ancestors"], undefined);
  assert.equal((await policy("/call/anthropic"))["frame-ancestors"], undefined);
});
