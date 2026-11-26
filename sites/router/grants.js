// The grants this browser keeps: which site may use which account, up to what
// limit, and how much it has used. There is no server. A grant lives in the
// browser's storage for the router's address, and nowhere else.
//
// A browser keeps that storage apart for each site the router's frame is
// inside. So the frame inside a florist's page can read the florist's grant
// and no other, and the router's own page cannot read it at all. Only the
// router's worker in that frame counts a request against it.
//
// A grant is one record:
//   site, id, provider, providerName, model, label     what was allowed
//   requests, expires                                  the limits
//   used, tokensIn, tokensOut, made, last              what has happened
//   sealed { iv, data }, key                           the API key, encrypted,
//                                                      and the key that opens it
// `key` is a CryptoKey the browser will not export. It can be used to decrypt
// and cannot be read, by anything. Works in a page and in a worker.

const STORE = "grants";
let opened = null;
let memory = null;    // used when the browser gives this page no storage: the grant then lasts until the page goes
const database = () => opened ||= new Promise((resolve, reject) => {
  const request = indexedDB.open("router", 1);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "site" });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error("blocked"));
}).catch(() => { memory = new Map(); return null; });

// Read one site's grant, change it, and write it back, as one step. Two tabs
// of the same site share this storage, and this is what stops both of them
// counting the same request once.
// fn(grant or null) returns { out, put } to write, { out, remove: true } to
// delete, or { out } to leave it alone. Resolves to out.
export async function change(site, fn) {
  const db = await database();
  if (!db) {
    const result = fn(memory.get(site) || null);
    if (result.put) memory.set(site, result.put); else if (result.remove) memory.delete(site);
    return result.out;
  }
  return new Promise((resolve, reject) => {
    let out;
    const step = db.transaction(STORE, "readwrite");
    const store = step.objectStore(STORE);
    const get = store.get(site);
    get.onsuccess = () => {
      const result = fn(get.result || null);
      out = result.out;
      if (result.put) store.put(result.put); else if (result.remove) store.delete(site);
    };
    step.oncomplete = () => resolve(out);
    step.onerror = step.onabort = () => reject(step.error || new Error("The grant could not be saved."));
  });
}

export const read = (site) => change(site, (grant) => ({ out: grant }));
export const save = (grant) => change(grant.site, () => ({ put: grant, out: true }));
export const remove = (site) => change(site, () => ({ remove: true, out: true }));

// Every grant kept in this storage. At the router's own address these are the
// sites served through the router window, which keeps their grants itself.
export async function all() {
  const db = await database();
  if (!db) return [...memory.values()];
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// Whether a grant is still good. Nothing outside this browser is asked.
export const stateOf = (grant, now = Date.now()) => (!grant ? "none" : now > grant.expires ? "expired" : grant.used >= grant.requests ? "used up" : "active");

// What may be shown of a grant, and passed to the router window: everything but the key.
export const view = (grant) => (grant ? {
  id: grant.id, site: grant.site, label: grant.label, provider: grant.provider, providerName: grant.providerName, model: grant.model,
  requests: grant.requests, used: grant.used, tokensIn: grant.tokensIn, tokensOut: grant.tokensOut, made: grant.made, expires: grant.expires, last: grant.last || 0, state: stateOf(grant),
} : null);
