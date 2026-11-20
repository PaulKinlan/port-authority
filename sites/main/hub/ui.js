// Shared by the hub tab and the hub popup: the connection to the switchboard
// worker, and the dashboard that shows what it is holding.

// This browser's hub: an id that says which hub on the server is yours, and
// a key that proves it. Both are made here the first time and kept in the hub
// origin's own storage, which is first party because the hub is always a
// window of its own.
function identity() {
  try {
    const saved = JSON.parse(localStorage.getItem("pa-owner"));
    if (saved?.id && saved?.key) return saved;
  } catch {}
  const made = { id: newSecret(18), key: newSecret(32) };
  localStorage.setItem("pa-owner", JSON.stringify(made));
  return made;
}

function newSecret(bytes) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// The hub window's connection to the hub server. The server holds the
// registry, so this works whether or not any other tab is open.
export function switchboard() {
  const me = identity();
  const listeners = new Set();
  const waiting = new Map();
  const queue = [];
  let ws = null, n = 1, retry = 0;
  const sb = {
    state: null,
    id: me.id,
    send(msg) { const text = JSON.stringify(msg); ws?.readyState === 1 ? ws.send(text) : queue.push(text); },
    ask(msg) {
      const reqId = n++;
      return new Promise((resolve) => { waiting.set(reqId, resolve); sb.send({ ...msg, reqId }); });
    },
    on(fn) { listeners.add(fn); if (sb.state) fn(sb.state); return () => listeners.delete(fn); },
    // Resolves when the state satisfies the test, or with null after the timeout.
    until(test, ms = 15000) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => { off(); resolve(null); }, ms);
        const off = sb.on((state) => { if (test(state)) { clearTimeout(timer); queueMicrotask(off); resolve(state); } });
      });
    },
  };
  const connect = () => {
    ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/h/${me.id}?role=owner&token=${me.key}`);
    ws.onopen = () => { retry = 0; for (const text of queue.splice(0)) ws.send(text); };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.t === "state") { sb.state = msg; for (const fn of listeners) fn(msg); }
      else if (msg.t === "granted") { waiting.get(msg.reqId)?.(msg); waiting.delete(msg.reqId); }
    };
    ws.onclose = () => setTimeout(connect, Math.min(15000, 500 * 2 ** retry++));
  };
  connect();
  return sb;
}

const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const host = (origin) => { try { return new URL(origin).host; } catch { return String(origin); } };
const ago = (at) => {
  const s = Math.round((Date.now() - at) / 1000);
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
const KIND = { registry: "every tool", agent: "your agent" };

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
    if (act === "new-room" && confirm("Make a new address? The bridge you are running now will stop working.")) sb.send({ t: "agent-config", mode: "relay", fresh: true });
  });
  root.addEventListener("change", (event) => {
    if (event.target.name === "agent-mode") {
      sb.send({ t: "agent-config", mode: event.target.value });
    }
    if (event.target.name === "agent-example") renderAgent(sb.state, event.target.value);
  });

  let example = "npx -y @zed-industries/claude-code-acp";
  function renderAgent(state, pick) {
    if (pick) example = pick;
    const a = state.agent;
    const wss = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/h/${sb.id}?token=${a.room}`;
    const status = a.mode !== "relay" ? ""
      : a.present ? `<p><span class="jack on"></span>Connected: <strong>${esc(a.info?.agentInfo?.title || a.info?.agentInfo?.name || "your agent")}</strong>${a.cwd ? `, working in <code>${esc(a.cwd)}</code>` : ""}.</p>`
      : `<p><span class="jack"></span>Waiting for the bridge on your machine.</p>`;
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
node bridge.mjs "${wss}" -- ${esc(example)}</pre>
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
          <span class="muted small">${esc(host(s.origin))}${s.live ? ", open now" : `, not open now. <a href="${esc(s.url)}" target="_blank">Open it</a>`} <button class="tiny quiet" data-act="forget" data-id="${esc(s.origin)}">Forget</button></span>
        </header>
        <ul class="tools">${s.tools.map((t) => `<li><code>${esc(t.name)}</code> ${esc(t.description)}</li>`).join("")}</ul>
      </article>`).join("")
      : `<p class="muted">Nothing yet. Open a site that offers tools and press its button to add it. Two to try: the <a data-site="florist" target="_blank">florist</a> and the <a data-site="library" target="_blank">library</a>.</p>`;

    part("grants").innerHTML = state.grants.length ? `<ul class="grants">${state.grants.map((g) => `
      <li><span><strong>${esc(host(g.client))}</strong> has ${KIND[g.kind]} <span class="muted small">${ago(g.at)}</span></span>
        <button class="tiny quiet" data-act="revoke" data-id="${g.id}">Revoke</button></li>`).join("")}</ul>`
      : `<p class="muted">No site has been given the registry or your agent. Direct lines to a single tool are not listed here: they are made on your machine and your hub is not part of them.</p>`;

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
