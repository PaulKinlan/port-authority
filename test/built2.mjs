// The second set of ideas under "What you could build with it" (sites/main/patterns/built2.js).
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const root = LIVE ? process.env.LIVE_MAIN || `https://portauthority.${LIVE}` : `http://hub.localhost:${process.env.PORT || 8787}`;
const shots = process.argv[2];
// Sandboxed frames in their own process, as in a desktop Chrome. Plain headless hides crashes there.
const browser = await chromium.launch({ args: ["--enable-features=IsolateSandboxedIframes", "--site-per-process"], ...(process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {}) });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const wait = (ms) => page.waitForTimeout(ms);
const flat = (t) => String(t).replace(/\n/g, " | ").slice(0, 260);
let at = "";
const open = async (pattern, id) => { at = "#" + id; await page.goto(`${root}/patterns/${pattern}/`); await page.locator(at).scrollIntoViewIfNeeded(); await page.waitForSelector(`${at} .controls button`, { timeout: 15000 }); await page.locator(`${at} .stage-el`).scrollIntoViewIfNeeded(); await wait(900); };
const click = (label) => page.locator(`${at} .controls button`, { hasText: label }).first().click();
const frameText = (name) => page.locator(`${at} .box[data-name="${name}"] iframe`).contentFrame().locator("body").innerText();
const boxText = async (name) => (await page.locator(`${at} .box[data-name="${name}"]`).innerText()).replace(/\n/g, " ");
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => false); if (v || Date.now() > end) return v; await wait(250); } };
const shot = async (name) => { if (shots) await page.locator(at).screenshot({ path: `${shots}/${name}.png` }); };

await open("router", "built-queue");
await click("Orders: send to the driver"); await click("Kitchen: send to the driver");
check("queue: the worker holds two messages for a window that is not open", !!(await until(async () => /Holding: 2 for driver/.test(await boxText("router")))), flat(await boxText("router")));
await click("Open the driver's window");
check("queue: the driver opens and gets both, oldest first", !!(await until(async () => { const t = await frameText("driver"); return /from kitchen: bag 2 is packed \(was held\)\s+from orders: order 1 is ready \(was held\)/.test(t); })) && /Holding: nothing/.test(await boxText("router")), flat(await frameText("driver")));
await click("Orders: send to the driver");
check("queue: after that, messages pass straight through", !!(await until(async () => /^[\s\S]*from orders: order 3 is ready\n/.test((await frameText("driver")) + "\n") && !/order 3 is ready \(was held\)/.test(await frameText("driver")))), flat(await frameText("driver")));
await shot("built-queue");

await open("router", "built-everyone");
await click("Settings: tell every editor");
check("role: both editors get it and the preview does not", !!(await until(async () => /use font size 18/.test(await frameText("editor-1")) && /use font size 18/.test(await frameText("editor-2")))) && !/font size/.test(await frameText("preview")) && /reached editor-1, editor-2/.test(await frameText("settings")), flat(await frameText("settings")));
await click("Open a third editor"); await until(async () => /editor-3 \(editor\)/.test(await boxText("router")));
await click("Settings: tell every editor");
check("role: a window that opens later is included", !!(await until(async () => /use font size 20/.test(await frameText("editor-3")))), flat(await boxText("router")));
await click("Close editor 1"); await until(async () => !/editor-1/.test(await boxText("router")), 6000);
await click("Settings: tell every editor");
check("role: a closed window is left out", !!(await until(async () => /reached editor-2, editor-3/.test(await frameText("settings")))), flat(await frameText("settings")));
await shot("built-everyone");

await open("router", "built-toolroute");
await click("Shop: ask for a label");
check("tool: a request for print-label reaches the window that offers it, and is answered", !!(await until(async () => /from label-printer: label printed for order 1/.test(await frameText("shop")))), flat(await frameText("shop")));
await click("Shop: ask for a route");
check("tool: a different tool goes to a different window", !!(await until(async () => /from route-finder: route for order 1/.test(await frameText("shop")))) && !/find-route/.test(await frameText("label-printer")), flat(await frameText("shop")));
await click("Close the label printer"); await until(async () => !/label-printer/.test(await boxText("router")), 6000);
await click("Shop: ask for a label");
check("tool: with no window offering it, the shop is told", !!(await until(async () => /no open window offers print-label/.test(await frameText("shop")))), flat(await frameText("shop")));
await click("Open the back office"); await until(async () => /back-office \(offers print-label\)/.test(await boxText("router")));
await click("Shop: ask for a label");
check("tool: another window that offers the tool gets the same request", !!(await until(async () => /from back-office: label printed for order 3/.test(await frameText("shop")))), flat(await frameText("shop")));
await shot("built-toolroute");

