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
  const statusListeners = new Set();
  const waiting = new Map();
  const queue = [];
  let ws = null, n = 1, retry = 0, status = "connecting";
  const setStatus = (next) => {
    if (status === next) return;
    status = next;
    for (const fn of statusListeners) fn(status);
  };
  const sb = {
    state: null,
    id: me.id,
    get status() { return status; },
    send(msg) { const text = JSON.stringify(msg); ws?.readyState === 1 ? ws.send(text) : queue.push(text); },
    ask(msg) {
      const reqId = n++;
      return new Promise((resolve) => { waiting.set(reqId, resolve); sb.send({ ...msg, reqId }); });
    },
    on(fn) { listeners.add(fn); if (sb.state) fn(sb.state); return () => listeners.delete(fn); },
    onStatus(fn) { statusListeners.add(fn); fn(status); return () => statusListeners.delete(fn); },
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
    ws.onopen = () => {
      retry = 0;
      setStatus("open");
      for (const text of queue.splice(0)) ws.send(text);
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.t === "state") { sb.state = msg; for (const fn of listeners) fn(msg); }
      else if (msg.t === "granted") { waiting.get(msg.reqId)?.(msg); waiting.delete(msg.reqId); }
    };
    ws.onclose = () => {
      setStatus("reconnecting");
      setTimeout(connect, Math.min(15000, 500 * 2 ** retry++));
    };
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
const KIND = { registry: "can use every tool", agent: "can talk to your agent" };

