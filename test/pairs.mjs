// Ports sent over ports: the service workers of two sites joined by a port
// (sites/main/patterns/pairs.js, sites/shared/pair-sw.js, sites/shared/pair/).
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const root = LIVE ? process.env.LIVE_MAIN || `https://portauthority.${LIVE}` : `http://hub.localhost:${process.env.PORT || 8787}`;
const florist = LIVE ? `https://pa-florist.${LIVE}` : `http://florist.localhost:${process.env.PORT || 8787}`;
const shots = process.argv[2];
const browser = await chromium.launch({ args: ["--site-per-process"], ...(process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {}) });
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const wait = (ms) => page.waitForTimeout(ms);
const flat = (t) => String(t).replace(/\n/g, " | ").slice(0, 300);
let at = "";
const open = async (id) => { at = "#" + id; await page.goto(`${root}/patterns/swpair/`); await page.locator(at).scrollIntoViewIfNeeded(); await page.waitForSelector(`${at} .controls button`, { timeout: 20000 }); await wait(600); };
// Bring the button to the middle of the screen first. The step bar above the
// buttons is sticky, and a button scrolled only just into view can be under it.
const click = async (label) => { const b = page.locator(`${at} .controls button`, { hasText: label }).first(); await b.evaluate((el) => el.scrollIntoView({ block: "center" })); await wait(150); await b.click(); };
const frameText = (name) => page.locator(`${at} .box[data-name="${name}"] iframe`).contentFrame().locator("body").innerText();
const boxText = async (name) => (await page.locator(`${at} .box[data-name="${name}"]`).innerText()).replace(/\n/g, " ");
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => false); if (v || Date.now() > end) return v; await wait(200); } };
const sees = (name, re, ms) => until(async () => re.test(await (name.startsWith("sw") ? boxText(name) : frameText(name))), ms);
const shot = async (name) => { if (shots) await page.locator(at).screenshot({ path: `${shots}/${name}.png` }); };
const cables = () => page.locator(`${at} .stage-el svg path.cable`).count();

