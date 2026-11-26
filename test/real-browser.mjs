// Launch the browser the way a person's own browser runs.
//
// Playwright switches off third-party storage partitioning, so in a browser it
// launches, a frame from one site inside another site's page shares storage
// with that site's own tabs. No real Chrome does that any more. The AI router
// is built around partitioned storage, so its tests have to run with it on.
//
// A feature that is in both the list to switch off and the list to switch on
// stays off, so the name has to come out of Playwright's own list. That list
// is read from a browser Playwright starts, and then used again without it.
const FEATURE = "ThirdPartyStoragePartitioning";

export async function launchWithPartitioning(chromium, options = {}) {
  const probe = await chromium.launchServer({ ...options, headless: true });
  const theirs = probe.process().spawnargs.find((arg) => arg.startsWith("--disable-features=")) || "";
  await probe.close();
  if (!theirs.split("=")[1]?.split(",").includes(FEATURE)) return chromium.launch(options);   // this Playwright leaves it on
  const ours = "--disable-features=" + theirs.split("=")[1].split(",").filter((name) => name !== FEATURE).join(",");
  return chromium.launch({ ...options, ignoreDefaultArgs: [...(Array.isArray(options.ignoreDefaultArgs) ? options.ignoreDefaultArgs : []), theirs], args: [...(options.args || []), ours] });
}

// What a router page keeps for one site: the grant, as the router's worker
// stored it. Read from inside the router frame (or the router window) with the
// test's own tools. No page from another address could do this.
// Returns null when there is none, or { text, fields, key, exported, grant }.
export function keptGrant(frame, site) {
  return frame.evaluate(async (site) => {
    // Opening a database that is not there would make an empty one, and the router would then find no store in it.
    if (!(await indexedDB.databases()).some((db) => db.name === "router")) return null;
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("router"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const grant = await new Promise((resolve) => { const request = db.transaction("grants").objectStore("grants").get(site); request.onsuccess = () => resolve(request.result || null); request.onerror = () => resolve(null); });
    db.close();
    if (!grant) return null;
    let exported = "refused";
    if (grant.key) { try { await crypto.subtle.exportKey("raw", grant.key); exported = "exported"; } catch { /* the browser will not hand it over */ } }
    const { key, ...rest } = grant;
    return { text: JSON.stringify(grant), fields: Object.keys(grant).sort(), grant: rest, exported, key: key ? `${key.type} ${key.algorithm.name} extractable=${key.extractable} usages=${key.usages.join(",")}` : "none" };
  }, site);
}

// What makes the calls to a provider for a page, by address: the call worker
// (/call/<provider>.js) where the browser holds a worker to the policy on its
// own script, or the call page (/call/<provider>) where it does not.
// After a page is reloaded, the test's tools can go on listing a worker that went with the old page, so each
// worker is asked to answer before it is counted.
export async function callers(page) {
  const answers = (worker) => Promise.race([worker.evaluate(() => true).catch(() => false), new Promise((resolve) => setTimeout(() => resolve(false), 1000))]);
  const workers = [];
  for (const worker of page.workers().filter((w) => /\/call\/[^/]+\.js$/.test(w.url()))) if (await answers(worker)) workers.push(worker);
  return [...workers, ...page.frames().filter((frame) => /\/call\/[^/.]+$/.test(frame.url()))];
}
// Makes a router page unable to start the call worker, as in a browser that cannot. It then uses the call page.
export const withoutCallWorker = (context) => context.addInitScript(() => {
  const Real = self.Worker;
  self.Worker = function (url, options) { if (/\/call\/[^/]+\.js$/.test(String(url))) throw new Error("no call worker in this test"); return new Real(url, options); };
  self.Worker.prototype = Real.prototype;
});

// How the router's own page keeps the accounts: what is in localStorage, and
// what is in the database of secrets. Read with the test's own tools, from a
// page at the router's address.
export function keptAccounts(page) {
  return page.evaluate(async () => {
    const out = { plain: JSON.stringify({ ...localStorage }), listed: JSON.parse(localStorage.getItem("router.accounts") || "[]"), secrets: [] };
    if (!(await indexedDB.databases()).some((db) => db.name === "router-accounts")) return out;
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("router-accounts"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const all = await new Promise((resolve) => { const request = db.transaction("secrets").objectStore("secrets").getAll(); request.onsuccess = () => resolve(request.result || []); request.onerror = () => resolve([]); });
    db.close();
    for (const kept of all) {
      let exported = "refused";
      try { await crypto.subtle.exportKey("raw", kept.key); exported = "exported"; } catch { /* the browser will not hand it over */ }
      out.secrets.push({ id: kept.id, text: JSON.stringify(kept), sealed: kept.sealed, exported, key: `${kept.key.type} ${kept.key.algorithm.name} extractable=${kept.key.extractable} usages=${[...kept.key.usages].sort().join(",")}` });
    }
    return out;
  });
}
