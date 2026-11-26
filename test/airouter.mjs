// The AI router, end to end: a site asks for a model, the person picks one in
// the router window, the site gets a port, and the key never reaches the site.
// Needs `npx wrangler dev --port 8787` running (PORT=<n> for another port), or LIVE=<workers.dev subdomain>.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { launchWithPartitioning, keptGrant, callers, keptAccounts } from "./real-browser.mjs";
const LIVE = process.env.LIVE;
const base = (name) => LIVE ? (name === "hub" && process.env.LIVE_MAIN) || `https://${name === "hub" ? "portauthority" : "pa-" + name}.${LIVE}` : `http://${name}.localhost:${process.env.PORT || 8787}`;
// Storage partitioning has to be on, as it is in a person's own browser. Playwright switches it off.
const browser = await launchWithPartitioning(chromium, process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
const ctx = await browser.newContext();
// The pages ask for web fonts. The tests do not wait on another network for them.
await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
const errors = [];
// Everything that is sent to the router's own server, to look for a key in it afterwards.
const toServer = [];
ctx.on("request", (request) => { if (new URL(request.url()).host === new URL(base("router")).host) toServer.push(request.method() + " " + request.url() + " " + (request.postData() || "")); });
ctx.on("page", (p) => { p.on("pageerror", (e) => errors.push(`${p.url()}: ${e.message}`)); });
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const popupFrom = async (page, click) => { const [popup] = await Promise.all([page.waitForEvent("popup"), click()]); await popup.waitForLoadState(); return popup; };
const KEY = "sk-test-THIS-KEY-MUST-NOT-LEAK-0123456789";
// In the router window an account is a group, and its models are the choices inside it.
const pickModel = (popup, account, model) => popup.locator("#choices .account", { hasText: account }).locator("label", { hasText: model }).click();
const KEY2 = "sk-spare-THIS-ONE-MUST-NOT-LEAK-EITHER-9876543210";
// A call to a provider is made by the router's call worker. The browser files a worker's request under the page
// that started it, so a call is "by the router" when it comes from the router frame or the router's own page.
const byRouter = (call) => !!call && [base("router") + "/frame.html", base("router") + "/", base("router") + "/pick.html#window"].includes(call.from);
const callerUrls = async (page) => (await callers(page)).map((c) => c.url()).join();

// A stand-in for Anthropic: answers the streaming Messages API and records the key it was sent.
const seen = [];
await ctx.route("https://api.anthropic.com/**", async (route) => {
  const request = route.request();
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } });
  seen.push({ key: request.headers()["x-api-key"], body: JSON.parse(request.postData()), from: request.frame().url() });
  const sse = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
  const body = sse({ type: "message_start", message: { usage: { input_tokens: 21 } } })
    + ["Dear Ada, ", "well done ", "on passing."].map((text) => sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })).join("")
    + sse({ type: "message_delta", usage: { output_tokens: 9 } }) + sse({ type: "message_stop" });
  if (request.headers()["x-api-key"] !== KEY) return route.fulfill({ status: 401, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: JSON.stringify({ error: { message: "invalid x-api-key" } }) });
  route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "text/event-stream" }, body });
});

// A stand-in for OpenAI: answers the streaming Chat Completions API. A prompt
// that says "slowly" is kept waiting, so that a test can stop it.
const seenOpenAI = [];
await ctx.route("https://api.openai.com/**", async (route) => {
  const request = route.request();
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  const body = JSON.parse(request.postData());
  seenOpenAI.push({ key: request.headers()["authorization"], body, from: request.frame().url(), path: new URL(request.url()).pathname });
  const last = body.messages.at(-1);
  if (/slowly/.test(String(last.content))) await new Promise((resolve) => setTimeout(resolve, 2500));
  const data = (o) => `data: ${JSON.stringify(o)}\n\n`;
  const delta = (d, finish_reason = null) => data({ choices: [{ index: 0, delta: d, finish_reason }] });
  const usage = data({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 6 } }) + "data: [DONE]\n\n";
  // Given tools and a question, it asks for the first tool. Given the tool's result, it answers with it.
  const answer = body.tools && last.role === "user"
    ? delta({ role: "assistant", content: "" }) + delta({ tool_calls: [{ index: 0, id: "call_stand_in", type: "function", function: { name: body.tools[0].function.name, arguments: "" } }] })
      + delta({ tool_calls: [{ index: 0, function: { arguments: '{"town":' } }] }) + delta({ tool_calls: [{ index: 0, function: { arguments: '"Hull"}' } }] }) + delta({}, "tool_calls") + usage
    : last.role === "tool" ? delta({ content: "The tool said: " }) + delta({ content: String(last.content) }) + delta({}, "stop") + usage
    : ["A note ", "from the ", "stand-in."].map((content) => delta({ content })).join("") + usage;
  if (request.headers()["authorization"] !== "Bearer " + KEY2) return route.fulfill({ status: 401, headers: cors, contentType: "application/json", body: JSON.stringify({ error: { message: "Incorrect API key provided" } }) }).catch(() => {});
  route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: answer }).catch(() => {});   // the page may have stopped waiting
});

// The person has the router's own page open, and no account yet.
const home = await ctx.newPage();
await home.goto(base("router") + "/");
await home.locator("#accounts li").first().waitFor();
check("the router's page offers no model of its own", !/practice/i.test(await home.locator("#main").innerText()) && /None yet/.test(await home.locator("#accounts").innerText()));

