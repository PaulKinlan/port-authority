// The form that adds an account.
//
// The router's own page has it. So does the router window, so that an account
// can be set up at the moment a site asks for one. Either way the account is
// saved in this browser, in the router's own storage, and nowhere else.

import { PROVIDERS } from "/providers.js";
import { saveAccount, random } from "/store.js";

const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const FIELDS = `
  <div><label for="provider">Provider</label><select id="provider"></select><p class="small muted" id="provider-note"></p></div>
  <div><label for="label">Name for this account</label><input type="text" id="label" required maxlength="40" placeholder="Work key"></div>
  <div id="key-row"><label for="key">API key</label><input type="password" id="key" autocomplete="off"></div>
  <div><label for="models">Models, separated by commas</label><input type="text" id="models" required></div>
  <div class="actions"><button class="accent">Save</button><span class="small muted" id="form-state" role="status" aria-live="polite"></span></div>`;

// Fill an empty <form> with the fields and make it work.
// onSaved(account) is called after an account is saved.
export function accountForm(form, onSaved) {
  form.innerHTML = FIELDS;
  const field = (id) => form.querySelector("#" + id);
  const keyed = Object.entries(PROVIDERS).filter(([, p]) => p.needsKey || p.local);
  field("provider").innerHTML = keyed.map(([id, p]) => `<option value="${esc(id)}">${esc(p.name)}</option>`).join("");
  const say = (text, isError = false) => {
    const el = field("form-state");
    el.textContent = text;
    el.className = isError ? "small error" : "small muted";
  };
  const providerChanged = () => {
    const p = PROVIDERS[field("provider").value];
    field("provider-note").textContent = p.note;
    field("key-row").hidden = !p.needsKey;
    field("key").required = !!p.needsKey;
    field("models").value = p.models.join(", ");
    say("");
  };
  field("provider").onchange = providerChanged;
  providerChanged();

  form.onsubmit = (event) => {
    event.preventDefault();
    const provider = field("provider").value;
    const p = PROVIDERS[provider];
    const label = field("label").value.trim();
    const key = p.needsKey ? field("key").value.trim() : "";
    const models = field("models").value.split(",").map((m) => m.trim()).filter(Boolean);
    if (!label) { say("Enter a name for this account.", true); field("label").focus(); return; }
    if (p.needsKey && !key) { say("Enter an API key for " + p.name + ".", true); field("key").focus(); return; }
    if (!models.length) { say("Enter at least one model name.", true); field("models").focus(); return; }
    const account = { id: random(6), provider, label, key, models };
    saveAccount(account);
    form.reset();
    providerChanged();
    say("Account saved.");
    onSaved?.(account);
  };
}

// True while someone has started to fill the form in, so that it is not redrawn under them.
export const formInUse = (form) => !!form && [...form.querySelectorAll("#label, #key")].some((input) => input.value !== "");
