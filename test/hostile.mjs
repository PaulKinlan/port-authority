// A hostile site: a page that embeds the AI router and does everything a page
// can do to get at the key, or at the line between the router window and the
// router frame. It taps every port and message in its own page, plants frames
// of its own where the router frame should be, reaches into the frame and the
// window, and posts forged messages to both. Then a person allows it, for five
// requests, and it sends a prompt. At the end, what it collected is searched
// for the key. Then it tries to get more than the five it was given.
// The router has no server, so there is nothing else to attack: what was
// allowed is kept in the browser, inside the router frame.
// Needs `npx wrangler dev --port 8787` running (PORT=<n> for another port).
import { createRequire } from "node:module";
import { launchWithPartitioning, keptGrant } from "./real-browser.mjs";
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
  forged.port1.postMessage({ t: "grant", grant: { id: "forged", site: location.origin, provider: "anthropic", providerName: "Anthropic", model: "x", label: "forged", requests: 100000, used: 0, tokensIn: 0, tokensOut: 0, made: Date.now(), expires: Date.now() + 365 * 86400000, last: 0, sealed: null } });
  forged.port1.postMessage({ t: "stop" });
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
await popup.selectOption("#requests", "5");
await Promise.all([popup.waitForEvent("close"), popup.click("#yes")]);
await site.locator("#out", { hasText: "chose: true" }).waitFor();
const answer = await site.evaluate(async () => (await window.ai.chat.completions.create({ messages: [{ role: "user", content: "hello" }] })).choices[0].message.content);
check("once allowed, the hostile page gets what it was allowed: an answer", answer === "An answer for the hostile site.");

// What the real frame was given, read from outside the page, to know what to search for.
const frames = site.frames().filter((f) => f.url() === base("router") + "/frame.html");
const real = frames[0];
const held = async () => { for (const f of site.frames().filter((f) => f.url() === base("router") + "/frame.html")) { const kept = await keptGrant(f, base("planner")).catch(() => null); if (kept) return kept; } return null; };
const kept = await held();
const grant = kept && kept.grant;
check("the real frame holds the grant, with the key encrypted", !!grant && grant.label === "Work key" && !!grant.sealed && !kept.text.includes(KEY), kept ? kept.fields.join(",") : "no grant found");
check("what opens the key is kept beside it, and the browser will not export it", !!kept && kept.key === "secret AES-GCM extractable=false usages=decrypt" && kept.exported === "refused", kept && kept.key);

const loot = await site.evaluate(() => window.__loot);
const all = loot.heard.join("\n");
const secrets = { "the API key": KEY, "the encrypted key": grant && grant.sealed && grant.sealed.data, "the grant's id": grant && grant.id };
for (const [name, value] of Object.entries(secrets)) check(`nothing the hostile page collected contains ${name}`, !!value && !all.includes(value), `(${loot.heard.length} messages on ${loot.ports} ports searched)`);
check("it never saw a message between the window and the frame", !/"router":"picker"|"t":"grant"|"t":"stored"|"t":"site"|"t":"stop"|sealed|"pub"|"crv"/.test(all.split("\n").filter((line) => !line.startsWith("sent-on-port") && !line.startsWith("posted-to-window")).join("\n")));
const decoys = loot.heard.filter((line) => line.includes('"decoy":true'));
check("the frames it planted were sent nothing by the router window", decoys.length === 0, decoys.join(" | ").slice(0, 200));
check("the frame did not answer its forged router window, take its forged grant, or stop for it", loot.forgedReply === undefined && grant.label !== "forged" && grant.id !== "forged" && grant.requests === 5);
check("the frame ignored its second hello", loot.secondHello === undefined);
check("the router window did not answer its forged messages", loot.windowReply === undefined);
const refused = Object.entries(loot.tried);
check("the browser refused every reach into the frame and the window", refused.length >= 6 && refused.every(([, result]) => /^refused: SecurityError$|^nothing$/.test(result)), refused.map(([name, result]) => `${name}: ${result}`).join("; "));
const kinds = [...new Set(loot.heard.filter((line) => !line.startsWith("sent-on-port") && !line.startsWith("posted-to-window")).map((line) => { try { const data = JSON.parse(line.slice(line.indexOf(" ") + 1)); return data.router ? "router:" + data.router : data.t ? "t:" + data.t : data["@hawser"] ? "hawser" : "other"; } catch { return "other"; } }))].sort();
console.log("note what the hostile page did receive, by kind: " + kinds.join(", "));

// ------------------------------------------- getting more than it was given
// It was given five requests, and has used one. With no server, the count is
// kept in the browser. The hostile page tries to change it, and to start again.
const more = await site.evaluate(async (router) => {
  const out = { own: [], answered: 0, refused: [] };
  // On its own port, messages only the router window or the frame may send.
  const line = new MessageChannel();
  line.port1.onmessage = (e) => out.own.push(e.data && e.data.t);
  const frame = [...document.querySelectorAll("iframe")].find((f) => f.src === router + "/frame.html" && !f.hasAttribute("sandbox"));
  const forged = { id: "more", site: location.origin, provider: "anthropic", providerName: "Anthropic", model: "x", label: "more", requests: 100000, used: 0, tokensIn: 0, tokensOut: 0, made: Date.now(), expires: Date.now() + 365 * 86400000, last: 0, sealed: null };
  const lent = await window.ai.lend();
  for (const port of [lent]) for (const message of [{ t: "grant", grant: forged, n: 1 }, { t: "init", site: location.origin }, { t: "current", n: 2 }, { t: "caller", provider: "anthropic" }, { t: "stop", n: 3 }]) port.postMessage(message);
  frame.contentWindow.postMessage({ t: "grant", grant: forged }, "*");
  frame.contentWindow.postMessage({ router: "picker", t: "grant", grant: forged }, "*", [line.port2]);
  // Clear everything it can clear: its own storage. The count is not in it.
  localStorage.clear(); sessionStorage.clear();
  try { for (const db of await indexedDB.databases()) indexedDB.deleteDatabase(db.name); } catch { /* none */ }
  try { for (const name of await caches.keys()) await caches.delete(name); } catch { /* none */ }
  // Start again: a second router frame, and a fresh connection through it.
  const { connect } = await import(router + "/router.js");
  const again = await connect();
  out.againLeft = again.left;
  const ask = async (ai) => { try { await ai.prompt("hello again").text(); out.answered++; return true; } catch (error) { out.refused.push(error.code); return false; } };
  // Ask through one and then the other, and both at once, until it is refused.
  for (let i = 0; i < 4; i++) { const [a, b] = await Promise.all([ask(window.ai), ask(again)]); if (!a && !b) break; }
  out.readyAfter = [window.ai.ready, again.ready];
  await new Promise((r) => setTimeout(r, 300));
  out.readyAfter = [window.ai.ready, again.ready];
  return out;
}, base("router"));
const after = await held();
check("messages for the router's own use, sent on the site's port and at the frame, changed nothing", more.own.length === 0 && more.againLeft === 4, JSON.stringify({ own: more.own, left: more.againLeft }));
check("clearing its own storage and starting again with a second frame did not reset the count", more.answered === 4 && more.refused[0] === "limit" && more.refused.every((code) => code === "limit" || code === "no-grant"), `answered ${more.answered} more, then refused with: ${more.refused.join(", ")}`);
check("so it got the five requests it was given and no more, asked for through two frames at once", more.answered + 1 === 5);
check("once used up, the grant is deleted where it was kept, with its key, and both frames tell the site", after === null && more.readyAfter.join() === "false,false", JSON.stringify({ kept: after && after.fields, ready: more.readyAfter }));

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
