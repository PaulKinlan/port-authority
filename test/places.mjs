// Experiments where the other end of the port is somewhere else: another
// device, a mounted path, a shared worker's socket, the audio thread.
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const root = LIVE ? process.env.LIVE_MAIN || `https://portauthority.${LIVE}` : "http://hub.localhost:8787";
const shots = process.argv[2];
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"], ...(process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {}) });
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const frame = (sel, name) => page.locator(`${sel} .box[data-name="${name}"] iframe`).contentFrame();
const frameText = (sel, name) => frame(sel, name).locator("body").innerText();
const boxText = (sel, name) => page.locator(`${sel} .box[data-name="${name}"]`).innerText();
const click = (sel, label) => page.locator(`${sel} .controls button`, { hasText: label }).click();
const wait = (ms) => page.waitForTimeout(ms);
const flat = (t) => t.replace(/\n/g, " | ").slice(0, 260);
const until = async (fn, ms = 12000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => false); if (v || Date.now() > end) return v; await wait(250); } };

await page.goto(root + "/patterns/");
for (const id of ["far", "mounted", "socket", "audio"]) { await page.locator("#" + id).scrollIntoViewIfNeeded(); await page.waitForSelector(`#${id} .controls button`, { timeout: 15000 }); }
await wait(800);

// ---- a port to another device. The far side here is a second real page.
await page.locator("#far").scrollIntoViewIfNeeded();
await click("#far", "Open a line");
const code = (await page.locator("#far [data-code] strong").innerText()).trim();
check("far: a pairing code is shown", /^[a-z0-9]{6}$/.test(code), code);
const phone = await context.newPage();
await phone.goto(`${root}/far/#${code}`);
const direct = await until(async () => /Connected directly/.test(await phone.locator("#state").innerText()), 15000);
check("far: a separate page connects directly", !!direct, await phone.locator("#state").innerText());
check("far: this page gave the far port to the counter", /gave the far port to the counter/.test(await boxText("#far", "page")), flat(await boxText("#far", "page")));
await phone.locator("#add").click(); await phone.locator("#add").click(); await phone.locator("#colour").click();
await until(async () => (await phone.locator("#count").innerText()) === "2");
check("far: the far page's presses reach a sandboxed frame here", /asked to add one/.test(await frameText("#far", "tool")) && /asked for another colour/.test(await frameText("#far", "tool")), flat(await frameText("#far", "tool")));
check("far: and the answer comes back down the port", (await phone.locator("#count").innerText()) === "2");
await click("#far", "Hang up");
check("far: hanging up is seen on the far side", !!(await until(async () => /hung up/.test(await phone.locator("#state").innerText()))), await phone.locator("#state").innerText());
await phone.close();
// The stand-in path, as the tour plays it.
await click("#far", "Start again"); await wait(600);
await click("#far", "Open a line"); await click("#far", "Use a stand-in");
await until(async () => !(await page.locator("#far .controls button", { hasText: "Other device: add one" }).isDisabled()), 15000);
await click("#far", "Other device: add one"); await wait(900);
check("far: the stand-in works the same way", /asked to add one/.test(await frameText("#far", "tool")) && /1/.test(await frame("#far", "far").locator("#count").innerText()), flat(await frameText("#far", "tool")));
if (shots) await page.locator("#far .demo").screenshot({ path: shots + "/far.png" });
const bad = await page.evaluate(async () => (await fetch("/meet/nope")).status);
check("far: the meeting place refuses bad codes", bad === 400, String(bad));

