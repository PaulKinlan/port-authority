// The AI router, end to end: a site asks for a model, the person picks one in
// the router window, the site gets a port, and the key never reaches the site.
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const base = (name) => LIVE ? (name === "hub" && process.env.LIVE_MAIN) || `https://${name === "hub" ? "portauthority" : "pa-" + name}.${LIVE}` : `http://${name}.localhost:8787`;
const browser = await chromium.launch(process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
const ctx = await browser.newContext();
const errors = [];
ctx.on("page", (p) => { p.on("pageerror", (e) => errors.push(`${p.url()}: ${e.message}`)); });
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const popupFrom = async (page, click) => { const [popup] = await Promise.all([page.waitForEvent("popup"), click()]); await popup.waitForLoadState(); return popup; };
const KEY = "sk-test-THIS-KEY-MUST-NOT-LEAK-0123456789";

// A stand-in for Anthropic: answers the streaming Messages API and records the key it was sent.
const seen = [];
await ctx.route("https://api.anthropic.com/**", async (route) => {
  const request = route.request();
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } });
  seen.push({ key: request.headers()["x-api-key"], body: JSON.parse(request.postData()), from: request.frame().url() });
  const sse = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
  const body = sse({ type: "message_start", message: { usage: { input_tokens: 21 } } })
    + ["Dear Ada, ", "well done ", "on passing."].map((text) => sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })).join("")
    + sse({ type: "message_delta", usage: { output_tokens: 9 } }) + sse({ type: "message_stop" });
  if (request.headers()["x-api-key"] !== KEY) return route.fulfill({ status: 401, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: JSON.stringify({ error: { message: "invalid x-api-key" } }) });
  route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "text/event-stream" }, body });
});

// The person adds an account at the router's own address.
const home = await ctx.newPage();
await home.goto(base("router") + "/");
await home.click("#add summary");
await home.fill("#label", "Work key");
await home.fill("#key", KEY);
await home.click("#form button");
await home.waitForSelector("#accounts li[data-id]");
check("an account is saved at the router", /Work key/.test(await home.locator("#accounts").innerText()));
await home.click("#accounts [data-test]");
await home.waitForFunction(() => /It answered/.test(document.querySelector("#accounts").textContent));
check("the router's home page can test the key", /Dear Ada/.test(await home.locator("#accounts").innerText()));

// Everything the florist page receives from anywhere is recorded, to look for the key afterwards.
const florist = await ctx.newPage();
await florist.addInitScript(() => {
  window.__heard = [];
  const keep = (data) => { try { window.__heard.push(JSON.stringify(data)); } catch { /* not JSON */ } };
  addEventListener("message", (e) => keep(e.data), true);
  const add = MessagePort.prototype.addEventListener;
  const desc = Object.getOwnPropertyDescriptor(MessagePort.prototype, "onmessage");
  Object.defineProperty(MessagePort.prototype, "onmessage", { set(fn) { desc.set.call(this, fn && ((e) => { keep(e.data); return fn.call(this, e); })); }, get() { return desc.get.call(this); } });
  MessagePort.prototype.addEventListener = function (type, fn, opts) { return add.call(this, type, type === "message" ? (e) => { keep(e.data); return fn.call(this, e); } : fn, opts); };
});
await florist.goto(base("florist") + "/card/");
await florist.waitForSelector("#choose:not([disabled])");
check("a site with no grant has no model", /No model yet/.test(await florist.locator("#state").innerText()) && (await florist.locator("#write").isDisabled()));

// Don't allow: nothing changes.
let popup = await popupFrom(florist, () => florist.click("#choose"));
await popup.waitForSelector("#no");
check("the router window names the site that asked", (await popup.locator(".origin").innerText()) === base("florist"));
check("the router window lists the account and the practice model", /Work key · claude-sonnet-5-5/.test(await popup.locator("#choices").innerText()) && /Practice/.test(await popup.locator("#choices").innerText()));
await popup.click("#no");
await florist.waitForFunction(() => /closed without a grant/.test(document.querySelector("#log").textContent));
check("refusing leaves the site with no model", /No model yet/.test(await florist.locator("#state").innerText()));

// Allow, with a limit of 5 requests.
popup = await popupFrom(florist, () => florist.click("#choose"));
await popup.waitForSelector("#yes");
await popup.selectOption("#requests", "5");
await Promise.all([popup.waitForEvent("close"), popup.click("#yes")]);
await florist.waitForSelector("#write:not([disabled])");
check("after allowing, the site is told the model's name", /Using Work key · claude-sonnet-5-5, 5 requests left/.test(await florist.locator("#state").innerText()), await florist.locator("#state").innerText());

await florist.click("#write");
await florist.waitForFunction(() => /pieces/.test(document.querySelector("#log").textContent));
check("the answer streams into the site", (await florist.locator("#card").innerText()) === "Dear Ada, well done on passing.");
check("the provider was called with the person's key", seen.at(-1).key === KEY && seen.at(-1).body.model === "claude-sonnet-5-5" && seen.at(-1).body.stream === true);
check("the call was made by the router frame, not the site", seen.at(-1).from.startsWith(base("router") + "/frame.html"), seen.at(-1).from);
check("the site saw how many requests are left", /4 requests left/.test(await florist.locator("#state").innerText()));

