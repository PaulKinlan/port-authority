// A tiny ACP agent for tests. On each prompt it lists the MCP tools it was
// given and calls the one whose name appears in the prompt.
import { createInterface } from "node:readline";
const out = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
const sessions = new Map();
let n = 0;
async function mcp(server, method, params) {
  const res = await fetch(server.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}
createInterface({ input: process.stdin }).on("line", async (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") return out({ id: msg.id, result: { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true, sse: false } }, agentInfo: { name: "fake", title: "Fake test agent", version: "0" }, authMethods: [] } });
  if (msg.method === "session/new") {
    const sessionId = `s${++n}`;
    sessions.set(sessionId, msg.params);
    return out({ id: msg.id, result: { sessionId } });
  }
  if (msg.method === "session/prompt") {
    const { sessionId, prompt } = msg.params;
    const text = prompt.map((p) => p.text).join(" ");
    const say = (t) => out({ method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } } } });
    try {
      const server = sessions.get(sessionId).mcpServers[0];
      await mcp(server, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake", version: "0" } });
      const { tools } = await mcp(server, "tools/list");
      say(`cwd=${sessions.get(sessionId).cwd} tools=${tools.map((t) => t.name).join(",")}\n`);
      const tool = tools.find((t) => text.includes(t.name.split("__")[1]));
      if (tool) {
        const result = await mcp(server, "tools/call", { name: tool.name, arguments: { bouquet: "quiet", recipient: "Relay Test", query: "chickens", title: "chickens" } });
        say(`result=${result.content[0].text}`);
      }
    } catch (err) { say(`error=${err.message}`); }
    return out({ id: msg.id, result: { stopReason: "end_turn" } });
  }
  if (msg.id !== undefined) out({ id: msg.id, error: { code: -32601, message: "Method not found" } });
});
