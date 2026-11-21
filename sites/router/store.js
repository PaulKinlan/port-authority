// What the router keeps in the person's own browser, at the router's address:
// their accounts (with the API keys) and the two random values that identify
// their grant list on the server. Only the router's home page and picker
// window can read this. The router frame inside another site cannot: the
// browser gives a frame inside another site separate storage.

import { PROVIDERS, hasBuiltin } from "/providers.js";

const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
export const random = (bytes = 24) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function me() {
  let who = read("router.me", null);
  if (!who) { who = { id: random(24), owner: random(32) }; write("router.me", who); }
  return who;
}

export const accounts = () => read("router.accounts", []);
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
  out.push({ key: "practice", label: "Practice model", provider: "practice", providerName: PROVIDERS.practice.name, model: PROVIDERS.practice.models[0], note: "Not a real model. No key, no network call." });
  return out;
}

export async function server(action, body = {}) {
  const who = me();
  const response = await fetch(`/r/${who.id}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: who.owner, ...body }) });
  return response.json();
}

export { seal } from "/seal.js";