// Everything the florist page receives from anywhere is recorded, to look for the key afterwards.
const florist = await ctx.newPage();
await florist.addInitScript(() => {
  window.__heard = [];
  const keep = (data) => { try { window.__heard.push(JSON.stringify(data)); } catch { /* not JSON */ } };
  addEventListener("message", (e) => keep(e.data), true);
  const add = MessagePort.prototype.addEventListener;
  const desc = Object.getOwnPropertyDescriptor(MessagePort.prototype, "onmessage");
  Object.defineProperty(MessagePort.prototype, "onmessage", { set(fn) { desc.set.call(this, fn && ((e) => { keep(e.data); return fn.call(this, e); })); }, get() { return desc.get.call(this); } });
  MessagePort.prototype.addEventListener = function (type, fn, opts) { return add.call(this, type, type === "message" ? (e) => { keep(e.data); return fn.call(this, e); } : fn, opts); };
});
await florist.goto(base("florist") + "/card/");
await florist.waitForSelector("#choose:not([disabled])");
check("a site with no grant has no model", /No model yet/.test(await florist.locator("#state").innerText()) && (await florist.locator("#write").isDisabled()));

// With no account there is nothing to choose, and the router window says so.
let popup = await popupFrom(florist, () => florist.click("#choose"));
await popup.waitForSelector("#no");
check("the router window names the site that asked", (await popup.locator(".origin").innerText()) === base("florist"));
if ((await popup.locator("#yes").count()) === 0) {
  check("with no account, the router window has nothing to allow and says to add one", /no account/.test(await popup.locator("#main").innerText())
    && (await popup.locator("input[name=choice]").count()) === 0 && (await popup.locator('#main a[href="/#add"]').count()) === 1 && (await popup.locator("input, textarea").count()) === 0, (await popup.locator("#main").innerText()).replace(/\n+/g, " | "));
} else console.log("note this browser has a built-in model, so the router window had something to offer before any account was added");

// The person adds an account at the router's own address, while that window is open.
await home.click("#add summary");
await home.fill("#label", "Work key");
await home.fill("#key", KEY);
await home.click("#form button");
await home.waitForSelector("#accounts li[data-id]");
check("an account is saved at the router", /Work key/.test(await home.locator("#accounts").innerText()));
await home.click("#accounts [data-test]");
await home.locator("#accounts", { hasText: "It answered" }).waitFor();   // not waitForFunction: the router pages forbid eval
check("the router's home page can test the key", /Dear Ada/.test(await home.locator("#accounts").innerText()));
// How the key is kept at the router's own address: encrypted, beside a key the browser will use and will not export.
let atRest = await keptAccounts(home);
check("the key is not kept as text anywhere at the router's address: only its last four characters are", !atRest.plain.includes(KEY) && atRest.listed.length === 1 && atRest.listed[0].ends === KEY.slice(-4) && !("key" in atRest.listed[0]) && /key ends 6789/.test(await home.locator("#accounts").innerText()), atRest.plain.slice(0, 160));
check("it is kept encrypted, beside a key that the browser will not export", atRest.secrets.length === 1 && !atRest.secrets[0].text.includes(KEY) && !!atRest.secrets[0].sealed.data && atRest.secrets[0].exported === "refused" && atRest.secrets[0].key === "secret AES-GCM extractable=false usages=decrypt,encrypt,unwrapKey,wrapKey", atRest.secrets[0] && atRest.secrets[0].key + ", export " + atRest.secrets[0].exported);
check("and the test of the key was made with that: the call carried the real key", seen.at(-1).key === KEY);
// An account from before, when keys were kept as text, is encrypted the next time the router's page is opened.
await home.evaluate((old) => localStorage.setItem("router.accounts", JSON.stringify([...JSON.parse(localStorage.getItem("router.accounts")), old])), { id: "from-before", provider: "anthropic", label: "From before", key: "sk-old-KEPT-AS-TEXT-0000111122223333", models: ["claude-sonnet-5-5"] });
await home.reload();
await home.locator("#accounts li", { hasText: "From before" }).waitFor();
await home.locator("#accounts li", { hasText: "From before" }).locator("[data-test]").click();
// The stand-in for the provider knows one key and refuses any other. Being refused shows the old key reached it whole.
await home.locator("#accounts li", { hasText: "From before" }).filter({ hasText: "answered 401" }).waitFor();
atRest = await keptAccounts(home);
check("an account that was kept as text is encrypted when the router's page is next opened, and its key still reaches the provider whole", !atRest.plain.includes("sk-old-KEPT-AS-TEXT") && atRest.secrets.length === 2 && atRest.secrets.every((kept) => kept.exported === "refused") && seen.at(-1).key === "sk-old-KEPT-AS-TEXT-0000111122223333" && /key ends 3333/.test(await home.locator("#accounts").innerText()), atRest.plain.slice(0, 200));
home.once("dialog", (dialog) => dialog.accept());
await home.locator("#accounts li", { hasText: "From before" }).locator("[data-remove]").click();
await home.locator("#accounts li", { hasText: "From before" }).waitFor({ state: "detached" });
check("removing an account removes its key too", (await keptAccounts(home)).secrets.length === 1);

// And a second account, with another provider.
await home.click("#add summary");
await home.selectOption("#provider", "openai");
await home.fill("#label", "Spare key");
await home.fill("#key", KEY2);
await home.click("#form button");
await home.locator("#accounts li[data-id]").nth(1).waitFor();
await home.locator("#accounts li", { hasText: "Spare key" }).locator("[data-test]").click();
await home.locator("#accounts li", { hasText: "Spare key" }).locator("text=It answered").waitFor();
check("the home page can test the second account, and the call goes to its provider from the page for that provider", /A note from the stand-in/.test(await home.locator("#accounts li", { hasText: "Spare key" }).innerText())
  && byRouter(seenOpenAI.at(-1)) && seenOpenAI.at(-1).path === "/v1/chat/completions" && seenOpenAI.at(-1).body.model === "gpt-6.2-sol" && seenOpenAI.at(-1).body.stream === true, seenOpenAI.at(-1) && seenOpenAI.at(-1).from);

