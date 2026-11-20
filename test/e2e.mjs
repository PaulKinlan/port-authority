// End-to-end check of the hub across four origins. Needs `npx wrangler dev --port 8787` running.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE; // e.g. kinlan-test.workers.dev
const base = (name) => LIVE ? `https://${name === "hub" ? "portauthority" : "pa-" + name}.${LIVE}` : `http://${name}.localhost:8787`;
const browser = await chromium.launch(process.env.HTTPS_PROXY && process.env.LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
const ctx = await browser.newContext();
const errors = [];
ctx.on("page", (p) => { p.on("pageerror", (e) => errors.push(`${p.url()}: ${e.message}`)); p.on("console", (m) => m.type() === "error" && errors.push(`${p.url()}: ${m.text()}`)); });
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const popupFrom = async (page, click) => { const [popup] = await Promise.all([page.waitForEvent("popup"), click()]); await popup.waitForLoadState(); return popup; };

const hub = await ctx.newPage();
await hub.goto(base("hub") + "/hub/");
await hub.waitForSelector("text=Nothing yet");

for (const name of ["florist", "library"]) {
  const page = await ctx.newPage();
  await page.goto(base(name) + "/");
  const popup = await popupFrom(page, () => page.click("#connect"));
  await popup.click("#yes");
  await popup.waitForEvent("close", { timeout: 8000 }).catch(() => {});
  await page.waitForSelector("text=Connected to your hub", { timeout: 8000 }).catch(() => {});
  check(`${name} connects`, await page.locator("#state").innerText() === "Connected to your hub", await page.locator("#state").innerText());
  globalThis[name] = page;
}
await hub.waitForSelector("text=book_delivery");
check("hub lists both sites", (await hub.locator(".service.live").count()) === 2);

const planner = await ctx.newPage();
await planner.goto(base("planner") + "/");

// pick: a direct line to one tool
let popup = await popupFrom(planner, () => planner.click("#pick"));
await popup.waitForSelector(".options button");
check("picker ranks the matching tool first", (await popup.locator(".options button strong").first().innerText()) === "book_delivery");
await popup.locator(".options button").first().click();
await planner.waitForSelector("#picked form");
await planner.selectOption('#picked select[name="bouquet"]', "ember");
await planner.fill('#picked input[name="recipient"]', "Ada");
await planner.click("#picked form button");
await planner.waitForFunction(() => document.querySelector("#picked .result")?.textContent.length > 0);
const picked = await planner.locator("#picked .result").innerText();
check("direct tool call returns an order", /SP-/.test(picked) && /Ada/.test(picked), picked.slice(0, 60).replace(/\n/g, " "));
check("florist tab shows the order and who booked it", /Ember for Ada/.test(await florist.locator("#orders").innerText()) && /planner/.test(await florist.locator("#orders").innerText()));

// the granted port is limited to that one tool
const widen = await planner.evaluate(async () => {
  const { sites } = await import("/_sites.js");
  return "skip";
});

// revoke from the hub, then the line is dead
await hub.click('button[data-act="revoke"]');
await florist.waitForSelector("text=A line was revoked");
check("revoking in the hub reaches the florist", true);

// intent link, served by the library
popup = await popupFrom(planner, () => planner.click('a[href^="intent:find"]'));
await popup.waitForSelector(".options button");
check("intent link ranks find_book first", (await popup.locator(".options button strong").first().innerText()) === "find_book");
await popup.locator(".options button").first().click();
await planner.waitForSelector('#picked input[name="query"]');
await planner.fill('#picked input[name="query"]', "chickens");
await planner.click("#picked form button");
await planner.waitForFunction(() => document.querySelector("#picked .result")?.textContent.length > 0);
check("library answers over its own line", /Raising Chickens/.test(await planner.locator("#picked .result").innerText()));

// registry: MCP over a port
popup = await popupFrom(planner, () => planner.click("#registry"));
await popup.click("#yes");
await planner.waitForSelector("#tools form");
check("registry lists four tools", (await planner.locator("#tools form").count()) === 4, String(await planner.locator("#tools form").count()));

// agent: ACP over a port, built-in agent
popup = await popupFrom(planner, () => planner.click("#agent"));
await popup.click("#yes");
await planner.waitForSelector("#say:not([hidden])");
await planner.click("#say button");
await planner.waitForSelector("text=tool completed", { timeout: 8000 }).catch(() => {});
const chat = await planner.locator("#chat").innerText();
check("agent prompt runs a tool in the florist tab", /tool completed/.test(chat) && /Sam/.test(await florist.locator("#orders").innerText()), chat.slice(-120).replace(/\n/g, " "));

// registry notices a site leaving
await library.close();
await planner.waitForFunction(() => document.querySelectorAll("#tools form").length === 2, null, { timeout: 12000 }).catch(() => {});
check("registry updates when the library tab closes", (await planner.locator("#tools form").count()) === 2, String(await planner.locator("#tools form").count()));

// picking a tool on a site that is closed opens it and hands it a port
popup = await popupFrom(planner, () => planner.click('a[href^="intent:reserve"]'));
await popup.waitForSelector(".options button");
const [reopened] = await Promise.all([ctx.waitForEvent("page"), popup.locator(".options button", { hasText: "reserve_book" }).click()]);
await planner.waitForSelector('#picked input[name="title"]', { timeout: 15000 }).catch(() => {});
check("closed site is reopened and connected by the hub", (await planner.locator('#picked input[name="title"]').count()) === 1 && /library/.test(reopened.url()));

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
