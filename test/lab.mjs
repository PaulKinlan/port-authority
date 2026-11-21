// The lab runs every test, reports to the server, and the results page shows it.
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>.
// Against the live site the run is private, so tests do not add reports.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const root = LIVE ? process.env.LIVE_MAIN || `https://portauthority.${LIVE}` : "http://hub.localhost:8787";
const shots = process.argv[2];
const browser = await chromium.launch(process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1200 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const cell = (kind, dest) => page.locator(`#matrix td[data-k="${kind}"][data-d="${dest}"]`).getAttribute("data-o");

await page.goto(root + "/lab/" + (LIVE ? "?private" : ""));
await page.waitForSelector('html[data-done="true"]', { timeout: 120000 });
const rows = await page.locator("#matrix tbody tr:not(.band)").count();
const pending = await page.locator('#matrix td[data-o="pending"]').count();
check("every test ran", rows >= 45 && pending === 0, `(${rows} kinds, ${pending} pending)`);
check("a port reaches a worker inside a frame on another origin", (await cell("MessagePort", "frame-other-worker")) === "works");
check("a stream reaches a service worker", (await cell("ReadableStream", "sw")) === "works");
check("a non-extractable key signs on another origin", (await cell("CryptoKey (ECDSA private, non-extractable)", "frame-other")) === "works");
check("a port reaches the audio thread", (await cell("MessagePort", "audio")) === "works");
check("BroadcastChannel and IndexedDB refuse a port", (await cell("MessagePort", "broadcast")) === "refused" && (await cell("MessagePort", "idb")) === "refused");
check("a function is refused everywhere", (await cell("Function", "worker")) === "refused" && (await cell("Function", "clone")) === "refused");
check("shared memory cannot be made on an ordinary page", (await cell("SharedArrayBuffer", "worker")) === "cannot-make");
await page.locator('#matrix td[data-k="Promise"][data-d="worker"] button').click();
check("a mark explains itself when pressed", /Promise.*Worker.*refused.*DataCloneError/s.test(await page.locator("#detail").innerText()), (await page.locator("#detail").innerText()).slice(0, 120));
if (shots) await page.screenshot({ path: shots + "/lab.png", fullPage: true });

if (!LIVE) {
  await page.waitForFunction(() => document.documentElement.dataset.report, null, { timeout: 10000 });
  const id = await page.evaluate(() => document.documentElement.dataset.report);
  await page.evaluate(() => dispatchEvent(new CustomEvent("pa-error", { detail: { where: "test", message: "a test error " + Date.now() } })));
  await page.waitForTimeout(500);
  await page.goto(root + "/lab/results/");
  await page.waitForSelector('html[data-done="true"]');
  check("results: the report is listed", (await page.locator("#reports").innerText()).includes(id));
  check("results: the browser has a table", (await page.locator("#matrix tbody tr:not(.band)").count()) >= 45 && (await page.locator('#matrix td[data-o="works"]').count()) > 200);
  check("results: page errors are listed", /a test error/.test(await page.locator("#errors").innerText()));
  if (shots) await page.screenshot({ path: shots + "/results.png", fullPage: true });
}

await page.goto(root + "/isolated/lab/?private");
await page.waitForSelector('html[data-done="true"]', { timeout: 120000 });
check("isolated lab: shared memory is shared with a worker", (await cell("SharedArrayBuffer", "worker")) === "works");
check("isolated lab: shared memory does not reach another origin", (await cell("SharedArrayBuffer", "frame-other")) !== "works");

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