// The window that was open shows the accounts as soon as they are saved. Don't allow: nothing changes.
await popup.locator("#choices", { hasText: "Spare key" }).waitFor();
const offered = await popup.locator("#choices").innerText();
check("the router window has nowhere to type a key: accounts are added at the router's own page only", (await popup.locator("input[type=password], input[type=text], textarea, #key").count()) === 0 && /never asks for an API key/.test(await popup.locator("#main").innerText()) && (await popup.locator('#main a[href="/#add"]').count()) === 1);
check("the router window lists both accounts, and nothing that is not an account", /Work key/.test(offered) && /Spare key/.test(offered) && !/practice|not a real model/i.test(await popup.locator("#main").innerText()));
const groups = await popup.locator("#choices .account").evaluateAll((all) => all.map((group) => ({
  name: group.querySelector(".account-name strong").textContent, about: group.querySelector(".account-name span").textContent, models: [...group.querySelectorAll("label")].map((label) => label.textContent.trim()) })));
check("each account is shown by the name it was given, with its provider and the end of its key, apart from its models", groups.length === 2
  && groups[0].name === "Work key" && groups[0].about === "Anthropic, key ends " + KEY.slice(-4) && groups[0].models[0] === "claude-sonnet-5-5" && groups[0].models.length === 4
  && groups[1].name === "Spare key" && groups[1].about === "OpenAI, key ends " + KEY2.slice(-4) && groups[1].models[0] === "gpt-6.2-sol" && !groups.some((g) => g.models.some((m) => /key/i.test(m))), JSON.stringify(groups));
await popup.click("#no");
await florist.waitForFunction(() => /closed without a grant/.test(document.querySelector("#log").textContent));
check("refusing leaves the site with no model", /No model yet/.test(await florist.locator("#state").innerText()));

// Allow, with a limit of 5 requests.
popup = await popupFrom(florist, () => florist.click("#choose"));
await popup.waitForSelector("#yes");
await popup.selectOption("#requests", "5");
check("the router window says where the prompts can go", /prompts to api\.anthropic\.com\./.test(await popup.locator("#lock").innerText()), await popup.locator("#lock").innerText());
await pickModel(popup, "Spare key", "gpt-6.2-sol");
check("and says so for the other account when that one is ticked", /prompts to api\.openai\.com\./.test(await popup.locator("#lock").innerText()) && !/anthropic/.test(await popup.locator("#lock").innerText()), await popup.locator("#lock").innerText());
await pickModel(popup, "Work key", "claude-sonnet-5-5");
await Promise.all([popup.waitForEvent("close"), popup.click("#yes")]);
await florist.waitForSelector("#write:not([disabled])");
check("after allowing, the site is told the model's name", /Using Work key · claude-sonnet-5-5, 5 requests left/.test(await florist.locator("#state").innerText()), await florist.locator("#state").innerText());

await florist.click("#write");
await florist.waitForFunction(() => /pieces/.test(document.querySelector("#log").textContent));
check("the answer streams into the site", (await florist.locator("#card").innerText()) === "Dear Ada, well done on passing.");
check("the provider was called with the person's key", seen.at(-1).key === KEY && seen.at(-1).body.model === "claude-sonnet-5-5" && seen.at(-1).body.stream === true);
check("the call was made by the router's worker for that one provider, not by the site", byRouter(seen.at(-1)) && (await callerUrls(florist)) === base("router") + "/call-worker/anthropic.js", seen.at(-1).from + " " + (await callerUrls(florist)));
check("the site saw how many requests are left", /4 requests left/.test(await florist.locator("#state").innerText()));

// The site cannot get at the key: not in any message, not in its storage, not by reaching into the frame.
const leak = await florist.evaluate((key) => {
  const store = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie;
  let reach = "blocked";
  try { reach = String(document.querySelector("iframe").contentWindow.localStorage.length); } catch { /* cross-origin */ }
  return { heard: window.__heard.join("\n").includes(key), heardAny: window.__heard.length, store: store.includes(key), reach };
}, KEY);
check("no message the site received contains the key", !leak.heard && leak.heardAny > 3, `(${leak.heardAny} messages checked)`);
check("the site's own storage does not contain the key", !leak.store);
// The grant goes from the router window to the router frame on a port the window makes. The site
// embeds the frame and opens the window, and holds no end of that port. So it hears none of it.
const heard = await florist.evaluate(() => {
  const all = window.__heard.map((text) => { try { return JSON.parse(text); } catch { return null; } }).filter(Boolean);
  const kinds = [...new Set(all.map((m) => (m.router ? "router:" + m.router : m.t ? "t:" + m.t : "other")))].sort();
  return { kinds, handover: window.__heard.filter((text) => /"router":"picker"|"t":"grant"|"t":"site"|"t":"stored"|"sealed"|"wrap"|"secret"/.test(text)).length };
});
check("the site heard nothing of the handover between the window and the frame", heard.handover === 0 && heard.kinds.includes("router:frame-ready") && heard.kinds.includes("t:state") && heard.kinds.includes("t:text"), "it heard only: " + heard.kinds.join(", "));
check("the site cannot read the frame's storage", leak.reach === "blocked");
const frame = florist.frames().find((f) => f.url().includes("/frame.html"));
const stored = await keptGrant(frame, base("florist"));
if (process.env.DEBUG) console.log(stored);
check("the frame keeps the grant in its own storage for this site, with the key encrypted", !!stored && !stored.text.includes(KEY) && !!stored.grant.sealed && !!stored.grant.sealed.data && !("from" in stored.grant.sealed), stored ? stored.fields.join(",") : "no grant kept");
check("what opens the key is a key the browser will not export, and it can only decrypt", !!stored && stored.key === "secret AES-GCM extractable=false usages=decrypt" && stored.exported === "refused", stored && stored.key + ", export " + stored.exported);
check("the frame keeps nothing that came from a server: no id for the person, and no secret to show one", !!stored && !stored.fields.some((f) => /person|secret|wrap|owner/.test(f)) && (await frame.evaluate(() => Object.keys(localStorage).length)) === 0, stored && stored.fields.join(","));

