// Knowing whether the other side of a port is still there (sites/main/patterns/alive.js).
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const root = LIVE ? process.env.LIVE_MAIN || `https://portauthority.${LIVE}` : "http://hub.localhost:8787";
const shots = process.argv[2];
// Frames from other sites in their own process, as in a desktop Chrome.
const browser = await chromium.launch({ args: ["--enable-features=IsolateSandboxedIframes", "--site-per-process"], ...(process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {}) });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const wait = (ms) => page.waitForTimeout(ms);
const flat = (t) => String(t).replace(/\n/g, " | ").slice(0, 300);
const at = "#demo";
const open = async (id) => { await page.goto(`${root}/patterns/${id}/`); await page.waitForSelector(`${at} .controls button`, { timeout: 15000 }); await wait(600); };
const click = (label) => page.locator(`${at} .controls button`, { hasText: label }).first().click();
const state = () => page.locator(`${at} .box[data-name="page"]`).getAttribute("data-state");
const boxText = async (name) => (await page.locator(`${at} .box[data-name="${name}"]`).innerText()).replace(/\n/g, " ");
const frameText = (name) => page.locator(`${at} .box[data-name="${name}"] iframe`).contentFrame().locator("body").innerText();
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => false); if (v || Date.now() > end) return v; await wait(150); } };
const shot = async (name) => { if (shots) await page.locator(at).screenshot({ path: `${shots}/${name}.png` }); };

// ---- two ports, pings on the second
await open("health-pair");
check("pair: the far side is on another origin", new URL(await page.locator(`${at} .box[data-name="far"] iframe`).getAttribute("src")).origin !== new URL(root).origin);
await click("Connect");
check("pair: alive once pings are answered", !!(await until(async () => (await state()) === "alive")), await state());
await click("Ask the price of tulips");
check("pair: work goes on the data port", !!(await until(async () => /tulips: £4.50 a bunch/.test(await boxText("page")))), flat(await boxText("page")));
check("pair: the data port's far side never saw a ping", !/asked for (?!tulips)/.test(await frameText("far")), flat(await frameText("far")));
await click("Far side: busy for 5 seconds");
check("pair: a busy far side is late, then silent", !!(await until(async () => (await state()) === "silent", 6000)), flat(await boxText("page")));
check("pair: and alive again when it is free", !!(await until(async () => (await state()) === "alive", 6000)), flat(await boxText("page")));
await shot("health-pair");
const t0 = Date.now();
await click("Remove the far side");
check("pair: a removed frame is seen as gone at once, from its goodbye", !!(await until(async () => (await state()) === "closed", 1500)) && Date.now() - t0 < 1500, `${Date.now() - t0} ms, ${flat(await boxText("page"))}`);

// ---- the far side sends the health port back
await open("health-back");
await click("Connect");
check("back: a health port comes back and is watched", !!(await until(async () => (await state()) === "alive")) && /a health port came back/.test(await boxText("page")), flat(await boxText("page")));
check("back: the cable for it is drawn", (await page.locator(`${at} .stage path.cable`).count()) === 2);
await click("Far side: close its ports");
check("back: close() says nothing, the missed pings do", !!(await until(async () => (await state()) === "silent", 6000)) && !/goodbye/.test(await boxText("page")), flat(await boxText("page")));
await shot("health-back");

// ---- beats each way
await open("health-beats");
await click("Connect");
check("beats: this page hears the far side's beats", !!(await until(async () => (await state()) === "alive")), flat(await boxText("page")));
check("beats: the far side hears this page's", !!(await until(async () => /the page is alive/.test(await frameText("far")))), flat(await frameText("far")));
await click("This page: stop sending beats");
check("beats: the far side notices this page went quiet", !!(await until(async () => /the page is silent/.test(await frameText("far")), 7000)), flat(await frameText("far")));
check("beats: this page still hears the far side", (await state()) === "alive");
await click("Remove the far side");
check("beats: the goodbye comes on the far side's beat port", !!(await until(async () => (await state()) === "closed", 1500)), flat(await boxText("page")));
await shot("health-beats");

// ---- every signal against every ending
await open("alive-signals");
await click("Run every row");
const row = (id) => page.locator(`${at} tr[data-row="${id}"]`).evaluate((tr) => Object.fromEntries([...tr.querySelectorAll("td")].map((td) => [td.dataset.col, td.textContent])));
await until(async () => !(await page.locator(`${at} .controls button`, { hasText: "Run every row" }).isDisabled()) && (await row("stuck")).lock !== "not run" && !/…/.test(JSON.stringify(await row("stuck"))), 60000);
const rows = {};
for (const id of ["remove", "leave", "close", "worker", "stuck"]) { rows[id] = await row(id); console.log("     ", id, JSON.stringify(rows[id])); }
const quick = (text) => /^\d+ ms$/.test(text) && parseInt(text) < 300;
check("signals: removing the frame is seen at once by the goodbye and the lock", quick(rows.remove.goodbye) && quick(rows.remove.lock));
check("signals: pings and beats see it within two seconds", Object.values(rows).slice(0, 4).every((r) => /^1\.\d s$/.test(r.pings) && /^1\.\d s$/.test(r.beats)));
check("signals: navigating away, the same", quick(rows.leave.goodbye) && quick(rows.leave.lock));
check("signals: close() is only seen by pings and beats", rows.close.goodbye === "nothing" && rows.close.lock === "nothing" && /s$/.test(rows.close.pings) && /s$/.test(rows.close.beats));
check("signals: a busy worker looks gone to pings and beats, then comes back", /then alive again/.test(rows.stuck.pings) && /then alive again/.test(rows.stuck.beats) && rows.stuck.lock === "nothing");
check("signals: a terminated worker frees its lock at once", quick(rows.worker.lock) && /pagehide/.test(rows.worker.goodbye));
check("signals: no close event in a browser without it", Object.values(rows).every((r) => r.close === "not in this browser"));
await shot("alive-signals");

// ---- restart a worker that stopped answering
await open("alive-restart");
await click("Start the worker"); await wait(300);
await click("Ask: primes below 5 million");
check("restart: the worker answers", !!(await until(async () => /348,513 primes below 5,000,000/.test(await boxText("page")))), flat(await boxText("page")));
await click("Make the worker hang");
await click("Ask: primes below 5 million");
check("restart: a hung worker is replaced and asked again", !!(await until(async () => /answer #2: 348,513/.test(await boxText("page")), 8000)) && /Number 2/.test(await boxText("worker")), flat(await boxText("page")));
await click("Make the worker close itself");
check("restart: a worker that closed itself is replaced", !!(await until(async () => /Number 3/.test(await boxText("worker")), 8000)), flat(await boxText("worker")));
await click("Ask: primes below 5 million");
check("restart: the new worker answers", !!(await until(async () => /answer #3: 348,513/.test(await boxText("page")))), flat(await boxText("page")));
await shot("alive-restart");

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
