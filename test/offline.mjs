// The router's address goes away, and the router goes on working.
//
// The router has no server side any more, so the only thing its address does
// is send its pages and scripts. A service worker keeps a copy of them
// (sites/router/sw.js). This test lets a site connect, then makes every
// request to the router's address fail, and sees what still works.
// Needs `npx wrangler dev --port 8787` running (PORT=<n> for another port).
import { createRequire } from "node:module";
import { launchWithPartitioning, keptGrant } from "./real-browser.mjs";
// Lets the test see, and fail, the requests a service worker makes. Without it only a page's own requests can be failed.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
const { chromium } = createRequire(import.meta.url)("playwright");
const PORT = process.env.PORT || 8787;
const base = (name) => `http://${name}.localhost:${PORT}`;
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const KEY = "sk-test-THIS-KEY-MUST-NOT-LEAK-0123456789";

async function run(browser, label, { expectWorker }) {
  const ctx = await browser.newContext();
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  const calls = [];
  await ctx.route("https://api.anthropic.com/**", (route) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    calls.push({ key: route.request().headers()["x-api-key"], from: route.request().frame()?.url() });
    const sse = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
    route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Still here." } }) + sse({ type: "message_stop" }) });
  });
  // The router's address: "up" as it is, "down" when nothing answers, "broken" when it answers with an error.
  let router = "up";
  const asked = [];
  await ctx.route(base("router") + "/**", (route) => {
    asked.push(router + " " + new URL(route.request().url()).pathname);
    if (router === "down") return route.abort("internetdisconnected");
    if (router === "broken") return route.fulfill({ status: 503, body: "broken" });
    return route.fallback();
  });
  const errors = [];
  ctx.on("page", (p) => p.on("pageerror", (e) => errors.push(`${p.url()}: ${e.message}`)));
  const workerReady = (where) => where.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => new Promise((r) => (navigator.serviceWorker.controller ? r(true) : navigator.serviceWorker.addEventListener("controllerchange", () => r(true))))), new Promise((r) => setTimeout(() => r(false), 8000))])).catch(() => false);
  const seen = (where) => where.evaluate(() => new Promise((resolve) => { const line = new MessageChannel(); line.port1.onmessage = (e) => resolve(e.data); setTimeout(() => resolve(null), 3000); navigator.serviceWorker.controller.postMessage("seen", [line.port2]); })).catch(() => null);
  const copies = (where) => where.evaluate(async () => { const copy = await caches.open("router-files-1"); const out = {}; for (const request of await copy.keys()) out[new URL(request.url).pathname] = (await copy.match(request)).headers.get("content-security-policy"); return out; }).catch(() => ({}));

  // The person has an account at the router. The router's own page keeps a copy of the router.
  const home = await ctx.newPage();
  await home.goto(base("router") + "/");
  await home.click("#add summary");
  await home.fill("#label", "Work key");
  await home.fill("#key", KEY);
  await home.click("#form button");
  await home.waitForSelector("#accounts li[data-id]");
  check(`${label}: the router's own page has a service worker`, await workerReady(home));
  const atHome = await copies(home);
  check(`${label}: it keeps a copy of every router file, each with the policy it was sent with`, Object.keys(atHome).length === (await seen(home)).files && atHome["/call/openai"] === "default-src 'none'; script-src 'self'; connect-src https://api.openai.com/v1/chat/completions; base-uri 'none'; form-action 'none'" && /connect-src 'none'/.test(atHome["/frame.html"]), `${Object.keys(atHome).length} files kept`);

  // A site connects, and the person allows it.
  const site = await ctx.newPage();
  await site.goto(base("planner") + "/a-site-of-its-own");
  await site.evaluate(async (at) => { const { connect } = await import(at + "/router.js"); window.connect = connect; window.ai = await connect(); document.body.append(Object.assign(document.createElement("button"), { id: "go", textContent: "Choose" })); document.getElementById("go").onclick = () => { window.chose = window.ai.choose(); }; }, base("router"));
  const frame = site.frames().find((f) => f.url() === base("router") + "/frame.html");
  const framed = await workerReady(frame);
  if (expectWorker) check(`${label}: the router frame inside the site has a service worker of its own, with a copy of its own`, framed && Object.keys(await copies(frame)).length === Object.keys(atHome).length);
  else console.log(`note ${label}: the router frame inside the site ${framed ? "has" : "was not allowed"} a service worker of its own`);
  const [popup] = await Promise.all([site.waitForEvent("popup"), site.click("#go")]);
  await popup.waitForSelector("#yes");
  await popup.selectOption("#requests", "5");
  await Promise.all([popup.waitForEvent("close"), popup.click("#yes")]);
  const ask = (through = "ai") => site.evaluate((name) => window[name].prompt("hello").text().catch((error) => "error: " + (error.code || error.message)), through);
  check(`${label}: the site has its model, with the router's address there`, (await site.evaluate(() => window.chose)) === true && (await ask()) === "Still here." && calls.at(-1).key === KEY);
  if (!framed) { await ctx.close(); return; }

  const before = await seen(frame);
  check(`${label}: the call to the provider, which carries the key, was never shown to the service worker`, !!before && before.passedBy === 0, JSON.stringify(before));

  // ------------------------------------------------ the router's address goes away
  router = "down";
  asked.length = 0;
  // A new router frame in the same page: the frame, its scripts, its worker and the call page all have to load.
  const again = await site.evaluate(async () => { window.again = await window.connect(); return { mode: window.again.mode, ready: window.again.ready, left: window.again.left }; });
  check(`${label}: with the router's address gone, a new router frame still loads, and still has the grant`, again.mode === "frame" && again.ready === true && again.left === 4, JSON.stringify(again));
  const frames = site.frames().filter((f) => f.url() === base("router") + "/frame.html");
  const policy = await frames.at(-1).evaluate(() => new Promise((resolve) => { setTimeout(() => fetch("/_sites.js").then(() => resolve("allowed"), () => resolve("blocked")), 0); }));
  check(`${label}: a frame taken from the copy is held to the same policy: it can connect to nothing`, policy === "blocked");
  const n = calls.length;
  check(`${label}: and a prompt through it is answered, from the call page for that provider`, (await ask("again")) === "Still here." && calls.length === n + 1 && calls.at(-1).key === KEY && calls.at(-1).from === base("router") + "/call/anthropic", JSON.stringify(calls.at(-1)));
  check(`${label}: the network was asked first each time, and failed`, asked.length > 5 && asked.every((line) => line.startsWith("down ")), `${asked.length} requests failed`);

  // The router window opens from its copy too. It shows what the site has used, and Stop works.
  const [offline] = await Promise.all([site.waitForEvent("popup"), site.click("#go")]);
  await offline.waitForSelector("#stop");
  check(`${label}: the router window opens with the router's address gone, and shows what the site has used`, /2 of 5 requests used/.test(await offline.locator("#now").innerText()) && /Work key/.test(await offline.locator("#choices").innerText()), await offline.locator("#now").innerText());
  await offline.click("#stop");
  await offline.locator("#stopped").waitFor();
  await offline.close();
  check(`${label}: Stop works with the router's address gone: the grant is deleted and the site is told`, (await keptGrant(frames.at(-1), base("planner"))) === null && (await site.evaluate(() => [window.ai.ready, window.again.ready].join())) === "false,false");

  // The router's own page.
  await home.reload();
  await home.waitForSelector("#accounts li[data-id]");
  check(`${label}: the router's own page loads with its address gone, with the person's accounts`, /Work key/.test(await home.locator("#accounts").innerText()) && /planner/.test(await home.locator("#grants").innerText()));

  // What does not work: a site's own page is not the router's to keep a copy for.
  const fresh = await ctx.newPage();
  await fresh.goto(base("planner") + "/another-page");
  const loaded = await fresh.evaluate((at) => import(at + "/router.js").then(() => "loaded", () => "failed"), base("router"));
  console.log(`note ${label}: a page of a site, loaded while the router's address is gone, ${loaded === "failed" ? "cannot fetch router.js. The service worker answers for the router's own pages, not for a site's" : "could fetch router.js"}`);
  check(`${label}: (known gap) a site's page cannot fetch router.js while the router's address is gone`, loaded === "failed");
  await fresh.close();

  // ------------------------------------------------ the router's address answers with errors
  router = "broken";
  await home.reload();
  await home.waitForSelector("#accounts li[data-id]");
  check(`${label}: when the router's address answers with errors, the copy is used`, /Work key/.test(await home.locator("#accounts").innerText()) && (await home.locator("#main h1").count()) === 1);

  // ------------------------------------------------ and comes back
  router = "up";
  asked.length = 0;
  await home.reload();
  await home.waitForSelector("#accounts li[data-id]");
  check(`${label}: when the router's address is back, pages come from the network again`, asked.includes("up /") && asked.includes("up /home.js"), `${asked.length} requests`);
  check(`${label}: no page threw an error`, errors.length === 0, errors.join(" ; "));
  await ctx.close();
}

const browser = await launchWithPartitioning(chromium);
await run(browser, "Chrome", { expectWorker: true });
await browser.close();
// With third-party cookies blocked, as in Chrome's Incognito. The router has to work whether or not the frame may have a service worker.
const strict = await launchWithPartitioning(chromium, { args: ["--test-third-party-cookie-phaseout"] });
await run(strict, "third-party cookies blocked", { expectWorker: false });
await strict.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
