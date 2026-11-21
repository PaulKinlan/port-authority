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
| `sites/main/hub/popup.html` | The window sites open to ask the user (the picker) |
| `sites/main/bridge.mjs` | Run beside an ACP agent; connects it to the hub and gives it the registry as an MCP server |
| `sites/florist`, `library`, `planner` | Three demo sites, each served on its own origin |
| `sites/router/` | The AI router, on its own origin. `router.js` is what a site loads (`connect()`, `fromPort()`), `frame.html` is the hidden frame that holds a site's grant and calls the model provider, `pick.html` is the window where the person chooses an account, `index.html` lists accounts and grants. Explained at `sites/main/ai-router/`; used by `sites/florist/card/` and `sites/library/digest/` |
| `sites/shared/hawser.js` | Hawser (working name): Comlink's idea rebuilt on today's platform. One file, no dependencies, served on every origin |
| `sites/main/reading/` | Further reading: links to reference pages, specifications, articles, libraries, talks and papers. Edit `links.json`, then run `node scripts/reading.mjs` to rebuild `index.html`. `node scripts/reading.mjs --check` fetches every link |
| `sites/main/comlink/` | The Comlink chapter. Three demos that do real work, each with Comlink 4.4.2 beside Hawser: a fractal on two workers (`render-worker.js`), a third-party widget on another origin (`sites/shared/comlink/widget.html`), and a journal in a locked OPFS file (`journal-worker.js`). Then how Comlink works and what has changed |
| `sites/shared/portwire.js` | A `MessagePort` over anything that carries bytes in order. Data, bytes, ports and streams posted into it are rebuilt on the other side. No dependencies |
| `sites/shared/farport.js` | A `MessagePort` whose other end is on another device: a pairing code, a WebRTC data channel, and `portwire.js` on top. The page the other device opens is `sites/main/far/` |
| `sites/shared/oneway.js` | `oneWay()`: two channels and a valve, for a port link that carries messages in one direction only |
| `sites/shared/qr.js` | A small QR encoder, for the link a phone scans |
| `sites/shared/` | CSS and the patch-bay diagram component used by the demos |
| `src/worker.js` | Cloudflare Worker: picks a site folder by hostname, and runs the hub (one Durable Object per person) |

## How the hub works

The hub is one Durable Object per person. It holds the registry (which sites
offer which tools) and the way to the person's agent. It does not carry calls
between sites.

1. A site with tools calls `serve()`. The first time, a click opens the hub
   window, the person agrees, and the site is given a token bound to its origin.
   It keeps the token in its own storage and from then on registers its tools
   over a WebSocket every time it loads.
2. A site that needs something calls `pick("send flowers")`. The hub window
   lists matching tools from the server, so none of those sites need to be open.
   The person picks one, the window opens that site, passes each side one end
   of a `MessageChannel`, and closes. The call is local and works offline.
   If that site is already open in a tab, no window is opened: the server
   introduces the two tabs and they open a WebRTC channel between themselves.
3. `registry()` returns a port that speaks MCP for every site that is open, and
   `agent()` returns a port that speaks ACP. These two are carried by the hub
   server, because an agent runs on a machine and not in a tab.
4. The agent is either a built-in stand-in (no model) or the person's own,
   connected by `bridge.mjs`.

The hub is a visible window, never a hidden iframe: storage inside a cross-site
iframe is partitioned by top-level site, so it could not be shared.

## Hawser

`hawser.js` keeps Comlink's shape (`expose` on one end of a port, `wrap` on the
other) and changes what the platform now allows:

- Calls reject with `LinkClosedError` when the other side goes away. A closing
  page says goodbye on `pagehide`, the port `close` event is used where it
  exists (Chromium 157 keeps it behind `MessagePortCloseEvent`), and an
  optional heartbeat catches a crash. There is also a per-link `timeout`.
- Functions, class instances and async generators cross by reference with no
  marking, multiplexed on the one port with reference counts. They are released
  by `Symbol.dispose`, by a `FinalizationRegistry`, or when the link closes.
- An `AbortSignal` argument arrives as a working signal.
- `api.open("x").latest().title()` is sent as one message; the far side
  resolves the chain against the real values.
- A path cannot reach `constructor`, `__proto__` or anything on
  `Object.prototype` / `Function.prototype`. `expose(..., { only })` is an
  allow list, and `port(remote, { only, signal })` mints a narrowed, revocable
  port for a third party.
- Errors keep their class, name and `cause`. A proxy sent home is the original
  object again.

Design choices that were weighed and dropped: one `MessageChannel` per proxied
value (Comlink's way; simple, but nothing ties the channels' lifetimes
together and each costs a port), and keeping call results on the far side
until acknowledged so chains could be built at any time (it doubles the
message count; chaining within one tick needs no retention at all).

```
node --test test/portwire.unit.mjs                           # 14 unit tests of the port bridge, no browser
NODE_PATH=$(npm root -g) node test/further.mjs <screenshot-dir>  # cross-device streams and ports, the one-way port
node --expose-gc --test test/hawser.unit.mjs                 # 31 unit tests, no browser
NODE_PATH=$(npm root -g) node test/hawser.mjs <screenshot-dir>   # the /comlink/ demos, 24 checks
```

## Run it

```
npm install
npx wrangler dev --port 8787
```

Open http://hub.localhost:8787 (also `florist.`, `library.`, `planner.localhost:8787`).

```
NODE_PATH=$(npm root -g) node test/e2e.mjs       # hub across four origins
NODE_PATH=$(npm root -g) node test/relay.mjs     # site -> hub -> bridge -> agent -> tools
NODE_PATH=$(npm root -g) node test/more.mjs <screenshot-dir>
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
- The hub's owner key lives in the hub origin's localStorage in one browser. Clearing it, or using another browser, gives you a new empty hub.
- The bridge address contains the only secret between a hub and its agent.
- The real-agent path is tested with a stand-in ACP agent (`test/fake-agent.mjs`), not yet with Claude Code or Gemini CLI.
- A line to an already-open tab is a WebRTC data channel, so it carries JSON only. Ports and streams cannot be sent over it. A line to a window the hub opened is a real port and can carry them.
- The WebRTC handshake passes through the hub server, as all WebRTC signalling does, so the server is trusted to introduce the right two tabs.
