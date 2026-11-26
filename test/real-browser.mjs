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
