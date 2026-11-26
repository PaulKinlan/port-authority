// The words of the site are in its HTML. Scripts start the demos and nothing else.
//
// Every pattern page, and the patterns index, is loaded with JavaScript turned
// off and must still have its title, its code, how it works and the rest. The
// other pages of the site are loaded both ways and compared, to show any page
// whose text mostly arrives by script.
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const root = LIVE ? process.env.LIVE_MAIN || `https://portauthority.${LIVE}` : `http://hub.localhost:${process.env.PORT || 8787}`;
const browser = await chromium.launch(process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
const off = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1200, height: 900 } });
// Web fonts are not what is being tested, and can be slow to answer.
await off.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
const page = await off.newPage();
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const words = (text) => text.trim().split(/\s+/).filter(Boolean).length;

// The index: every pattern is listed and has its short version, with no script.
await page.goto(root + "/patterns/", { waitUntil: "domcontentloaded" });
const links = await page.locator('#contents a[href^="/patterns/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
check("with no script, the patterns page lists every pattern", links.length === 33, String(links.length));
check("with no script, the patterns page has every short version, with its code", (await page.locator("section.pattern[id] .text pre").count()) === 33, String(await page.locator("section.pattern[id] .text pre").count()));
check("with no script, the patterns page has the key to the diagrams", (await page.locator("[data-legend] li").count()) > 3, String(await page.locator("[data-legend] li").count()));

// Each pattern's own page.
const short = [];
for (const href of links) {
  const res = await page.goto(root + href, { waitUntil: "domcontentloaded" });
  const got = await page.evaluate(() => ({
    title: document.querySelector("#title")?.textContent || "",
    sections: [...document.querySelectorAll("#deep > section")].map((s) => s.id),
    code: document.querySelector("#code pre")?.textContent.length || 0,
    using: document.querySelector("#using + pre")?.textContent.length || 0,
    when: document.querySelector("#case + p")?.textContent || "",
    text: document.querySelector("#main").innerText,
    described: document.querySelector('meta[name="description"]')?.content || "",
    pager: document.querySelectorAll("#pager a").length,
  }));
  const missing = ["what", "code", "how", "uses", "traps"].filter((id) => !got.sections.includes(id));
  const problems = [];
  if (res.status() !== 200) problems.push("status " + res.status());
  if (!got.title || /Loading/.test(got.title)) problems.push("no title");
  if (missing.length) problems.push("no " + missing.join(", "));
  if (got.code < 40) problems.push("no code");
  if (got.using < 40 || !got.when.startsWith("A real case.")) problems.push("no code in use, or no real case");
  if (words(got.text) < 400) problems.push(words(got.text) + " words");
  if (got.described.length < 60) problems.push("no description");
  if (got.pager < 2) problems.push("no pager");
  if (problems.length) short.push(`${href}: ${problems.join("; ")}`);
}
check("with no script, every pattern's page has its title, code, the code in use, a real case, how it works, what to build and the mistakes", short.length === 0, short.join(" | "));

const missing = await page.goto(root + "/patterns/nonsense/", { waitUntil: "domcontentloaded" });
check("an address with no pattern is a 404 that says so, with no script", missing.status() === 404 && /There is no pattern here/.test(await page.locator("#title").innerText()), String(missing.status()));

// The rest of the site: how much of each page's text is there before any script runs.
const on = await browser.newContext({ viewport: { width: 1200, height: 900 } });
await on.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
const live = await on.newPage();
const thin = [];
for (const path of ["/", "/guide/", "/comlink/", "/ai-router/", "/ai-router/attacks/", "/missing/", "/reading/", "/about/", "/lab/", "/lab/results/", "/hub/", "/isolated/", "/far/", "/chat/"]) {
  await page.goto(root + path, { waitUntil: "domcontentloaded" });
  const without = words(await page.locator("body").innerText());
  await live.goto(root + path, { waitUntil: "domcontentloaded" });
  await live.waitForTimeout(1500);
  const withScript = words(await live.locator("body").innerText());
  const share = withScript ? Math.round((without / withScript) * 100) : 100;
  console.log(`     ${path.padEnd(22)} ${String(without).padStart(5)} words with no script, ${String(withScript).padStart(5)} with (${share}%)`);
  if (share < 60) thin.push(`${path} ${share}%`);
}
// These are tools, not reading: the lab's tables, a person's hub and the chat are made by running them.
const tools = ["/lab/", "/lab/results/", "/hub/", "/chat/", "/far/"];
const reading = thin.filter((entry) => !tools.includes(entry.split(" ")[0]));
check("every page that is for reading has most of its words with no script", reading.length === 0, reading.join(", "));
if (thin.length > reading.length) console.log("     made by running them, so thin with no script: " + thin.filter((entry) => tools.includes(entry.split(" ")[0])).join(", "));

await browser.close();
process.exit(failed ? 1 : 0);
