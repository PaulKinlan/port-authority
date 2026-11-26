// The attack lab page, run as a person would run it: every attack is pressed,
// the person allows the page in the router window when asked, and the page's
// own verdicts are read back. Then the test checks them against what it knows
// and the page cannot: the key itself.
// Needs `npx wrangler dev --port 8787` running (PORT=<n> for another port).
// LIVE=1 runs it against the deployed sites instead, with the same stand-in for the provider.
import { createRequire } from "node:module";
import { launchWithPartitioning, keptGrant } from "./real-browser.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const PORT = process.env.PORT || 8787;
const LIVE = { hub: "https://port-authority.dev", router: "https://llmchannel.dev", florist: "https://pa-florist.kinlan-test.workers.dev" };
const base = (name) => (process.env.LIVE ? LIVE[name] : `http://${name}.localhost:${PORT}`);
const browser = await launchWithPartitioning(chromium);
const ctx = await browser.newContext();
await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const errors = [];
ctx.on("page", (p) => p.on("pageerror", (e) => errors.push(`${p.url()}: ${e.message}`)));
const KEY = "sk-test-THIS-KEY-MUST-NOT-LEAK-0123456789";

const calls = [];
await ctx.route("https://api.anthropic.com/**", (route) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  calls.push(route.request().headers()["x-api-key"]);
  const sse = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
  route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }) + sse({ type: "message_stop" }) });
});

// The person has an account at the router.
const home = await ctx.newPage();
await home.goto(base("router") + "/");
await home.click("#add summary");
await home.fill("#label", "Work key");
await home.fill("#key", KEY);
await home.click("#form button");
await home.waitForSelector("#accounts li[data-id]");