// The router's pages may connect to nothing at all. The one page that calls
// a provider may connect only to the provider named in its address.
// The router's own pages can no longer fetch anything, so the test asks for the headers itself.
// Node does not look up names under .localhost, so locally it asks the loopback address by that name.
const header = async (path) => {
  if (LIVE) return (await fetch(base("router") + path)).headers.get("content-security-policy") || "";
  const { default: http } = await import("node:http");
  const at = new URL(base("router"));
  return new Promise((resolve, reject) => http.get({ host: "127.0.0.1", port: at.port, path, headers: { host: at.host } }, (response) => { response.resume(); resolve(response.headers["content-security-policy"] || ""); }).on("error", reject));
};
const connect = (csp) => (csp.split("; ").find((part) => part.startsWith("connect-src ")) || "").slice(12);
const csp = await header("/frame.html");
check("the router frame is served with a content security policy", /default-src 'none'/.test(csp) && !/unsafe/.test(csp), csp.slice(0, 60));
check("the router frame may connect to nothing", connect(csp) === "'none'", connect(csp));
check("nor may the router's own page, the router window, or the worker", connect(await header("/")) === "'none'" && connect(await header("/pick.html")) === "'none'" && connect(await header("/frame-worker.js")) === "'none'");
check("the worker that calls Anthropic is sent with a policy that allows Anthropic's one chat address and nothing else", (await header("/call-worker/anthropic.js")) === "default-src 'none'; script-src 'self'; connect-src https://api.anthropic.com/v1/messages" && (await header("/call-worker/openai.js")) === "default-src 'none'; script-src 'self'; connect-src https://api.openai.com/v1/chat/completions", await header("/call-worker/anthropic.js"));
check("the page that calls Anthropic, for a browser with no such worker, may connect to Anthropic's one chat address and nothing else", connect(await header("/call/anthropic")) === "https://api.anthropic.com/v1/messages", connect(await header("/call/anthropic")));
check("the page that calls OpenAI may connect to OpenAI's one chat address and nothing else", connect(await header("/call/openai")) === "https://api.openai.com/v1/chat/completions");
check("a call page for an unknown provider, or at the old address, may connect to nothing", connect(await header("/call/example.com")) === "'none'" && connect(await header("/call.html")) === "'none'" && connect(await header("/call.html?provider=anthropic")) === "'none'");
const tryFetch = (where, address) => where.evaluate((a) => fetch(a, { mode: "no-cors" }).then(() => "allowed", () => "blocked"), address);
const before = seen.length;
check("the router frame cannot connect to another address", (await tryFetch(frame, "https://example.com/")) === "blocked");
check("the router frame cannot connect to the router's own server either", (await tryFetch(frame, "/_sites.js")) === "blocked" && (await tryFetch(frame, "/r/aaaaaaaaaaaaaaaaaaaaaaaa/list")) === "blocked");
const frameWorker = florist.workers().find((w) => w.url().endsWith("/frame-worker.js"));
check("the worker inside the frame cannot connect to anything", !!frameWorker && (await tryFetch(frameWorker, "/_sites.js")) === "blocked" && (await tryFetch(frameWorker, "https://example.com/")) === "blocked" && (await tryFetch(frameWorker, "https://api.anthropic.com/v1/messages")) === "blocked" && seen.length === before);
check("the router frame cannot connect to the provider itself", (await tryFetch(frame, "https://api.anthropic.com/v1/messages")) === "blocked" && seen.length === before);
const callWorker = florist.workers().find((w) => w.url() === base("router") + "/call-worker/anthropic.js");
check("the calls are made by a worker for that one provider, and no page is opened to make them", !!callWorker && !florist.frames().some((f) => f.url().includes("/call/")), (await callerUrls(florist)));
check("the call worker cannot connect to any other address at that provider", (await tryFetch(callWorker, "https://api.anthropic.com/v1/models")) === "blocked" && (await tryFetch(callWorker, "https://api.anthropic.com/v1/messages/batches")) === "blocked"
  && (await tryFetch(callWorker, "https://api.anthropic.com/")) === "blocked" && seen.length === before);
check("the call worker cannot connect to another provider", (await tryFetch(callWorker, "https://api.openai.com/v1/models")) === "blocked");
check("the call worker cannot connect to another address", (await tryFetch(callWorker, "https://example.com/")) === "blocked");
// Things a script could be talked into doing to carry a key out. A worker has no document, so most are not there to try.
const tried = await callWorker.evaluate(async () => {
  const stopped = [];
  addEventListener("securitypolicyviolation", (event) => stopped.push(event.effectiveDirective + " " + event.blockedURI + " | " + event.originalPolicy));
  const out = {};
  // Asked for from a timer: code run straight from the test's own tools is let through, as it is from DevTools.
  out.evaled = await new Promise((resolve) => setTimeout(() => { try { new Function("return 1")(); resolve(true); } catch { resolve(false); } }, 0));
  out.imported = await import("https://example.com/x.js").then(() => true, () => false);
  try { new WebSocket("wss://example.com/"); } catch { /* the report says why */ }
  out.has = { document: typeof document, Image: typeof Image, open: typeof self.open, sendBeacon: typeof navigator.sendBeacon, assign: typeof location.assign, frames: typeof self.frames, parent: typeof self.parent };
  await new Promise((resolve) => setTimeout(resolve, 400));
  out.stopped = stopped;
  return out;
});
check("the call worker cannot be made to run other code: no eval, and no script from elsewhere", tried.evaled === false && tried.imported === false && tried.stopped.some((line) => /^script-src/.test(line)), JSON.stringify(tried).slice(0, 300));
check("it has no page to carry a key out with: no document, no image, no window to open, no address to go to, no beacon", Object.values(tried.has).every((kind) => kind === "undefined") && tried.stopped.some((line) => /^connect-src wss:\/\/example\.com/.test(line)), JSON.stringify(tried.has));
check("and it is held to the policy on its own script, which names one address, not to the frame's", tried.stopped.length > 0 && tried.stopped.every((line) => line.endsWith("| default-src 'none'; script-src 'self'; connect-src https://api.anthropic.com/v1/messages")), tried.stopped[0]);
check("the router frame around it has no styles, fonts or images to load from anywhere, and cannot hold a frame from another site", !/style-src|font-src|img-src|https?:/.test(csp) && /frame-src 'self'/.test(csp), csp);
check("the call worker cannot connect to the router's server", (await tryFetch(callWorker, "/_sites.js")) === "blocked");
check("the site's requests go through a worker inside the frame", florist.workers().some((w) => w.url().endsWith("/frame-worker.js")));