// The site cannot get at the key: not in any message, not in its storage, not by reaching into the frame.
const leak = await florist.evaluate((key) => {
  const store = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie;
  let reach = "blocked";
  try { reach = String(document.querySelector("iframe").contentWindow.localStorage.length); } catch { /* cross-origin */ }
  return { heard: window.__heard.join("\n").includes(key), heardAny: window.__heard.length, store: store.includes(key), reach };
}, KEY);
check("no message the site received contains the key", !leak.heard && leak.heardAny > 3, `(${leak.heardAny} messages checked)`);
check("the site's own storage does not contain the key", !leak.store);
check("the site cannot read the frame's storage", leak.reach === "blocked");
const frame = florist.frames().find((f) => f.url().includes("/frame.html"));
const kept = await frame.evaluate(() => JSON.stringify({ ...localStorage }));
if (process.env.DEBUG) console.log(kept);
const stored = JSON.parse(kept)["router.grant:" + base("florist")] || "";
check("the frame's stored copy of the key is encrypted", !stored.includes(KEY) && /sealed/.test(stored));

// A reload needs no window.
await florist.reload();
await florist.waitForSelector("#write:not([disabled])");
check("after a reload the site still has its model, with no window", /Using Work key/.test(await florist.locator("#state").innerText()) && /already had a grant/.test(await florist.locator("#log").innerText()));

// Another site has no grant, even though the same frame is used.
const library = await ctx.newPage();
await library.goto(base("library") + "/digest/");
await library.waitForSelector("#choose:not([disabled])");
check("a second site does not inherit the first site's grant", /No model yet/.test(await library.locator("#state").innerText()));
popup = await popupFrom(library, () => library.click("#choose"));
await popup.waitForSelector("#yes");
await popup.check('input[value="practice"]');
await Promise.all([popup.waitForEvent("close"), popup.click("#yes")]);
await library.waitForSelector("#run:not([disabled])");
check("the second site was given the practice model", /Using Practice model · not a real model/.test(await library.locator("#state").innerText()));

// A worker is handed a port and does the work.
await library.click("#run");
await library.waitForFunction(() => /worker finished/.test(document.querySelector("#log").textContent), null, { timeout: 60000 });
const notes = await library.locator("#notes p").allInnerTexts();
check("a worker holding a port wrote a note for all four books", notes.length === 4 && notes.every((n) => /practice model/.test(n) && /would arrive here/.test(n)));

// A port lent for 3 requests stops at 3.
await library.click("#lend");
for (let i = 1; i <= 4; i++) {
  await library.click("#ask");
  await library.waitForFunction((n) => new RegExp(`Request ${n}(:| was refused)`).test(document.querySelector("#lent").textContent) && !/Request \d+: sent\./.test(document.querySelector("#lent").textContent), i, { timeout: 30000 });
}
const lent = await library.locator("#lent").innerText();
check("a port lent for 3 requests answers 3", /Request 3: This is the practice model/.test(lent));
check("and refuses the fourth", /Request 4 was refused: This port was lent/.test(lent), lent.split("\n")[0]);

// The main site is a third site, and on the live deployment it is on a different
// registrable domain from the router, so the browser gives the frame separate storage.
const main = await ctx.newPage();
await main.goto(base("hub") + "/ai-router/");
await main.waitForSelector("#choose:not([disabled])");
popup = await popupFrom(main, () => main.click("#choose"));
await popup.waitForSelector("#yes");
check("the explainer page is named in the router window", (await popup.locator(".origin").innerText()) === base("hub"));
await popup.check('input[value="practice"]');
await Promise.all([popup.waitForEvent("close"), popup.click("#yes")]);
await main.waitForSelector("#send:not([disabled])");
await main.click("#send");
await main.waitForFunction(() => /pieces/.test(document.querySelector("#log").textContent), null, { timeout: 30000 });
check("the explainer page's own demo gets an answer", /practice model/.test(await main.locator("#answer").innerText()));
const mainFrame = main.frames().find((f) => f.url().includes("/frame.html"));
const mainKept = await mainFrame.evaluate(() => Object.keys(localStorage).join(" "));
console.log(`note the frame inside ${base("hub")} ${/router\.accounts/.test(mainKept) ? "shares storage with the router's own pages (same site)" : "has storage of its own (another site)"}`);
await main.close();

// The router's home page shows both sites and what they used.
await home.bringToFront();
await home.evaluate(() => dispatchEvent(new Event("focus")));
await home.waitForFunction(() => document.querySelectorAll("#grants li[data-id]").length >= 3);
const grants = await home.locator("#grants").innerText();
check("the router lists both sites with their usage", /florist/.test(grants) && /1 of 5 requests used/.test(grants) && /21 tokens in, 9 out/.test(grants) && /library/.test(grants) && /7 of 20 requests used/.test(grants), grants.replace(/\n/g, " | "));

// Stop the florist. Its next request is refused, and its stored copy of the key cannot be opened.
await home.locator("#grants li", { hasText: "florist" }).locator("[data-revoke]").click();
await home.waitForFunction(() => /Stopped/.test(document.querySelector("#grants").textContent));
const calls = seen.length;
await florist.bringToFront();
await florist.click("#write");
await florist.waitForFunction(() => /refused or failed/.test(document.querySelector("#log").textContent));
check("after Stop, the site's next request is refused", /revoked/.test(await florist.locator("#meta").innerText()) && seen.length === calls, await florist.locator("#meta").innerText());
check("and the site is back to having no model", /No model yet/.test(await florist.locator("#state").innerText()));

// A page that is not the router cannot use the server's grant list.
const outside = await florist.evaluate(async (router) => {
  try { const r = await fetch(router + "/r/aaaaaaaaaaaaaaaaaaaaaaaa/list", { method: "POST", body: "{}" }); return r.status; } catch { return "blocked"; }
}, base("router"));
check("another origin cannot call the router's grant list", outside === "blocked" || outside === 403, String(outside));

check("no page threw an error", errors.length === 0, errors.join(" ; "));
await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
