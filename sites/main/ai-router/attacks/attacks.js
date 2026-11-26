// The attack lab. This page plays a hostile site: it embeds the real AI router
// and tries to take the person's API key.
//
// Nothing here is pretend. Each attack is a function below, it runs when its
// button is pressed, and its own source is what the page shows as "the code".
// The page records everything it receives, and shows all of it.

import { sites } from "/_sites.js";
const ROUTER = sites.router;
const $ = (id) => document.getElementById(id);
const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------ the recording
// Set up before the router's script is loaded, so that nothing is missed:
// every message this window is sent, every port this page makes or is passed,
// and every message on those ports.
const loot = { heard: [], ports: 0, decoys: 0 };
const keep = (where, data) => {
  let text;
  try { text = JSON.stringify(data); } catch { text = "[something that is not JSON]"; }
  loot.heard.push(where + "  " + text);
  if (data && data.decoy) loot.decoys++;
  showLoot();
};
const tap = (port, where) => {
  if (!port || port.__tapped) return;
  port.__tapped = true;
  loot.ports++;
  port.addEventListener("message", (event) => { keep(where, event.data); for (const passed of event.ports) tap(passed, where + " > a port passed on it"); });
};
addEventListener("message", (event) => { keep("this window", event.data); for (const passed of event.ports) tap(passed, "a port passed to this window"); }, true);
const RealChannel = MessageChannel;
window.MessageChannel = function () { const made = new RealChannel(); tap(made.port1, "a port this page made"); tap(made.port2, "a port this page made"); return made; };
// The router window, when this page opens one: the page keeps the handle the browser gives it.
let picker = null;
const realOpen = window.open;
window.open = function (...args) { picker = realOpen.apply(this, args); return picker; };

// What the collection is searched for. The first set is the talk between the
// router's window and its frame. The second is anything shaped like a key.
const BETWEEN = /"router":"picker"|"t":"(grant|site|stored|failed|stop|stopped)"|"sealed"|"pub"/;
const KEYLIKE = /sk-[A-Za-z0-9_-]{6,}|"crv"|"kty"|"iv":"|AIza[0-9A-Za-z_-]{10,}/;
let showLoot = () => {};

// --------------------------------------------------------------- the router
const { connect } = await import(ROUTER + "/router.js");
const ai = await connect();
window.ai = ai;
const frame = [...document.querySelectorAll("iframe")].find((f) => f.src === ROUTER + "/frame.html");

// ------------------------------------------------------------- the attacks
// Each returns nothing and reports with held(text) when the attack got
// nothing, broke(text) when it got something, and told(text) for a plain fact.

async function readTheFrame({ held, broke }) {
  // The frame is in this page. Reach into it every way a page can.
  const tries = {
    "Read the frame's page": () => frame.contentDocument && frame.contentDocument.documentElement.innerHTML,
    "Read the frame's storage": () => frame.contentWindow.localStorage.length,
    "Open the frame's database, where the grant is kept": () => frame.contentWindow.indexedDB,
    "Read a variable inside it": () => frame.contentWindow.host,
    "Listen to the messages it is sent": () => { frame.contentWindow.addEventListener("message", (event) => keep("LISTENING IN THE FRAME", event.data)); return "listening"; },
    "Replace its postMessage with this page's own": () => { frame.contentWindow.postMessage = () => {}; return String(frame.contentWindow.postMessage).includes("=>") ? "replaced" : null; },
    "Read the address it is at now": () => frame.contentWindow.location.href,
  };
  for (const [name, attempt] of Object.entries(tries)) {
    try {
      const got = attempt();
      if (got === null || got === undefined) held(name + ": the browser gave back nothing.");
      else broke(name + ": got " + String(got).slice(0, 80));
    } catch (error) { held(name + ": the browser refused, with " + error.name + "."); }
  }
}