// The site lends a port to an iframe from a third site, limited to 2 requests.
await florist.click("#lend");
const widget = florist.frameLocator("#widget");
await widget.locator("#go:not([disabled])").waitFor();
for (let i = 1; i <= 3; i++) {
  await widget.locator("#go").click();
  await widget.locator("#state", { hasText: `Request ${i}` }).waitFor();
}
check("an iframe from another site answers with the port it was lent, then stops at its limit", /Request 3 was refused: This port was lent/.test(await widget.locator("#state").innerText()) && (await widget.locator("#tag").innerText()) === "", await widget.locator("#state").innerText());

// A reload needs no window.
await florist.reload();
await florist.waitForSelector("#write:not([disabled])");
check("after a reload the site still has its model, with no window", /Using Work key/.test(await florist.locator("#state").innerText()) && /already had a grant/.test(await florist.locator("#log").innerText()));

// The same model in the shape of the Chat Completions API, as a site would call it.
const routed = await florist.evaluate(async (router) => {
  const { connect } = await import(router + "/router.js");
  const ai = await connect();
  const stream = await ai.chat.completions.create({
    model: "some-other-model", stream: true, stream_options: { include_usage: true }, temperature: 0.2, stop: "END", max_tokens: 99,
    messages: [{ role: "system", content: "You write cards." }, { role: "user", content: [{ type: "text", text: "A card for Ada" }] }],
  });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}, base("router"));
check("a site can ask in the shape of the Chat Completions API and read chunks", routed.length === 6 && routed.every((c) => c.object === "chat.completion.chunk" && /^chatcmpl-/.test(c.id))
  && routed[0].choices[0].delta.role === "assistant" && routed.slice(1, 4).map((c) => c.choices[0].delta.content).join("") === "Dear Ada, well done on passing." && routed[4].choices[0].finish_reason === "stop", JSON.stringify(routed).slice(0, 120));
check("the chunks name the model the person chose, and the last one carries the usage", routed.every((c) => c.model === "claude-sonnet-5-5") && JSON.stringify(routed[5].usage) === JSON.stringify({ prompt_tokens: 21, completion_tokens: 9, total_tokens: 30 }) && routed[5].choices.length === 0);
const sent = seen.at(-1);
check("the request reached the provider with the site's settings", sent.body.model === "claude-sonnet-5-5" && sent.body.system === "You write cards." && sent.body.temperature === 0.2 && sent.body.max_tokens === 99
  && JSON.stringify(sent.body.stop_sequences) === '["END"]' && JSON.stringify(sent.body.messages) === JSON.stringify([{ role: "user", content: "A card for Ada" }]), JSON.stringify(sent.body));
check("that call was also made by the router's worker for the one provider, with the key the site never sees", byRouter(sent) && sent.key === KEY && !JSON.stringify(routed).includes(KEY));

// Another site has no grant, even though the same frame is used.
const library = await ctx.newPage();
await library.goto(base("library") + "/digest/");
await library.waitForSelector("#choose:not([disabled])");
check("a second site does not inherit the first site's grant", /No model yet/.test(await library.locator("#state").innerText()));
popup = await popupFrom(library, () => library.click("#choose"));
await popup.waitForSelector("#yes");
await pickModel(popup, "Spare key", "gpt-6.2-sol");
await Promise.all([popup.waitForEvent("close"), popup.click("#yes")]);
await library.waitForSelector("#run:not([disabled])");
check("the second site was given the other account", /Using Spare key · gpt-6\.2-sol/.test(await library.locator("#state").innerText()), await library.locator("#state").innerText());
const anthropicCalls = seen.length, openaiCalls = seenOpenAI.length;

// A worker is handed a port and does the work.
await library.click("#run");
await library.waitForFunction(() => /worker finished/.test(document.querySelector("#log").textContent), null, { timeout: 60000 });
const notes = await library.locator("#notes p").allInnerTexts();
check("a worker holding a port wrote a note for all four books", notes.length === 4 && notes.every((n) => /A note from the stand-in\./.test(n)), notes[0]);
const libraryCalls = seenOpenAI.slice(openaiCalls);
check("the second site's prompts went to its provider and not to the first site's", libraryCalls.length === 4 && seen.length === anthropicCalls
  && libraryCalls.every((c) => byRouter(c) && c.key === "Bearer " + KEY2 && c.body.model === "gpt-6.2-sol"), libraryCalls[0] && libraryCalls[0].from);
const libraryCaller = library.workers().find((w) => w.url() === base("router") + "/call-worker/openai.js");
check("the second site's call worker is for its own provider, and cannot connect to the first site's", !!libraryCaller && (await callerUrls(library)) === base("router") + "/call-worker/openai.js" && (await tryFetch(libraryCaller, "https://api.anthropic.com/v1/messages")) === "blocked" && seen.length === anthropicCalls, (await callerUrls(library)));

// A port lent for 3 requests stops at 3.
await library.click("#lend");
for (let i = 1; i <= 4; i++) {
  await library.click("#ask");
  await library.waitForFunction((n) => new RegExp(`Request ${n}(:| was refused)`).test(document.querySelector("#lent").textContent) && !/Request \d+: sent\./.test(document.querySelector("#lent").textContent), i, { timeout: 30000 });
}
const lent = await library.locator("#lent").innerText();
check("a port lent for 3 requests answers 3", /Request 3: A note from the stand-in\./.test(lent));
check("and refuses the fourth", /Request 4 was refused: This port was lent/.test(lent), lent.split("\n")[0]);

