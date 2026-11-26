// What the router keeps in the person's own browser, at the router's address:
// their accounts, and a note of each site they allowed. Only the router's home
// page and the router window can read this. The router frame inside another
// site cannot: the browser gives a frame inside another site separate storage.
// Nothing here is sent to a server. There is none.
//
// An account is kept in two parts.
//   - What it is called, its provider, its models and the last four characters
//     of its key, in localStorage. None of that is secret, and a change to it
//     is heard by the router window at once.
//   - The API key, in IndexedDB, encrypted. Beside it is the key that opens
//     it: a CryptoKey that the browser will use and will not export. So no
//     script, the router's own included, can read the API key out of storage
//     as text. It can only ask the browser to hand it on, encrypted again, to
//     the frame of a site the person allowed, or to the worker that calls the
//     provider. The API key is text in two places: the box it is typed in, and
//     that worker.

import { PROVIDERS, hasBuiltin } from "/providers.js";

const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
// When the router kept grants on a server, this browser kept an id and a key for that list. Neither is used now.
try { localStorage.removeItem("router.me"); } catch { /* no storage */ }
export const random = (bytes = 24) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ---- the secret part of an account
let opening = null;
const secrets = () => opening ||= new Promise((resolve, reject) => {
  const request = indexedDB.open("router-accounts", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("secrets", { keyPath: "id" });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const withSecrets = async (mode, work) => {
  const db = await secrets();
  return new Promise((resolve, reject) => {
    const step = db.transaction("secrets", mode);
    const request = work(step.objectStore("secrets"));
    step.oncomplete = () => resolve(request ? request.result : undefined);
    step.onerror = step.onabort = () => reject(step.error || new Error("The key could not be kept in this browser's storage."));
  });
};
const text64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
// Encrypt an API key with a new key that only this browser has, and that it will not export.
async function lock(apiKey) {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt", "wrapKey", "unwrapKey"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(apiKey));
  return { sealed: { iv: text64(iv), data: text64(data) }, key };
}

// An account saved when keys were kept as text is encrypted the first time this file is loaded, and the text is removed.
const tidied = (async () => {
  const all = read("router.accounts", []);
  if (!Array.isArray(all) || !all.some((a) => a && a.key)) return;
  for (const account of all) {
    if (!account || !account.key) continue;
    try {
      const locked = await lock(account.key);
      await withSecrets("readwrite", (store) => store.put({ id: account.id, ...locked }));
      account.ends = account.key.slice(-4);
      delete account.key;
    } catch { /* this browser gives the page no database. The key stays as it was, and still works */ }
  }
  write("router.accounts", all);
})();

// An account saved for a provider the router no longer has is left out. What comes back never holds a key.
export const accounts = () => read("router.accounts", []).filter((a) => a && Object.hasOwn(PROVIDERS, a.provider)).map(({ key, ...rest }) => ({ ...rest, ends: rest.ends || (key ? key.slice(-4) : "") }));
// account: { id, provider, label, models }. apiKey: the key as it was typed, or "" for a provider that needs none.
export async function saveAccount(account, apiKey) {
  await tidied;
  const kept = { id: account.id, provider: account.provider, label: account.label, models: account.models, ends: apiKey ? apiKey.slice(-4) : "" };
  if (apiKey) {
    try { const locked = await lock(apiKey); await withSecrets("readwrite", (store) => store.put({ id: account.id, ...locked })); }
    catch { kept.key = apiKey; }     // no database in this browser: the key is kept as text, as it used to be
  }
  write("router.accounts", [...read("router.accounts", []).filter((a) => a && a.id !== account.id), kept]);
}
export async function removeAccount(id) {
  await tidied;
  write("router.accounts", read("router.accounts", []).filter((a) => a && a.id !== id));
  await withSecrets("readwrite", (store) => store.delete(id)).catch(() => {});
}
// The API key of an account, as it is kept: { sealed, key } where key opens sealed and cannot be exported.
// Resolves to { plain } for a key this browser could only keep as text, and to null when there is none.
export async function secretOf(id) {
  await tidied;
  const kept = await withSecrets("readonly", (store) => store.get(id)).catch(() => null);
  if (kept) return { sealed: kept.sealed, key: kept.key };
  const plain = (read("router.accounts", []).find((a) => a && a.id === id) || {}).key;
  return plain ? { plain } : null;
}

// Every account and model the person can choose from, as a flat list.
export async function choices() {
  const out = [];
  await tidied;
  for (const a of accounts()) for (const model of a.models) out.push({ key: a.id + "|" + model, account: a.id, label: a.label, provider: a.provider, providerName: PROVIDERS[a.provider].name, model, ends: a.ends || "", hasKey: !!PROVIDERS[a.provider].needsKey });
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
