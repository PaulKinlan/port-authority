// What a port to another device can carry, and the one-way port.
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>.
import { createRequire } from "node:module";
import { Buffer } from "node:buffer";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const root = LIVE ? process.env.LIVE_MAIN || `https://portauthority.${LIVE}` : "http://hub.localhost:8787";
const shots = process.argv[2];
// ISOLATE=1 puts sandboxed and cross-site frames in processes of their own, as desktop Chrome does.
const args = process.env.ISOLATE ? ["--enable-features=IsolateSandboxedIframes", "--site-per-process"] : [];
const browser = await chromium.launch({ args, ...(process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {}) });
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const wait = (ms) => page.waitForTimeout(ms);
const flat = (t) => String(t).replace(/\n+/g, " | ").slice(0, 260);
let at = "";
const open = async (pattern, id) => { at = "#" + id; await page.goto(`${root}/patterns/${pattern}/?play=0`); await page.locator(at).scrollIntoViewIfNeeded(); await page.waitForSelector(`${at} .controls button`, { timeout: 15000 }); await page.locator(`${at} .stage-el`).scrollIntoViewIfNeeded(); await wait(900); };
const click = (label) => page.locator(`${at} .controls button`, { hasText: label }).click();
const enabled = (label) => page.locator(`${at} .controls button`, { hasText: label }).isEnabled();
const frame = (name) => page.locator(`${at} .box[data-name="${name}"] iframe`).contentFrame();
const frameText = (name) => frame(name).locator("body").innerText();
const boxText = (name) => page.locator(`${at} .box[data-name="${name}"]`).innerText();
const until = async (fn, ms = 12000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => false); if (v || Date.now() > end) return v; await wait(200); } };
const shot = async (name) => { if (shots) await page.locator(at).screenshot({ path: `${shots}/${name}.png` }); };

// ---- one-way: two real sites, a valve in this page
await open("oneway", "demo");
const pub = await page.locator('#demo .box[data-name="pub"] iframe').getAttribute("src"), sub = await page.locator('#demo .box[data-name="sub"] iframe').getAttribute("src");
check("oneway: the two ends are on two real origins, neither this one", new Set([new URL(pub).origin, new URL(sub).origin, new URL(root).origin]).size === 3);
await click("Join them one way");
await click("Library: publish a price");
check("oneway: what the publisher posts reaches the subscriber", !!(await until(async () => /heard: tulips at \d/.test(await frameText("sub")))), flat(await frameText("sub")));
await click("Florist: post an order back"); await click("Florist: post an order back"); await click("Florist: post a port back");
await until(async () => /Stopped, coming back: 3/.test(flat(await boxText("page")).replace(/ \| /g, " ")));
await wait(500);
let t = await frameText("pub");
check("oneway: nothing the subscriber posts reaches the publisher", /Stopped, coming back: 3/.test(flat(await boxText("page")).replace(/ \| /g, " ")) && !/heard back/.test(t) && /posted an order into the port \(2\)/.test(await frameText("sub")), flat(t));
await click("Library: send a port forward"); await wait(700);
t = await frameText("sub");
check("oneway: a port sent forward is refused, so no private line is made", /Refused, going forward: 1/.test(flat(await boxText("page")).replace(/ \| /g, " ")) && !/got a port/.test(t) && !/private line works/.test(await frameText("pub")), flat(await boxText("page")));
await shot("oneway");
await click("Cut the link"); await click("Library: publish a price"); await wait(700);
check("oneway: after the cut nothing more arrives", ((await frameText("sub")).match(/heard: tulips/g) || []).length === 1, flat(await frameText("sub")));

await open("oneway", "built-figures");
await click("Give the widget a one-way port"); await click("Send this month's spending");
check("chart: the widget draws the figures it was sent", !!(await until(async () => /drew rent 900/.test(await frameText("widget")))) && (await frame("widget").locator("div > div").count()) === 4, flat(await frameText("widget")));
await click("Widget: try to send the figures out");
await until(async () => /network request: (blocked|sent)/.test(await frameText("widget")));
t = flat(await boxText("page")).replace(/ \| /g, " ");
check("chart: its message back stops at the valve and its network request is blocked", /Stopped, coming back: 1/.test(t) && /Heard from the widget on my port: 0/.test(t) && /network request: blocked/.test(await frameText("widget")), t);
await shot("built-figures");

await open("oneway", "built-covert");
await click("Give the frame a read-only stream");
check("covert: the frame holds a stream it cannot write to", !!(await until(async () => /can I write to it\? no/.test(await frameText("reader")))), flat(await frameText("reader")));
await click("Frame: spell a word by when it reads");
await until(async () => /done\. I only ever read/.test(await frameText("reader")), 15000);
t = flat(await boxText("page")).replace(/ \| /g, " ");
check("covert: the writer reads the frame's word from the timing of its reads", /01001000 01001001/.test(t) && /As text: HI/.test(t), t);
await click("Give the frame a one-way port"); await click("Frame: try the same on the port");
await until(async () => /I took \d+ ticks/.test(await frameText("reader")), 15000);
t = flat(await boxText("page")).replace(/ \| /g, " ");
const late = Number(t.match(/(\d+) of them late/)?.[1] ?? 99);
check("covert: on the one-way port the frame's timing changes nothing for the sender", /Read from the one-way port: nothing/.test(t) && late <= 1, t);
await shot("built-covert");

