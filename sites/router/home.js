// The router's home page: accounts, and the sites that were allowed.

import { sites } from "/_sites.js";
import { PROVIDERS, generate } from "/providers.js";
import { openCaller } from "/caller.js";
import { askOver } from "/line.js";
import { accounts, removeAccount, secretOf, allowed, stopped } from "/store.js";
import { all as keptHere, remove as deleteHere, stateOf } from "/grants.js";
import { accountForm } from "/account-form.js";
import "/keep.js";
const $ = (id) => document.getElementById(id);
const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
$("main-link").href = sites.main + "/ai-router/";
$("main-link-inline").href = sites.main + "/ai-router/";
$("pa-link").href = sites.main + "/";
$("about-pa-link").href = sites.main + "/";
$("explainer-link").href = sites.main + "/ai-router/";
$("limits-link").href = sites.main + "/ai-router/#limits";
$("try").innerHTML = [
  [sites.main + "/chat/", "Chat", "A chat app that keeps your conversations in your browser and uses your accounts."],
  [sites.florist + "/card/", "Stem and Petal", "A florist that writes the card for a bouquet."],
  [sites.library + "/digest/", "Harbour Street Library", "A library that hands its port to a worker, and lends a 3-request port."],
  [sites.main + "/ai-router/", "Port Authority", "How the router works, with a box to try it in."],
].map(([href, name, what]) => `<li><span><a href="${esc(href)}"><strong>${esc(name)}</strong></a><br><span class="small muted">${esc(what)}</span></span></li>`).join("");

// ---- accounts
// The form that adds an account is shared with the router window.
accountForm($("form"), () => { $("add").open = false; drawAccounts(); });
// The router window sends people here to add an account, with the form already open.
if (location.hash === "#add") { $("add").open = true; $("label").focus(); }

