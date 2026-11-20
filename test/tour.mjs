// The demos play themselves when they come into view. Checked at phone size.
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const root = LIVE ? `https://portauthority.${LIVE}` : "http://hub.localhost:8787";
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
await page.waitForFunction(() => /1 of 5/.test(document.querySelector("#introduce .caption")?.textContent || ""), null, { timeout: 8000 }).catch(() => {});
check("introduce: the tour starts by itself and says what it is doing", /1 of 5.*Introduce them\. The introducer makes a channel/s.test(await caption("introduce")), (await caption("introduce")).slice(0, 90));
check("introduce: the tour runs to the end", await finished("introduce", 30000));
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
check("a press of your own takes over from the tour", /Owner adds one\. The owner still can/.test(mine) && (await caption("attenuate")) === mine, mine.slice(0, 80));

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