await open("hello", "built-oneknock");
await click("Deliver a port"); await click("Ask for a sum"); await click("Subscribe to prices");
await until(async () => /Received on the port: 6/.test(await boxText("page")), 8000);
await click("Ask for a sum");
check("one message: seven replies on the port, and the widget's window heard one message", !!(await until(async () => /Calls to window.postMessage: 1\. Sent on the port: 3\. Received on the port: 7/.test(await boxText("page")))) && /heard on my window: 1\. Heard on the port: 3/.test(await frameText("widget")), flat(await boxText("page")));
await shot("built-oneknock");

await open("introduce", "built-picker");
await click("Shop: ask for someone"); await until(async () => /2 florists offer it/.test(await frameText("picker")));
await click("Person: pick Petal Post"); await until(async () => /given a port to Petal Post/.test(await boxText("page")));
await click("Close the picker"); await wait(500);
await click("Shop: order twelve tulips");
check("picker: the shop reaches the chosen florist after the picker has closed, and the other hears nothing", !!(await until(async () => /twelve tulips, delivered Friday by Petal Post/.test(await boxText("page")))) && !/order|introduced/.test(await frameText("rose")) && (await page.locator(`${at} .box[data-name="picker"].gone`).count()) === 1, flat(await boxText("page")));
await shot("built-picker");

await open("functions", "built-proxy");
await click("Wrap the port");
for (const label of ["shop.add(2, 3)", "shop.basket.add(", "shop.basket.total()", "shop.reserve()", "shop.constructor("]) { await click(label); await wait(350); }
const proxy = await boxText("page");
check("proxy: calls, a nested method, a thrown error and a refused constructor all cross the port", /shop\.add\(2, 3\) gave 5/.test(proxy) && /basket\.add\("lilies"\) gave 3/.test(proxy) && /basket\.total\(\) gave 13\.5/.test(proxy) && /reserve\(\) threw: out of stock/.test(proxy) && /constructor\("return 1"\) threw: nothing called constructor/.test(proxy), flat(proxy));
await shot("built-proxy");

await open("filter", "built-effect");
const gap = async () => Number((await boxText("main")).match(/last blur: (\d+) ms/)?.[1]);
const pixels = () => page.locator(`${at} .box[data-name="page"] canvas`).evaluate((c) => { const d = c.getContext("2d").getImageData(790, 400, 20, 1).data; return d.join(","); });
const sharp = await pixels();
await click("Blur it on the page"); await until(async () => /blurred on the page/.test(await boxText("main")), 20000);
const onPage = await gap(), blurred = await pixels();
await click("Draw the picture again"); await wait(300);
const redrawn = await pixels();
await click("Blur it in a worker"); await until(async () => /blurred in the worker/.test(await boxText("main")), 20000);
const inWorker = await gap();
check("effect: the same blur stops the page when run there and does not when run in a worker", sharp !== blurred && redrawn === sharp && (await pixels()) !== sharp && onPage > 100 && inWorker < onPage / 2 && /I now hold 0 bytes/.test(await boxText("main")), `page stopped ${onPage} ms on the page, ${inWorker} ms with the worker`);
await shot("built-effect");

// Demos built for one pattern that are also what an idea on another page asks for.
for (const [pattern, id] of [["reload", "built-upgrade"], ["roundtrip", "built-stages"]]) {
  await open(pattern, id);
  check(`${pattern}: ${id} runs on this page too`, (await page.locator(`${at} .stage-el .box`).count()) > 1);
}

// Every idea on every pattern page is either running there or points at where it runs.
const left = [];
for (const id of await page.evaluate(async () => (await import("/patterns/all.js")).all.map((d) => d.id))) {
  await page.goto(`${root}/patterns/${id}/?play=0`); await page.waitForSelector("#deep section");
  const todo = await page.locator("#uses h3.todo", { hasText: "Not built yet" }).count();
  if (todo) left.push(id);
}
check("no pattern page lists an idea as not built", left.length === 0, left.join(", "));

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