function drawAccounts() {
  const all = accounts();
  $("accounts").innerHTML = all.length ? all.map((a) => `<li data-id="${esc(a.id)}">
    <span><strong>${esc(a.label)}</strong><br><span class="small muted">${esc(PROVIDERS[a.provider].name)} · ${esc(a.models.join(", "))} ${a.ends ? " · key ends " + esc(a.ends) : ""}</span><br><span class="small" data-result></span></span>
    <span class="actions"><button class="tiny quiet" data-test>Test</button><button class="tiny quiet" data-remove>Remove</button></span></li>`).join("")
    : `<li class="muted">None yet. A site can only use an account you add here.</li>`;
}
drawAccounts();
$("accounts").onclick = async (event) => {
  const row = event.target.closest("li[data-id]");
  if (!row) return;
  const account = accounts().find((a) => a.id === row.dataset.id);
  if (!account) return;
  if (event.target.matches("[data-remove]")) {
    // Removing an account here does not reach a site that was already allowed to use it.
    // That site keeps an encrypted copy of the key until its grant runs out or is stopped.
    const using = allowed().filter((a) => !a.stopped && !a.gone && Date.now() < a.expires && a.label === account.label && a.provider === account.provider);
    const warning = using.length ? ` ${using.length === 1 ? "One site you allowed" : using.length + " sites you allowed"} may still be using it: ${using.map((a) => a.site.replace(/^https?:\/\//, "")).join(", ")}. Removing it here does not stop them. They stop when their limit runs out, or when you stop them from the site, or when you cancel the key at the provider.` : "";
    if (!confirm(`Remove "${account.label}" from this browser?${warning}`)) return;
    await removeAccount(account.id);
    drawAccounts();
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
      const model = account.models[0];
      const ask = { messages: [{ role: "user", content: "Say hello in five words or fewer." }], maxTokens: 30 };
      // This page cannot reach a provider. The call is made by the page that may
      // connect to this account's provider and to nowhere else.
      const opened = PROVIDERS[account.provider].kind ? await openCaller(account.provider) : null;
      try {
        // The key goes to the caller as it is kept: encrypted, with the key that opens it. This page does not open it.
        const secret = opened ? await secretOf(account.id) : null;
        const how = !secret ? {} : secret.plain ? { key: secret.plain } : { sealed: secret.sealed, opens: secret.key };
        const pieces = opened ? askOver(opened.port, { account: { provider: account.provider, model, ...how }, ask }) : generate({ ...account, model }, ask);
        for await (const piece of pieces) { text += piece; out.textContent = "It answered: " + text; }
      } finally { if (opened) opened.close(); }
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

// ---- sites you have allowed
// There is no server, so this page has no list of grants to ask for. It shows
// the note the router window made each time you allowed a site (store.js).
// A grant kept inside a site cannot be read or stopped from here. A grant for
// a site that uses the router window is kept at this address, so this page can
// read it and stop it.
const day = (ms) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const plural = (n, word) => `${n} ${n === 1 ? word : word + "s"}`;
let lastKey = null;
async function drawGrants(force = false) {
  let here = [];
  try { here = await keptHere(); } catch { /* this browser gives the page no storage */ }
  const live = new Map(here.map((g) => [g.id, g]));
  const notes = allowed().sort((a, b) => b.made - a.made);
  const key = JSON.stringify([notes, here.map((g) => [g.id, g.used, g.tokensIn, g.tokensOut])]);
  if (!force && key === lastKey) return;
  lastKey = key;
  const now = Date.now();
  $("grants").innerHTML = notes.length ? notes.map((a) => {
    const kept = live.get(a.id);     // kept at this address: the numbers are exact, and Stop works from here
    const state = a.stopped ? "Stopped" : kept ? ({ active: "Allowed", expired: "Expired", "used up": "Used up" })[stateOf(kept, now)] : a.gone ? "Ended" : now > a.expires ? "Expired" : "Allowed";
    const on = state === "Allowed";
    const used = kept ? `${kept.used} of ${plural(kept.requests, "request")} used${kept.tokensIn + kept.tokensOut ? `, ${kept.tokensIn} tokens in and ${kept.tokensOut} out` : ""}`
      : `up to ${plural(a.requests, "request")}. ${a.used} used when you last opened the router window from this site, on ${day(a.seen)}`;
    const where = kept ? "Kept at this address, because this site uses the router window." : on ? "Kept inside that site. To see what it has used since, or to stop it, open the site and choose again." : "";
    return `<li data-id="${esc(a.id)}" data-site="${esc(a.site)}">
      <span><strong><a href="${esc(a.site)}">${esc(a.site.replace(/^https?:\/\//, ""))}</a></strong><br>
      <span class="small muted"><span class="model-name">${esc(a.model)}</span>, from ${esc(a.label)} · ${used} · ${on ? "until " + day(a.expires) : "allowed " + day(a.made)}</span>${where ? `<br><span class="small muted">${where}</span>` : ""}</span>
      <span class="actions"><span class="tag ${on ? "active" : "off"}">${state}</span>${on && kept ? `<button class="tiny quiet" data-revoke>Stop</button>` : ""}</span></li>`;
  }).join("") : `<li class="muted">No site has asked yet. Try one of the sites below.</li>`;
}
$("grants").onclick = async (event) => {
  const row = event.target.closest("li[data-id]");
  const btn = event.target.closest("[data-revoke]");
  if (!row || !btn || btn.disabled) return;
  btn.disabled = true;
  btn.textContent = "Stopping...";
  $("grants-error").hidden = true;
  try {
    await deleteHere(row.dataset.site);    // the grant and the key that opens your API key are deleted. The open window notices at the site's next request
    stopped(row.dataset.site);
    try { const tell = new BroadcastChannel("router.grant:" + row.dataset.site); tell.postMessage("changed"); tell.close(); } catch { /* the window finds out at the next request */ }
    await drawGrants(true);
  } catch (error) {
    $("grants-error").textContent = "Could not stop that site: " + error.message;
    $("grants-error").hidden = false;
    if (btn.isConnected) { btn.disabled = false; btn.textContent = "Stop"; }
  }
};
drawGrants(true);
addEventListener("focus", () => drawGrants());
addEventListener("storage", () => drawGrants());
setInterval(() => { if (!document.hidden) drawGrants(); }, 3000);
