// Browser run for the /comlink/ page: a fractal on two workers, a widget on
// another origin, and a journal in a locked file, with Comlink beside Hawser.
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>
// (and LIVE_MAIN=<origin of the main site> when it has a domain of its own).
//   NODE_PATH=$(npm root -g) node test/hawser.mjs <screenshot-dir>
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const root = LIVE ? process.env.LIVE_MAIN || `https://portauthority.${LIVE}` : `http://hub.localhost:${process.env.PORT || 8787}`;
// CHROMIUM_ARGS=--enable-blink-features=MessagePortCloseEvent turns on the port close event.
const args = (process.env.CHROMIUM_ARGS || "").split(" ").filter(Boolean);
const browser = await chromium.launch({ args, ...(process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {}) });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const wait = (ms) => page.waitForTimeout(ms);
const until = async (read, test, ms = 8000) => { const end = Date.now() + ms; let value; while (Date.now() < end) { value = await read(); if (test(value)) return value; await wait(100); } return value; };
const text = (selector) => page.locator(selector).innerText();
const stat = (lib, name) => text(`.pane[data-lib="${lib}"] [data-stat="${name}"]`);
const shot = async (name) => { if (process.argv[2]) await page.screenshot({ path: `${process.argv[2]}/${name}.png` }); };

await page.goto(root + "/comlink/");

// ---- explorer
await page.waitForSelector("#explorer[data-mounted]");
await page.waitForSelector('.pane[data-lib="hawser"][data-drawn="0"]');
await page.waitForSelector('.pane[data-lib="comlink"][data-drawn="0"]');
const painted = (lib) => page.evaluate((lib) => {
  const c = document.querySelector(`.pane[data-lib="${lib}"] canvas`), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  const seen = new Set(); for (let i = 0; i < d.length; i += 4 * 97) seen.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]);
  return seen.size;
}, lib);
check("explorer: both workers drew a picture", (await painted("hawser")) > 20 && (await painted("comlink")) > 20);
await page.click("#dive");
await page.waitForSelector('.pane[data-lib="hawser"][data-drawn="14"]', { timeout: 20000 });
const cancelled = +(await stat("hawser", "cancelled")), hawserWaste = await stat("hawser", "wasted");
check("explorer: Hawser cancelled the frames that were left behind", cancelled >= 5, `cancelled ${cancelled} of 14, wasted ${hawserWaste}`);
await page.waitForSelector('.pane[data-lib="comlink"][data-drawn="14"]', { timeout: 60000 });
const comlinkWaste = await stat("comlink", "wasted");
const asMs = (s) => (s.endsWith(" s") ? parseFloat(s) * 1000 : parseFloat(s));
check("explorer: Comlink finished every stale frame", asMs(comlinkWaste) > asMs(hawserWaste) * 3, `Comlink wasted ${comlinkWaste}, Hawser ${hawserWaste}`);
await shot("comlink-explorer");
await page.click("#crash");
await page.waitForSelector('.pane[data-lib="hawser"][data-recovered]', { timeout: 8000 });
const died = await until(() => text('.pane[data-lib="hawser"] .status'), (v) => /worker died.*drawn/.test(v));
check("explorer: Hawser noticed the dead worker, replaced it and redrew", /worker died\. Noticed after .* and replaced\. Zoom .* drawn/.test(died), died);
await page.locator('.pane[data-lib="hawser"]').evaluate((el) => delete el.dataset.drawn);
await page.click("#out");
await page.waitForSelector('.pane[data-lib="hawser"][data-drawn="13"]', { timeout: 8000 });
check("explorer: the replacement worker draws", true);
const waiting = await until(() => text('.pane[data-lib="comlink"] .status'), (s) => /No answer for/.test(s));
check("explorer: Comlink is still waiting on the dead worker", /No answer for/.test(waiting) && +(await stat("comlink", "waiting")) >= 2, waiting);

