// Sites the AI router cannot serve, and sites it can serve only one way.
//
// A site's own response headers decide whether it may hold the router's frame,
// and whether a window it opens can still reach it. This test serves the same
// small site under each set of headers, lets a person try to choose a model,
// and says what happened. The explainer's list of where the router does not
// work is written from these results.
// Needs `npx wrangler dev --port 8787` running (PORT=<n> for another port).
import http from "node:http";
import { createRequire } from "node:module";
import { launchWithPartitioning } from "./real-browser.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const PORT = process.env.PORT || 8787;
const ROUTER = `http://router.localhost:${PORT}`;
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };

// what: "frame"   the site holds the router frame, the window hands it a grant and closes
//       "window"  the frame cannot load, the window stays open and serves the site
//       "none"    the person cannot choose at all
const CASES = [
  { name: "no headers", headers: {}, what: "frame" },
  { name: "COOP same-origin", headers: { "cross-origin-opener-policy": "same-origin" }, what: "none" },
  { name: "COOP same-origin-allow-popups", headers: { "cross-origin-opener-policy": "same-origin-allow-popups" }, what: "frame" },
  { name: "COOP noopener-allow-popups", headers: { "cross-origin-opener-policy": "noopener-allow-popups" }, what: "frame" },
  { name: "COEP require-corp", headers: { "cross-origin-embedder-policy": "require-corp" }, what: "window" },
  { name: "COEP credentialless", headers: { "cross-origin-embedder-policy": "credentialless" }, what: "window" },
  { name: "cross-origin isolated (COOP same-origin, COEP require-corp)", headers: { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" }, what: "none", isolated: true },
  { name: "Document-Isolation-Policy isolate-and-require-corp", headers: { "document-isolation-policy": "isolate-and-require-corp" }, what: "frame", isolated: true },
  { name: "CSP frame-src 'none'", headers: { "content-security-policy": "frame-src 'none'" }, what: "window" },
  { name: "CSP sandbox, popups kept in the sandbox", headers: { "content-security-policy": "sandbox allow-scripts allow-popups" }, what: "none" },
  { name: "CSP sandbox, popups let out", headers: { "content-security-policy": "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox" }, what: "none" },
];
const only = process.env.ONLY ? CASES.filter((c) => c.name.includes(process.env.ONLY)) : CASES;

const PAGE = `<!doctype html><meta charset="utf-8"><title>loading</title><button id="go">Choose</button><pre id="out"></pre>
<script type="module">
  const out = (text) => { document.getElementById("out").textContent += text + "\\n"; };
  try {
    const { connect } = await import("${ROUTER}/router.js");
    const ai = window.ai = await connect();
    out("mode " + ai.mode);
    document.getElementById("go").onclick = async () => { try { out("chose " + await ai.choose()); } catch (error) { out("choose-error " + (error.code || error.name)); } };
  } catch (error) { out("load-error " + error.message); }
  document.title = "ready";
</script>`;
const server = http.createServer((request, response) => {
  const found = CASES[Number(new URL(request.url, "http://x").searchParams.get("case"))];
  if (!found || !request.url.startsWith("/site")) { response.writeHead(404); return response.end("not found"); }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...found.headers });
  response.end(PAGE);
});
await new Promise((done) => server.listen(0, "::", done));
const SITE = `http://a-site.localhost:${server.address().port}`;

async function run(browser, found, label = found.name) {
  const ctx = await browser.newContext();
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  await ctx.route("https://api.anthropic.com/**", (route) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const sse = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
    route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "An answer." } }) + sse({ type: "message_stop" }) });
  });
  // The person has an account at the router.
  const home = await ctx.newPage();
  await home.goto(ROUTER + "/");
  await home.click("#add summary");
  await home.fill("#label", "Work key");
  await home.fill("#key", "sk-test-0123456789-0123456789");
  await home.click("#form button");
  await home.waitForSelector("#accounts li[data-id]");

  const site = await ctx.newPage();
  await site.goto(`${SITE}/site?case=${CASES.indexOf(found)}`);
  await site.waitForFunction(() => document.title === "ready", null, { timeout: 15000 });
  const said = async () => (await site.locator("#out").innerText()).trim().split("\n").filter(Boolean);
  const mode = ((await said()).find((line) => line.startsWith("mode ")) || (await said())[0] || "nothing").replace("mode ", "");
  const seen = { mode, window: "no window", chose: null, answer: null, opener: null };
  // A header the browser ignored would prove nothing, so where a header should isolate the page, see that it did.
  if (found.isolated) check(`${label}: the browser applied the header (the page is cross-origin isolated)`, await site.evaluate(() => crossOriginIsolated));

  const opened = site.waitForEvent("popup", { timeout: 5000 }).catch(() => null);
  await site.click("#go");
  const popup = await opened;
  if (popup) {
    await popup.waitForLoadState().catch(() => {});
    const yes = popup.locator("#yes");
    const stuck = popup.locator("h1", { hasText: /opened by a site|tab of its own/i });
    const first = await Promise.race([yes.waitFor({ timeout: 9000 }).then(() => "chooser"), stuck.waitFor({ timeout: 9000 }).then(() => "stuck")]).catch(() => "neither");
    seen.opener = await popup.evaluate(() => (window.opener ? "has opener" : "no opener")).catch(() => "unknown");
    seen.window = first === "chooser" ? "asks the person to choose" : first === "stuck" ? "says: " + (await popup.locator("h1").innerText()) : "shows: " + (await popup.locator("body").innerText().catch(() => "")).trim().slice(0, 80);
    if (first === "chooser") {
      await yes.click();
      await site.locator("#out", { hasText: /chose (true|false)/ }).waitFor({ timeout: 8000 }).catch(() => {});
    }
  }
  await site.waitForTimeout(1200);
  seen.chose = ((await said()).find((line) => /^chose|^choose-error/.test(line)) || "still waiting");
  seen.answer = await site.evaluate(async () => {
    if (!window.ai) return "no router";
    try { return (await Promise.race([window.ai.chat.completions.create({ messages: [{ role: "user", content: "hello" }] }), new Promise((_, no) => setTimeout(() => no(new Error("no answer in 6 s")), 6000))])).choices[0].message.content; }
    catch (error) { return "error: " + (error.code || error.message); }
  });
  const got = seen.answer === "An answer." ? seen.mode : "none";
  check(`${label}: ${found.what === "none" ? "the person cannot choose" : "works, by the " + found.what}`, got === found.what, `(mode ${seen.mode}; window ${seen.window}, ${seen.opener}; site heard "${seen.chose}"; prompt gave "${seen.answer}")`);
  await ctx.close();
  return seen;
}

const browser = await launchWithPartitioning(chromium);
for (const found of only) await run(browser, found);
await browser.close();

// The same plain site, in a browser that blocks third-party cookies, as Chrome does in Incognito.
if (!process.env.ONLY) {
  const strict = await launchWithPartitioning(chromium, { args: ["--test-third-party-cookie-phaseout"] });
  await run(strict, CASES[0], "third-party cookies blocked");
  await strict.close();
}

server.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