// Chat Completions on the second site: a whole answer, an image, a tool call, a refusal, a lent port and a stop.
const plain = await library.evaluate(async (router) => {
  const { connect, fromPort } = await import(router + "/router.js");
  const ai = await connect();
  const caught = async (work) => { try { await work(); return null; } catch (e) { return { name: e.name, message: e.message, code: e.code, status: e.status, param: e.param, type: e.type }; } };
  const hello = [{ role: "user", content: "Hello there" }];
  const answer = await ai.chat.completions.create({ messages: hello, temperature: 0.4, top_p: 0.5, stop: ["X", "Y"], max_completion_tokens: 123 });
  const refused = await caught(() => ai.chat.completions.create({ messages: hello, response_format: { type: "json_object" } }));
  // A tool: the model asks for it, this site runs it, and sends the result back. An image goes with the question.
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
  const tools = [{ type: "function", function: { name: "get_weather", description: "The weather in a town.", parameters: { type: "object", properties: { town: { type: "string" } }, required: ["town"] } } }];
  const question = { role: "user", content: [{ type: "text", text: "What is the weather where this was taken?" }, { type: "image_url", image_url: { url: PNG } }] };
  const asked = await ai.chat.completions.create({ messages: [question], tools, tool_choice: "auto" });
  const call = asked.choices[0].message.tool_calls[0];
  const result = "raining in " + JSON.parse(call.function.arguments).town;       // this site runs the tool. The router does not.
  const told = await ai.chat.completions.create({ messages: [question, asked.choices[0].message, { role: "tool", tool_call_id: call.id, content: result }], tools });
  const deltas = [];
  for await (const chunk of await ai.chat.completions.create({ messages: [question], tools, stream: true })) deltas.push(chunk.choices[0]);
  const lent = fromPort(await ai.lend({ requests: 1 }));
  await lent.started;
  const first = await lent.chat.completions.create({ messages: hello });
  const second = await caught(() => lent.chat.completions.create({ messages: hello }));
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 300);
  const stopped = await caught(() => ai.chat.completions.create({ messages: [{ role: "user", content: "Answer slowly" }] }, { signal: stop.signal }));
  return { answer, refused, first: first.choices[0].message.content, second, stopped, PNG, asked: asked.choices[0], told: told.choices[0], deltas };
}, base("router"));
check("without stream, the site gets a whole chat.completion object", plain.answer.object === "chat.completion" && plain.answer.model === "gpt-6.2-sol" && plain.answer.choices[0].message.role === "assistant"
  && plain.answer.choices[0].message.content === "A note from the stand-in." && plain.answer.choices[0].finish_reason === "stop" && plain.answer.usage.prompt_tokens === 12 && plain.answer.usage.total_tokens === 18, JSON.stringify(plain.answer).slice(0, 100));
const tuned = seenOpenAI.find((c) => c.body.temperature === 0.4);
check("the site's settings reached a provider that speaks Chat Completions", !!tuned && tuned.body.top_p === 0.5 && JSON.stringify(tuned.body.stop) === '["X","Y"]' && tuned.body.max_completion_tokens === 123
  && JSON.stringify(tuned.body.messages) === JSON.stringify([{ role: "user", content: "Hello there" }]), tuned && JSON.stringify(tuned.body));
check("a setting the router does not pass on is refused by name, as an error the site can read", plain.refused && plain.refused.code === "unsupported" && plain.refused.status === 400 && plain.refused.param === "response_format" && plain.refused.type === "invalid_request_error", JSON.stringify(plain.refused));
check("given a tool, the model's call for it comes back to the site, with finish_reason tool_calls", plain.asked.finish_reason === "tool_calls" && plain.asked.message.content === null
  && JSON.stringify(plain.asked.message.tool_calls) === JSON.stringify([{ id: "call_stand_in", type: "function", function: { name: "get_weather", arguments: '{"town":"Hull"}' } }]), JSON.stringify(plain.asked));
check("the site runs the tool and sends the result, and the model answers with it", plain.told.message.content === "The tool said: raining in Hull" && plain.told.finish_reason === "stop" && plain.told.message.tool_calls === undefined, JSON.stringify(plain.told));
const withTools = seenOpenAI.filter((c) => c.body.tools);
check("the provider was sent the tools, the image, the call and its result, from the page for that provider", withTools.length === 3 && withTools.every((c) => byRouter(c))
  && JSON.stringify(withTools[0].body.tools) === JSON.stringify([{ type: "function", function: { name: "get_weather", description: "The weather in a town.", parameters: { type: "object", properties: { town: { type: "string" } }, required: ["town"] } } }])
  && withTools[0].body.tool_choice === "auto" && JSON.stringify(withTools[0].body.messages[0].content[1]) === JSON.stringify({ type: "image_url", image_url: { url: plain.PNG } })
  && JSON.stringify(withTools[1].body.messages.slice(1)) === JSON.stringify([{ role: "assistant", content: null, tool_calls: [{ id: "call_stand_in", type: "function", function: { name: "get_weather", arguments: '{"town":"Hull"}' } }] }, { role: "tool", tool_call_id: "call_stand_in", content: "raining in Hull" }]),
  JSON.stringify(withTools[1] && withTools[1].body.messages.slice(1)));
const toolDeltas = plain.deltas.flatMap((c) => c.delta.tool_calls || []);
check("in a stream the call arrives as its name, then its arguments in pieces", toolDeltas.length === 3 && toolDeltas[0].id === "call_stand_in" && toolDeltas[0].function.name === "get_weather"
  && toolDeltas.map((c) => c.function.arguments).join("") === '{"town":"Hull"}' && plain.deltas.at(-1).finish_reason === "tool_calls", JSON.stringify(toolDeltas));
