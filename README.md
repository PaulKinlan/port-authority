# Port Authority (working name)

Experiments in what the web can do when sites hand each other `MessagePort`s:
Web Intents for the agent era, a registry of WebMCP-style tools, and the
user's own agent on any site over the Agent Client Protocol.

Live (interim): https://portauthority.kinlan-test.workers.dev

## What is here

| Path | What it is |
| --- | --- |
| `sites/main/` | The experiments homepage, the port patterns page, and the hub |
| `sites/main/hub.js` | Client library: `serve()`, `pick()`, `registry()`, `agent()`, `intentLinks()` |
| `sites/main/hub/switchboard.js` | The hub's SharedWorker: holds a port per site, makes introductions, serves MCP and ACP on ports |
| `sites/main/hub/popup.html` | The window sites open to ask the user (the picker) |
| `sites/main/bridge.mjs` | Run beside an ACP agent; connects it to the relay and gives it the registry as an MCP server |
| `sites/florist`, `library`, `planner` | Three demo sites, each served on its own origin |
| `sites/shared/` | CSS and the patch-bay diagram component used by the demos |
| `src/worker.js` | Cloudflare Worker: picks a site folder by hostname, and runs the relay (one Durable Object per room) |

## How the hub works

1. A site with tools calls `serve()`. On a click it opens the hub window, which
   passes one end of a `MessageChannel` to the hub's SharedWorker.
2. A site that needs something calls `pick("send flowers")`. The hub window
   shows matching tools, the user picks one, and the worker creates a fresh
   channel: one end goes to the tool's site, the other back to the caller.
   The hub is then out of that conversation.
3. `registry()` returns a port that speaks MCP (`tools/list`, `tools/call`)
   for every connected site. `agent()` returns a port that speaks ACP.
4. The agent is either a built-in stand-in (no model) or the user's own,
   reached through `/relay/<room>` by `bridge.mjs`.

The hub is a visible window, never a hidden iframe: a SharedWorker inside a
cross-site iframe is partitioned by top-level site, so it could not be shared.

## Run it

```
npm install
npx wrangler dev --port 8787
```

Open http://hub.localhost:8787 (also `florist.`, `library.`, `planner.localhost:8787`).

```
NODE_PATH=$(npm root -g) node test/e2e.mjs       # hub across four origins
NODE_PATH=$(npm root -g) node test/relay.mjs     # site -> hub -> relay -> bridge -> agent -> tools
NODE_PATH=$(npm root -g) node test/patterns.mjs <screenshot-dir>
LIVE=kinlan-test.workers.dev ...                 # same tests against the deployment
```

## Deploy

The same script is deployed under four Worker names (`portauthority`,
`pa-florist`, `pa-library`, `pa-planner`) so each demo has a real origin.
For now files are pushed into KV with `scripts/upload.sh`; moving to
`wrangler deploy` with static assets is the next step once this is in a repo.

## Known limits

- Tested in Chromium only so far.
- The relay room name is the only secret between a hub and its agent.
- The real-agent path is tested with a stand-in ACP agent (`test/fake-agent.mjs`), not yet with Claude Code or Gemini CLI.
- The hub must stay open in a tab (or its popup) to keep registrations alive.
