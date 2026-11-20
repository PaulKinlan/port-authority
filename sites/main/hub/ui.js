// Shared by the hub tab and the hub popup: the connection to the switchboard
// worker, and the dashboard that shows what it is holding.

export function switchboard(kind) {
  const worker = new SharedWorker("/hub/switchboard.js", { name: "port-authority" });
  const port = worker.port;
  const listeners = new Set();
  const waiting = new Map();
  let n = 1;
  const sb = {
    state: null,
    kind,
    send: (msg, transfer = []) => port.postMessage(msg, transfer),
    ask(msg, transfer = []) {
      const reqId = n++;
      return new Promise((resolve) => {
        waiting.set(reqId, resolve);
        port.postMessage({ ...msg, reqId }, transfer);
      });
    },
    on(fn) { listeners.add(fn); if (sb.state) fn(sb.state); return () => listeners.delete(fn); },
    setKind(next) { sb.kind = next; port.postMessage({ t: "hello", kind: next }); },
    // Resolves when the state satisfies the test, or with null after the timeout.
    until(test, ms = 15000) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => { off(); resolve(null); }, ms);
        const off = sb.on((state) => { if (test(state)) { clearTimeout(timer); queueMicrotask(off); resolve(state); } });
      });
    },
  };
  port.onmessage = (event) => {
    const msg = event.data;
    if (msg.t === "state") { sb.state = msg; for (const fn of listeners) fn(msg); }
    else if (msg.t === "granted") { waiting.get(msg.reqId)?.({ ...msg, ports: event.ports }); waiting.delete(msg.reqId); }
  };
  // Hold a lock for as long as this window lives. The worker waits on the same
  // lock, and when it gets it, it knows this window has gone.
  const lock = `pa-page-${crypto.randomUUID()}`;
  if (navigator.locks) {
    navigator.locks.request(lock, () => { port.postMessage({ t: "hello", kind, lock }); return new Promise(() => {}); });
  } else {
    port.postMessage({ t: "hello", kind });
    addEventListener("pagehide", () => port.postMessage({ t: "bye" }));
  }
  return sb;
}

