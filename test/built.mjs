// The ideas under "What you could build with it", built and running on each pattern's page.
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const root = LIVE ? process.env.LIVE_MAIN || `https://portauthority.${LIVE}` : "http://hub.localhost:8787";
const shots = process.argv[2];
const browser = await chromium.launch(process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const wait = (ms) => page.waitForTimeout(ms);
const flat = (t) => t.replace(/\n/g, " | ").slice(0, 240);
let at = "";
const open = async (pattern, id) => { at = "#" + id; await page.goto(`${root}/patterns/${pattern}/`); await page.locator(at).scrollIntoViewIfNeeded(); await page.waitForSelector(`${at} .controls button`, { timeout: 15000 }); await page.locator(`${at} .stage-el`).scrollIntoViewIfNeeded(); await wait(700); };
const click = (label) => page.locator(`${at} .controls button`, { hasText: label }).click();
const frameText = (name) => page.locator(`${at} .box[data-name="${name}"] iframe`).contentFrame().locator("body").innerText();
const boxText = (name) => page.locator(`${at} .box[data-name="${name}"]`).innerText();
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => false); if (v || Date.now() > end) return v; await wait(250); } };
const shot = async (name) => { if (shots) await page.locator(at).screenshot({ path: `${shots}/${name}.png` }); };

await open("canvas", "built-chart");
const order = await page.evaluate(() => { const y = (s) => document.querySelector(s).getBoundingClientRect().top; return y("#demo") < y("#what") && y("#what") < y("#code") && y("#code") < y("#how") && y("#how") < y("#uses"); });
check("page order: the demo, then what it is, the code, how it works, what to build", order);
const pixels = () => page.locator(`${at} .box[data-name="page"] canvas`).screenshot().then((b) => b.toString("base64"));
const blank = await pixels();
await click("Give the chart maker"); await wait(1500);
const first = await pixels();
await click("Send new numbers"); await wait(1500);
check("chart: another origin draws bars into this page's canvas, and redraws on new numbers", blank !== first && first !== (await pixels()) && /drew \d+, \d+/.test(await frameText("maker")), flat(await frameText("maker")));
await shot("built-chart");

await open("attenuate", "built-expiry");
await click("Lend the diary"); await click("Guest: ask"); await wait(900);
check("expiry: inside the time, the guest is answered", /today: dentist/.test(await frameText("guest")), flat(await frameText("guest")));
await until(async () => /Closed my end/.test(await boxText("page")), 12000);
await click("Guest: ask"); await wait(1200);
check("expiry: after it, the same port goes nowhere", /heard nothing/.test(await frameText("guest")), flat(await frameText("guest")));

await open("reply", "built-progress");
await click("Start a long job");
check("progress: progress arrives on the reply port and the job finishes", !!(await until(async () => /job 1 is ready/.test(await boxText("page")))), flat(await boxText("page")));
await click("Start a long job"); await wait(1000); await click("Cancel it"); await wait(1500);
const svc = await frameText("service");
check("progress: cancelling on the reply port stops the service's work", /job 2: cancelled at \d+%/.test(svc) && !/job 2: finished/.test(svc), flat(svc));

await open("halves", "built-sealed");
await click("Give each bidder"); await wait(500); await click("Bidder one: bid"); await click("Bidder two: bid"); await wait(900);
check("sealed: both bids arrive, and neither bidder can read", /bidder one bid \d+/.test(await boxText("page")) && /bidder two bid \d+/.test(await boxText("page")) && /can I read from it\? no/.test(await frameText("one")) && !/bidder/i.test((await frameText("two")).replace("Bidder two", "")), flat(await boxText("page")));
await click("Close the box"); await wait(300); await click("Bidder one: bid"); await wait(900);
check("sealed: after closing, a winner is named and late bids are refused", /wins with \d+/.test(await boxText("page")) && /refused: bidding has closed/.test(await frameText("one")), flat(await frameText("one")));

await open("functions", "built-listener");
await click("Let analytics listen"); await click("Press the page's button"); await click("Press the page's button"); await wait(700);
check("listener: clicks here are heard on another origin", /heard click 2: "Buy tulips"/.test(await frameText("analytics")), flat(await frameText("analytics")));
await click("Unsubscribe analytics"); await click("Press the page's button"); await wait(700);
check("listener: closing the port unsubscribes it", !/heard click 3/.test(await frameText("analytics")) && /pressed 3 times/.test((await boxText("page")).replace(/\n/g, " ")), flat(await boxText("page")));

await open("stream", "built-typing");
await click("Stream an answer"); await wait(1500);
const early = await frameText("viewer");
await wait(1500);
const later = await frameText("viewer");
check("typing: words appear on the other origin while the answer is still being written", /A port is one end/.test(early) && later.length > early.length + 20, flat(early));
await click("Stop writing"); await wait(700);
check("typing: stopping ends the stream and the viewer knows", /the answer ended after \d+ words/.test(await frameText("viewer")));

await open("signer", "built-cap");
await click("Let the shop charge"); for (let i = 0; i < 3; i++) { await click("Shop: charge 20"); await wait(700); }
const wallet = await frameText("wallet");
check("cap: two charges reach the wallet and the third is stopped before it", /balance 160/.test(wallet) && !/balance 140/.test(wallet) && /refused: over the limit of 50/.test(await frameText("shop")) && /refused 20: it would make 60/.test(await boxText("page")), flat(wallet));
await shot("built-cap");

await open("far", "built-approve");
await click("Open a line"); await click("Use a stand-in");
await until(async () => !(await page.locator(`${at} .controls button`, { hasText: "Pay 20" }).isDisabled()), 15000);
await click("Pay 20"); await wait(900);
check("approve: the question appears on the other device", /Pay 20 to the florist\?/.test(await frameText("far")), flat(await frameText("far")));
await click("Other device: approve");
check("approve: yes on the other device lets the checkout pay", !!(await until(async () => /approved on the other device\. Paid 20/.test(await boxText("page")))), flat(await boxText("page")));
await click("Pay 20"); await wait(700); await click("Other device: deny");
check("approve: no stops it", !!(await until(async () => /denied on the other device/.test(await boxText("page")))));
await shot("built-approve");

await open("lend", "built-tap");
await click("Open a connection");
await until(async () => !(await page.locator(`${at} .controls button`, { hasText: "Give the logger" }).isDisabled()));
await click("Give the logger"); await click("This page: say something"); await wait(1500); await click("Logger: try to speak"); await wait(500);
const lg = await frameText("logger");
check("tap: the logger hears the server and cannot speak", /logged: the server heard: hello 1/.test(lg) && /nothing to speak into/.test(lg) && /listening half only/.test(lg), flat(lg));

// The guide carries the same demos, running inside each section.
await page.goto(root + "/guide/");
const cards = await page.locator(".live").count();
at = "#live-built-cap";
await page.locator(at).scrollIntoViewIfNeeded(); await page.waitForSelector(`${at} .fwd`, { timeout: 15000 }); await page.locator(`${at} .stage-el`).scrollIntoViewIfNeeded(); await wait(800);
for (let i = 0; i < 4; i++) { await page.locator(`${at} .fwd`).click(); await wait(1300); }
check("guide: every section has running demos, and they step with Next", cards >= 24 && /4 of 4/.test(await page.locator(`${at} .caption`).innerText()) && /refused: over the limit/.test(await frameText("shop")), `${cards} demos`);
const sections = await page.evaluate(() => [...document.querySelectorAll("main section")].filter((s) => !s.querySelector(".live")).map((s) => s.id));
check("guide: only the list of open questions has no demo", sections.join() === "open", sections.join());

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