async function plantDecoys({ held, broke, told }) {
  // The router window looks through this page's frames for the router's frame.
  // Put frames of this page's own in front of it. Each sends back whatever it is given.
  const forward = "<script>addEventListener('message', (e) => parent.postMessage({ decoy: true, got: e.data, ports: e.ports.length, from: e.origin }, '*', [...e.ports]))<\/script>";
  const own = Object.assign(document.createElement("iframe"), { srcdoc: forward, hidden: true });
  const nowhere = Object.assign(document.createElement("iframe"), { src: "data:text/html," + encodeURIComponent(forward), hidden: true });
  const boxed = Object.assign(document.createElement("iframe"), { src: ROUTER + "/frame.html", hidden: true });
  boxed.setAttribute("sandbox", "allow-scripts");     // the router's real frame, with its address taken away
  document.body.prepend(own, nowhere, boxed);
  await wait(600);
  told("Three decoy frames are now ahead of the router's frame: one at this page's address, one with no address, and the router's own frame in a sandbox.");
  told("Opening the router window. Choose an account and press Allow.");
  const before = loot.decoys;
  const chose = await ai.choose().catch((error) => error.code);
  await wait(300);
  if (loot.decoys === before) held("The decoys were sent nothing. The window posted to every frame, and the browser dropped it for each one that was not at the router's address.");
  else broke("A decoy was sent " + (loot.decoys - before) + " message(s). See the collection below.");
  told(chose === true ? "Meanwhile the grant reached the real frame. This page has a model: " + (ai.model && ai.model.name) + "." : "The window closed with no new grant (" + chose + ").");
}

async function relay({ held, broke, told }) {
  // The relay: give the window a port, give the frame a port, and sit between them.
  const heardFromWindow = [], heardFromFrame = [];
  const toFrame = new RealChannel();
  toFrame.port1.onmessage = (event) => { heardFromFrame.push(event.data); keep("RELAY, from the frame", event.data); };
  // To the frame: the message the router window sends, with this page's port in place of the window's.
  frame.contentWindow.postMessage({ router: "picker" }, ROUTER, [toFrame.port2]);
  told("Offered the frame a port, in the words the router window uses. Opening the router window, to offer it one too. Choose an account and press Allow.");
  const choosing = ai.choose().catch((error) => error.code);
  // To the window: the message a site with no frame sends, again and again while it is open.
  const offering = setInterval(() => {
    if (!picker || picker.closed) return;
    const toWindow = new RealChannel();
    toWindow.port1.onmessage = (event) => { heardFromWindow.push(event.data); keep("RELAY, from the window", event.data); toFrame.port1.postMessage(event.data); };
    try { picker.postMessage({ router: "hello" }, ROUTER, [toWindow.port2]); } catch { /* closed */ }
  }, 150);
  const chose = await choosing;
  clearInterval(offering);
  await wait(300);
  if (heardFromFrame.length === 0) held("The frame said nothing on the port this page offered it. It takes that port only from a page at the router's address, and the browser marked the message with this page's address.");
  else broke("The frame answered this page's port: " + JSON.stringify(heardFromFrame).slice(0, 200));
  if (heardFromWindow.length === 0) held("The window said nothing on any port this page offered it. When a site has the frame, the window takes no port from the site at all.");
  else broke("The window answered this page's port: " + JSON.stringify(heardFromWindow).slice(0, 200));
  told(chose === true ? "And yet the grant was delivered: this page has a model. It travelled on a line the window made itself, which this page never held." : "The window closed with no new grant (" + chose + "). Run it again and press Allow to see the grant arrive anyway.");
}

