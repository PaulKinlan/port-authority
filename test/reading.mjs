// The further reading page: built from links.json, readable on a phone, linked from the other pages.
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const root = LIVE ? process.env.LIVE_MAIN || `https://portauthority.${LIVE}` : "http://hub.localhost:8787";
const data = JSON.parse(readFileSync(new URL("../sites/main/reading/links.json", import.meta.url), "utf8"));
const want = data.groups.flatMap((g) => g.items.map((i) => i.u));
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };

let fresh = true;
try { execFileSync("node", [new URL("../scripts/reading.mjs", import.meta.url).pathname, "--verify"], { stdio: "pipe" }); } catch { fresh = false; }
check("index.html is what scripts/reading.mjs builds from links.json", fresh);
check("no address is listed twice", new Set(want).size === want.length, String(want.length - new Set(want).size));
const thin = data.groups.flatMap((g) => g.items).filter((i) => !i.t || !i.by || !i.n || !/^https?:\/\//.test(i.u) || i.n.length > 220);
check("every link has a title, a source and a short note", thin.length === 0, thin.map((i) => i.u).join(" "));

const browser = await chromium.launch(process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(root + "/reading/");
const got = await page.evaluate(() => ({
  links: [...document.querySelectorAll("main .links li > a")].map((a) => a.href),
  notes: [...document.querySelectorAll("main .links li")].filter((li) => li.querySelector(".note")?.textContent.trim() && li.querySelector(".src")?.textContent.trim()).length,
  toc: [...document.querySelectorAll(".toc a")].map((a) => a.getAttribute("href")),
  sections: [...document.querySelectorAll("main section")].map((s) => "#" + s.id),
  wide: document.documentElement.scrollWidth > innerWidth + 1,
}));
check("the page shows every link in links.json", JSON.stringify(got.links) === JSON.stringify(want.map((u) => new URL(u).href)), `${got.links.length} of ${want.length}`);
check("each one has its source and note beside it", got.notes === want.length, String(got.notes));
check("the contents list has every group", JSON.stringify(got.toc) === JSON.stringify(got.sections) && got.toc.length === data.groups.length);
check("no sideways scroll on a phone, and no script errors", !got.wide && errors.length === 0, errors.join("|"));
const served = await page.evaluate(() => fetch("/reading/links.json").then((r) => r.json()).then((j) => j.groups.length, () => -1));
check("links.json is served", served === data.groups.length, String(served));
for (const p of ["/", "/guide/", "/patterns/keycopy/", "/lab/"]) {
  await page.goto(root + p);
  check(`${p} links to the reading page`, (await page.locator('.site-bar nav a[href="/reading/"]').count()) === 1);
}
await browser.close();
process.exit(failed ? 1 : 0);
