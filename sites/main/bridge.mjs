#!/usr/bin/env node
// Port Authority agent bridge. Needs Node 22 or newer, and nothing else.
//
//   node bridge.mjs "<address from your hub>" -- <command that starts an ACP agent>
//   node bridge.mjs "wss://hub.example/h/ID?token=SECRET" -- npx -y @zed-industries/claude-code-acp
//
// It starts your agent, speaks the Agent Client Protocol to it over stdio, and
// connects outwards to your hub server.
// It also runs a small MCP server on localhost that leads back to the hub's
// tool registry, and tells the agent about it, so your agent can call tools
// that live inside your open browser tabs.
//
// Anyone who has the address can talk to your agent. Treat it like a password.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);

// Used by agents that only launch MCP servers over stdio: forward each line to
// the bridge's HTTP endpoint.
if (argv[0] === "--mcp-stdio") {
  const url = argv[1];
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: line });
    if (res.status !== 202) process.stdout.write((await res.text()) + "\n");
  }
  process.exit(0);
}

const split = argv.indexOf("--");
const relayUrl = argv[0];
const command = split >= 0 ? argv.slice(split + 1) : [];
if (!relayUrl || !/^wss?:\/\//.test(relayUrl) || !command.length) {
  console.error('usage: node bridge.mjs "<address from your hub>" -- <agent command...>');
  process.exit(2);
}
const log = (...args) => console.error("[bridge]", ...args);

// ---- the agent, over stdio ------------------------------------------------
const agent = spawn(command[0], command.slice(1), { stdio: ["pipe", "pipe", "inherit"] });
agent.on("exit", (code) => { log(`agent exited (${code})`); process.exit(code ?? 0); });
agent.on("error", (err) => { log(`could not start agent: ${err.message}`); process.exit(1); });
createInterface({ input: agent.stdout }).on("line", (line) => {
  if (!line.trim()) return;
  try { send("acp", JSON.parse(line)); } catch { log("agent wrote something that is not JSON:", line.slice(0, 120)); }
});

// ---- MCP on localhost, answered by the hub --------------------------------
const mcpWaiting = new Map();
let mcpSeq = 1;
const token = crypto.randomUUID();
const http = createServer(async (req, res) => {
  if (req.url !== `/mcp/${token}`) return res.writeHead(404).end();
  if (req.method !== "POST") return res.writeHead(405, { allow: "POST" }).end();
  let body = "";
  for await (const chunk of req) body += chunk;
  let msg;
  try { msg = JSON.parse(body); } catch { return res.writeHead(400).end(); }
  if (msg.id === undefined) return res.writeHead(202).end(); // notification
  const id = `b${mcpSeq++}`;
  const timer = setTimeout(() => finish({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "The hub did not answer." } }), 60000);
  const finish = (out) => {
    clearTimeout(timer);
    mcpWaiting.delete(id);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
  };
  mcpWaiting.set(id, (out) => finish({ ...out, id: msg.id }));
  if (!send("mcp", { ...msg, id })) finish({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "The hub is not connected." } });
});
await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
const mcpUrl = `http://127.0.0.1:${http.address().port}/mcp/${token}`;

const hello = {
  agent: command.join(" ").slice(0, 80),
  cwd: process.cwd(),
  mcp: {
    http: { type: "http", name: "port-authority", url: mcpUrl, headers: [] },
    stdio: { name: "port-authority", command: process.execPath, args: [fileURLToPath(import.meta.url), "--mcp-stdio", mcpUrl], env: [] },
  },
};

// ---- the relay ------------------------------------------------------------
let ws = null;
let retry = 0;
function send(ch, msg) {
  if (ws?.readyState !== 1) return false;
  ws.send(JSON.stringify({ ch, msg }));
  return true;
}
function connect() {
  const url = new URL(relayUrl);
  url.searchParams.set("role", "agent");
  ws = new WebSocket(url);
  ws.onopen = () => { retry = 0; log("connected to your hub"); };
  ws.onmessage = (event) => {
    let frame;
    try { frame = JSON.parse(event.data); } catch { return; }
    if (frame.ch === "ctl") {
      if (frame.peer === "hub" && frame.present) { ws.send(JSON.stringify({ ch: "ctl", hello })); log("hub is here"); }
      else if (frame.peer === "hub") log("hub went away");
    } else if (frame.ch === "acp") {
      agent.stdin.write(JSON.stringify(frame.msg) + "\n");
    } else if (frame.ch === "mcp") {
      mcpWaiting.get(frame.msg?.id)?.(frame.msg);
    }
  };
  ws.onclose = () => {
    const wait = Math.min(30000, 1000 * 2 ** retry++);
    log(`connection to the hub closed, retrying in ${wait / 1000}s`);
    setTimeout(connect, wait);
  };
  ws.onerror = () => {};
}
connect();
