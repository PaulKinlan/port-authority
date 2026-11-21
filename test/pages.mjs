// Every pattern has a page of its own: the demo, and the longer explanation.
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const root = LIVE ? process.env.LIVE_MAIN || `https://portauthority.${LIVE}` : "http://hub.localhost:8787";
const shots = process.argv[2];
const browser = await chromium.launch(process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };

await page.goto(root + "/patterns/");
await page.waitForSelector("#contents a");
const links = await page.locator("#contents a").evaluateAll((as) => as.map((a) => [a.getAttribute("href"), a.textContent]));
check("the patterns page lists every pattern with a link to its page", links.length === 32, String(links.length));
check("each short version links to its full page", (await page.locator('#keycopy .more a').getAttribute("href")) === "/patterns/keycopy/");

const thin = [];
for (const [href, title] of links) {
  const before = errors.length;
  await page.goto(root + href);
  const ok = await page.waitForSelector("#demo .controls button", { timeout: 15000 }).then(() => true, () => false);
  const got = await page.evaluate(() => ({
    title: document.getElementById("title")?.textContent, tab: document.title,
    sections: [...document.querySelectorAll("#deep section")].map((s) => s.id),
    wide: document.documentElement.scrollWidth > innerWidth + 1,
  }));
  const need = ["what", "code", "how", "uses", "try", "traps", "related"];
  if (!ok || got.title !== title || !got.tab.startsWith(title) || need.some((n) => !got.sections.includes(n)) || got.wide || errors.length > before) thin.push(`${href} ${JSON.stringify(got)} ${errors.slice(before).join("|")}`);
}
check("all 32 pages load their demo and every part of the explainer, with no sideways scroll on a phone", thin.length === 0, thin.join("\n"));

await page.goto(root + "/patterns/attenuate/");
await page.waitForSelector("#demo .fwd");
for (let i = 0; i < 3; i++) { await page.locator("#demo .fwd").click(); await page.waitForTimeout(1400); }
const guest = await page.locator('#demo .box[data-name="guest"] iframe').contentFrame().locator("body").innerText().catch(() => "");
check("the demo on a pattern's own page steps with Next", /3 of 6/.test(await page.locator("#demo .caption").innerText()), (await page.locator("#demo .caption").innerText()).slice(0, 60) + " // " + guest.replace(/\n/g, " | ").slice(0, 80));
check("the page lists the same steps in words", (await page.locator("#steps ol li").count()) === 6);
if (shots) await page.screenshot({ path: shots + "/page-attenuate.png", fullPage: true });
await page.locator("#related a").first().click(); await page.waitForSelector("#demo .controls button");
check("read next goes to another pattern's page", /\/patterns\/[a-z-]+\/$/.test(page.url()) && !page.url().endsWith("/attenuate/"), page.url());
const missing = await page.goto(root + "/patterns/nonsense/");
check("an unknown pattern says so", /There is no pattern here/.test(await page.locator("#title").innerText()), String(missing.status()));

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
