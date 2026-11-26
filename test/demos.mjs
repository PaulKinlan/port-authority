// Every demo runs to the end. Each pattern's page is opened, and Next is pressed
// on its demo and on every built idea under it until the button says Start again.
// A demo fails here if its step bar stops ("Stopped ...", "This browser cannot ..."),
// if it never finishes, or if the page throws or crashes.
//
//   node test/demos.mjs                 every pattern
//   ONLY=filter,roundtrip node ...      some of them
//   SKIP=far,lend node ...              all but these (the two need a WebSocket server, which a plain local server may not have)
//   CHANNEL=chrome-canary node ...      another installed browser
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const root = LIVE ? process.env.LIVE_MAIN || `https://portauthority.${LIVE}` : `http://hub.localhost:${process.env.PORT || 8787}`;
const list = (value) => (value || "").split(",").filter(Boolean);
const only = list(process.env.ONLY), skip = list(process.env.SKIP);
const browser = await chromium.launch({
  ...(process.env.CHANNEL ? { channel: process.env.CHANNEL } : {}),
  ...(process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
  // The filter demo can use a camera, and the audio ones make sound: give them stand-ins and no prompts.
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, permissions: ["camera", "microphone"] });
await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
const STOP = /^Stopped|Could not run|This browser (cannot|does not|lacks)|does not support|not available here/i;

const index = await context.newPage();
await index.goto(root + "/patterns/", { waitUntil: "domcontentloaded" });
const ids = (await index.locator('#contents a[href^="/patterns/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href").split("/")[2]))).filter((id) => (!only.length || only.includes(id)) && !skip.includes(id));
await index.close();

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
        // No step bar. Either the demo is one a person drives by hand, or it has said why it cannot run here.
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
      if (crashed) verdict = "the page crashed";
      (verdict ? bad : good).push(verdict ? `${name}: ${verdict}` : name);
    }
    if (errors.length) bad.push(`${id}: the page threw: ${[...new Set(errors)].slice(0, 2).join(" ; ")}`);
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
