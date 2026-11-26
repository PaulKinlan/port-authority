# Port Authority (working name)

Experiments in what the web can do when sites hand each other `MessagePort`s:
Web Intents for the agent era, a registry of WebMCP-style tools, and the
user's own agent on any site over the Agent Client Protocol.

Live: https://port-authority.dev

## What is here

| Path | What it is |
| --- | --- |
| `sites/main/` | The experiments homepage, the port patterns page, and the hub |
| `sites/main/about/` | Who made the site and how it came to be, from Web Intents in 2011 to now. Every page's footer links to it |
| `sites/main/hub.js` | Client library: `serve()`, `pick()`, `registry()`, `agent()`, `intentLinks()` |
| `sites/main/hub/popup.html` | The window sites open to ask the user (the picker) |
| `sites/main/bridge.mjs` | Run beside an ACP agent; connects it to the hub and gives it the registry as an MCP server |
| `sites/florist`, `library`, `planner` | Three demo sites, each served on its own origin |
| `sites/main/chat/` | A chat app with no AI account of its own. It asks the AI router for a model and speaks the Chat Completions API over the port. Conversations are kept in IndexedDB (`db.js`), with any images sent in them. Answers are drawn by `markdown.js`, which trusts nothing a model writes and never loads an image |
| `sites/router/` | The AI router, on its own origin. `router.js` is what a site loads (`connect()`, `fromPort()`, and `ai.chat.completions.create()` in the shape of the Chat Completions API, which `chat.js` answers over Hawser), `frame.html` is the hidden frame that holds a site's grant (`host.js` is the job it does, which `pick.js` also does for a site whose own Content-Security-Policy forbids the frame: the router window then stays open and `ai.mode` is `"window"`), `call-worker.js` is the worker that calls the model provider. It is served at `/call/<provider>.js`, with a `connect-src` of that provider's one chat endpoint and nothing else (`routerCsp()` in `src/worker.js`), and checks that it is held to that policy before it takes a key. `call.html`, at `/call/<provider>`, is the hidden page that does the same job in a browser that does not hold a worker to its own policy (`caller.js` chooses; `calling.js` is the job). Accounts are kept at the router's address with each key encrypted beside a `CryptoKey` the browser will not export (`store.js`), `pick.html` is the window where the person chooses an account, sees what a site has used and can stop it, `index.html` lists accounts and the sites that were allowed. The router keeps nothing on a server: a grant is kept in the browser's IndexedDB for the router's address inside that site (`grants.js`), where the worker counts each request against its limit, and the API key crosses from the window to the frame encrypted to a key only the frame holds (`seal.js`). No router page except the call page may connect to anything. `sw.js` is a service worker that keeps a copy of the router's own files, asks the network first, and uses the copy when the router's address cannot be reached; `keep.js` registers it. Explained at `sites/main/ai-router/`; used by `sites/florist/card/` and `sites/library/digest/` |
| `sites/shared/hawser.js` | Hawser (working name): Comlink's idea rebuilt on today's platform. One file, no dependencies, served on every origin |
| `sites/main/missing/` | What the web platform is missing: the list of things for browser vendors to build or fix, each with evidence and links to the spec issue or bug. `probes.js` and `more-probes.js` run each gap as a check in the reader's browser, using the lab's `kinds.js`. `effects-demo.js` and `demos.js` are the running demos, which talk to `sites/shared/effects.html` and `sites/shared/missing-peer.html` on another origin. `census.js` is the wide table of what can be copied, moved and sent to another origin. `test/missing.mjs` covers it |
| `sites/main/reading/` | Further reading: links to reference pages, specifications, articles, libraries, talks and papers. Edit `links.json`, then run `node scripts/reading.mjs` to rebuild `index.html`. `node scripts/reading.mjs --check` fetches every link |
| `sites/main/comlink/` | The Comlink chapter. Three demos that do real work, each with Comlink 4.4.2 beside Hawser: a fractal on two workers (`render-worker.js`), a third-party widget on another origin (`sites/shared/comlink/widget.html`), and a journal in a locked OPFS file (`journal-worker.js`). Then how Comlink works and what has changed |
| `sites/shared/portwire.js` | A `MessagePort` over anything that carries bytes in order. Data, bytes, ports and streams posted into it are rebuilt on the other side. No dependencies |
| `sites/shared/farport.js` | A `MessagePort` whose other end is on another device: a pairing code, a WebRTC data channel, and `portwire.js` on top. The page the other device opens is `sites/main/far/` |
| `sites/shared/alive.js` | Knowing whether the other side of a port is still there, on a second port kept for health checks: `watch()` / `answer()` (ping and answer), `beat()` / `listen()` (one-way beats), `holdLock()` / `whenReleased()` (a Web Lock, one origin only), and `announce()` (a goodbye on `pagehide`, a pause on `freeze` and the back/forward cache). Demos in `sites/main/patterns/alive.js`, far side in `sites/shared/alive-far.js` |
| `sites/shared/oneway.js` | `oneWay()`: two channels and a valve, for a port link that carries messages in one direction only |
| `sites/shared/pair-sw.js`, `pair/` | The service worker of one site joined to the service worker of another by a port that pages carry across, with time limits and rejoining for when the browser stops a worker. `pair-shared.js` and `pair/tab.html` do the same with shared workers. Explained at `/patterns/swpair/` (`sites/main/patterns/pairs.js`), tested by `test/pairs.mjs` |
| `sites/shared/refs.js` | Links the first mention of a platform feature in each section to MDN, and adds a References list to the foot of the page with what each feature is, its MDN page and its specification. A page opts in with one script tag. `node scripts/check-refs.mjs` checks every address and spec anchor |
| `sites/shared/qr.js` | A small QR encoder, for the link a phone scans |
| `sites/shared/` | CSS and the patch-bay diagram component used by the demos (`wire.js`). A box made with `stage.frame()` is a sandboxed `srcdoc` iframe with an opaque origin, and is never called a site. A box that is called a site loads `actor.html` from one of the demo origins, and `actor.js` holds the part it plays. `stage.cable()` takes the kind of line: only the default is a `MessageChannel`, and a stream, a fetch, a plain `postMessage` and a WebRTC connection are each drawn as what they are |
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
  exists (only behind a flag in Chromium; it was removed from the HTML
  standard in October 2026), and an optional heartbeat catches a crash. There is also a per-link `timeout`.
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
node --test test/chat.unit.mjs test/markdown.unit.mjs        # the Chat Completions face of the router, and the chat app's Markdown
node --test test/providers.unit.mjs                          # what is sent to each provider and what is made of its stream: text, images, tool calls
NODE_PATH=$(npm root -g) node test/airouter.mjs              # the AI router end to end, against stand-in providers
NODE_PATH=$(npm root -g) node test/chat.mjs                  # the chat app, and a site that cannot have the router's frame
NODE_PATH=$(npm root -g) node test/hostile.mjs               # a hostile site that taps, forges and reaches for the key, and gets none of it
NODE_PATH=$(npm root -g) node test/site-headers.mjs          # a site under each header that changes what it may embed or open: COOP, COEP, CSP, sandbox
NODE_PATH=$(npm root -g) node test/attacks.mjs               # the attack lab page (/ai-router/attacks/): every attack pressed, and its verdicts checked against the key
NODE_PATH=$(npm root -g) node test/offline.mjs               # every request to the router's address is failed, and the router goes on working from the service worker's copy
NODE_PATH=$(npm root -g) node test/callpage.mjs              # the call page, which makes the call where the call worker cannot be used, and a worker that is not held to its policy
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