// The hub has two pages. "tools" is the registry: which sites offer you tools
// and who may use them. "agent" is the one agent that sites can be let talk to.
export function mountDashboard(root, sb, view = "tools") {
  const tabs = `<nav class="hub-tabs" aria-label="Parts of your hub">
      <a href="/hub/" ${view === "tools" ? 'aria-current="page"' : ""}>Sites and their tools</a>
      <a href="/hub/agent/" ${view === "agent" ? 'aria-current="page"' : ""}>Your agent</a>
    </nav>`;
  const conn = `<div class="conn-banner" data-part="conn" role="status" aria-live="polite">Connecting to your hub...</div>`;
  const perms = `<section class="stack" data-part="permissions-wrap" aria-labelledby="d-perms" role="alert" aria-live="assertive" hidden>
      <h2 id="d-perms">Your agent is asking permission</h2>
      <div data-part="permissions" class="stack"></div>
    </section>`;
  root.innerHTML = view === "agent" ? `${tabs}${conn}${perms}
    <section class="stack" aria-labelledby="d-agent">
      <h2 id="d-agent">Which agent sites get</h2>
      <div data-part="agent" class="stack"><p class="muted">Connecting to your hub...</p></div>
    </section>
    <section class="stack" aria-labelledby="d-access">
      <h2 id="d-access">Sites you have let talk to it</h2>
      <div data-part="grants"><p class="muted">Connecting to your hub...</p></div>
    </section>
    <section class="stack" aria-labelledby="d-log">
      <h2 id="d-log">What happened</h2>
      <ul class="log" data-part="log"><li class="muted">Connecting to your hub...</li></ul>
    </section>` : `${tabs}${conn}${perms}
    <section class="stack" aria-labelledby="d-sites">
      <h2 id="d-sites">Sites offering tools</h2>
      <div data-part="services" class="stack"><p class="muted">Connecting to your hub...</p></div>
    </section>
    <section class="stack" aria-labelledby="d-access">
      <h2 id="d-access">Who you have let in</h2>
      <div data-part="grants"><p class="muted">Connecting to your hub...</p></div>
    </section>
    <section class="stack" aria-labelledby="d-log">
      <h2 id="d-log">What happened</h2>
      <ul class="log" data-part="log"><li class="muted">Connecting to your hub...</li></ul>
    </section>`;
  // A part that this page does not show is drawn into a spare element and thrown away.
  const part = (name) => root.querySelector(`[data-part="${name}"]`) || document.createElement("div");

  const updateConn = () => {
    const el = part("conn");
    if (sb.status === "reconnecting") {
      el.hidden = false;
      el.className = "conn-banner warn";
      el.textContent = "Disconnected from your hub. Reconnecting...";
    } else if (!sb.state) {
      el.hidden = false;
      el.className = "conn-banner";
      el.textContent = "Connecting to your hub...";
    } else {
      el.hidden = true;
      el.textContent = "";
    }
  };
  sb.onStatus(updateConn);

  let copyTimer = null;
  root.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-act]");
    if (!button || button.disabled) return;
    const { act, id, opt, label } = button.dataset;
    if (act === "revoke") {
      if (!confirm(`Revoke access for ${label || "this site"}? It will have to ask again to use your hub.`)) return;
      sb.send({ t: "revoke", grantId: id });
    }
    if (act === "forget") {
      if (!confirm(`Forget ${label || host(id)}? It will be disconnected and removed from your hub.`)) return;
      try {
        const saved = JSON.parse(localStorage.getItem("pa-services") || "[]");
        localStorage.setItem("pa-services", JSON.stringify(saved.filter((o) => o !== id)));
      } catch {}
      sb.send({ t: "forget", origin: id });
    }
    if (act === "perm") {
      button.closest(".perm")?.querySelectorAll("button[data-act='perm']").forEach((b) => { b.disabled = true; });
      button.textContent = "Sending...";
      sb.send({ t: "permission", id, optionId: opt || null });
    }
    if (act === "copy") {
      const cmd = root.querySelector("[data-command]")?.textContent || "";
      const resetLater = () => {
        clearTimeout(copyTimer);
        copyTimer = setTimeout(() => { if (button.isConnected) button.textContent = "Copy command"; }, 2000);
      };
      if (!navigator.clipboard?.writeText) {
        button.textContent = "Copy unavailable — select text above";
        resetLater();
        return;
      }
      navigator.clipboard.writeText(cmd).then(
        () => { button.textContent = "Copied"; resetLater(); },
        () => { button.textContent = "Copy failed — select text above"; resetLater(); },
      );
    }
    if (act === "new-room" && confirm("Make a new address? The bridge you are running now will stop working.")) sb.send({ t: "agent-config", mode: "relay", fresh: true });
  });
  root.addEventListener("change", (event) => {
    if (event.target.name === "agent-mode") {
      sb.send({ t: "agent-config", mode: event.target.value });
    }
    if (event.target.name === "agent-example") {
      renderAgent(sb.state, event.target.value);
      root.querySelector('input[name="agent-example"]:checked')?.focus({ preventScroll: true });
    }
  });

  // Agents that speak the Agent Client Protocol, and the command that starts each
  // one in that mode. Taken from the protocol's own registry of agents, without
  // the pinned versions. [name, who makes it, command, what you need first]
  const AGENTS = [
    ["Claude Code", "Anthropic", "npx -y @agentclientprotocol/claude-agent-acp", "Runs with npx"],
    ["Codex", "OpenAI", "npx -y @agentclientprotocol/codex-acp", "Runs with npx"],
    ["Gemini CLI", "Google", "npx -y @google/gemini-cli --acp", "Runs with npx"],
    ["Antigravity", "Google", "agy acp", "Needs the agy command, 1.5 or later"],
    ["pi", "pi-acp adapter", "npx -y pi-acp", "Runs with npx, needs pi installed"],
    ["GitHub Copilot", "GitHub", "npx -y @github/copilot --acp", "Runs with npx"],
    ["Cursor", "Cursor", "cursor-agent acp", "Needs the cursor-agent command"],
    ["OpenCode", "OpenCode", "opencode acp", "Needs the opencode command"],
    ["goose", "Block", "goose acp", "Needs the goose command"],
    ["Cline", "Cline", "npx -y cline --acp", "Runs with npx"],
    ["Qwen Code", "Alibaba", "npx -y @qwen-code/qwen-code --acp", "Runs with npx"],
    ["Kiro", "AWS", "kiro-cli acp", "Needs the kiro-cli command"],
    ["Auggie", "Augment Code", "npx -y @augmentcode/auggie --acp", "Runs with npx"],
    ["Kilo", "Kilo Code", "npx -y @kilocode/cli acp", "Runs with npx"],
    ["Mistral Vibe", "Mistral", "vibe-acp", "Needs the vibe-acp command"],
    ["Junie", "JetBrains", "junie --acp=true", "Needs the junie command"],
    ["Devin", "Cognition", "devin acp", "Needs the devin command"],
    ["Something else", "Any ACP agent", "<your agent command>", "Put its command after the two dashes"],
  ];
  const HUES = [8, 205, 150, 262, 38, 330, 180, 95, 20, 290, 230, 60];
  let example = AGENTS[0][2];

  function captureFocus(container) {
    const active = document.activeElement;
    if (!active || !container.contains(active)) return null;
    if (active.matches('input[type="radio"]')) return { kind: "radio", name: active.name, value: active.value };
    if (active.matches("button[data-act]")) return { kind: "btn", act: active.dataset.act, id: active.dataset.id || "", opt: active.dataset.opt || "" };
    return null;
  }

  function restoreFocus(container, saved) {
    if (!saved) return;
    if (saved.kind === "radio") {
      const target = [...container.querySelectorAll('input[type="radio"]')].find((el) => el.name === saved.name && el.value === saved.value);
      target?.focus({ preventScroll: true });
    } else if (saved.kind === "btn") {
      const target = [...container.querySelectorAll("button[data-act]")].find(
        (el) => el.dataset.act === saved.act && (el.dataset.id || "") === saved.id && (el.dataset.opt || "") === saved.opt,
      );
      target?.focus({ preventScroll: true });
    }
  }

  function renderAgent(state, pick) {
    if (!state) return;
    if (pick) example = pick;
    const box = part("agent");
    const savedFocus = captureFocus(box);
    const a = state.agent;
    const wss = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/h/${sb.id}?token=${a.room}`;
    const status = a.mode !== "relay" ? ""
      : a.present ? `<p><span class="jack on"></span>Connected: <strong>${esc(a.info?.agentInfo?.title || a.info?.agentInfo?.name || "your agent")}</strong>${a.cwd ? `, working in <code>${esc(a.cwd)}</code>` : ""}.</p>`
      : `<p><span class="jack"></span>Waiting for the bridge on your machine.</p>`;
    box.innerHTML = `
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
          <fieldset class="agent-pick">
            <legend>Which agent is it?</legend>
            ${AGENTS.map(([name, maker, cmd, needs], i) => `<label class="agent-card" style="--hue:${HUES[i % HUES.length]}">
              <input type="radio" name="agent-example" value="${esc(cmd)}" ${cmd === example ? "checked" : ""}>
              <span class="badge" aria-hidden="true">${esc(name.replace(/[^A-Za-z ]/g, "").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase())}</span>
              <span class="who"><strong>${esc(name)}</strong><span class="muted small">${esc(maker)}</span></span>
              <span class="needs small">${esc(needs)}</span>
            </label>`).join("")}
          </fieldset>
          <p class="small muted">These are agents listed in <a href="https://agentclientprotocol.com/" target="_blank" rel="noopener">the Agent Client Protocol's registry</a>, with the command each uses to speak the protocol. Each needs its own sign-in, done in its own way, before it will answer.</p>
          <p style="margin:0;font-weight:700">Then run this on your machine</p>
          <pre data-command>curl -fsSLO ${location.origin}/bridge.mjs
node bridge.mjs "${wss}" -- ${esc(example)}</pre>
          <p class="small muted">Run it in the folder you want the agent to work in. The address is a secret: anyone who has it can talk to your agent.</p>
          <p><button class="tiny quiet" data-act="copy">Copy command</button> <button class="tiny quiet" data-act="new-room">Make a new address</button></p>
        </div>` : ""}`;
    restoreFocus(box, savedFocus);
  }

  let lastAgentKey = "";
  let lastServicesHtml = "";
  let lastGrantsHtml = "";
  let lastPermsHtml = "";
  sb.on((state) => {
    updateConn();

    const servicesHtml = state.services.length ? state.services.map((s) => `
      <article class="service ${s.live ? "live" : ""}">
        <header>
          <h3><span class="jack ${s.live ? "on" : ""}"></span>${esc(s.name)}</h3>
          <span class="muted small">${esc(host(s.origin))}${s.live ? ", open now" : `, not open now. <a href="${esc(s.url)}" target="_blank" rel="noopener">Open it</a>`} <button class="tiny quiet" data-act="forget" data-id="${esc(s.origin)}" data-label="${esc(s.name)}">Forget</button></span>
        </header>
        <ul class="tools">${s.tools.map((t) => `<li><code>${esc(t.name)}</code> ${esc(t.description)}</li>`).join("")}</ul>
      </article>`).join("")
      : `<p class="muted">Nothing yet. Open a site that offers tools and press its button to add it. Two to try: the <a data-site="florist" target="_blank" rel="noopener">florist</a> and the <a data-site="library" target="_blank" rel="noopener">library</a>, then try calling them from the <a data-site="planner" target="_blank" rel="noopener">planner</a>.</p>`;
    if (servicesHtml !== lastServicesHtml) {
      const box = part("services");
      const saved = captureFocus(box);
      lastServicesHtml = servicesHtml;
      box.innerHTML = servicesHtml;
      restoreFocus(box, saved);
    }

    const grants = view === "agent" ? state.grants.filter((g) => g.kind === "agent") : state.grants;
    const grantsHtml = grants.length ? `<ul class="grants">${grants.map((g) => `
      <li><span><strong>${esc(host(g.client))}</strong> ${view === "agent" ? "can talk to your agent" : (KIND[g.kind] || esc(g.kind))} <span class="muted small">${ago(g.at)}</span></span>
        <button class="tiny quiet" data-act="revoke" data-id="${esc(g.id)}" data-label="${esc(host(g.client))}">Revoke</button></li>`).join("")}</ul>`
      : view === "agent" ? `<p class="muted">No site has been let talk to your agent. A site has to ask, and you have to say yes in the hub window. One to try: the <a data-site="planner" target="_blank" rel="noopener">planner</a>.</p>`
      : `<p class="muted">No site has been given the registry or your agent. Direct lines to a single tool are not listed here: they are made on your machine and your hub is not part of them.</p>`;
    if (grantsHtml !== lastGrantsHtml) {
      const box = part("grants");
      const saved = captureFocus(box);
      lastGrantsHtml = grantsHtml;
      box.innerHTML = grantsHtml;
      restoreFocus(box, saved);
    }

    const perms = state.permissions || [];
    part("permissions-wrap").hidden = !perms.length;
    const permsHtml = perms.map((p) => `
      <article class="perm">
        <p><strong>${esc(p.toolCall?.title || "Run an action on your machine")}</strong>
          <span class="muted small">requested while answering ${esc(host(p.client))}</span></p>
        <div class="actions">
          ${p.options.map((o) => `<button class="${o.kind?.startsWith("allow") ? "accent" : "quiet"} tiny" data-act="perm" data-id="${esc(p.id)}" data-opt="${esc(o.optionId)}">${esc(o.name || o.optionId)}</button>`).join("")}
          <button class="tiny quiet" data-act="perm" data-id="${esc(p.id)}">Cancel</button>
        </div>
      </article>`).join("");
    if (permsHtml !== lastPermsHtml) {
      const box = part("permissions");
      const saved = captureFocus(box);
      lastPermsHtml = permsHtml;
      box.innerHTML = permsHtml;
      restoreFocus(box, saved);
    }

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