// ---- another origin mounted at a path
await page.locator("#mounted").scrollIntoViewIfNeeded();
const shelf = await page.locator('#mounted .box[data-name="shelf"] iframe').getAttribute("src");
check("mounted: the server is a page on a real second origin", new URL(shelf).origin !== new URL(root).origin, new URL(shelf).origin);
await click("#mounted", "Mount the florist");
await until(async () => !(await page.locator("#mounted .controls button", { hasText: "Open the catalogue" }).isDisabled()));
await click("#mounted", "Open the catalogue");
const stock = await until(async () => /peonies: 3/.test(await frameText("#mounted", "view")), 10000);
let t = await frameText("#mounted", "view");
check("mounted: a page on this origin is written by the other one", /Written by/.test(t) && t.includes(new URL(shelf).host) && t.includes(new URL(root).host + "/patterns/mounted/florist/catalogue.html"), flat(t));
check("mounted: a relative fetch is answered by the mount too", !!stock, flat(t));
const times = [...t.matchAll(/\((\d+\.\d) s\)/g)].map((m) => Number(m[1]));
check("mounted: the body is a stream, read while it is written", times.length === 3 && times[2] - times[0] > 0.5, JSON.stringify(times));
check("mounted: its image loads from the mount", await frame("#mounted", "view").locator("img").evaluate((img) => img.naturalWidth > 0));
check("mounted: the florist saw each request", /200 stock.txt/.test(await frameText("#mounted", "shelf")) && /200 tulip.svg/.test(await frameText("#mounted", "shelf")), flat(await frameText("#mounted", "shelf")));
const tab = await context.newPage();
const res = await tab.goto(root + "/patterns/mounted/florist/nothing.html");
check("mounted: a real tab gets the florist's own 404", res.status() === 404 && /The florist has no nothing.html/.test(await tab.locator("body").innerText()), String(res.status()));
if (shots) await page.locator("#mounted .demo").screenshot({ path: shots + "/mounted.png" });
await click("#mounted", "Unmount"); await wait(1200);
const after = await tab.goto(root + "/patterns/mounted/florist/catalogue.html");
check("mounted: unmounted, the same address has nothing behind it", after.status() === 503, String(after.status()));
await tab.close();

// ---- one socket for every tab
await page.locator("#socket").scrollIntoViewIfNeeded();
await until(async () => /tab \d+, tab \d+/.test(await boxText("#socket", "worker")));
const opened = () => page.locator("#socket [data-opened]").innerText().then(Number);
const first = await opened();
check("socket: two tabs, one socket", /Open now: 1/.test(flat(await boxText("#socket", "worker")).replace(/ \| /g, " ")) || (await page.locator("#socket [data-open]").innerText()) === "1", flat(await boxText("#socket", "worker")));
await click("#socket", "Tab one: say hello"); await click("#socket", "Tab two: say hello"); await wait(1500);
const t1 = await frameText("#socket", "tab1"), t2 = await frameText("#socket", "tab2");
const me1 = t1.match(/I am (tab \d+)/)?.[1], me2 = t2.match(/I am (tab \d+)/)?.[1];
check("socket: each answer returns to the tab that asked", !!me1 && !!me2 && me1 !== me2 && t1.includes(`the server heard: ${me1} says hello 1`) && !t1.includes(me2 + " says") && t2.includes(`the server heard: ${me2} says hello 1`), flat(t1) + " // " + flat(t2));
const third = await context.newPage();
await third.goto(root + "/patterns/tab.html");
await third.locator("#say").click();
await until(async () => /the server heard/.test(await third.locator("#log").innerText()));
check("socket: a real third tab joins the same socket", (await opened()) === first && /shared by 3/.test(await third.locator("#state").innerText()), await third.locator("#state").innerText());
await third.close();
await click("#socket", "Close tab one");
await until(async () => !(await page.locator("#socket [data-tabs]").innerText()).includes(me1), 8000);
await click("#socket", "Tab two: say hello"); await wait(1200);
check("socket: a tab closes, the socket stays for the rest", (await opened()) === first && /says hello 2/.test(await frameText("#socket", "tab2")) && !(await page.locator("#socket [data-tabs]").innerText()).includes(me1), flat(await boxText("#socket", "worker")));
if (shots) await page.locator("#socket .demo").screenshot({ path: shots + "/socket.png" });

// ---- the audio thread
await page.locator("#audio").scrollIntoViewIfNeeded();
await click("#audio", "Start the music"); await wait(1500);
check("audio: the worker was introduced to the audio thread", /kept no port/.test(await boxText("#audio", "page")), flat(await boxText("#audio", "page")));
await click("#audio", "Freeze this page"); await wait(4500);
t = await boxText("#audio", "page");
const m = t.match(/I ticked (\d+) times, the audio thread played (\d+) notes/);
check("audio: notes are played while the page is frozen", !!m && Number(m[1]) <= 2 && Number(m[2]) >= 8, flat(t));
if (shots) await page.locator("#audio .demo").screenshot({ path: shots + "/audio.png" });
await click("#audio", "Stop the music");

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
