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
  // WebGPU needs a graphics adapter, which a headless browser may not have.
  const pending = Object.entries(got).filter(([id, state]) => !state || (state === "unknown" && id !== "gpu-move"));
  check(`${label}: every check reported a result`, pending.length === 0, JSON.stringify(pending));
  const more = ["file-writer", "request-copy", "response-copy", "headers-copy", "compression-move", "websocket-move", "canvas-drawn", "audiobuffer-copy", "key-move", "class-copy", "error-copy", "worker-other-origin", "backpressure", "stream-copy", "sync-receive"];
  check(`${label}: the unsendable types and missing primitives are as the page says`, more.every((id) => got[id] === "gap"), JSON.stringify(more.filter((id) => got[id] !== "gap")));
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
  // The other demos. Each has one line that fails and one that works.
  const demo = async (id, buttons, ms = 2500) => {
    for (const what of buttons) {
      await page.evaluate((id) => document.querySelector(`#demo-${id}`).scrollIntoView(), id);
      await page.waitForSelector(`#demo-${id} [data-do="${what}"]:not([disabled])`, { state: "attached", timeout: 15000 });
      await page.evaluate(([id, what]) => { document.querySelector(`#demo-${id}`).scrollIntoView(); document.querySelector(`#demo-${id} [data-do="${what}"]`).click(); }, [id, what]);
      await page.waitForTimeout(ms);
    }
    return page.evaluate((id) => [...document.querySelectorAll(`#demo-${id} .lanes li`)].map((li) => `[${li.dataset.state || "-"}] ${li.textContent}`), id);
  };
  for (const [id, buttons, want] of [
    ["track", ["start"], [/\[gap\].*DataCloneError/, /\[works\].*read \d+ frames/]],
    ["editor", ["start", "type"], [/\[gap\].*no file/, /\[works\].*this page wrote it/]],
    ["plugin", ["start"], [/\[gap\].*no connection/, /\[works\].*\d+ messages from the plug-in/]],
    ["identity", ["start"], [/\[gap\].*event.origin is ""/, /\[gap\].*event.origin is ""/]],
    ["abort", ["start"], [/\[gap\].*DataCloneError/, /\[works\].*stopped \d+ ms/]],
  ]) {
    const lanes = await demo(id, buttons, id === "plugin" ? 4000 : 2500);
    check(`${label}: the ${id} demo shows what fails and what works`, want.every((re, i) => re.test(lanes[i] || "")), JSON.stringify(lanes));
  }
  const painter = await demo("painter", ["start"], 1500);
  check(`${label}: the painter sends pictures back`, /\[works\].*pictures drawn/.test(painter[0]), painter[0]);
  if (!args.length) {
    await page.evaluate(() => document.getElementById("run-census").click());
    await page.waitForFunction(() => document.getElementById("census-table").dataset.done, null, { timeout: 90000 });
    const census = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#census-table tbody tr:not(.group)")].map((tr) => [tr.cells[0].textContent, [...tr.cells].slice(1).map((td) => td.textContent)])));
    check("the full table runs", Object.keys(census).length > 55, String(Object.keys(census).length));
    check("the full table: a port moves and crosses, a VideoFrame moves and does not cross, a Request does neither", census.MessagePort?.join() === "No,Yes,Yes" && census.VideoFrame?.join() === "Yes,Yes,No" && census.Request?.join() === "No,No,No", JSON.stringify([census.MessagePort, census.VideoFrame, census.Request]));
    const cards = [];
    for (const id of ["bite-unreadable", "bite-gone", "alive-signals", "oneway", "built-covert", "stream-intro", "built-swroute", "built-picker"]) {
      await page.evaluate((id) => document.querySelector("#live-" + id)?.scrollIntoView(), id);
      const ok = await page.waitForSelector(`#live-${id} .demo button`, { timeout: 15000 }).then(() => true, () => false);
      if (!ok) cards.push(id);
    }
    check("the eight demos from elsewhere on the site are running on the page", cards.length === 0, cards.join(" "));
  }
  // Last, because in Chrome it ends the other origin's frames.
  const given = await page.evaluate(async () => {
    document.querySelector('#demo-painter [data-do="give"]').click();
    const li = document.querySelectorAll("#demo-painter .lanes li")[1];
    for (let i = 0; i < 100 && !li.dataset.state; i++) await new Promise((r) => setTimeout(r, 100));
    return `[${li.dataset.state}] ${li.textContent}`;
  });
  check(`${label}: the painter given the canvas ${args.length ? "stops answering" : "draws on the page"}`, args.length ? /\[gap\].*stopped answering/.test(given) : /\[works\].*drawing straight/.test(given), given);
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
      let found = !hash || body.includes(`id="${hash}"`);
      // A pattern page builds its sections with script, so open it and look.
      if (ok && !found && path.startsWith("/patterns/")) {
        const other = await context.newPage();
        await other.goto(root + path);
        found = await other.waitForSelector("#" + hash, { state: "attached", timeout: 8000 }).then(() => true, () => false);
        await other.close();
      }
      if (!ok || !found) broken.push(href);
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