async function forgeTheWindow({ held, broke, told }) {
  // Pretend to be the router window: hand the frame a grant this page wrote, for 100,000 requests and a year.
  const before = JSON.stringify([ai.ready, ai.model, ai.left, ai.expires]);
  const forged = { id: "forged", site: location.origin, provider: "anthropic", providerName: "Anthropic", model: "any-model", label: "forged", requests: 100000, used: 0, tokensIn: 0, tokensOut: 0, made: Date.now(), expires: Date.now() + 365 * 86400000, last: 0, sealed: null };
  const replies = [];
  const line = new RealChannel();
  line.port1.onmessage = (event) => { replies.push(event.data); keep("FORGED WINDOW, reply", event.data); };
  frame.contentWindow.postMessage({ router: "picker" }, "*", [line.port2]);
  line.port1.postMessage({ t: "grant", grant: forged });
  // And the same without the port, in case the frame reads it from the window message.
  frame.contentWindow.postMessage({ router: "picker", t: "grant", grant: forged }, "*");
  // Say hello a second time, for a second line into the worker.
  const second = new RealChannel();
  second.port1.onmessage = (event) => { replies.push(event.data); keep("SECOND HELLO, reply", event.data); };
  frame.contentWindow.postMessage({ router: "hello" }, "*", [second.port2]);
  // On this page's own port: messages only the frame may send to its worker.
  const lent = await ai.lend().catch(() => null);
  if (lent) for (const message of [{ t: "grant", grant: forged, n: 1 }, { t: "init", site: location.origin }, { t: "current", n: 2 }, { t: "caller", provider: "anthropic" }]) lent.postMessage(message);
  await wait(700);
  if (replies.length === 0) held("The frame did not answer the forged window or the second hello.");
  else broke("The frame answered: " + JSON.stringify(replies).slice(0, 200));
  const after = JSON.stringify([ai.ready, ai.model, ai.left, ai.expires]);
  if (after === before) held("What this page may use is unchanged: " + (ai.ready ? ai.model.name + ", " + ai.left + " requests left." : "no model."));
  else broke("What this page may use changed, from " + before + " to " + after);
  told("The frame takes a grant only on a line that came from a page at the router's address. The browser says where a message came from. This page cannot.");
}

async function reachIntoTheWindow({ held, broke, told }) {
  // The router window is open, and this page opened it, so it holds a handle to it.
  told("Opening the router window. Leave it open for a few seconds, and look at the address it shows.");
  const choosing = ai.choose().catch((error) => error.code);
  // A new window starts as an empty page at this page's own address. Wait until the router's page is in it.
  for (let i = 0; i < 100 && picker && !picker.closed; i++) { try { void picker.location.href; await wait(100); } catch { break; } }
  await wait(1200);
  const tries = {
    "Read the window's page": () => picker.document.body.innerHTML,
    "Read the window's storage, where the accounts and keys are": () => picker.localStorage.getItem("router.accounts"),
    "Read the address it is at": () => picker.location.href,
    "Listen to the messages it is sent": () => { picker.addEventListener("message", (event) => keep("LISTENING IN THE WINDOW", event.data)); return "listening"; },
  };
  for (const [name, attempt] of Object.entries(tries)) {
    try { const got = attempt(); if (got === null || got === undefined) held(name + ": the browser gave back nothing."); else broke(name + ": got " + String(got).slice(0, 80)); }
    catch (error) { held(name + ": the browser refused, with " + error.name + "."); }
  }
  // Tell the window this page is another site, in the words the frame uses.
  const replies = [];
  for (let i = 0; i < 8 && picker && !picker.closed; i++) {
    const line = new RealChannel();
    line.port1.onmessage = (event) => { replies.push(event.data); keep("FORGED FRAME, reply", event.data); };
    try {
      picker.postMessage({ t: "site", site: "https://your-bank.example", current: null, pub: null }, "*");
      picker.postMessage({ router: "hello" }, "*", [line.port2]);
      picker.postMessage({ t: "stored" }, "*");
    } catch { /* closed */ }
    await wait(250);
  }
  if (replies.length === 0) held("The window did not answer any forged message.");
  else broke("The window answered: " + JSON.stringify(replies).slice(0, 200));
  told("The window still shows " + location.origin + ". That address came from the browser, by way of the frame. Close the window, or allow it.");
  await choosing;
}

