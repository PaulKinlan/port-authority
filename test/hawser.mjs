// Browser run for the /comlink/ page: Hawser (and Comlink beside it) between
// the main origin and real frames on two other origins.
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>.
//   NODE_PATH=$(npm root -g) node test/hawser.mjs <screenshot-dir>
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const root = LIVE ? `https://portauthority.${LIVE}` : "http://hub.localhost:8787";
// CHROMIUM_ARGS=--enable-blink-features=MessagePortCloseEvent turns on the port close event.
const args = (process.env.CHROMIUM_ARGS || "").split(" ").filter(Boolean);
const browser = await chromium.launch({ args, ...(process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {}) });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const here = (id) => page.locator(`#${id} .box[data-name="page"]`).innerText();
const frameText = (id, name) => page.locator(`#${id} .box[data-name="${name}"] iframe`).contentFrame().locator("body").innerText();
const click = (id, label) => page.locator(`#${id} .controls button`, { hasText: label }).click();
const wait = (ms) => page.waitForTimeout(ms);
const until = async (read, pattern, ms = 6000) => { const end = Date.now() + ms; let text = ""; while (Date.now() < end) { text = await read(); if (pattern.test(text)) return text; await wait(100); } return text; };
const ready = async (id) => { await page.locator("#" + id).scrollIntoViewIfNeeded(); await page.waitForSelector(`#${id}[data-ready]`); };

await page.goto(root + "/comlink/");

await ready("gone");
await click("gone", "Ask both a slow question"); await wait(600);
check("gone: the frame is a different origin and got both questions", (await frameText("gone", "peer")).split("asked a slow question").length === 3);
await click("gone", "Remove the frame");
let text = await until(() => here("gone"), /Hawser: rejected with LinkClosedError/);
check("gone: Hawser rejects when the frame is removed", /Hawser: rejected with LinkClosedError/.test(text), (text.match(/Hawser: rejected[^\n]*/) || [""])[0]);
await wait(1200);
check("gone: Comlink is still waiting", /Comlink: still waiting/.test(await here("gone")));

await ready("cancel");
await click("cancel", "Start a long job"); await wait(1300);
await click("cancel", "Cancel it");
text = await until(() => here("cancel"), /rejected here with AbortError/);
check("cancel: the call rejects here", /rejected here with AbortError: the user pressed cancel/.test(text));
check("cancel: the far side saw the abort and stopped", /told to stop at step \d/.test(await until(() => frameText("cancel", "peer"), /told to stop/)));

await ready("chain");
await click("chain", "Hawser: one expression");
text = await until(() => here("chain"), /Hawser: "Latest note in ideas"/);
check("chain: three calls, one message", /with 1 message sent/.test(text), (text.match(/Hawser:[^\n]*/) || [""])[0]);
await click("chain", "Comlink: three awaits");
check("chain: Comlink gets there in three", /Comlink: "Latest note in ideas"/.test(await until(() => here("chain"), /Comlink: "/)));

await ready("ticks");
await click("ticks", "Start reading ticks");
await until(() => here("ticks"), /read tick 3/);
await click("ticks", "Stop reading");
check("ticks: the loop ends", /left the loop/.test(await until(() => here("ticks"), /left the loop/)));
text = await until(() => frameText("ticks", "peer"), /generator closed after \d+ ticks/);
check("ticks: the generator's finally ran on the other origin", /generator closed/.test(text));
const made = +text.match(/generator closed after (\d+)/)?.[1], read = Math.max(...[...(await here("ticks")).matchAll(/read tick (\d+)/g)].map((m) => +m[1]));
check("ticks: nothing was made that was not read", made === read, `made ${made}, read ${read}`);

await ready("narrow");
await click("narrow", "Add one as this page"); await wait(300);
await click("narrow", "Give the guest a read-only port");
await until(() => here("narrow"), /minted a port/);
await click("narrow", "Guest reads");
check("narrow: guest on a third origin reads the owner's counter", /guest says: read 42/.test(await until(() => here("narrow"), /guest says: read/)));
await click("narrow", "Guest tries to add");
check("narrow: guest cannot add", /guest says: NotAllowedError/.test(await until(() => here("narrow"), /NotAllowedError/)));
await click("narrow", "Revoke"); await wait(300);
await click("narrow", "Guest reads");
check("narrow: revoked port is dead", /guest says: LinkClosedError/.test(await until(() => here("narrow"), /LinkClosedError/)));
await click("narrow", "Add one as this page");
check("narrow: this page's own link is untouched", /this page added, now 43/.test(await until(() => here("narrow"), /now 43/)));

await ready("using");
await click("using", "Open a session"); await until(() => here("using"), /holding a session/);
await click("using", "Leave one scope");
check("using: dispose reaches the object on the other origin", /session for \w+ closed/.test(await until(() => frameText("using", "peer"), /session for \w+ closed/)));
await click("using", "Open a session"); await wait(400);
await click("using", "Open a session"); await wait(400);
await click("using", "Close the whole link");
text = await until(() => frameText("using", "peer"), /link closed/);
check("using: closing the link disposes of everything it held", /link closed/.test(text) && text.split(/session for \w+ closed/).length === 4, text.replace(/\n/g, " | "));

// The claim on the page about Comlink and `constructor`, checked against the real thing.
const escape = await page.evaluate(async () => {
  const Comlink = await import("/vendor/comlink.mjs");
  const { expose, wrap } = await import("/hawser.js");
  const a = new MessageChannel(), b = new MessageChannel();
  Comlink.expose({ fn() {} }, a.port1);
  expose({ fn() {} }, b.port1);
  const made = await new (Comlink.wrap(a.port2).fn.constructor)("globalThis.__ran = 'comlink'");
  await made();
  const comlink = globalThis.__ran;
  const hawser = await (async () => { const f = await new (wrap(b.port2).fn.constructor)("globalThis.__ran = 'hawser'"); await f(); return "ran"; })().catch((e) => e.name);
  return { comlink, hawser, after: globalThis.__ran };
});
check("escape: Comlink lets a caller build and run code through `constructor`", escape.comlink === "comlink");
check("escape: Hawser refuses the same path", escape.hawser === "TypeError" && escape.after === "comlink", JSON.stringify(escape));

if (process.argv[2]) await page.screenshot({ path: process.argv[2] + "/comlink.png", fullPage: true });
check("no page errors", errors.length === 0, errors.join(" | "));
console.log(await browser.version());
await browser.close();
process.exit(failed ? 1 : 0);