// ---- widget
await page.locator("#widget").scrollIntoViewIfNeeded();
await page.waitForSelector('.widget[data-lib="hawser"][data-ready]');
await page.waitForSelector('.widget[data-lib="comlink"][data-ready]');
const inside = (lib) => page.locator(`.widget[data-lib="${lib}"] iframe`).contentFrame();
const origin = await inside("hawser").locator("#origin").innerText();
check("widget: it is on another origin", origin !== new URL(root).host, origin);
await page.fill("#note", "one two three four five");
for (const lib of ["hawser", "comlink"]) check(`widget: ${lib} widget counts live`, (await until(() => inside(lib).locator("#words").innerText(), (v) => v === "5")) === "5");
await inside("hawser").locator("#overwrite").click();
check("widget: Hawser refuses write()", /refused with NotAllowedError/.test(await until(() => inside("hawser").locator("#result").innerText(), (v) => /refused|worked/.test(v))));
await inside("hawser").locator("#escape").click();
check("widget: Hawser refuses the constructor path", /constructor: refused with TypeError/.test(await until(() => inside("hawser").locator("#result").innerText(), (v) => /constructor/.test(v))));
check("widget: the note is untouched", (await page.inputValue("#note")) === "one two three four five");
await inside("comlink").locator("#overwrite").click();
check("widget: Comlink's facade has no write()", /write\(\): refused/.test(await until(() => inside("comlink").locator("#result").innerText(), (v) => /refused|worked/.test(v))));
await inside("comlink").locator("#escape").click();
const taken = await until(() => page.inputValue("#note"), (v) => /rewritten by the word count widget/.test(v));
check("widget: through Comlink, the widget's code ran in the page and rewrote the note", /rewritten by the word count widget/.test(taken), taken.slice(0, 60));
await shot("comlink-widget");
await page.click("#restore");
await page.click("#revoke");
check("widget: taking the port back ends the widget's access", /took its port back/.test(await until(() => inside("hawser").locator("#result").innerText(), (v) => /took its port back/.test(v))));
await page.fill("#note", "one two");
await wait(400);
check("widget: a revoked widget no longer sees edits", (await inside("hawser").locator("#words").innerText()) !== "2" && (await inside("comlink").locator("#words").innerText()) === "2");
await page.click("#regrant");
check("widget: a new port works again", (await until(() => inside("hawser").locator("#words").innerText().catch(() => ""), (v) => v === "2")) === "2");

// ---- journal
await page.locator("#journal").scrollIntoViewIfNeeded();
await page.waitForSelector("#journal[data-mounted]");
const status = () => text("#journal-status");
await until(status, (s) => /Read the journal/.test(s));
await page.click("#journal-clear"); await until(status, (s) => /Emptied/.test(s));
await page.fill("#entry", "first line"); await page.click("#journal-form button");
await until(status, (s) => /Written/.test(s));
check("journal: a line is written to the file and the handle is closed", /first line/.test(await text("#entries")) && (await text("#handles")) === "0", await status());
await page.uncheck("#careful");
await page.fill("#entry", "second line"); await page.click("#journal-form button");
await until(status, (s) => /kept by mistake/.test(s));
check("journal: a forgotten handle stays open", (await text("#handles")) === "1");
await page.fill("#entry", "third line"); await page.click("#journal-form button");
const locked = await until(status, (s) => /Error/.test(s));
check("journal: the browser refuses a second lock", /NoModificationAllowedError/.test(locked), locked.slice(0, 90));
await shot("comlink-journal");
await page.click("#journal-close");
await until(status, (s) => /Closed the link/.test(s));
check("journal: closing the link closes the handle in the worker", (await until(() => text("#handles"), (v) => v === "0")) === "0");
await page.check("#careful");
await page.fill("#entry", "fourth line"); await page.click("#journal-form button");
await until(status, (s) => /Written/.test(s));
check("journal: and the file can be written again", /fourth line/.test(await text("#entries")));
await page.reload();
await page.locator("#journal").scrollIntoViewIfNeeded();
check("journal: the file is still there after a reload", /fourth line/.test(await until(() => text("#entries"), (v) => /fourth line/.test(v))));

if (process.argv[2]) await page.screenshot({ path: process.argv[2] + "/comlink.png", fullPage: true });
check("no page errors", errors.length === 0, errors.join(" | "));
console.log(await browser.version());
await browser.close();
process.exit(failed ? 1 : 0);