async function getMore({ held, broke, told }) {
  // This page was given a number of requests. Try to get more.
  if (!ai.ready) { told("This page has no model yet. Run one of the attacks that opens the router window, press Allow, and then run this."); return; }
  const allowed = ai.left;
  told("This page has " + allowed + " requests left. It will try to get more. This sends real prompts, of one word each, and uses the requests up.");
  // 1. Clear everything a page can clear. The count is not in this page's storage.
  localStorage.clear(); sessionStorage.clear();
  try { for (const db of await indexedDB.databases()) indexedDB.deleteDatabase(db.name); } catch { /* none */ }
  try { for (const name of await caches.keys()) await caches.delete(name); } catch { /* none */ }
  // 2. Start again: a second router frame, with a worker and a connection of its own.
  const again = await connect();
  if (again.left === allowed) held("After clearing this page's storage and connecting again through a second frame, the count is the same: " + again.left + " left.");
  else broke("The count changed after clearing and reconnecting: " + again.left + " left, not " + allowed + ".");
  // 3. Ask through both connections at once, until both are refused.
  let counted = 0;
  const refusals = [];
  const ask = async (through) => {
    try { await through.prompt({ messages: [{ role: "user", content: "Say ok." }], maxTokens: 1 }).text(); counted++; return true; }
    catch (error) {
      // A made-up key is refused by the provider. The request was still counted, because it is counted before the call.
      if (error.code === "key-refused" || error.code === "provider") { counted++; return true; }
      refusals.push(error.code || "error");
      return false;
    }
  };
  for (let round = 0; round < allowed + 2; round++) { const [one, two] = await Promise.all([ask(ai), ask(again)]); if (!one && !two) break; }
  await wait(400);
  if (counted === allowed) held("It got " + counted + " requests through two frames at once: exactly what was left, and no more. Then it was refused (" + [...new Set(refusals)].join(", ") + ").");
  else if (counted < allowed) told("It got " + counted + " of " + allowed + " before it was refused (" + [...new Set(refusals)].join(", ") + ").");
  else broke("It got " + counted + " requests, and was only allowed " + allowed + ".");
  if (!ai.ready && !again.ready) held("The grant is used up, so the frame deleted it, with the key that opens your API key. Both connections were told.");
  else told("This page still has a model: " + ai.left + " requests left.");
}

async function borrowAName({ told }, card) {
  // Show a site the person trusts inside this page, and let it ask in its own name.
  const inner = Object.assign(document.createElement("iframe"), { src: sites.florist + "/card/", title: "Another site, shown inside this hostile page" });
  card.append(inner);
  told("The florist's page is now inside this one, below. Press its \"Choose a model\" button.");
  told("If the router answered it, the window would say the florist is asking, while this page stood round it and could draw over it. It does not. The router's frame answers only the page in the tab itself, so the florist is given no frame at all. The window it opens says to open the site in a tab of its own, and offers nothing to allow.");
}

async function lookAlike({ broke, told }) {
  // Open a window of this page's own that looks like the router's, and ask for a key.
  realOpen.call(window, "/ai-router/attacks/lookalike.html", "look-alike", "popup,width=460,height=640");
  broke("This one works. A window opened that looks like the router's and asks for a key. Nothing in a browser stops a site doing this.");
  told("Look at its address bar. It says " + location.host + ", not " + new URL(ROUTER).host + ". That is the only thing that gives it away.");
  told("It is why the real router window never asks for a key. A key is typed at the router's own address, in a tab you opened yourself, and nowhere else.");
}

