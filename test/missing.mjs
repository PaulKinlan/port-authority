// The "What is missing" page: every check runs and reports, every link on the
// page that points into this site resolves, and the other pages link to it.
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const root = LIVE ? process.env.LIVE_MAIN || `https://portauthority.${LIVE}` : "http://hub.localhost:8787";
const shots = process.argv[2];
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const proxy = process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {};

// Once as an ordinary browser, and once with the other origin and sandboxed
// frames in processes of their own, which is how desktop Chrome runs them.
const isolate = LIVE ? ["--site-per-process", "--enable-features=IsolateSandboxedIframes"] : ["--site-per-process", "--isolate-origins=http://florist.localhost:8787", "--enable-features=IsolateSandboxedIframes"];
for (const [label, args] of [["one process", []], ["isolated frames", isolate]]) {
  const browser = await chromium.launch({ ...proxy, args });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(root + "/missing/");
  await page.waitForFunction(() => /This page ran \d+ checks/.test(document.getElementById("tally").textContent), null, { timeout: 30000 });
  const got = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-probe]:not([data-manual])")].map((el) => [el.dataset.probe, el.dataset.state])));
  const pending = Object.entries(got).filter(([, state]) => !state || state === "unknown");
  check(`${label}: every check reported a result`, pending.length === 0, JSON.stringify(pending));
  const gaps = ["videoframe-other", "audiodata-other", "chunk-other", "track-worker", "filehandle-other", "datachannel-other", "mediasource-other", "close-event", "port-origin", "abortsignal-worker"];
  check(`${label}: the gaps the page describes are there in this Chromium`, gaps.every((id) => got[id] === "gap"), JSON.stringify(gaps.filter((id) => got[id] !== "gap")));
  check(`${label}: a stream and a bitmap do reach the other origin`, got["stream-other"] === "works" && got["imagebitmap-other"] === "works");
  check(`${label}: a video frame ${args.length ? "does not reach" : "reaches"} a sandboxed frame`, got["videoframe-sandbox"] === (args.length ? "gap" : "works"), got["videoframe-sandbox"]);
  // The effects demo, before the canvas check, which can end the other origin's frames.
  // The effects demo: the same pictures to another origin as ImageBitmap and as VideoFrame.
  await page.locator("#effects [data-start]").click();
  await page.waitForFunction(() => document.querySelector('[data-note="frame"]').dataset.state && /\d+ pictures back/.test(document.querySelector('[data-note="bitmap"]').textContent), null, { timeout: 15000 });
  const lanes = await page.evaluate(() => ["bitmap", "frame"].map((k) => document.querySelector(`[data-note="${k}"]`).textContent));
  check(`${label}: effects come back from the other origin when sent as ImageBitmap`, /pictures back/.test(lanes[0]), lanes[0]);
  check(`${label}: the VideoFrame version fails on the first frame, and says how`, /messageerror event and no VideoFrame/.test(lanes[1]), lanes[1]);
  // Waited for inside the page: when the frame's process dies, Playwright's own waits are rejected.
  const canvas = await page.evaluate(async () => {
    document.getElementById("run-canvas").click();
    const out = document.querySelector('[data-probe="canvas-other"]');
    for (let i = 0; i < 150 && !out.dataset.state; i++) await new Promise((r) => setTimeout(r, 100));
    return out.textContent;
  });
  check(`${label}: the canvas check ${args.length ? "finds the frame dead" : "draws"}`, args.length ? /stopped answering for good/.test(canvas) : /worked there/.test(canvas), canvas);
  if (!args.length) {
    check("no sideways scroll on a phone", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.waitForSelector("#references, .references, footer", { timeout: 5000 });
    check("API names are linked to MDN", (await page.locator('main a[href*="developer.mozilla.org"]').count()) > 10);
    const toc = await page.evaluate(() => [...document.querySelectorAll('.toc a')].map((a) => a.getAttribute("href")).filter((h) => !document.querySelector(h)));
    check("every entry in the contents list has a section", toc.length === 0, toc.join(" "));
    const inner = await page.evaluate(() => [...new Set([...document.querySelectorAll('main a[href^="/"]')].map((a) => a.getAttribute("href")))]);
    const broken = [];
    for (const href of inner) {
      const [path, hash] = href.split("#");
      // Fetched by the page, because Node does not resolve *.localhost.
      const { ok, body } = await page.evaluate((url) => fetch(url).then(async (r) => ({ ok: r.ok, body: await r.text() })), path);
      if (!ok || (hash && !body.includes(`id="${hash}"`))) broken.push(href);
    }
    check(`all ${inner.length} links into this site resolve`, broken.length === 0, broken.join(" "));
    if (shots) { await page.screenshot({ path: shots + "/missing-phone.png", fullPage: true }); }
    for (const p of ["/", "/guide/", "/patterns/", "/lab/", "/reading/", "/comlink/"]) {
      await page.goto(root + p);
      check(`${p} links to the page`, (await page.locator('.site-bar nav a[href="/missing/"]').count()) === 1);
    }
  }
  check(`${label}: no page errors`, errors.length === 0, errors.join(" | "));
  await browser.close();
}
process.exit(failed ? 1 : 0);
