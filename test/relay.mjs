// The full loop: a site -> hub server (Durable Object) -> bridge -> ACP agent -> MCP -> bridge -> hub server -> florist tab.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE; // e.g. kinlan-test.workers.dev
const base = (name) => LIVE ? (name === "hub" && process.env.LIVE_MAIN) || `https://${name === "hub" ? "portauthority" : "pa-" + name}.${LIVE}` : `http://${name}.localhost:8787`;
const browser = await chromium.launch(process.env.HTTPS_PROXY && process.env.LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
const ctx = await browser.newContext();
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const popupFrom = async (page, click) => { const [popup] = await Promise.all([page.waitForEvent("popup"), click()]); await popup.waitForLoadState(); return popup; };

const hub = await ctx.newPage();
await hub.goto(base("hub") + "/hub/");
await hub.check('input[value="relay"]');
await hub.waitForSelector("[data-command]");
const wss = (await hub.locator("[data-command]").innerText()).match(/wss?:\/\/[^\s"]+/)[0];
check("hub shows an address for the bridge", /\/h\/[\w-]{20,}\?token=[\w-]{20,}/.test(wss));
await hub.waitForSelector("text=Waiting for the bridge");

const bridge = spawn(process.execPath, ["sites/main/bridge.mjs", LIVE ? wss : wss.replace("hub.localhost", "127.0.0.1"), "--", process.execPath, "test/fake-agent.mjs"], { stdio: ["ignore", "inherit", "inherit"] });
await hub.waitForSelector("text=Fake test agent", { timeout: 15000 }).catch(() => {});
check("hub sees the agent through the relay", (await hub.locator("text=Fake test agent").count()) > 0);

const florist = await ctx.newPage();
await florist.goto(base("florist") + "/");
let popup = await popupFrom(florist, () => florist.click("#connect"));
await popup.click("#yes");
await florist.waitForSelector("text=Connected to your hub");

const planner = await ctx.newPage();
await planner.goto(base("planner") + "/");
popup = await popupFrom(planner, () => planner.click("#agent"));
await popup.click("#yes");
await planner.waitForSelector("#say:not([hidden])");
await planner.fill("#prompt", "please book_delivery");
await planner.click("#say button");
await planner.waitForFunction(() => /result=|error=/.test(document.querySelector("#chat").textContent), null, { timeout: 20000 }).catch(() => {});
const chat = await planner.locator("#chat").innerText();
check("agent reached the registry over MCP", /tools=stem_and_petal__list_bouquets,stem_and_petal__book_delivery/.test(chat), chat.slice(0, 200).replace(/\n/g, " "));
check("agent's tool call ran in the florist tab", /Quiet for Relay Test/.test(await florist.locator("#orders").innerText()));
check("site could not choose the agent's folder", chat.includes(`cwd=${process.cwd()}`));
bridge.kill();
await hub.waitForSelector("text=Waiting for the bridge", { timeout: 10000 }).catch(() => {});
check("hub notices the agent leaving", (await hub.locator("text=Waiting for the bridge").count()) > 0);
await browser.close();
process.exit(failed ? 1 : 0);
