// Experiments between real origins: the florist's and the library's own sites.
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const root = LIVE ? process.env.LIVE_MAIN || `https://portauthority.${LIVE}` : `http://hub.localhost:${process.env.PORT || 8787}`;
const shots = process.argv[2];
const browser = await chromium.launch(process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const frameText = (sel, name) => page.locator(`${sel} .box[data-name="${name}"] iframe`).contentFrame().locator("body").innerText();
const boxText = (sel, name) => page.locator(`${sel} .box[data-name="${name}"]`).innerText();
const click = (sel, label) => page.locator(`${sel} .controls button`, { hasText: label }).click();
const wait = (ms) => page.waitForTimeout(ms);
const flat = (t) => t.replace(/\n/g, " | ").slice(0, 230);

await page.goto(root + "/patterns/");
for (const id of ["keycopy", "halves", "roundtrip", "lend"]) { await page.locator("#" + id).scrollIntoViewIfNeeded(); await page.waitForSelector(`#${id} .controls button`, { timeout: 15000 }); }
await wait(800);

await page.locator("#keycopy").scrollIntoViewIfNeeded();
const host = await page.locator('#keycopy .box[data-name="keeper"] iframe').getAttribute("src");
check("keycopy: the keeper is a real second origin", new URL(host).origin !== new URL(root).origin, new URL(host).origin);
await click("#keycopy", "Send the key itself"); await wait(900);
check("keycopy: the other origin holds the key and cannot read it", /can I read it\? no\. saved it/.test(await frameText("#keycopy", "keeper")), flat(await frameText("#keycopy", "keeper")));
await click("#keycopy", "Florist: sign an order"); await wait(900);
check("keycopy: its signature verifies here", /verified: the florist signed "order 1: tulips" as me/.test(await boxText("#keycopy", "page")));
await click("#keycopy", "Destroy this page"); await click("#keycopy", "Reload the florist"); await wait(2000);
check("keycopy: after a reload the other origin still has the key", /I still have the key/.test(await frameText("#keycopy", "keeper")), flat(await frameText("#keycopy", "keeper")));
await click("#keycopy", "Florist: sign an order"); await wait(900);
check("keycopy: and it still signs", /verified: the florist signed "order 2: tulips"/.test(await boxText("#keycopy", "page")));
if (shots) await page.locator("#keycopy .demo").screenshot({ path: shots + "/keycopy.png" });

await page.locator("#halves").scrollIntoViewIfNeeded();
await click("#halves", "Give the library"); await wait(2200);
let t = await frameText("#halves", "listener");
check("halves: the listener hears, and has nothing to write into", /can I write to it\? no/.test(t) && /heard: tick 2/.test(t), flat(t));
await click("#halves", "Give the florist"); await wait(400);
await click("#halves", "Florist: drop a note"); await wait(700);
check("halves: a note written on another origin lands here", /found in the box: note 1 from/.test(await boxText("#halves", "page")) && /can I read from it\? no/.test(await frameText("#halves", "dropper")));
await click("#halves", "Close the feed"); await wait(700);
check("halves: closing the feed is felt on the other origin", /the feed was closed by its owner/.test(await frameText("#halves", "listener")));
await click("#halves", "Shut the drop box"); await click("#halves", "Florist: drop a note"); await wait(800);
check("halves: a shut box refuses the next write", /the box is shut/.test(await frameText("#halves", "dropper")), flat(await frameText("#halves", "dropper")));

await page.locator("#roundtrip").scrollIntoViewIfNeeded();
await click("#roundtrip", "Ask the library"); await wait(900);
await click("#roundtrip", "Send a line"); await click("#roundtrip", "Send a line"); await wait(900);
t = await boxText("#roundtrip", "out");
check("roundtrip: lines come back changed by the other origin", /Write to \[email\] about the order/.test(t) && /Card \[number\], expires soon/.test(t), flat(t));
if (shots) await page.locator("#roundtrip .demo").screenshot({ path: shots + "/roundtrip.png" });

await page.locator("#lend").scrollIntoViewIfNeeded();
await click("#lend", "Widget: try to connect"); await wait(900);
check("lend: the widget cannot reach the network by itself", /was blocked/.test(await frameText("#lend", "widget")), flat(await frameText("#lend", "widget")));
await click("#lend", "Open a connection"); await page.waitForSelector('#lend .controls button:has-text("Lend the widget"):not([disabled])', { timeout: 8000 });
await click("#lend", "Lend the widget"); await wait(400);
await click("#lend", "Widget: say hello"); await wait(1500);
check("lend: the widget talks to the server over the borrowed connection", /the server heard: hello 1 from the widget/.test(await frameText("#lend", "widget")), flat(await frameText("#lend", "widget")));
await click("#lend", "Close the connection"); await wait(900);
check("lend: closing the socket cuts the widget off", /closed by its owner/.test(await frameText("#lend", "widget")));
if (shots) await page.locator("#lend .demo").screenshot({ path: shots + "/lend.png" });

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