Merging to `main` deploys. Cloudflare Workers Builds is connected to this
repository and runs one deploy per Worker on every push to `main`:

| Worker | Address | Deploy command |
| --- | --- | --- |
| `portauthority` | https://port-authority.dev | `npx wrangler deploy` |
| `pa-florist` | https://pa-florist.kinlan-test.workers.dev | `npx wrangler deploy -c deploy/florist.jsonc` |
| `pa-library` | https://pa-library.kinlan-test.workers.dev | `npx wrangler deploy -c deploy/library.jsonc` |
| `pa-planner` | https://pa-planner.kinlan-test.workers.dev | `npx wrangler deploy -c deploy/planner.jsonc` |
| `pa-router` | https://llmchannel.dev (and still https://pa-router.kinlan-test.workers.dev) | `npx wrangler deploy -c deploy/router.jsonc` |

All five run `src/worker.js` and carry the whole `sites/` folder as static
assets; the script picks the folder by hostname. The three demo sites use the
main Worker's Durable Objects (hub, lab, meeting point), so `portauthority`
has to exist before they deploy. `pa-router` has no Durable Object: the router keeps
nothing on a server. The Router class that once kept grants there was deleted by a
migration, with what it stored, and `/r/` answers 410.

A build's log is in the Cloudflare dashboard under the Worker, in Deployments.
A new Worker name needs a file in `deploy/` and a build trigger on Cloudflare.

## Known limits

- Tested in Chromium only so far.
- The hub's owner key lives in the hub origin's localStorage in one browser. Clearing it, or using another browser, gives you a new empty hub.
- The bridge address contains the only secret between a hub and its agent.
- The real-agent path is tested with a stand-in ACP agent (`test/fake-agent.mjs`), not yet with Claude Code or Gemini CLI.
- A line to an already-open tab is a WebRTC data channel, so it carries JSON only. Ports and streams cannot be sent over it. A line to a window the hub opened is a real port and can carry them.
- The WebRTC handshake passes through the hub server, as all WebRTC signalling does, so the server is trusted to introduce the right two tabs.
