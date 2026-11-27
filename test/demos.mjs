// Every demo runs to the end and actually does what it says.
//
// Each pattern's page is opened in a browser configured like a real one
// (partitioned third-party storage, no fake autoplay override), and Next is
// pressed on its demo and on every built idea under it until the button says
// Start again. A demo fails here if:
//   - its step bar stops ("Stopped ...", "This browser cannot ..."),
//   - it never finishes,
//   - the page or any sandboxed frame throws (pageerror / pa-error),
//   - or any box or iframe shows broken output ("undefined", "NaN",
//     "the fetch failed", "delivered 0 blocks", "drew 0 readings", "played 0 notes").
//
//   node test/demos.mjs                 every pattern
//   ONLY=swpair,audio,router node ...   some of them
//   SKIP=far,lend node ...              all but these (the two need a WebSocket server)
//   CHANNEL=chrome-canary node ...      another installed browser
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>.
import { createRequire } from "node:module";
import { launchWithPartitioning } from "./real-browser.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const root = LIVE ? process.env.LIVE_MAIN || `https://portauthority.${LIVE}` : `http://hub.localhost:${process.env.PORT || 8787}`;
const list = (value) => (value || "").split(",").filter(Boolean);
const only = list(process.env.ONLY), skip = list(process.env.SKIP);
const browser = await launchWithPartitioning(chromium, {
  ...(process.env.CHANNEL ? { channel: process.env.CHANNEL } : {}),
  ...(process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
});
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
await context.addInitScript(() => {
  window.__paErrors = [];
  window.addEventListener("pa-error", (e) => window.__paErrors.push(e.detail));
});
const STOP = /^Stopped|Could not run|This browser (cannot|does not|lacks)|does not support|not available here/i;
const BROKEN_TEXT = /\bundefined\b|\bNaN\b|the fetch failed|delivered 0 blocks|drew 0 readings|played 0 notes/i;

const index = await context.newPage();
await index.goto(root + "/patterns/", { waitUntil: "domcontentloaded" });
const ids = (await index.locator('#contents a[href^="/patterns/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href").split("/")[2]))).filter((id) => (!only.length || only.includes(id)) && !skip.includes(id));
await index.close();

async function checkBoxes(page, where) {
  const problems = [];
  const count = await page.locator(`${where} .stage-el .box`).count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const box = page.locator(`${where} .stage-el .box`).nth(i);
    const bname = (await box.getAttribute("data-name").catch(() => "")) || `box-${i}`;
    const hasIframe = (await box.locator("iframe").count().catch(() => 0)) > 0;
    const text = (hasIframe
      ? await box.locator("iframe").first().contentFrame().locator("body").innerText({ timeout: 2500 }).catch(() => "")
      : await box.innerText({ timeout: 2500 }).catch(() => "")
    ).replace(/\s+/g, " ").trim();
    const match = text.match(BROKEN_TEXT);
    if (match) problems.push(`box ${bname} showed "${match[0]}": ${text.slice(0, 140)}`);
  }
  return problems;
}

const good = [], bad = [], still = [];
for (const id of ids) {
  const page = await context.newPage();
  const errors = [];
  let crashed = false;
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 140)));
  page.on("crash", () => { crashed = true; });
  try {
    await page.goto(`${root}/patterns/${id}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.locator("#demo .stepper").waitFor({ timeout: 15000 });
    // The built ideas start when they are scrolled to. Go to each, so that every one is running.
    const ideas = await page.locator("article.built[id]").evaluateAll((all) => all.map((a) => a.id));
    for (const idea of ideas) { await page.locator(`#${idea}`).scrollIntoViewIfNeeded(); await page.locator(`#${idea} .stepper`).waitFor({ timeout: 15000 }); }
    await page.waitForTimeout(1500);
    for (const where of ["#demo", ...ideas.map((idea) => "#" + idea)]) {
      if (crashed) break;
      const name = where === "#demo" ? id : `${id} / ${where.slice(1)}`;
      const fwd = page.locator(`${where} .stepper .fwd`), caption = page.locator(`${where} .stepper .caption`);
      const said = async () => (await caption.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      await page.locator(where).scrollIntoViewIfNeeded().catch(() => {});
      if (!(await fwd.isVisible().catch(() => false))) {
        const text = await said();
        (STOP.test(text) ? bad : still).push(`${name}: ${text.slice(0, 160) || "no steps"}`);
        continue;
      }
      let verdict = "did not finish in 20 presses";
      for (let press = 0; press < 20 && !crashed; press++) {
        const label = (await fwd.innerText().catch(() => "")).trim();
        if (/^Start again/.test(label)) { verdict = ""; break; }
        await fwd.click({ timeout: 5000 }).catch(() => {});
        // A step is over when Next can be pressed again.
        for (let waited = 0; waited < 14000 && !crashed; waited += 200) { await page.waitForTimeout(200); if (await fwd.isEnabled().catch(() => true)) break; }
        const text = await said();
        if (STOP.test(text)) { verdict = `stopped at "${label.replace(/^Next: /, "").replace(/ ›$/, "")}": ${text.slice(0, 200)}`; break; }
      }
      if (!verdict && !crashed) {
        await page.waitForTimeout(500);
        const boxProblems = await checkBoxes(page, where);
        if (boxProblems.length) verdict = boxProblems.join(" ; ");
      }
      if (crashed) verdict = "the page crashed";
      (verdict ? bad : good).push(verdict ? `${name}: ${verdict}` : name);
    }
    const paErrors = await page.evaluate(() => window.__paErrors || []).catch(() => []);
    if (errors.length) bad.push(`${id}: the page threw: ${[...new Set(errors)].slice(0, 2).join(" ; ")}`);
    if (paErrors.length) bad.push(`${id}: frame threw: ${paErrors.slice(0, 2).map((e) => `${e.where}: ${e.message}`).join(" ; ")}`);
  } catch (e) {
    bad.push(`${id}: ${crashed ? "the page crashed" : "could not be run: " + e.message.split("\n")[0].slice(0, 140)}`);
  }
  await page.close().catch(() => {});
}

console.log(`${browser.browserType().name()} ${browser.version()} at ${root}`);
for (const line of still) console.log("     no step bar: " + line);
for (const line of bad) console.log("FAIL " + line);
console.log(`${bad.length ? "FAIL" : "ok  "} every demo runs to the end: ${good.length} did, ${bad.length} did not${skip.length ? `, ${skip.length} skipped (${skip.join(", ")})` : ""}`);
await browser.close();
process.exit(bad.length ? 1 : 0);