// ---- the pattern itself
await open("demo");
await click("Give the two pages a line");
await click("Join the two workers");
check("join: both workers say they hold a port", !!(await sees("swa", /held, to the library's worker/)) && !!(await sees("swb", /held, to the florist's worker/)), flat(await boxText("swa")) + " // " + flat(await boxText("swb")));
check("join: the port went worker, page, page, worker", /Sent it over my line to the library's page/.test(await frameText("a")) && /Gave it to my worker/.test(await frameText("b")), flat(await frameText("a")));
check("join: a cable is drawn between the two workers", (await cables()) === 2);
await click("Florist's worker: ask about Dune");
check("ask: the library's worker answers the florist's from its cache", !!(await sees("a", /about Dune: out until Friday/)) && /asked about Dune\. Read my cache/.test(await boxText("swb")), flat(await frameText("a")));
await click("Library's worker: ask about tulips");
check("ask: and the other way on the same port", !!(await sees("b", /about tulips: 24 bunches/)), flat(await frameText("b")));
await shot("swpair-joined");
await click("Make the library's worker forget");
await sees("swb", /Port to the other worker: none/);
await click("Florist's worker: ask about Dune");
check("forget: the florist's worker notices by getting no answer", !!(await sees("swa", /no answer in 1\.5 seconds|We are joined|It said: out until Friday/)), flat(await boxText("swa")));
check("forget: a new port is carried across and the question is answered", !!(await until(async () => ((await frameText("a")).match(/about Dune: out until Friday/g) || []).length === 2)), flat(await frameText("a")));
check("forget: the library's worker holds a port again", /held, to the florist's worker/.test(await boxText("swb")), flat(await boxText("swb")));
await click("Close the library's page");
await click("Florist's worker: ask about Dune");
check("no page: the workers still talk after the library's page is destroyed", !!(await until(async () => ((await frameText("a")).match(/about Dune: out until Friday/g) || []).length === 3)), flat(await frameText("a")));
await click("Make the florist's worker forget");
await sees("swa", /Port to the other worker: none/);
await click("Florist's worker: ask about Dune");
check("no page: and cannot be joined again", !!(await sees("a", /could not reach the other worker/, 9000)) && /nothing answered on the port I sent out|could not ask/.test(await boxText("swa")), flat(await boxText("swa")));
await shot("swpair-end");

// ---- a real stop. The browser is told to stop every service worker, which a page cannot do.
await open("demo");
await click("Give the two pages a line");
await click("Join the two workers");
await sees("swb", /held, to the florist's worker/);
const runOf = async (name) => (await boxText(name)).match(/Run (\w+)/)[1];
const before = [await runOf("swa"), await runOf("swb")];
const cdp = await browser.newBrowserCDPSession();
const stopAll = async () => {
  const { targetInfos } = await cdp.send("Target.getTargets");
  let stopped = 0;
  for (const t of targetInfos.filter((t) => t.type === "service_worker" && /pair-sw\.js/.test(t.url))) { await cdp.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {}); stopped++; }
  return stopped;
};
const stopped = await stopAll();
await wait(1200);
await click("Florist's worker: ask about Dune");
const answered = await sees("a", /about Dune: out until Friday/, 12000);
const after = [await runOf("swa"), await runOf("swb")];
check("real stop: both workers were stopped by the browser and started again", stopped >= 2 && before[0] !== after[0] && before[1] !== after[1], `stopped ${stopped}, runs ${before} -> ${after}`);
check("real stop: the question is still answered, over a new port", !!answered && /stopped my worker and started it again/.test(await frameText("a")), flat(await frameText("a")));
await shot("swpair-stopped");

// ---- a line for every tab
await open("built-lines");
await click("Give the two pages a line to each other");
await click("Join the two workers");
await sees("swb", /held, to the florist's worker/);
await click("Tab one: get a line"); await click("Tab two: get a line");
check("lines: each tab is given a port to the library's worker", !!(await sees("a", /Its other end is held by the library's worker/)) && !!(await sees("a2", /Its other end is held by the library's worker/)), flat(await frameText("a2")));
await click("Tab one: ask about Dune on its line");
check("lines: a tab asks the library's worker directly", !!(await sees("a", /on my own line: out until Friday/)) && /a tab of the florist asked about Dune/.test(await boxText("swb")), flat(await boxText("swb")));
await click("Make the florist's worker forget");
await sees("swa", /Port to the other worker: none/);
await click("Tab two: ask about Dune on its line");
check("lines: a tab's line works after its own worker has lost its port", !!(await sees("a2", /on my own line: out until Friday/)), flat(await frameText("a2")));
await shot("built-lines");
await click("Make the library's worker forget");
await wait(500);
await click("Tab one: ask about Dune on its line");
check("lines: a line ends when the library's worker loses it, and the tab finds out by silence", !!(await sees("a", /no answer on my line/)), flat(await frameText("a")));
await click("Tab one: get a line");
check("lines: asking for a new line joins the workers again first", !!(await until(async () => ((await frameText("a")).match(/Its other end is held by the library's worker/g) || []).length >= 1 && /held, to the library's worker/.test(await boxText("swa")), 12000)), flat(await boxText("swa")));
await click("Tab one: ask about Dune on its line");
check("lines: and the new line is answered", !!(await until(async () => ((await frameText("a")).match(/on my own line: out until Friday/g) || []).length === 2)), flat(await frameText("a")));

// ---- an address on one site, answered by the other site's worker
await open("built-swfetch");
await click("Give the two pages a line to each other");
await click("Join the two workers");
await sees("swb", /held, to the florist's worker/);
await click("Florist's page: fetch the library's shelf");
check("fetch: the florist's page reads a file written by the library's worker", !!(await sees("a", /Beloved: on the shelf/)) && /Written by the library's service worker/.test(await frameText("a")) && /200, text\/plain/.test(await frameText("a")), flat(await frameText("a")));
await click("Make the library's worker forget");
await wait(400);
await click("Florist's page: fetch the library's shelf");
check("fetch: the same fetch succeeds after the library's worker lost its port", !!(await sees("a", /Beloved: on the shelf[\s\S]*200, text\/plain[\s\S]*my worker gave me a port\. Sent it over my line/, 12000)), flat(await frameText("a")));
await click("Florist's page: fetch a file the library does not have");
check("fetch: a missing file is the library's 404", !!(await sees("a", /404, text\/plain/)) && /The library has no prices\.txt/.test(await frameText("a")), flat(await frameText("a")));
await shot("built-swfetch");

// ---- a third site introduces them
await open("built-matchmaker");
await click("Planner: introduce the two sites");
check("planner: both workers hold a port after the planner's introduction", !!(await sees("swa", /held, to the library's worker/)) && !!(await sees("swb", /held, to the florist's worker/)), flat(await boxText("swa")));
await click("Close the planner");
await click("Florist's worker: ask about Dune");
check("planner: the workers talk with the planner gone", !!(await sees("a", /about Dune: out until Friday/)), flat(await frameText("a")));
await shot("built-matchmaker");
await click("Make the library's worker forget");
await wait(400);
await click("Florist's worker: ask about Dune");
check("planner: with no page to carry a port, the link cannot be repaired", !!(await sees("swa", /none of my pages has a line to the other site/, 9000)), flat(await boxText("swa")));


// ---- shared workers, joined once
await open("built-sharedpair");
await click("Give tab one of each site a line");
await click("Join the two SharedWorkers");
check("shared: both shared workers hold a port", !!(await sees("swa", /held, to the library's shared worker/)) && !!(await sees("swb", /held, to the florist's shared worker/)), flat(await boxText("swa")));
check("shared: each worker knows both of its tabs", /Tabs: florist tab (one, florist tab two|two, florist tab one)/.test(await boxText("swa")), flat(await boxText("swa")));
await click("Florist tab two: post a note");
check("shared: a note from a tab that did not join reaches both library tabs", !!(await sees("lt1", /florist tab two of the florist says: the van leaves at four/)) && !!(await sees("lt2", /the van leaves at four/)), flat(await frameText("lt2")));
await click("Close tab one of each site");
check("shared: the workers are told the tabs went", !!(await sees("swa", /Tabs: florist tab two\s+Port/)) && !!(await sees("swb", /Tabs: library tab two\s+Port/)), flat(await boxText("swb")));
await click("Library tab two: post a note");
check("shared: the link outlives the tabs that made it", !!(await sees("ft2", /library tab two of the library says: two copies of Dune are back/)), flat(await frameText("ft2")));
await shot("built-sharedpair");

// ---- who holds the other end
await open("built-whoholds");
await click("Give the library the florist's public key");
await click("Pass the library a port from the florist");
await sees("library", /port 1 says/);
await click("Pass the library a port from the stranger");
await sees("library", /port 2 says/);
const lib = await frameText("library");
check("who: both ports look the same to the receiver", /port 1 says "I am the florist"\. event\.origin is "", event\.source is null/.test(lib) && /port 2 says "I am the florist"\. event\.origin is "", event\.source is null/.test(lib), flat(lib));
await click("Library: check both ports");
check("who: the florist's port passes and the stranger's is closed", !!(await sees("library", /port 2: the signature does not match/)) && /port 1: signed my random value with the florist's key/.test(await frameText("library")), flat(await frameText("library")));
await shot("built-whoholds");

// ---- the page in a tab of its own, opening the other site in a real window
const own = await context.newPage();
await own.goto(`${florist}/pair/`);
await own.waitForSelector("#buttons button");
const [popup] = await Promise.all([context.waitForEvent("page"), own.getByRole("button", { name: "Open the library's window" }).click()]);
const ownSees = (p, re, ms = 10000) => until(async () => re.test(await p.locator("body").innerText()), ms);
check("windows: the florist's page gives the library's window a line", !!(await ownSees(own, /holding a line to the library's page/)) && !!(await ownSees(popup, /holding a line to the florist's page/)), flat(await own.locator("#log").innerText()));
await own.getByRole("button", { name: "Join the two workers" }).click();
check("windows: the two first-party workers are joined", !!(await ownSees(own, /held, to the library's worker/)) && !!(await ownSees(popup, /held, to the florist's worker/)), flat(await own.locator("#worker").innerText()));
await own.getByRole("button", { name: "My worker: ask about Dune" }).click();
check("windows: the florist's worker asks the library's", !!(await ownSees(own, /about Dune: out until Friday/)), flat(await own.locator("#log").innerText()));
await own.getByRole("button", { name: "Fetch /pair/from-other/shelf.txt" }).click();
check("windows: and the fetch works there too", !!(await ownSees(own, /Beloved: on the shelf/)), flat(await own.locator("#log").innerText()));
if (shots) await own.screenshot({ path: `${shots}/pair-own-tab.png` });
await popup.close(); await own.close();

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