check("a lent port speaks it too, and still stops at its limit", plain.first === "A note from the stand-in." && plain.second && plain.second.code === "limit" && plain.second.status === 429, JSON.stringify(plain.second));
check("a site can stop a request with an AbortSignal", plain.stopped && plain.stopped.name === "AbortError", JSON.stringify(plain.stopped));

// The main site is another site. Whether the browser gives the frame separate
// storage there depends on the browser and its settings, so this only reports it.
// The router does not rely on it: grants are stored under the embedding site's address.
const main = await ctx.newPage();
await main.goto(base("hub") + "/ai-router/");
await main.waitForSelector("#choose:not([disabled])");
popup = await popupFrom(main, () => main.click("#choose"));
await popup.waitForSelector("#yes");
check("the explainer page is named in the router window", (await popup.locator(".origin").innerText()) === base("hub"));
await pickModel(popup, "Spare key", "gpt-6.2-sol");
await Promise.all([popup.waitForEvent("close"), popup.click("#yes")]);
await main.waitForSelector("#send:not([disabled])");
await main.click("#send");
await main.waitForFunction(() => /pieces/.test(document.querySelector("#log").textContent), null, { timeout: 30000 });
check("the explainer page's own demo gets an answer", /A note from the stand-in\./.test(await main.locator("#answer").innerText()));
const mainFrame = main.frames().find((f) => f.url().includes("/frame.html"));
const mainKept = await mainFrame.evaluate(() => Object.keys(localStorage).join(" "));
check("the router frame inside a site has storage of its own, and cannot read the accounts kept at the router's address", !/router\.accounts/.test(mainKept) && (await home.evaluate(() => Object.keys(localStorage).join(" "))).includes("router.accounts"), mainKept);

// The two diagrams on the explainer: every numbered arrow has a step written under it, and
// the diagram can be stepped through one arrow at a time. Nothing moves until it is asked to.
for (const [id, count] of [["frame-steps", 13], ["window-steps", 12]]) {
  const figure = main.locator(`figure[data-flow][data-steps="${id}"]`);
  const hops = await figure.locator(".hop").evaluateAll((all) => all.map((hop) => Number(hop.dataset.step)));
  const steps = await main.locator(`#${id} li[data-step]`).evaluateAll((all) => all.map((li) => Number(li.dataset.step)));
  const inOrder = Array.from({ length: count }, (_, i) => i + 1).join();
  check(`the ${id} diagram has one numbered arrow for each of its ${count} steps`, hops.join() === inOrder && steps.join() === inOrder, hops.join());
  check("it shows the whole picture until it is asked to step", (await figure.getAttribute("data-at")) === null && (await figure.locator(".hop.now").count()) === 0 && (await figure.locator(".flow-now").innerText()) === "");
  await figure.locator('[data-go="start"]').click();
  await figure.locator('[data-go="next"]').click();
  await figure.locator('[data-go="next"]').click();
  check("stepping shows one arrow at a time, with its words", (await figure.getAttribute("data-at")) === "3" && (await figure.locator(".hop.now").count()) === 1 && (await figure.locator(".hop.now").getAttribute("data-step")) === "3"
    && (await figure.locator(".hop.done").count()) === 2 && new RegExp(`^Step 3 of ${count}\\. `).test(await figure.locator(".flow-now").innerText()) && (await main.locator(`#${id} li.now`).getAttribute("data-step")) === "3", await figure.locator(".flow-now").innerText());
  await figure.locator('[data-go="all"]').click();
  check("and it can be put back to the whole picture", (await figure.getAttribute("data-at")) === null && (await figure.locator('[data-go="start"]').isVisible()));
}
check("the diagrams show this deployment's own addresses", (await main.locator('figure[data-steps="window-steps"] [data-url="pickwindow"]').textContent()).endsWith("/pick.html#window"));
await main.close();

// Neither key reached a site, in anything the three sites were sent.
check("no site was sent the second key either", !JSON.stringify(plain).includes(KEY2) && !(await library.evaluate((key) => JSON.stringify({ ...localStorage }).includes(key), KEY2)));

// The router's own page lists the sites that were allowed. It is a note kept at the router's
// address. The grants are inside the sites, where this page cannot reach, so it has no Stop for them.
await home.bringToFront();
await home.evaluate(() => dispatchEvent(new Event("focus")));
await home.locator("#grants li[data-id]").nth(2).waitFor();
let grants = await home.locator("#grants").innerText();
check("the router's page lists the sites that were allowed, from a note in this browser", /florist/.test(grants) && /library/.test(grants) && /up to 5 requests/.test(grants) && /up to 20 requests/.test(grants) && /Kept inside that site/.test(grants), grants.replace(/\n/g, " | "));
check("it cannot stop a site from there, and does not pretend to", (await home.locator("#grants [data-revoke]").count()) === 0);

// The router window, opened from the site, is where a site's use is seen and where it is stopped.
await florist.bringToFront();
popup = await popupFrom(florist, () => florist.click("#choose"));
await popup.waitForSelector("#stop");
const usedNow = await popup.locator("#now").innerText();
check("the router window, opened from the site, shows what the site has used", /claude-sonnet-5-5/.test(usedNow) && /Work key/.test(usedNow) && /4 of 5 requests used, 84 tokens in and 36 out\. It stops on /.test(usedNow), usedNow);
const seenAtHome = await home.locator("#grants li", { hasText: "florist" }).filter({ hasText: "4 used when you last opened the router window" }).waitFor({ timeout: 8000 }).then(() => true, () => false);
check("and the router's page now shows that number, with the day it was seen", seenAtHome, (await home.locator("#grants li", { hasText: "florist" }).innerText()).replace(/\n/g, " | "));