const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const host = (origin) => { try { return new URL(origin).host; } catch { return String(origin); } };
const ago = (at) => {
  const s = Math.round((Date.now() - at) / 1000);
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
const KIND = { tool: "one tool", registry: "every tool", agent: "your agent" };

function newRoom() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function mountDashboard(root, sb) {
  root.innerHTML = `
    <section class="stack" aria-labelledby="d-sites">
      <h2 id="d-sites">Sites offering tools</h2>
      <div data-part="services" class="stack"></div>
    </section>
    <section class="stack" aria-labelledby="d-access">
      <h2 id="d-access">Who you have let in</h2>
      <div data-part="grants"></div>
    </section>
    <section class="stack" aria-labelledby="d-agent">
      <h2 id="d-agent">Your agent</h2>
      <div data-part="agent" class="stack"></div>
    </section>
    <section class="stack" aria-labelledby="d-log">
      <h2 id="d-log">What happened</h2>
      <ul class="log" data-part="log"></ul>
    </section>`;
  const part = (name) => root.querySelector(`[data-part="${name}"]`);

  root.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-act]");
    if (!button) return;
    const { act, id } = button.dataset;
    if (act === "revoke") sb.send({ t: "revoke", grantId: id });
    if (act === "forget") sb.send({ t: "forget", origin: id });
    if (act === "copy") navigator.clipboard?.writeText(root.querySelector("[data-command]").textContent).then(() => { button.textContent = "Copied"; });
    if (act === "new-room" && confirm("Make a new relay address? The bridge you are running now will stop working.")) sb.send({ t: "agent-config", mode: "relay", room: newRoom() });
  });
  root.addEventListener("change", (event) => {
    if (event.target.name === "agent-mode") {
      const mode = event.target.value;
      sb.send({ t: "agent-config", mode, room: mode === "relay" ? sb.state.agent.room || newRoom() : sb.state.agent.room });
    }
    if (event.target.name === "agent-example") renderAgent(sb.state, event.target.value);
  });

  let example = "npx -y @zed-industries/claude-code-acp";
  function renderAgent(state, pick) {
    if (pick) example = pick;
    const a = state.agent;
    const wss = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/relay/${a.room}`;
    const status = a.mode !== "relay" ? ""
      : a.present ? `<p><span class="jack on"></span>Connected: <strong>${esc(a.info?.agentInfo?.title || a.info?.agentInfo?.name || "your agent")}</strong>${a.cwd ? `, working in <code>${esc(a.cwd)}</code>` : ""}.</p>`
      : `<p><span class="jack"></span>${a.relay === "open" ? "The relay is ready. Waiting for the bridge on your machine." : "Connecting to the relay."}</p>`;
    part("agent").innerHTML = `
      <fieldset class="choice">
        <legend class="muted small">Sites that ask for your agent get this one</legend>
        <label><input type="radio" name="agent-mode" value="builtin" ${a.mode !== "relay" ? "checked" : ""}> Built-in demo agent
          <span class="muted small">No model. It matches words to tools, so you can see the whole path work.</span></label>
        <label><input type="radio" name="agent-mode" value="relay" ${a.mode === "relay" ? "checked" : ""}> My own agent, on my machine
          <span class="muted small">Any agent that speaks the Agent Client Protocol.</span></label>
      </fieldset>
      ${a.mode === "relay" && a.room ? `
        ${status}
        <div class="stack" style="--gap:.6rem">
          <label for="agent-example">Start it with</label>
          <select id="agent-example" name="agent-example">
            ${[["npx -y @zed-industries/claude-code-acp", "Claude Code"], ["gemini --experimental-acp", "Gemini CLI"], ["<your agent command>", "Something else"]]
              .map(([cmd, label]) => `<option value="${esc(cmd)}" ${cmd === example ? "selected" : ""}>${label}</option>`).join("")}
          </select>
          <pre data-command>curl -fsSLO ${location.origin}/bridge.mjs
node bridge.mjs ${wss} -- ${esc(example)}</pre>
          <p class="small muted">Run it in the folder you want the agent to work in. The address is a secret: anyone who has it can talk to your agent.</p>
          <p><button class="tiny quiet" data-act="copy">Copy command</button> <button class="tiny quiet" data-act="new-room">Make a new address</button></p>
        </div>` : ""}`;
  }

  let lastAgentKey = "";
  sb.on((state) => {
    part("services").innerHTML = state.services.length ? state.services.map((s) => `
      <article class="service ${s.live ? "live" : ""}">
        <header>
          <h3><span class="jack ${s.live ? "on" : ""}"></span>${esc(s.name)}</h3>
          <span class="muted small">${esc(host(s.origin))} ${s.live ? "" : `, not open now. <a href="${esc(s.url)}" target="_blank">Open it</a> <button class="tiny quiet" data-act="forget" data-id="${esc(s.origin)}">Forget</button>`}</span>
        </header>
        <ul class="tools">${s.tools.map((t) => `<li><code>${esc(t.name)}</code> ${esc(t.description)}</li>`).join("")}</ul>
      </article>`).join("")
      : `<p class="muted">Nothing yet. Open a site that offers tools and press its connect button. Two to try: the <a data-site="florist" target="_blank">florist</a> and the <a data-site="library" target="_blank">library</a>.</p>`;

    part("grants").innerHTML = state.grants.length ? `<ul class="grants">${state.grants.map((g) => `
      <li><span><strong>${esc(host(g.client))}</strong> has ${KIND[g.kind]}${g.kind === "tool" ? `: <code>${esc(g.tool)}</code> on ${esc(host(g.service))}` : ""} <span class="muted small">${ago(g.at)}</span></span>
        <button class="tiny quiet" data-act="revoke" data-id="${g.id}">Revoke</button></li>`).join("")}</ul>`
      : `<p class="muted">No site is holding a line right now.</p>`;

    const agentKey = JSON.stringify(state.agent);
    if (agentKey !== lastAgentKey) { lastAgentKey = agentKey; renderAgent(state); }

    part("log").innerHTML = state.log.length
      ? state.log.map((l) => `<li><span class="muted">${new Date(l.at).toLocaleTimeString()}</span> ${esc(l.text)}</li>`).join("")
      : `<li class="muted">Quiet so far.</li>`;
    fillSiteLinks(root);
  });
}

let sitesPromise;
export function fillSiteLinks(root = document) {
  sitesPromise ||= import("/_sites.js");
  sitesPromise.then(({ sites }) => {
    for (const a of root.querySelectorAll("a[data-site]")) a.href = sites[a.dataset.site] + (a.dataset.path || "/");
  });
}
