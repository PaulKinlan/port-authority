// What the router keeps in the person's own browser, at the router's address:
// their accounts (with the API keys), and a note of each site they allowed.
// Only the router's home page and the router window can read this. The router
// frame inside another site cannot: the browser gives a frame inside another
// site separate storage. Nothing here is sent to a server. There is none.

import { PROVIDERS, hasBuiltin } from "/providers.js";

const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
// When the router kept grants on a server, this browser kept an id and a key for that list. Neither is used now.
try { localStorage.removeItem("router.me"); } catch { /* no storage */ }
export const random = (bytes = 24) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// An account saved for a provider the router no longer has is left out.
export const accounts = () => read("router.accounts", []).filter((a) => a && Object.hasOwn(PROVIDERS, a.provider));
export function saveAccount(account) {
  const all = accounts().filter((a) => a.id !== account.id);
  all.push(account);
  write("router.accounts", all);
}
export function removeAccount(id) { write("router.accounts", accounts().filter((a) => a.id !== id)); }

// Every account and model the person can choose from, as a flat list.
export async function choices() {
  const out = [];
  for (const a of accounts()) for (const model of a.models) out.push({ key: a.id + "|" + model, label: a.label, provider: a.provider, providerName: PROVIDERS[a.provider].name, model, secretKey: a.key || "" });
  if (await hasBuiltin()) out.push({ key: "builtin", label: "This browser", provider: "builtin", providerName: PROVIDERS.builtin.name, model: "built-in", note: "Runs on this device. Free." });
  return out;
}

// The sites the person allowed, as the router window saw them. This is a note
// for the person, kept at the router's own address. It is not the grant. The
// grant is kept inside the site (grants.js), where this page cannot reach it,
// and that is where requests are counted. So what a site has used is only
// known here as of the last time the router window was opened from that site.
const MONTH = 30 * 86400000;
export const allowed = () => read("router.allowed", []).filter((a) => a && a.site && a.id);
const keep = (list) => write("router.allowed", list.filter((a) => Date.now() < (a.stopped || a.gone || a.expires) + MONTH).slice(-200));

// A grant was just made. how: "frame" when it is kept inside the site, "window" when this address keeps it.
export function remember(grant, how) {
  const { id, site, label, provider, providerName, model, requests, made, expires } = grant;
  keep([...allowed().filter((a) => a.site !== site), { id, site, label, provider, providerName, model, requests, made, expires, how, used: 0, tokensIn: 0, tokensOut: 0, seen: made, stopped: 0, gone: 0 }]);
}
// The window was opened from a site, and heard what that site's grant is now: a view of it, or null.
export function sighting(site, current) {
  const now = Date.now();
  keep(allowed().map((a) => {
    if (a.site !== site || a.stopped || a.gone) return a;
    if (current && current.id === a.id) return { ...a, used: current.used, tokensIn: current.tokensIn, tokensOut: current.tokensOut, seen: now };
    return { ...a, gone: now };    // the site no longer has that grant: it was used up, ran out, or was forgotten there
  }));
}
// The person pressed Stop in the router window, and the site's grant was deleted.
export function stopped(site) {
  const now = Date.now();
  keep(allowed().map((a) => (a.site === site && !a.stopped && !a.gone ? { ...a, stopped: now } : a)));
}

export { seal } from "/seal.js";
