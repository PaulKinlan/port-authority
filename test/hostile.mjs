// A hostile site: a page that embeds the AI router and does everything a page
// can do to get at the key, or at the line between the router window and the
// router frame. It taps every port and message in its own page, plants frames
// of its own where the router frame should be, reaches into the frame and the
// window, and posts forged messages to both. Then a person allows it, and it
// sends a prompt. At the end, what it collected is searched for the key.
// Needs `npx wrangler dev --port 8787` running (PORT=<n> for another port).
import { createRequire } from "node:module";
import { launchWithPartitioning } from "./real-browser.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const PORT = process.env.PORT || 8787;
const base = (name) => `http://${name}.localhost:${PORT}`;
// Storage partitioning has to be on, as it is in a person's own browser. Playwright switches it off.
const browser = await launchWithPartitioning(chromium);
const ctx = await browser.newContext();
await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const KEY = "sk-test-THIS-KEY-MUST-NOT-LEAK-0123456789";

await ctx.route("https://api.anthropic.com/**", (route) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  const sse = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
  route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "An answer for the hostile site." } }) + sse({ type: "message_stop" }) });
});

// The person has an account at the router.
const home = await ctx.newPage();
await home.goto(base("router") + "/");
await home.click("#add summary");
await home.fill("#label", "Work key");
await home.fill("#key", KEY);
await home.click("#form button");
await home.waitForSelector("#accounts li[data-id]");

// ------------------------------------------------------------ the hostile page
const site = await ctx.newPage();
// Before any other script runs, tap everything a page can tap in its own page:
// every message its window receives, every port it ever sees, and every message on those ports.
await site.addInitScript(() => {
  if (window !== top) return;     // a page can do this in its own page only. The test's tools could do it in the frames too, and must not.
  const loot = window.__loot = { heard: [], ports: 0, tried: {} };
  const keep = (where, data) => { try { loot.heard.push(where + " " + JSON.stringify(data)); } catch { loot.heard.push(where + " [not JSON]"); } };
  const tap = (port, where) => { if (!port || port.__tapped) return; port.__tapped = true; loot.ports++; port.addEventListener("message", (e) => { keep(where, e.data); for (const p of e.ports) tap(p, where + ">port"); }); };
  addEventListener("message", (e) => { keep("window", e.data); for (const p of e.ports) tap(p, "window>port"); }, true);
  const Real = MessageChannel;
  window.MessageChannel = function () { const ch = new Real(); tap(ch.port1, "own1"); tap(ch.port2, "own2"); return ch; };
  const send = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (data, ...rest) { keep("sent-on-port", data); return send.call(this, data, ...rest); };
  const post = window.postMessage;
  window.postMessage = function (data, ...rest) { keep("posted-to-window", data); return post.call(this, data, ...rest); };
  const open = window.open;
  window.open = function (...args) { const w = open.apply(this, args); window.__picker = w; return w; };
});
await site.goto(base("planner") + "/a-hostile-page");
await site.evaluate(async (router) => {
  const loot = window.__loot;
  // Frames of its own, put first, where the router window will look for the router frame.
  // One has this page's own origin. One has no origin. One is the real frame's address, sandboxed.
  const tapFrame = "<script>addEventListener('message', (e) => parent.postMessage({ decoy: true, got: e.data, ports: e.ports.length, from: e.origin }, '*', [...e.ports]))<\/script>";
  const own = Object.assign(document.createElement("iframe"), { srcdoc: tapFrame });
  const none = Object.assign(document.createElement("iframe"), { src: "data:text/html," + encodeURIComponent(tapFrame) });
  const boxed = Object.assign(document.createElement("iframe"), { src: router + "/frame.html" });
  boxed.setAttribute("sandbox", "allow-scripts");
  document.body.append(own, none, boxed, Object.assign(document.createElement("button"), { id: "go", textContent: "Choose" }), Object.assign(document.createElement("pre"), { id: "out" }));
  await new Promise((r) => setTimeout(r, 300));
  const { connect } = await import(router + "/router.js");
  const ai = window.ai = await connect();
  const real = [...document.querySelectorAll("iframe")].find((f) => f.src === router + "/frame.html" && !f.hasAttribute("sandbox"));
  // Reach into the frame.
  const attempt = (name, work) => { try { const got = work(); loot.tried[name] = got === undefined || got === null ? "nothing" : "GOT " + String(got).slice(0, 60); } catch (e) { loot.tried[name] = "refused: " + e.name; } };
  attempt("read the frame's document", () => real.contentDocument && real.contentDocument.body.innerHTML);
  attempt("read the frame's storage", () => real.contentWindow.localStorage.length);
  attempt("listen on the frame's window", () => { real.contentWindow.addEventListener("message", (e) => loot.heard.push("frame-window " + JSON.stringify(e.data))); return "listening"; });
  attempt("replace the frame's postMessage", () => { real.contentWindow.postMessage = () => {}; return real.contentWindow.postMessage.toString().includes("=>") ? "replaced" : undefined; });
  attempt("read the frame's worker", () => real.contentWindow.Worker && "worker constructor");
  // Pretend to be the router window: ask the frame which site this is, and offer it a grant.
  const forged = new MessageChannel();
  forged.port1.onmessage = (e) => { loot.forgedReply = e.data; };
  real.contentWindow.postMessage({ router: "picker" }, "*", [forged.port2]);
  forged.port1.postMessage({ t: "grant", grant: { site: location.origin, provider: "anthropic", model: "x", label: "forged", person: "p", id: "i", secret: "s".repeat(24), sealed: null }, info: { requests: 99, used: 0 } });
  // Say hello a second time, with another port, to get a second line into the worker.
  const second = new MessageChannel();
  second.port1.onmessage = (e) => { loot.secondHello = e.data; };
  real.contentWindow.postMessage({ router: "hello" }, "*", [second.port2]);
  document.getElementById("go").onclick = async () => {
    const chose = ai.choose();
    // The window is open. Reach into it, and post forged messages at it while the person decides.
    const w = window.__picker;
    const poke = setInterval(() => {
      try { loot.tried["read the window's document"] = "GOT " + w.document.title; } catch (e) { loot.tried["read the window's document"] = "refused: " + e.name; }
      try { loot.tried["read the window's storage"] = "GOT " + w.localStorage.length; } catch (e) { loot.tried["read the window's storage"] = "refused: " + e.name; }
      try {
        const line = new MessageChannel();
        line.port1.onmessage = (e) => { loot.windowReply = e.data; };
        w.postMessage({ router: "hello" }, "*", [line.port2]);
        w.postMessage({ t: "site", site: "https://bank.example", current: null }, "*");
        w.postMessage({ t: "stored" }, "*");
      } catch { /* closed */ }
    }, 150);
    document.getElementById("out").textContent = "chose: " + await chose;
    clearInterval(poke);
  };
  document.title = "ready";
}, base("router"));
await site.waitForFunction(() => document.title === "ready");
check("the hostile page still gets the router's frame, and is told nothing but that it has no model", (await site.evaluate(() => window.ai.mode)) === "frame" && (await site.evaluate(() => window.ai.ready)) === false);