// Stop. The frame deletes the grant and the key that opens the API key. Nothing is left to refuse later: it is gone now.
const beforeStop = await keptGrant(florist.frames().find((f) => f.url().includes("/frame.html")), base("florist"));
await popup.click("#stop");
await popup.locator("#stopped").waitFor();
check("Stop is in the router window, and says when it is done", /Stopped\. This site can no longer use your account/.test(await popup.locator("#stopped").innerText()) && (await popup.locator("#stop").count()) === 0);
const afterStop = await keptGrant(florist.frames().find((f) => f.url().includes("/frame.html")), base("florist"));
check("after Stop the frame keeps nothing for this site: no grant, no encrypted key, no key to open it", !!beforeStop && afterStop === null, JSON.stringify(afterStop));
await florist.locator("#state", { hasText: "No model yet" }).waitFor();
check("the site is told at once that it has no model", /No model yet/.test(await florist.locator("#state").innerText()));
await popup.close();
const calls = seen.length;
const refusedAfterStop = await florist.evaluate(async (router) => {
  const { connect } = await import(router + "/router.js");
  const ai = await connect();
  try { await ai.prompt("One more card").text(); return "answered"; } catch (error) { return error.code; }
}, base("router"));
check("after Stop, the site's next request is refused, and no provider is called", refusedAfterStop === "no-grant" && seen.length === calls, refusedAfterStop);
const stoppedAtHome = await home.locator("#grants li", { hasText: "florist" }).filter({ hasText: "Stopped" }).waitFor({ timeout: 8000 }).then(() => true, () => false);
check("the router's page shows the site as stopped", stoppedAtHome, (await home.locator("#grants li", { hasText: "florist" }).innerText()).replace(/\n/g, " | "));

// A grant ends by itself. Put the library's past its last day, as the calendar would.
const libraryRouter = library.frames().find((f) => f.url().includes("/frame.html"));
await library.evaluate(async (router) => { const { connect } = await import(router + "/router.js"); window.__second = await connect(); }, base("router"));   // connected while the grant is still good
await libraryRouter.evaluate(async (site) => {
  const db = await new Promise((resolve) => { const request = indexedDB.open("router"); request.onsuccess = () => resolve(request.result); });
  await new Promise((resolve) => { const step = db.transaction("grants", "readwrite"); const store = step.objectStore("grants"); const get = store.get(site); get.onsuccess = () => { get.result.expires = Date.now() - 1000; store.put(get.result); }; step.oncomplete = resolve; });
  db.close();
}, base("library"));
const openaiBefore = seenOpenAI.length;
const afterExpiry = await library.evaluate(async () => {
  const ai = window.__second;
  const was = ai.ready;
  try { await ai.prompt("One more note").text(); return { was, got: "answered" }; } catch (error) { await new Promise((r) => setTimeout(r, 200)); return { was, got: error.code, message: error.message, now: ai.ready }; }
});
check("a grant that has run out is refused at the next request, with no provider called, and the site is told", afterExpiry.was === true && afterExpiry.got === "no-grant" && /expired/.test(afterExpiry.message) && afterExpiry.now === false && seenOpenAI.length === openaiBefore, JSON.stringify(afterExpiry));
check("and it is deleted where it was kept, with its key", (await keptGrant(libraryRouter, base("library"))) === null);
const reloaded = await ctx.newPage();
await reloaded.goto(base("library") + "/digest/");
await reloaded.waitForSelector("#choose:not([disabled])");
check("a page of that site loaded afterwards has no model", /No model yet/.test(await reloaded.locator("#state").innerText()));
await reloaded.close();

// There is no grant list on a server any more. The address that had it answers that it has gone.
const outside = await florist.evaluate(async (router) => {
  try { const r = await fetch(router + "/r/aaaaaaaaaaaaaaaaaaaaaaaa/list?from-the-test", { method: "POST", body: "{}" }); return r.status; } catch { return "blocked"; }
}, base("router"));
check("the server keeps no list of grants: the address that had one answers that it has gone", outside === "blocked" || outside === 410, String(outside));

// A site shown inside another site's page gets nothing: the router answers only the page in the tab itself.
const outer = await ctx.newPage();
await outer.goto(base("planner") + "/a-page-that-is-not-there");
await outer.evaluate((src) => { document.body.innerHTML = `<iframe id="inner" src="${src}" width="900" height="700"></iframe>`; }, base("library") + "/digest/");
const inner = outer.frameLocator("#inner");
await inner.locator("#choose:not([disabled])").waitFor({ timeout: 20000 });
check("a site inside another site's page is not given its model, though it has a grant in its own tab", /No model yet/.test(await inner.locator("#state").innerText()) && !outer.frames().some((f) => f.url().includes("/frame.html")), await inner.locator("#state").innerText());
popup = await popupFrom(outer, () => inner.locator("#choose").click());
await popup.locator("h1", { hasText: "Open the site in a tab of its own" }).waitFor();
check("and the router window refuses it, with nothing to allow", (await popup.locator("#yes").count()) === 0 && (await popup.locator("input[name=choice]").count()) === 0 && /inside another page/.test(await popup.locator("#main").innerText()));
await popup.close();
await outer.close();

// Everything that went to the router's address, from every page in the whole run. The router's pages
// ask it for pages and scripts and send it nothing. (The one POST above was the test's own, from a site.)
const toRouter = toServer.filter((line) => !line.includes("?from-the-test"));
const notGets = toRouter.filter((line) => !/^(GET|HEAD) /.test(line) || / .+ .+/.test(line.slice(line.indexOf(" ") + 1)));
check("no router page sent the router's server anything: every request to it was for a page or a script", toRouter.length > 40 && notGets.length === 0 && !toRouter.some((line) => line.includes("/r/")), `${toRouter.length} requests to the router's address checked` + (notGets.length ? ", not plain: " + notGets.slice(0, 3).join(" | ") : ""));
check("nothing that went to the router's address contains an API key, in the clear or encrypted", !toServer.some((line) => line.includes(KEY) || line.includes(KEY2) || /sealed|"key"|"iv"/.test(line)));
check("no page threw an error", errors.length === 0, errors.join(" ; "));
await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
