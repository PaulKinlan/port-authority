import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const root = LIVE ? `https://portauthority.${LIVE}` : "http://hub.localhost:8787";
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

await page.goto(root + "/patterns/");
for (const id of ["canvas", "functions", "zerocopy", "tearoff", "tabserver"]) { await page.locator("#" + id).scrollIntoViewIfNeeded(); await page.waitForSelector(`#${id} .controls button`); }
await wait(1000);

await page.locator("#canvas").scrollIntoViewIfNeeded();
await click("#canvas", "Hand over the canvas"); await wait(1500);
const shot = await page.locator("#canvas canvas").screenshot();
await page.locator("#canvas .demo").screenshot({ path: process.argv[2] + "/canvas.png" });
const distinct = new Set(shot.toString("base64").match(/.{40}/g)).size;
check("canvas: another origin painted into this page's canvas", /holding a canvas/.test(await frameText("#canvas", "painter")) && distinct > 40, `(${distinct} distinct chunks)`);

await click("#functions", "Lend onTick"); await wait(2500);
check("functions: the lent function ran here", /onTick\(5, "counting"\) ran here/.test(await boxText("#functions", "page")));
await click("#functions", "Take the function back"); await wait(1800);
const fn = await boxText("#functions", "page");
check("functions: calls stop after it is taken back", !/onTick\(0/.test(fn) && /closed it/.test(fn));

await click("#zerocopy", "Copy 64 MB"); await wait(2500);
await click("#zerocopy", "Transfer 64 MB"); await wait(1500);
const z = await boxText("#zerocopy", "page");
check("zerocopy: both round trips complete, sender held 0 bytes", /copy: [\d.]+ ms/.test(z) && /transfer: [\d.]+ ms round trip, sender held 0 bytes/.test(z), z.replace(/\n/g, " | "));

await page.locator("#tearoff").scrollIntoViewIfNeeded(); await wait(1200);
const before = Number(await page.locator("#tearoff .meter").innerText());
const [popup] = await Promise.all([page.waitForEvent("popup"), click("#tearoff", "Tear it off")]);
await popup.waitForFunction(() => /^\d+$/.test(document.getElementById("meter").textContent));
const inPopup = Number(await popup.locator("#meter").innerText());
check("tearoff: the new window continues the same feed", before > 0 && inPopup >= before && inPopup <= before + 4, `(${before} then ${inPopup})`);
await popup.click("#back"); await wait(1500);
const after = Number(await page.locator("#tearoff .meter").innerText());
check("tearoff: the port comes back", after > inPopup, `(${after})`);

await page.locator("#tabserver").scrollIntoViewIfNeeded();
await page.waitForFunction(() => /holding a port/.test(document.querySelector('#tabserver .box[data-name="sw"]').textContent), null, { timeout: 15000 }).catch(() => {});
await page.locator("#tabserver textarea").fill("<h1>Served by tab one</h1>");
await click("#tabserver", "Load the served page"); await wait(1500);
check("tabserver: iframe navigation is answered by this tab", /Served by tab one/.test(await frameText("#tabserver", "served")));
const other = await ctx.newPage();
await other.goto(root + "/patterns/served/some/other/path");
check("tabserver: a different tab gets a real page at a real URL", /Served by tab one/.test(await other.locator("body").innerText()) && /some\/other\/path/.test(await other.locator("body").innerText()));
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
