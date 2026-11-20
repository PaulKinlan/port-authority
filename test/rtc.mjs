// The tool's site is already open in a tab: the picker opens no new window,
// the server introduces the two tabs, and the call goes over WebRTC.
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const base = (name) => LIVE ? `https://${name === "hub" ? "portauthority" : "pa-" + name}.${LIVE}` : `http://${name}.localhost:8787`;
const browser = await chromium.launch(process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
const ctx = await browser.newContext();
const errors = [];
ctx.on("page", (p) => { p.on("pageerror", (e) => errors.push(`${p.url()}: ${e.message}`)); });
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const popupFrom = async (page, click) => { const [popup] = await Promise.all([page.waitForEvent("popup"), click()]); await popup.waitForLoadState(); return popup; };
const ready = (page, id) => page.waitForSelector(`#${id}:not([disabled])`);

const florist = await ctx.newPage();
await florist.goto(base("florist") + "/");
await ready(florist, "connect");
let popup = await popupFrom(florist, () => florist.click("#connect"));
await popup.click("#yes");
await florist.waitForSelector("text=Connected to your hub", { timeout: 10000 });

const planner = await ctx.newPage();
await planner.goto(base("planner") + "/");
await ready(planner, "pick");
const before = ctx.pages().length;
popup = await popupFrom(planner, () => planner.click("#pick"));
await popup.waitForSelector(".options button");
check("picker says the florist is open in a tab", /open in a tab/.test(await popup.locator(".options button").first().innerText()));
await popup.locator(".options button").first().click();
await planner.waitForSelector("#picked form", { timeout: 20000 }).catch(() => {});
check("the line is made over WebRTC", /over WebRTC/.test(await planner.locator("#picked").innerText()), (await planner.locator("#picked").innerText()).slice(0, 120));
await popup.waitForEvent("close", { timeout: 3000 }).catch(() => {});
check("no new window was opened", ctx.pages().length === before, `${ctx.pages().length} pages`);
await planner.selectOption('#picked select[name="bouquet"]', "ember");
await planner.fill('#picked input[name="recipient"]', "Rita C");
await planner.click("#picked form button");
await planner.waitForFunction(() => document.querySelector("#picked .result")?.textContent.length > 0);
check("the call returns an order", /SP-/.test(await planner.locator("#picked .result").innerText()));
check("the order landed in the tab that was already open", /Rita C/.test(await florist.locator("#orders").innerText()));

// The server only carried the handshake: cut both sites off from it and call again.
await ctx.setOffline(true);
await planner.fill('#picked input[name="recipient"]', "Offline Rita");
await planner.click("#picked form button");
await florist.waitForFunction(() => /Offline Rita/.test(document.querySelector("#orders").textContent), null, { timeout: 8000 }).catch(() => {});
check("calls still work with the server unreachable", /Offline Rita/.test(await florist.locator("#orders").innerText()));
await ctx.setOffline(false);

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