const ATTACKS = [
  { run: readTheFrame, title: "Reach into the frame", about: "The router's frame is inside this page, and the key it was given is in the frame's storage. Read it, listen to it, or change it.", button: "Reach in" },
  { run: relay, title: "Relay between the window and the frame", about: "The window and the frame have to talk, and this page stands between them. Give each of them a port of this page's own, pass their messages across, and read every one.", button: "Open the window and relay" },
  { run: plantDecoys, title: "Plant decoy frames", about: "The window finds the frame by posting to every frame in this page. Put this page's own frames first, so that one of them is handed the key line.", button: "Plant them and open the window" },
  { run: forgeTheWindow, title: "Forge the router window", about: "Send the frame the messages the router window sends, with a grant this page wrote: any model, a hundred thousand requests, for a year.", button: "Send a forged grant" },
  { run: reachIntoTheWindow, title: "Reach into the window", about: "This page opened the router window, so it holds a handle to it. Read your accounts out of it, and tell it this page is your bank.", button: "Open the window and reach in" },
  { run: getMore, title: "Get more than it was given", about: "The router has no server. The count of requests is kept in your browser. Clear it, or start again with a new frame, and ask through both at once.", button: "Use up the requests, then ask for more" },
  { run: borrowAName, title: "Borrow a trusted site's name", about: "Show a site you trust inside this page, and have it ask the router in its own good name while this page sits round it.", button: "Show the florist inside this page" },
  { run: lookAlike, title: "Open a look-alike window", about: "Do not attack the router at all. Open a window that looks like its window, and ask you for the key.", button: "Open a look-alike" },
];

// ------------------------------------------------------------------ the page
$("router-link").href = ROUTER + "/#add";
const showState = () => {
  $("state").textContent = ai.mode !== "frame" ? "The router's frame did not load in this page, so these attacks have nothing to attack. They need the frame."
    : ai.ready ? `The router's frame is in this page. A person has allowed this page: ${ai.model.name}, from the account "${ai.model.account}", ${ai.left} requests left.`
    : "The router's frame is in this page. Nobody has allowed this page yet, so it has no model.";
};
ai.onchange(showState);
showState();

$("attacks").innerHTML = ATTACKS.map((attack, n) => `
  <li class="attack" id="attack-${attack.run.name}">
    <h3>${n + 1}. ${esc(attack.title)}</h3>
    <p>${esc(attack.about)}</p>
    <div class="status"><button type="button" data-run="${n}" ${frame ? "" : "disabled"}>${esc(attack.button)}</button></div>
    <ul class="results" aria-live="polite"></ul>
    <details><summary>The code that runs</summary><pre data-no-hl>${esc(attack.run.toString())}</pre></details>
  </li>`).join("");

$("attacks").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-run]");
  if (!button || button.disabled) return;
  const attack = ATTACKS[Number(button.dataset.run)];
  const card = button.closest(".attack");
  const list = card.querySelector(".results");
  list.innerHTML = "";
  const say = (kind) => (text) => { const item = document.createElement("li"); item.className = kind; item.textContent = text; list.append(item); };
  button.disabled = true;
  try { await attack.run({ held: say("held"), broke: say("broke"), told: say("told") }, card); }
  catch (error) { say("told")("The attack itself failed to run: " + (error.message || error)); }
  button.disabled = false;
  card.dataset.done = "true";
  showState();
});

showLoot = () => {
  // A line that starts in capitals is something an attack was sent in answer, or overheard. There should be none.
  const between = loot.heard.filter((line) => BETWEEN.test(line) || /^(RELAY|FORGED|SECOND|LISTENING)/.test(line)).length;
  const keys = loot.heard.filter((line) => KEYLIKE.test(line)).length;
  const clean = between === 0 && keys === 0 && loot.decoys === 0;
  $("verdict").className = clean ? "held" : "broke";
  $("verdict").textContent = `${loot.heard.length} messages received, on this window and ${loot.ports} ports. `
    + (clean ? "None of them passed between the router's window and its frame. None contains anything shaped like a key." : `${between} of them came from between the router's window and its frame, ${loot.decoys} reached a decoy, and ${keys} contain something shaped like a key.`);
  $("loot").textContent = loot.heard.length ? loot.heard.map((line) => (line.length > 400 ? line.slice(0, 400) + " …" : line)).join("\n") : "Nothing yet.";
};
showLoot();