const lab = await ctx.newPage();
await lab.goto(base("hub") + "/ai-router/attacks/");
await lab.locator("#attacks [data-run]:not([disabled])").first().waitFor();
check("the attack lab holds the router's real frame", /The router's frame is in this page/.test(await lab.locator("#state").innerText()) && lab.frames().some((f) => f.url() === base("router") + "/frame.html"));
check("every attack shows the code that runs", (await lab.locator("#attacks .attack details pre").allTextContents()).every((code) => /^async function \w+\(/.test(code)) && (await lab.locator("#attacks .attack").count()) === 8);

const card = (name) => lab.locator("#attack-" + name);
const results = async (name) => ({ held: await card(name).locator(".results li.held").count(), broke: await card(name).locator(".results li.broke").allInnerTexts(), told: (await card(name).locator(".results li.told").allInnerTexts()).join(" ") });
const done = (name) => card(name).locator("[data-run]:not([disabled])").waitFor({ timeout: 90000 }).then(() => lab.waitForFunction((id) => document.getElementById(id).dataset.done === "true", "attack-" + name));
// The person, in the router window: choose the account that is ticked, for five requests, and allow.
const allow = async (popup) => { await popup.waitForSelector("#yes"); await popup.selectOption("#requests", "5"); await Promise.all([popup.waitForEvent("close"), popup.click("#yes")]); };
const press = async (name) => { const opened = lab.waitForEvent("popup", { timeout: 4000 }).catch(() => null); await card(name).locator("[data-run]").click(); return opened; };

// 1. Reach into the frame. No window.
await press("readTheFrame");
await done("readTheFrame");
let got = await results("readTheFrame");
check("reach into the frame: the browser refused every one", got.held === 7 && got.broke.length === 0, JSON.stringify(got));

// 2. The relay. The person allows the page while it offers ports to the window and the frame.
let popup = await press("relay");
check("the relay: the router window names the attack lab by its real address", (await popup.locator(".origin").innerText()) === base("hub"));
await popup.waitForTimeout(800);     // let it keep offering ports
await allow(popup);
await done("relay");
got = await results("relay");
check("the relay: neither the frame nor the window said a word on the page's ports", got.held === 2 && got.broke.length === 0, JSON.stringify(got));
check("and the grant was delivered all the same, on a line the page never held", /the grant was delivered/.test(got.told) && /5 requests left/.test(await lab.locator("#state").innerText()), await lab.locator("#state").innerText());

// 3. Decoy frames.
popup = await press("plantDecoys");
await allow(popup);
await done("plantDecoys");
got = await results("plantDecoys");
check("decoy frames: three were planted ahead of the real frame, and were sent nothing", got.held === 1 && got.broke.length === 0 && lab.frames().length >= 5, JSON.stringify(got));

// 4. A forged router window, a forged grant, a second hello.
await press("forgeTheWindow");
await done("forgeTheWindow");
got = await results("forgeTheWindow");
check("a forged window: the frame did not answer, and what the page may use did not change", got.held === 2 && got.broke.length === 0, JSON.stringify(got));
const real = lab.frames().find((f) => f.url() === base("router") + "/frame.html" && !f.isDetached() && f.parentFrame() === lab.mainFrame() && f.childFrames().length > 0) || lab.frames().find((f) => f.url() === base("router") + "/frame.html");
const kept = await keptGrant(real, base("hub"));
check("the grant the frame keeps is the one the person allowed, not the forged one", !!kept && kept.grant.label === "Work key" && kept.grant.requests === 5 && kept.grant.id !== "forged", kept && JSON.stringify({ label: kept.grant.label, requests: kept.grant.requests }));

// 5. Reach into the window, and tell it the page is a bank.
popup = await press("reachIntoTheWindow");
await popup.waitForSelector("#yes");
await card("reachIntoTheWindow").locator(".results li", { hasText: "did not answer any forged message" }).waitFor({ timeout: 20000 });
check("reach into the window: it still shows the page's real address, and not the bank it was told", (await popup.locator(".origin").innerText()) === base("hub") && !/your-bank/.test(await popup.locator("#main").innerText()));
await popup.click("#no");
await done("reachIntoTheWindow");
got = await results("reachIntoTheWindow");
check("reach into the window: the browser refused every read, and the window answered nothing", got.held === 5 && got.broke.length === 0, JSON.stringify(got));

// 6. Get more than it was given: five requests.
const before = calls.length;
await press("getMore");
await done("getMore");
got = await results("getMore");
check("get more: the page got its five requests through two frames at once, and no more", got.held === 3 && got.broke.length === 0 && calls.length - before === 5, JSON.stringify(got) + ` (${calls.length - before} calls reached the provider)`);
check("and the provider was called with the person's key, which the page never saw", calls.slice(before).every((key) => key === KEY));
check("once used up, nothing is kept for the page", (await keptGrant(real, base("hub"))) === null && /no model/.test(await lab.locator("#state").innerText()));

// 7. A trusted site shown inside the hostile page.
await press("borrowAName");
await done("borrowAName");
const inner = lab.frameLocator("#attack-borrowAName iframe");
await inner.locator("#choose:not([disabled])").waitFor({ timeout: 20000 });
check("borrow a name: the site shown inside the page is given no router frame and no model", /No model yet/.test(await inner.locator("#state").innerText()) && !lab.frames().some((f) => f.url() === base("router") + "/frame.html" && f.parentFrame() && f.parentFrame().url().startsWith(base("florist"))));
const [refusing] = await Promise.all([lab.waitForEvent("popup"), inner.locator("#choose").click()]);
await refusing.locator("h1", { hasText: "Open the site in a tab of its own" }).waitFor();
check("and the router window it opens refuses, with nothing to allow", (await refusing.locator("#yes").count()) === 0);
await refusing.close();

// 8. The look-alike: the one that works, and the page says so.
const [fake] = await Promise.all([lab.waitForEvent("popup"), card("lookAlike").locator("[data-run]").click()]);
await fake.waitForLoadState();
await done("lookAlike");
got = await results("lookAlike");
check("the look-alike: the page says plainly that this attack works", got.broke.length === 1 && /This one works/.test(got.broke[0]));
check("the look-alike is at the attack lab's own address, and looks like the router's window", fake.url() === base("hub") + "/ai-router/attacks/lookalike.html" && /wants to use an AI model/.test(await fake.locator("h1").innerText()));
await fake.locator("#key").pressSequentially("sk-");
check("it keeps nothing typed into it, and owns up as soon as the box is used", (await fake.locator("#key").inputValue()) === "" && (await fake.locator("#caught").isVisible()) && /never asks for a key/.test(await fake.locator("#caught").innerText()));
await fake.close();

// Everything the page collected, read back and searched for what the page cannot know to search for.
const verdict = await lab.locator("#verdict").innerText();
const all = await lab.evaluate(() => document.documentElement.innerHTML);
const secrets = { "the API key": KEY, "the encrypted key": kept.grant.sealed.data, "the grant's id": kept.grant.id };
check("the page's own verdict: nothing from between the window and the frame, and nothing shaped like a key", (await lab.locator("#verdict").getAttribute("class")) === "held" && /^\d+ messages received/.test(verdict) && Number(verdict.split(" ")[0]) > 20, verdict);
for (const [name, value] of Object.entries(secrets)) check(`nothing on the page contains ${name}`, !!value && !all.includes(value));
check("no attack reported getting anything, but the look-alike", (await lab.locator(".results li.broke").count()) === 1);
check("no page threw an error", errors.length === 0, errors.join(" ; "));

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
