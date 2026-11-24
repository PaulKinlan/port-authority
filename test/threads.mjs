// Checks for the "across threads" experiments and the isolated room.
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const root = LIVE ? process.env.LIVE_MAIN || `https://portauthority.${LIVE}` : "http://hub.localhost:8787";
const shots = process.argv[2];
const browser = await chromium.launch(process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const frameText = (sel, name) => page.locator(`${sel} .box[data-name="${name}"] iframe`).contentFrame().locator("body").innerText();
const boxText = (sel, name) => page.locator(`${sel} .box[data-name="${name}"]`).innerText();
const click = (sel, label) => page.locator(`${sel} .controls button`, { hasText: label }).click();
const wait = (ms) => page.waitForTimeout(ms);
const shot = async (sel, name) => shots && page.locator(sel).screenshot({ path: `${shots}/${name}.png` });

await page.goto(root + "/patterns/");
for (const id of ["frozen", "filter", "signer"]) { await page.locator("#" + id).scrollIntoViewIfNeeded(); await page.waitForSelector(`#${id} .controls button`); }
await wait(800);

await page.locator("#frozen").scrollIntoViewIfNeeded();
await click("#frozen", "Introduce the two workers"); await wait(800);
await click("#frozen", "Freeze this page"); await wait(4500);
const frozen = await boxText("#frozen", "page");
const m = frozen.match(/I ticked (\d+) times, the workers exchanged (\d+) messages/);
check("frozen: workers kept talking while the page was stuck", !!m && Number(m[1]) <= 2 && Number(m[2]) >= 15, m ? `(page ${m[1]}, workers ${m[2]})` : frozen.replace(/\n/g, " | "));
await shot("#frozen .demo", "frozen");

await page.locator("#filter").scrollIntoViewIfNeeded();
await click("#filter", "Connect the filter"); await wait(200);
await click("#filter", "Start the video"); await wait(2500);
let note = await boxText("#filter", "out");
const first = Number(note.match(/(\d+) frames back/)?.[1] || 0);
check("filter: frames come back from another origin", first > 10 && /empty-handed/.test(note), note.replace(/\n/g, " "));
const a = (await page.locator('#filter .box[data-name="out"] canvas').screenshot()).toString("base64");
await click("#filter", "Ask for another effect"); await wait(800);
const b = (await page.locator('#filter .box[data-name="out"] canvas').screenshot()).toString("base64");
check("filter: the picture changes with the effect", a !== b && /mosaic/.test(await frameText("#filter", "filter")));
await shot("#filter .demo", "filter");
await click("#filter", "Remove the filter"); await wait(600);
const stopped = Number((await boxText("#filter", "out")).match(/(\d+) frames back/)?.[1]); await wait(600);
check("filter: video stops when the filter is removed", stopped === Number((await boxText("#filter", "out")).match(/(\d+) frames back/)?.[1]));

await page.locator("#signer").scrollIntoViewIfNeeded();
await click("#signer", "Ask the vault"); await wait(1200);
check("signer: the vault cannot read its own key", /can I read it myself\? no/.test(await frameText("#signer", "vault")));
await click("#signer", "Lend the shop"); await wait(300);
await click("#signer", "Shop: sign an order"); await wait(900);
check("signer: the page verifies a signature made through the lent port", /verified: "order: 1 dozen tulips"/.test(await boxText("#signer", "page")), (await boxText("#signer", "page")).replace(/\n/g, " | ").slice(0, 160));
await click("#signer", "Shop: try to sign a payment"); await wait(600);
check("signer: a payment is refused by the weaker port", /refused: this port only signs orders/.test(await frameText("#signer", "shop")));
await click("#signer", "Shop: sign an order"); await wait(500);
await click("#signer", "Shop: sign an order"); await wait(500);
await click("#signer", "Shop: sign an order"); await wait(700);
check("signer: the fourth order is refused, used up", /refused: this port is used up/.test(await frameText("#signer", "shop")) && /signed #3/.test(await frameText("#signer", "vault")) && !/signed #4/.test(await frameText("#signer", "vault")));
await shot("#signer .demo", "signer");

await page.locator("#census").scrollIntoViewIfNeeded();
await page.waitForSelector('table.census[data-done="true"]', { timeout: 40000 });
const census = await page.locator("table.census tbody").innerText();
check("census: lists the new kinds", /CropTarget/.test(census) && /RTCCertificate/.test(census) && /needs cross-origin isolation/.test(census));

await page.goto(root + "/isolated/");
await page.waitForSelector("#sync .controls button");
check("isolated: the page is cross-origin isolated", await page.evaluate(() => self.crossOriginIsolated));
await click("#sync", "Give the port to a slow service");
await page.waitForFunction(() => /done:/.test(document.querySelector('#sync .box[data-name="worker"]').textContent), null, { timeout: 15000 }).catch(() => {});
let w = await boxText("#sync", "worker");
check("isolated: blocking code got answers from an async service", /done: 24 tulips for Grace, 42\.00 in all/.test(w), w.replace(/\n/g, " | ").slice(0, 200));
await click("#sync", "Run it, and answer it yourself");
for (const answer of ["Ada", "3", "2"]) { await page.waitForSelector("#answer:visible"); await wait(400); await page.fill("#answer", answer); await page.click("#sync form button"); }
await page.waitForFunction(() => /done: 3 tulips for Ada/.test(document.querySelector('#sync .box[data-name="worker"]').textContent), null, { timeout: 8000 }).catch(() => {});
w = await boxText("#sync", "worker");
check("isolated: blocking code waited for a person", /done: 3 tulips for Ada, 6\.00 in all/.test(w) && /stopped on one line/.test(w), w.replace(/\n/g, " | ").slice(0, 200));
await shot("#sync .demo", "sync");

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
