// The demos play themselves when they come into view. Checked at phone size.
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const root = LIVE ? process.env.LIVE_MAIN || `https://portauthority.${LIVE}` : "http://hub.localhost:8787";
const shots = process.argv[2];
const browser = await chromium.launch(process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const frameText = (sel, name) => page.locator(`${sel} .box[data-name="${name}"] iframe`).contentFrame().locator("body").innerText();
const caption = (id) => page.locator(`#${id} .caption`).innerText();
const finished = (id, ms) => page.waitForFunction((i) => /That is all of it|Now press|Press Start again/.test(document.querySelector(`#${i} .caption`)?.textContent || ""), id, { timeout: ms }).then(() => true, () => false);

await page.goto(root + "/patterns/?play=1");
await page.locator("#introduce").scrollIntoViewIfNeeded(); await page.waitForSelector("#introduce .stage-el"); await page.locator("#introduce .stage-el").scrollIntoViewIfNeeded();
await page.waitForFunction(() => /1 of 7/.test(document.querySelector("#introduce .caption")?.textContent || ""), null, { timeout: 8000 }).catch(() => {});
check("introduce: the tour starts by itself and says what it is doing", /1 of 7.*Connect Site A to the introducer/s.test(await caption("introduce")), (await caption("introduce")).slice(0, 90));
check("introduce: the tour runs to the end", await finished("introduce", 45000));
check("introduce: the sites really talked after the introducer was removed", /Site B says hello 2/.test(await frameText("#introduce", "right")) || /hello 2/.test(await frameText("#introduce", "right")), (await frameText("#introduce", "right")).replace(/\n/g, " | ").slice(0, 120));
if (shots) await page.locator("#introduce").screenshot({ path: shots + "/tour-introduce.png" });

await page.locator("#signer").scrollIntoViewIfNeeded(); await page.waitForSelector("#signer .stage-el"); await page.locator("#signer .stage-el").scrollIntoViewIfNeeded();
check("signer: the tour runs to the end", await finished("signer", 30000));
check("signer: every step really happened", /refused: this port only signs orders/.test(await frameText("#signer", "shop")) && /signed #1/.test(await frameText("#signer", "vault")));
if (shots) await page.locator("#signer").screenshot({ path: shots + "/tour-signer.png" });

// A press from a person stops the tour and still explains itself.
await page.locator("#attenuate").scrollIntoViewIfNeeded(); await page.waitForSelector("#attenuate .stage-el"); await page.locator("#attenuate .stage-el").scrollIntoViewIfNeeded();
await page.waitForFunction(() => /1 of 6/.test(document.querySelector("#attenuate .caption")?.textContent || ""), null, { timeout: 8000 }).catch(() => {});
await page.locator("#attenuate .controls button", { hasText: "Owner adds one" }).click();
const mine = await caption("attenuate");
await page.waitForTimeout(3500);
check("a press of your own takes over from the tour", /Owner adds one\. The owner/.test(mine) && (await caption("attenuate")) === mine, mine.slice(0, 80));

// The newer experiments play themselves too, at phone size.
const go = async (id) => { await page.locator("#" + id).scrollIntoViewIfNeeded(); await page.waitForSelector(`#${id} .stage-el`); await page.locator(`#${id} .stage-el`).scrollIntoViewIfNeeded(); };
await go("far");
check("far: the tour connects a stand-in device and runs to the end", (await finished("far", 45000)) && /asked for another colour/.test(await frameText("#far", "tool")), (await caption("far")).slice(0, 80));
if (shots) await page.locator("#far").screenshot({ path: shots + "/tour-far.png" });
await go("mounted");
check("mounted: the tour mounts, loads and unmounts", (await finished("mounted", 45000)) && /Nothing is mounted here/.test(await frameText("#mounted", "view")), (await caption("mounted")).slice(0, 80));
await go("socket");
check("socket: the tour runs to the end, through a dropped connection", (await finished("socket", 45000)) && /says hello 2/.test(await frameText("#socket", "tab2")), (await caption("socket")).slice(0, 80));
if (shots) await page.locator("#socket").screenshot({ path: shots + "/tour-socket.png" });

// Without ?play=1 nothing moves until Next is pressed. Next does one step, Back undoes one.
const steps = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
steps.on("pageerror", (e) => errors.push(e.message));
await steps.goto(root + "/");
await steps.waitForSelector("#hero-demo .steps .fwd");
const hero = (name) => steps.locator(`#hero-demo .box[data-name="${name}"] iframe`).contentFrame().locator("body").innerText();
const cap = () => steps.locator("#hero-demo .caption").innerText();
const fwd = steps.locator("#hero-demo .fwd"), prev = steps.locator("#hero-demo .back");
await steps.waitForTimeout(2500);
check("steps: the homepage demo waits, and says to press Next", /7 steps.*Press Next/s.test(await cap()) && /Next: Connect Site A to the introducer/.test(await fwd.innerText()) && (await prev.isDisabled()), (await cap()).slice(0, 70));
await fwd.click(); await steps.waitForTimeout(1200);
check("steps: Next does step one (connect Site A) and names step two", /1 of 7.*Connect Site A/s.test(await cap()) && /Next: Connect Site B to the introducer/.test(await fwd.innerText()) && /holding a line to the introducer|connected to the introducer/.test(await hero("left")), (await cap()).slice(0, 70));
await fwd.click(); await steps.waitForTimeout(1200);
check("steps: Next does step two (connect Site B) and names step three", /2 of 7.*Connect Site B/s.test(await cap()) && /Next: Introduce them/.test(await fwd.innerText()) && /holding a line to the introducer|connected to the introducer/.test(await hero("right")), (await cap()).slice(0, 70));
await fwd.click(); await steps.waitForTimeout(1500);
check("steps: Next does step three (introduce them)", /3 of 7.*Introduce them\./s.test(await cap()) && /Next: Site A says hello/.test(await fwd.innerText()) && /introduced to Site A/.test(await hero("right")), (await cap()).slice(0, 70));
await fwd.click(); await steps.waitForTimeout(1500);
check("steps: Next does step four (Site A says hello)", /4 of 7/.test(await cap()) && /Site A says hello 1/.test(await hero("right")));
await prev.click();
await steps.waitForFunction(() => !document.querySelector("#hero-demo .fwd").disabled && /3 of 7/.test(document.querySelector("#hero-demo .caption").textContent), null, { timeout: 15000 }).catch(() => {});
await steps.waitForTimeout(600);
check("steps: Back returns to step three, with step four undone", /3 of 7/.test(await cap()) && /Next: Site A says hello/.test(await fwd.innerText()) && /introduced to Site A/.test(await hero("right")) && !/says hello/.test(await hero("right")), (await hero("right")).replace(/\n/g, " | ").slice(0, 100));
for (let i = 0; i < 4; i++) { await fwd.click(); await steps.waitForTimeout(1500); }
check("steps: Next reaches the end, and the sites outlived the introducer", /7 of 7/.test(await cap()) && /Start again/.test(await fwd.innerText()) && /Site A says hello 2/.test(await hero("right")), (await cap()).slice(0, 60));
if (shots) await steps.locator(".hero-demo").screenshot({ path: shots + "/steps-hero.png" });
await prev.click();
await steps.waitForFunction(() => !document.querySelector("#hero-demo .fwd").disabled, null, { timeout: 20000 }).catch(() => {});
await prev.click();
await steps.waitForFunction(() => !document.querySelector("#hero-demo .fwd").disabled, null, { timeout: 20000 }).catch(() => {});
await steps.waitForTimeout(600);
check("steps: Back twice in a row lands on a real step", /[1-6] of 7/.test(await cap()), (await cap()).slice(0, 40));

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