// ---- a stream from another device. The other device here is a second real page.
await open("far", "built-farfile");
await click("Open a line to your phone");
const link = await page.locator(`${at} .box[data-name="far"] a[data-qr]`).getAttribute("href");
check("farfile: a QR code and a link for the phone are shown", /\/far\/#[a-z0-9]{6}$/.test(link) && (await page.locator(`${at} .box[data-name="far"] a[data-qr] svg path`).count()) === 1, link);
const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
phone.on("pageerror", (e) => errors.push("phone: " + e.message));
await phone.goto(link);
check("farfile: a separate page connects and is asked for a picture", !!(await until(async () => (await phone.locator("#file").isVisible()) && /Connected directly/.test(await phone.locator("#state").innerText()), 15000)), await phone.locator("#state").innerText());
// A real file, picked on the far page: 300 kB of PNG made here.
const png = await page.evaluate(async () => {
  const canvas = new OffscreenCanvas(400, 260), c = canvas.getContext("2d");
  const pixels = c.createImageData(400, 260);
  for (let i = 0; i < pixels.data.length; i++) pixels.data[i] = i % 4 === 3 ? 255 : Math.random() * 255;
  c.putImageData(pixels, 0, 0);
  return [...new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer())];
});
await phone.locator("#pick").setInputFiles({ name: "holiday.png", mimeType: "image/png", buffer: Buffer.from(png) });
const arrived = await until(async () => new RegExp(`all ${png.length} bytes arrived`).test(await frameText("viewer")), 20000);
check("farfile: the picked file crosses as a stream and every byte arrives in a sandboxed frame", !!arrived && png.length > 250000, `${png.length} bytes. ${flat(await frameText("viewer"))}`);
check("farfile: the page in the middle passed the stream on unread", /holiday\.png, \d+ kB, is arriving as a ReadableStream\. Passed it to the viewer unread/.test(flat(await boxText("page"))), flat(await boxText("page")));
check("farfile: the viewer drew the picture", await frame("viewer").locator("canvas").isVisible());
check("farfile: the far page says its file was handed over", /all \d+ kB handed to the port/.test(await phone.locator("#sent").innerText()), await phone.locator("#sent").innerText());
if (shots) await phone.screenshot({ path: shots + "/far-phone-file.png" });
await shot("built-farfile");
await click("Hang up");
check("farfile: hanging up is seen on the far page", !!(await until(async () => /hung up/.test(await phone.locator("#state").innerText()))));
await phone.close();
// The stand-in path, as the step bar plays it.
await click("Start again"); await wait(600);
await click("Open a line to your phone"); await click("Use a stand-in");
await until(() => enabled("Other device: send a sample picture"), 15000);
await click("Other device: send a sample picture");
check("farfile: the stand-in sends a sample picture the same way", !!(await until(async () => /all \d+ bytes arrived/.test(await frameText("viewer")), 20000)), flat(await frameText("viewer")));

// ---- ports sent through the port that crosses devices
await open("far", "built-farports");
await click("Open a line to your phone");
const link2 = await page.locator(`${at} .box[data-name="far"] a[data-qr]`).getAttribute("href");
const phone2 = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
phone2.on("pageerror", (e) => errors.push("phone: " + e.message));
await phone2.goto(link2);
await until(() => enabled("Lend the lamp"), 15000);
await click("Lend the lamp"); await click("Lend the counter");
check("farports: each port posted into the connection arrives as a card on the far page", !!(await until(async () => (await phone2.locator("#cards .card").count()) === 2)), await phone2.locator("#cards").innerText().then(flat));
const card = (name) => phone2.locator("#cards .card", { hasText: name });
await card("The lamp").locator("button").click();
await card("The counter").locator("button").click(); await card("The counter").locator("button").click();
await until(async () => /the count is 2/.test(await card("The counter").innerText()));
check("farports: the far page drives two sandboxed frames here, each through its own port", /Now on/.test(await frameText("lamp")) && /the lamp is on/.test(await card("The lamp").innerText()) && (await frame("counter").locator("p").first().innerText()) === "2", flat(await frameText("lamp")) + " // " + flat(await card("The counter").innerText()));
if (shots) await phone2.screenshot({ path: shots + "/far-phone-ports.png" });
await shot("built-farports");
await click("Take the lamp back");
await until(async () => /took this port back/.test(await card("The lamp").innerText()));
await card("The lamp").locator("button").click(); await card("The counter").locator("button").click();
await until(async () => /the count is 3/.test(await card("The counter").innerText()));
await wait(500);
check("farports: one port is taken back, and the other and the connection carry on", !/Now off/.test(await frameText("lamp")) && /nothing came back/.test(await card("The lamp").innerText()) && /the count is 3/.test(await card("The counter").innerText()) && /Connected directly/.test(await phone2.locator("#state").innerText()), flat(await frameText("lamp")));
await phone2.close();

// ---- the main demo shows a QR code too
await open("far", "demo");
await click("Open a line");
check("far: the main demo shows a QR code for its link", (await page.locator('#demo .box[data-name="far"] a[data-qr] svg').count()) === 1);

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
