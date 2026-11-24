// End-to-end check of the hub across four origins, with no hub tab open.
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
const ready = (page, id) => page.waitForSelector(`#${id}:not([disabled])`);
const pages = {};

// Add two sites to the hub. No hub tab is ever opened in this test.
for (const name of ["florist", "library"]) {
  const page = pages[name] = await ctx.newPage();
  await page.goto(base(name) + "/");
  await ready(page, "connect");
  const popup = await popupFrom(page, () => page.click("#connect"));
  await popup.click("#yes");
  await page.waitForSelector("text=Connected to your hub", { timeout: 10000 }).catch(() => {});
  check(`${name} is added to the hub`, (await page.locator("#state").innerText()) === "Connected to your hub", await page.locator("#state").innerText());
}

// A reload reconnects by itself: no button, no popup.
await pages.florist.reload();
await pages.florist.waitForSelector("text=Connected to your hub", { timeout: 10000 }).catch(() => {});
check("florist reconnects by itself after a reload", (await pages.florist.locator("#state").innerText()) === "Connected to your hub" && !(await pages.florist.locator("#connect").isVisible()));

// Close both sites. The registry is on the server, so the picker still lists their tools.
await pages.florist.close(); await pages.library.close();
const planner = await ctx.newPage();
await planner.goto(base("planner") + "/");
await ready(planner, "pick");
let popup = await popupFrom(planner, () => planner.click("#pick"));
await popup.waitForSelector(".options button");
check("picker lists all four tools with every site closed", (await popup.locator(".options button").count()) === 4);
check("picker ranks the matching tool first", (await popup.locator(".options button strong").first().innerText()) === "book_delivery");
const [floristWindow] = await Promise.all([ctx.waitForEvent("page"), popup.locator(".options button").first().click()]);
await planner.waitForSelector("#picked form");
check("the hub window closes after the introduction", popup.isClosed() || (await popup.waitForEvent("close", { timeout: 3000 }).then(() => true, () => false)));
await planner.selectOption('#picked select[name="bouquet"]', "ember");
await planner.fill('#picked input[name="recipient"]', "Ada");
await planner.click("#picked form button");
await planner.waitForFunction(() => document.querySelector("#picked .result")?.textContent.length > 0);
const picked = await planner.locator("#picked .result").innerText();
check("direct call over the port returns an order", /SP-/.test(picked) && /Ada/.test(picked));
const orders = await floristWindow.locator("#orders").innerText();
check("it ran in the florist window the hub opened, and the florist knows who called", /Ember for Ada/.test(orders) && /planner/.test(orders));

// The line is a plain MessagePort between two pages. Prove the server is not in it:
// cut both sites off from the network and call again.
await ctx.setOffline(true);
await planner.fill('#picked input[name="recipient"]', "Offline Ada");
await planner.click("#picked form button");
await floristWindow.waitForFunction(() => /Offline Ada/.test(document.querySelector("#orders").textContent), null, { timeout: 5000 }).catch(() => {});
check("the line still works with the network off", /Offline Ada/.test(await floristWindow.locator("#orders").innerText()));
await ctx.setOffline(false);

// Intent link, answered by the library.
popup = await popupFrom(planner, () => planner.click('a[href^="intent:find"]'));
await popup.waitForSelector(".options button");
check("intent link ranks find_book first", (await popup.locator(".options button strong").first().innerText()) === "find_book");
const [libraryWindow] = await Promise.all([ctx.waitForEvent("page"), popup.locator(".options button").first().click()]);
await planner.waitForSelector('#picked input[name="query"]');
await planner.fill('#picked input[name="query"]', "chickens");
await planner.click("#picked form button");
await planner.waitForFunction(() => document.querySelector("#picked .result")?.textContent.length > 0);
check("library answers over its own line", /Raising Chickens/.test(await planner.locator("#picked .result").innerText()));

// Registry: MCP over a port, carried by the hub server.
await floristWindow.waitForSelector("text=Connected to your hub"); await libraryWindow.waitForSelector("text=Connected to your hub");
popup = await popupFrom(planner, () => planner.click("#registry"));
await popup.click("#yes");
await planner.waitForSelector("#tools form");
check("registry lists four tools", (await planner.locator("#tools form").count()) === 4, String(await planner.locator("#tools form").count()));

// Agent: ACP over a port, built-in agent.
popup = await popupFrom(planner, () => planner.click("#agent"));
await popup.click("#yes");
await planner.waitForSelector("#say:not([hidden])");
await planner.click("#say button");
await planner.waitForSelector("text=tool completed", { timeout: 10000 }).catch(() => {});
const chat = await planner.locator("#chat").innerText();
check("agent prompt runs a tool in the florist window", /tool completed/.test(chat) && /Sam/.test(await floristWindow.locator("#orders").innerText()), chat.slice(-80).replace(/\n/g, " "));

// Registry notices a site leaving.
await libraryWindow.close();
await planner.waitForFunction(() => document.querySelectorAll("#tools form").length === 2, null, { timeout: 12000 }).catch(() => {});
check("registry updates when the library window closes", (await planner.locator("#tools form").count()) === 2, String(await planner.locator("#tools form").count()));

// Access that was given is remembered: after a reload there is no popup.
await planner.reload();
await ready(planner, "registry");
let sawPopup = false; planner.once("popup", () => (sawPopup = true));
await planner.click("#registry");
await planner.waitForSelector("#tools form", { timeout: 8000 }).catch(() => {});
check("registry access is remembered after a reload, with no popup", !sawPopup && (await planner.locator("#tools form").count()) === 2);

// Revoking in the hub ends it.
const hub = await ctx.newPage();
hub.on("dialog", (d) => d.accept());
await hub.goto(base("hub") + "/hub/");
await hub.waitForSelector('button[data-act="revoke"]');
check("the dashboard shows what the server knows", (await hub.locator(".service").count()) === 2 && (await hub.locator('button[data-act="revoke"]').count()) === 2);
for (const left of [1, 0]) {
  await hub.locator('button[data-act="revoke"]').first().click();
  await hub.waitForFunction((n) => document.querySelectorAll('button[data-act="revoke"]').length === n, left);
}
await planner.reload(); await ready(planner, "registry");
popup = await popupFrom(planner, () => planner.click("#registry")).catch(() => null);
check("after a revoke the site has to ask again", !!popup);

// Forgetting a site in the hub disconnects it, and it stays disconnected.
if (popup && !popup.isClosed()) await popup.close().catch(() => {});
await hub.bringToFront();
const florist = hub.locator(".service", { hasText: "pa-florist" }).or(hub.locator(".service", { hasText: "florist" })).first();
await florist.locator('button[data-act="forget"]').click();
await hub.waitForFunction(() => document.querySelectorAll(".service").length === 1, null, { timeout: 8000 }).catch(() => {});
await floristWindow.waitForSelector("text=Not connected", { timeout: 8000 }).catch(() => {});
await floristWindow.waitForTimeout(4000);   // long enough for a reconnect, if it were going to try
check("forget: the site is told, shows it is not connected, and does not come back by itself", (await floristWindow.locator("#state").innerText()) === "Not connected" && (await floristWindow.locator("#connect").isVisible()) && /hub forgot this site/.test(await floristWindow.locator("#log").innerText()) && (await hub.locator(".service").count()) === 1, await floristWindow.locator("#state").innerText());
await floristWindow.reload(); await floristWindow.waitForTimeout(2500);
check("forget: a reload does not bring it back either", (await floristWindow.locator("#state").innerText()) === "Not connected" && (await hub.locator(".service").count()) === 1);

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
