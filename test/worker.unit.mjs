// Unit tests for Hub and Router Durable Objects in src/worker.js.
//   node --test test/worker.unit.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hub, Router } from "../src/worker.js";

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

test("Router allows more than 200 lifetime grants when old ones are revoked or replaced", async () => {
  const router = new Router({ storage: memoryStorage() });
  const owner = "owner-secret-key-at-least-20-chars";
  const secret = "grant-secret-key-at-least-20-chars";
  const call = (action, body) => router.fetch(new Request(`https://router.example/r/person1234567890/${action}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  })).then((r) => r.json());

  // Weak secret must not revoke an existing active grant for the same site.
  const first = await call("grant", { owner, secret, site: "https://a.example", label: "k", provider: "practice", model: "m" });
  assert.equal(first.ok, true);
  const weak = await call("grant", { owner, secret: "short", site: "https://a.example", label: "k", provider: "practice", model: "m" });
  assert.equal(weak.ok, false);
  const stillActive = await call("status", { id: first.id, secret });
  assert.equal(stillActive.ok, true);

  // Create 205 grants by replacing/revoking; inactive history is pruned so it never locks out.
  for (let i = 0; i < 205; i++) {
    const made = await call("grant", { owner, secret, site: `https://site-${i}.example`, label: "k", provider: "practice", model: "m" });
    assert.equal(made.ok, true, `grant ${i} failed: ${made.why}`);
    if (i < 200) {
      const rev = await call("revoke", { owner, id: made.id });
      assert.equal(rev.ok, true);
    }
  }
  const listed = await call("list", { owner });
  assert.equal(listed.ok, true);
  assert.ok(listed.grants.length <= 200);
});

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