// The person allows it. The window names the hostile page by its real address.
const [popup] = await Promise.all([site.waitForEvent("popup"), site.click("#go")]);
await popup.waitForSelector("#yes");
check("the router window shows the hostile page's real address, not the one it posted", (await popup.locator(".origin").innerText()) === base("planner"), await popup.locator(".origin").innerText());
check("the router window offers the person's real account, and not the forged grant", /Work key/.test(await popup.locator("#choices").innerText()) && !/forged/.test(await popup.locator("#main").innerText()));
await popup.waitForTimeout(600);    // let the forged messages keep arriving while the window is open
await Promise.all([popup.waitForEvent("close"), popup.click("#yes")]);
await site.locator("#out", { hasText: "chose: true" }).waitFor();
const answer = await site.evaluate(async () => (await window.ai.chat.completions.create({ messages: [{ role: "user", content: "hello" }] })).choices[0].message.content);
check("once allowed, the hostile page gets what it was allowed: an answer", answer === "An answer for the hostile site.");

// What the real frame was given, read from outside the page, to know what to search for.
const frames = site.frames().filter((f) => f.url() === base("router") + "/frame.html");
let grant = null;
for (const f of frames) { const kept = await f.evaluate((key) => { try { return localStorage.getItem(key); } catch { return null; } }, "router.grant:" + base("planner")).catch(() => null); if (kept) grant = JSON.parse(kept); }
check("the real frame holds the grant, with the key encrypted", !!grant && grant.label === "Work key" && !!grant.sealed && !JSON.stringify(grant).includes(KEY), grant ? Object.keys(grant).join(",") : "no grant found");

const loot = await site.evaluate(() => window.__loot);
const all = loot.heard.join("\n");
const secrets = { "the API key": KEY, "the grant's secret": grant && grant.secret, "the encrypted key": grant && grant.sealed && grant.sealed.data, "the grant's id": grant && grant.id };
for (const [name, value] of Object.entries(secrets)) check(`nothing the hostile page collected contains ${name}`, !!value && !all.includes(value), `(${loot.heard.length} messages on ${loot.ports} ports searched)`);
check("it never saw a message between the window and the frame", !/"router":"picker"|"t":"grant"|"t":"stored"|"t":"site"|sealed|"wrap"/.test(all.split("\n").filter((line) => !line.startsWith("sent-on-port") && !line.startsWith("posted-to-window")).join("\n")));
const decoys = loot.heard.filter((line) => line.includes('"decoy":true'));
check("the frames it planted were sent nothing by the router window", decoys.length === 0, decoys.join(" | ").slice(0, 200));
check("the frame did not answer its forged router window, or take its forged grant", loot.forgedReply === undefined && grant.label !== "forged");
check("the frame ignored its second hello", loot.secondHello === undefined);
check("the router window did not answer its forged messages", loot.windowReply === undefined);
const refused = Object.entries(loot.tried);
check("the browser refused every reach into the frame and the window", refused.length >= 6 && refused.every(([, result]) => /^refused: SecurityError$|^nothing$/.test(result)), refused.map(([name, result]) => `${name}: ${result}`).join("; "));
const kinds = [...new Set(loot.heard.filter((line) => !line.startsWith("sent-on-port") && !line.startsWith("posted-to-window")).map((line) => { try { const data = JSON.parse(line.slice(line.indexOf(" ") + 1)); return data.router ? "router:" + data.router : data.t ? "t:" + data.t : data["@hawser"] ? "hawser" : "other"; } catch { return "other"; } }))].sort();
console.log("note what the hostile page did receive, by kind: " + kinds.join(", "));

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
