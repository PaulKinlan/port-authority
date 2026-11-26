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
