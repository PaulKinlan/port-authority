// The router's home page: accounts, and the sites that were allowed.

import { sites } from "/_sites.js";
import { PROVIDERS, generate } from "/providers.js";
import { accounts, saveAccount, removeAccount, server, random } from "/store.js";
const $ = (id) => document.getElementById(id);
const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
$("main-link").href = sites.main + "/ai-router/";
$("main-link-inline").href = sites.main + "/ai-router/";
$("pa-link").href = sites.main + "/";
$("try").innerHTML = [
  [sites.florist + "/card/", "Stem and Petal", "A florist that writes the card for a bouquet."],
  [sites.library + "/digest/", "Harbour Street Library", "A library that hands its port to a worker, and lends a 3-request port."],
  [sites.main + "/ai-router/", "Port Authority", "How the router works, with a box to try it in."],
].map(([href, name, what]) => `<li><span><a href="${esc(href)}"><strong>${esc(name)}</strong></a><br><span class="small muted">${esc(what)}</span></span></li>`).join("");

// ---- accounts
const keyed = Object.entries(PROVIDERS).filter(([, p]) => p.needsKey || p.local);
$("provider").innerHTML = keyed.map(([id, p]) => `<option value="${esc(id)}">${esc(p.name)}</option>`).join("");
const setFormState = (text, isError = false) => {
  const el = $("form-state");
  el.textContent = text;
  el.className = isError ? "small error" : "small muted";
};
const providerChanged = () => {
  const p = PROVIDERS[$("provider").value];
  $("provider-note").textContent = p.note;
  $("key-row").hidden = !p.needsKey;
  $("key").required = !!p.needsKey;
  $("models").value = p.models.join(", ");
  setFormState("");
};
$("provider").onchange = providerChanged;
providerChanged();

let latestGrants = [];

function drawAccounts() {
  const all = accounts();
  $("accounts").innerHTML = all.length ? all.map((a) => `<li data-id="${esc(a.id)}">
    <span><strong>${esc(a.label)}</strong><br><span class="small muted">${esc(PROVIDERS[a.provider].name)} · ${esc(a.models.join(", "))} ${a.key ? " · key ends " + esc(a.key.slice(-4)) : ""}</span><br><span class="small" data-result></span></span>
    <span class="actions"><button class="tiny quiet" data-test>Test</button><button class="tiny quiet" data-remove>Remove</button></span></li>`).join("")
    : `<li class="muted">None yet. Without one you can still use the practice model, which is not a real model.</li>`;
}
drawAccounts();
$("accounts").onclick = async (event) => {
  const row = event.target.closest("li[data-id]");
  if (!row) return;
  const account = accounts().find((a) => a.id === row.dataset.id);
  if (!account) return;
  if (event.target.matches("[data-remove]")) {
    const active = latestGrants.filter((g) => g.state === "active" && g.label === account.label && (!g.provider || g.provider === account.provider));
    if (active.length) {
      if (!confirm(`Remove "${account.label}"? ${active.length} active site grant(s) still use this account, and removing it does not automatically stop them.`)) return;
      removeAccount(account.id);
      drawAccounts();
      if (confirm(`Also stop the ${active.length} active site grant(s) using "${account.label}"?`)) {
        try {
          await Promise.all(active.map((g) => server("revoke", { id: g.id })));
          drawGrants(true);
        } catch (error) {
          $("grants-error").textContent = "Could not stop every grant: " + error.message;
          $("grants-error").hidden = false;
        }
      }
    } else {
      if (!confirm(`Remove "${account.label}" from this browser?`)) return;
      removeAccount(account.id);
      drawAccounts();
    }
    return;
  }
  if (event.target.matches("[data-test]")) {
    const btn = event.target;
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "Testing...";
    const out = row.querySelector("[data-result]");
    out.textContent = "Asking " + account.models[0] + " to say hello...";
    try {
      let text = "";
      for await (const piece of generate({ ...account, model: account.models[0] }, { messages: [{ role: "user", content: "Say hello in five words or fewer." }], maxTokens: 30 })) { text += piece; out.textContent = "It answered: " + text; }
    } catch (error) {
      out.innerHTML = `<span class="error">${esc(error.message)}</span>`;
    } finally {
      if (btn.isConnected) {
        btn.disabled = false;
        btn.textContent = "Test";
      }
    }
  }
};
$("form").onsubmit = (event) => {
  event.preventDefault();
  const provider = $("provider").value;
  const p = PROVIDERS[provider];
  const label = $("label").value.trim();
  const key = p.needsKey ? $("key").value.trim() : "";
  const models = $("models").value.split(",").map((m) => m.trim()).filter(Boolean);
  if (!label) { setFormState("Enter a name for this account.", true); $("label").focus(); return; }
  if (p.needsKey && !key) { setFormState("Enter an API key for " + p.name + ".", true); $("key").focus(); return; }
  if (!models.length) { setFormState("Enter at least one model name.", true); $("models").focus(); return; }
  saveAccount({ id: random(6), provider, label, key, models });
  $("form").reset();
  providerChanged();
  setFormState("Account saved.");
  $("add").open = false;
  drawAccounts();
};

// ---- grants
const day = (ms) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
let lastGrantsKey = null;
async function drawGrants(force = false) {
  let answer;
  try {
    answer = await server("list");
  } catch (error) {
    lastGrantsKey = null;
    $("grants").innerHTML = `<li class="error">The router server could not be reached: ${esc(error.message)}</li>`;
    return;
  }
  const grants = answer.grants || [];
  latestGrants = grants;
  const key = JSON.stringify(grants);
  if (!force && key === lastGrantsKey) return;
  lastGrantsKey = key;
  $("grants-error").hidden = true;
  $("grants-error").textContent = "";
  $("grants").innerHTML = grants.length ? grants.map((g) => `<li data-id="${esc(g.id)}">
    <span><strong>${esc(g.site.replace(/^https?:\/\//, ""))}</strong><br>
    <span class="small muted">${esc(g.label)} · ${esc(g.model)} · ${g.used} of ${g.requests} requests used${g.tokensIn + g.tokensOut ? ` · ${g.tokensIn} tokens in, ${g.tokensOut} out` : ""} · ${g.state === "active" ? "until " + day(g.expires) : "allowed " + day(g.made)}</span></span>
    <span class="actions"><span class="tag ${g.state === "active" ? "active" : "off"}">${g.state === "active" ? "Allowed" : g.state === "revoked" ? "Stopped" : g.state === "expired" ? "Expired" : "Used up"}</span>${g.state === "active" ? `<button class="tiny quiet" data-revoke>Stop</button>` : ""}</span></li>`).join("")
    : `<li class="muted">No site has asked yet. Try one of the sites below.</li>`;
}
$("grants").onclick = async (event) => {
  const row = event.target.closest("li[data-id]");
  const btn = event.target.closest("[data-revoke]");
  if (!row || !btn || btn.disabled) return;
  btn.disabled = true;
  btn.textContent = "Stopping...";
  $("grants-error").hidden = true;
  try {
    await server("revoke", { id: row.dataset.id });
    await drawGrants(true);
  } catch (error) {
    $("grants-error").textContent = "Could not stop that site: " + error.message;
    $("grants-error").hidden = false;
    if (btn.isConnected) {
      btn.disabled = false;
      btn.textContent = "Stop";
    }
  }
};
drawGrants(true);
addEventListener("focus", () => drawGrants());
setInterval(() => { if (!document.hidden) drawGrants(); }, 5000);
