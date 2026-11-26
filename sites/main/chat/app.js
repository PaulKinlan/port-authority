// A chat app with no AI account of its own.
//
// It asks the AI router for a model and gets a port. Messages go down the
// port in the shape of the Chat Completions API, and the answer comes back a
// few words at a time. This page never sees an API key. Conversations are
// kept in this browser (db.js). What the model writes is shown as Markdown
// (markdown.js), with nothing in it trusted.

import { sites } from "/_sites.js";
import { highlightCode } from "/highlight.js";
import * as db from "./db.js";
import { render } from "./markdown.js";

const $ = (id) => document.getElementById(id);
const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const MOST_TOKENS = 4000;                        // the most the router will ask a provider for
const HIGHLIGHTED = new Set(["js", "javascript", "mjs", "jsx", "ts", "typescript", "tsx", "json", "sh", "bash", "shell", "zsh"]);
const markdown = (text) => render(text, { highlight: (code, lang) => (HIGHLIGHTED.has(lang) ? highlightCode(code, lang) : null) });

let conversations = [];      // every saved conversation, newest first
let current = null;          // the one on screen. A new chat is not saved until its first message.
let ai = null;               // the router, once connected
let unreachable = null;      // why the router could not be loaded, if it could not
let busy = null;             // { conversation, reply, stop } while an answer is arriving
let attached = [];           // images chosen for the next message, each a data: address
const wanted = new URLSearchParams(location.search).get("via") || localStorage.getItem("chat.via") || "frame";

// Other tabs of this app hear when a conversation changes.
const tabs = "BroadcastChannel" in self ? new BroadcastChannel("chat") : null;

// ---------------------------------------------------------------- the router

async function connectRouter() {
  drawConnection();
  try {
    const { connect } = await import(sites.router + "/router.js");
    ai = await connect(wanted === "window" ? { via: "window" } : {});
    ai.onchange(drawConnection);
  } catch (error) {
    unreachable = error;
  }
  drawConnection();
}

function drawConnection() {
  const button = $("model"), jack = $("model-jack"), text = $("model-text");
  const ready = !!(ai && ai.ready);
  jack.classList.toggle("on", ready);
  button.classList.toggle("ask", !!ai && !ready);
  button.disabled = !ai && !unreachable;
  // The model's name is the provider's. The account's name is the one the person gave it. They are shown apart.
  if (ready) text.innerHTML = `<b>${esc(ai.model.name)}</b> <span class="from">${esc(ai.model.account)}</span>`;
  else text.textContent = unreachable ? "Router out of reach" : !ai ? "Connecting" : ai.mode === "window" ? "Connect a model" : "Choose a model";
  button.title = ready ? "Choose a different model, or set up another account" : "";

  const state = $("connection-state");
  if (unreachable) state.textContent = "This app could not load the router, so it has no model to ask. Check your connection and reload the page.";
  else if (!ai) state.textContent = "Connecting to your router.";
  else if (ready) {
    const left = ai.left == null ? "" : ` It has ${ai.left} ${ai.left === 1 ? "request" : "requests"} left.`;
    state.innerHTML = ai.model.id === "builtin"
      ? `This app is using <strong>this browser's built-in model</strong>. It runs on this device.${esc(left)}`
      : `This app is using <strong class="model-name">${esc(ai.model.name)}</strong> from ${esc(ai.model.provider)}, on your account <strong>${esc(ai.model.account)}</strong>.${esc(left)}`;
  } else state.textContent = ai.mode === "window" ? "No model is connected. The router window opens when you connect, and stays open while you chat." : "No model yet. Choose one of your accounts in the router window.";
  $("connection-choose").textContent = ready ? "Choose a different model" : ai && ai.mode === "window" ? "Connect a model" : "Choose a model";
  $("connection-choose").disabled = !ai;
  $("connection-forget").hidden = !ready;
  for (const input of document.querySelectorAll('input[name="via"]')) { input.checked = input.value === (ai ? ai.mode : wanted); input.disabled = !ai; }
  $("via-note").textContent = ai && ai.mode === "window" && wanted !== "window"
    ? "The router's frame did not load in this page, so this app is using the router window."
    : "Changing this reloads the page.";
  // The first screen of a new chat offers the same button.
  if (current && !current.messages.length) drawThread();
}

// Open the router window. Has to be called from a click or a key press.
async function choose() {
  if (!ai) { notice(unreachable ? "The router could not be reached. Reload the page to try again." : "Still connecting to your router. Try again in a moment."); return false; }
  try {
    const ok = await ai.choose();
    if (ok) notice("");
    return ok;
  } catch (error) {
    notice(error.message);
    return false;
  }
}

// ----------------------------------------------------------- conversations

const blank = () => ({ id: db.newId(), title: "New chat", named: false, created: Date.now(), updated: Date.now(), system: "", messages: [] });
const saved = (conversation) => conversations.some((c) => c.id === conversation.id);

async function keep(conversation) {
  conversation.updated = Date.now();
  if (!saved(conversation)) conversations.unshift(conversation);
  conversations.sort((a, b) => b.updated - a.updated);
  await db.save(conversation);
  tabs?.postMessage({ changed: conversation.id });
}

function open(conversation, { focus = true } = {}) {
  current = conversation || blank();
  const hash = conversation && saved(conversation) ? "#c=" + conversation.id : "";
  if (location.hash !== hash) history.replaceState(null, "", location.pathname + location.search + hash);
  drawThread();
  drawList();
  drawTop();
  closeSide();
  if (focus && matchMedia("(pointer: fine)").matches) $("prompt").focus();
}

const DAY = 86400000;
function when(time) {
  const today = new Date().setHours(0, 0, 0, 0);
  if (time >= today) return "Today";
  if (time >= today - DAY) return "Yesterday";
  if (time >= today - 6 * DAY) return "This week";
  if (time >= today - 29 * DAY) return "This month";
  return "Earlier";
}

function drawList() {
  const query = $("search").value.trim().toLowerCase();
  const shown = query ? conversations.filter((c) => c.title.toLowerCase().includes(query) || c.messages.some((m) => m.content.toLowerCase().includes(query))) : conversations;
  if (!shown.length) {
    $("list").innerHTML = `<p class="none small muted">${query ? "No conversation has those words in it." : "Nothing saved yet. Your first message starts a conversation."}</p>`;
    return;
  }
  let group = "";
  $("list").innerHTML = shown.map((c) => {
    const label = when(c.updated);
    const head = label !== group ? `<h3 class="group">${label}</h3>` : "";
    group = label;
    const here = current && current.id === c.id;
    return `${head}<a class="conv${busy && busy.conversation.id === c.id ? " busy" : ""}" href="#c=${esc(c.id)}"${here ? ' aria-current="page"' : ""}>${esc(c.title)}</a>`;
  }).join("");
}

function drawTop() {
  $("title").textContent = current.title;
  document.title = (current.messages.length ? current.title + " | " : "") + "Chat | Port Authority";
  const real = saved(current);
  for (const id of ["menu-rename", "menu-export", "menu-delete"]) $(id).disabled = !real;
}

// -------------------------------------------------------------- the thread

const who = (message) => message.model || "Model";

function messageHTML(message, last) {
  if (message.role === "user") {
    const shots = imagesOf(message).map((url, i) => `<img src="${esc(url)}" alt="Image ${i + 1} that you sent" loading="lazy">`).join("");
    return `<article class="msg user" data-id="${esc(message.id)}"><h3 class="visually-hidden">You said</h3>${shots ? `<div class="shots">${shots}</div>` : ""}${message.content ? `<div class="bubble">${esc(message.content)}</div>` : ""}</article>`;
  }
  const pending = busy && busy.reply === message;
  const tail = message.stopped ? `<p class="tail small">You stopped this answer.</p>` : message.interrupted && !pending ? `<p class="tail small">This answer was cut off when the page closed.</p>` : "";
  const failed = message.error ? `<div class="failed"><p>${esc(explain(message.error))}</p><div class="actions">${fix(message.error)}<button type="button" class="tiny quiet" data-act="retry">Try again</button></div></div>` : "";
  const actions = pending ? "" : `<div class="msg-actions">${message.content ? `<button type="button" class="tiny quiet" data-act="copy">Copy</button>` : ""}${last && !message.error ? `<button type="button" class="tiny quiet" data-act="retry">Ask again</button>` : ""}</div>`;
  return `<article class="msg assistant${pending ? " pending" : ""}" data-id="${esc(message.id)}"><h3 class="who">${esc(who(message))}</h3><div class="md">${markdown(message.content)}</div>${tail}${failed}${actions}</article>`;
}

// What went wrong, in words, and the button that puts it right.
function explain(error) {
  if (error.code === "no-grant") return "This app has no model to ask. " + (error.message || "");
  if (error.code === "limit") return "This app has used all the requests you gave it. Choose a model again to give it more.";
  if (error.code === "closed") return "The router window was closed before the answer finished.";
  if (error.code === "storage") return "The router could not read what you allowed from this browser's storage. Choose a model again.";
  if (error.code === "key-refused") return "The provider refused the API key for this account. " + (error.message || "");
  if (error.code === "unsupported") return (error.message || "This model cannot take that.") + " Use the model button to choose another.";
  return error.message || "The model did not answer.";
}
const fix = (error) => (["no-grant", "limit", "closed"].includes(error.code) ? `<button type="button" class="tiny accent" data-act="choose">${error.code === "closed" ? "Connect again" : "Choose a model"}</button>` : "");

function drawThread() {
  const thread = $("thread");
  if (!current.messages.length) {
    thread.innerHTML = `<div class="empty">
      <h3>What would you like to ask?</h3>
      <p>This app has no AI account and no key. Your messages go from this browser to the model you choose in your router, on your own account.</p>
      ${ai && !ai.ready ? `<button type="button" class="accent" data-act="choose">${ai.mode === "window" ? "Connect a model" : "Choose a model"}</button>` : ""}
    </div>`;
    return;
  }
  const lastId = current.messages.at(-1).id;
  thread.innerHTML = current.messages.map((m) => messageHTML(m, m.id === lastId)).join("");
  toEnd(true);
}

// Stay at the end while an answer arrives, unless the person has scrolled up to read.
let pinned = true;
$("scroller").addEventListener("scroll", () => { const s = $("scroller"); pinned = s.scrollHeight - s.scrollTop - s.clientHeight < 80; }, { passive: true });
function toEnd(force = false) { if (force || pinned) { const s = $("scroller"); s.scrollTop = s.scrollHeight; pinned = true; } }

// Draw the arriving answer at most once a frame.
let painting = false;
function paint() {
  if (painting) return;
  painting = true;
  requestAnimationFrame(() => {
    painting = false;
    if (!busy || busy.conversation !== current) return;
    const node = $("thread").querySelector(`[data-id="${CSS.escape(busy.reply.id)}"]`);
    if (!node) return;
    node.querySelector(".md").innerHTML = markdown(busy.reply.content);
    node.querySelector(".who").textContent = who(busy.reply);
    toEnd();
  });
}

// ------------------------------------------------------------ ask the model

// What is sent: the instructions, then every message that has words in it.
// Two messages in a row from the same side are sent as one, because some
// providers refuse them otherwise.
function forModel(conversation, upTo) {
  const out = [];
  if (conversation.system.trim()) out.push({ role: "system", content: conversation.system.trim() });
  const parts = (content) => (typeof content === "string" ? [{ type: "text", text: content }] : content);
  for (const message of conversation.messages) {
    if (message === upTo) break;
    const images = message.role === "user" ? imagesOf(message) : [];
    if (!message.content.trim() && !images.length) continue;
    // A message with images is a list of parts: its words, then each image.
    const content = images.length ? [...(message.content.trim() ? [{ type: "text", text: message.content }] : []), ...images.map((url) => ({ type: "image_url", image_url: { url } }))] : message.content;
    const before = out.at(-1);
    if (!before || before.role !== message.role) out.push({ role: message.role, content });
    else if (typeof before.content === "string" && typeof content === "string") before.content += "\n\n" + content;
    else before.content = [...parts(before.content), ...parts(content)];
  }
  return out;
}

async function answer(conversation) {
  const reply = { id: db.newId(), role: "assistant", content: "", at: Date.now(), interrupted: true };   // true until it ends in some known way
  conversation.messages.push(reply);
  const stop = new AbortController();
  busy = { conversation, reply, stop };
  await keep(conversation);
  if (conversation === current) { drawThread(); drawTop(); }
  drawList();
  drawComposer();
  let lastSave = Date.now();
  try {
    const stream = await ai.chat.completions.create(
      { messages: forModel(conversation, reply), stream: true, stream_options: { include_usage: true }, max_completion_tokens: MOST_TOKENS },
      { signal: stop.signal },
    );
    for await (const chunk of stream) {
      if (chunk.model) reply.model = chunk.model;
      if (chunk.usage) reply.usage = chunk.usage;
      const piece = chunk.choices[0]?.delta?.content;
      if (!piece) continue;
      reply.content += piece;
      if (conversation === current) paint();
      // Keep what has arrived, so a closed tab does not lose a long answer.
      if (Date.now() - lastSave > 1500 && !conversation.deleted) { lastSave = Date.now(); db.save(conversation).catch(() => {}); }
    }
  } catch (error) {
    if (error.name === "AbortError") reply.stopped = true;
    else reply.error = { message: String(error.message || error), code: error.code, status: error.status };
  }
  delete reply.interrupted;
  busy = null;
  if (conversation.deleted) return drawComposer();    // it was deleted while the answer was arriving
  await keep(conversation);
  if (conversation === current) drawThread();
  drawList();
  drawComposer();
}

async function send() {
  const box = $("prompt");
  const text = box.value.trim();
  if ((!text && !attached.length) || busy) return;
  // The router window can only open during a click or a key press, and this is one.
  if (!ai || !ai.ready) { if (!(await choose())) return; }
  box.value = "";
  grow();
  const images = attached;
  attached = [];
  drawAttached();
  const conversation = current;
  conversation.messages.push({ id: db.newId(), role: "user", content: text, ...(images.length ? { images } : {}), at: Date.now() });
  if (!conversation.named && conversation.messages.length === 1) conversation.title = text.split("\n")[0].replace(/\s+/g, " ").slice(0, 60) || (images.length ? "An image" : "New chat");
  await keep(conversation);
  if (conversation === current) history.replaceState(null, "", location.pathname + location.search + "#c=" + conversation.id);
  await answer(conversation);
}

// Ask again: drop the last answer and ask for another.
async function retry() {
  if (busy || !current.messages.length) return;
  if (!ai || !ai.ready) { if (!(await choose())) return; }
  const conversation = current;
  if (conversation.messages.at(-1).role === "assistant") conversation.messages.pop();
  if (!conversation.messages.length) return;
  await answer(conversation);
}

// ------------------------------------------------------------- the message box

// A line above the message box. It goes away by itself.
let noticeTimer = 0;
function notice(text) {
  clearTimeout(noticeTimer);
  $("notice").textContent = text;
  $("notice").hidden = !text;
  if (text) noticeTimer = setTimeout(() => { $("notice").hidden = true; }, 8000);
}
function drawComposer() {
  $("send").hidden = !!busy;
  $("stop").hidden = !busy;
  $("hint").textContent = busy ? "The answer is arriving. You can stop it." : "Enter sends. Shift and Enter starts a new line.";
}
// The box grows with what is typed. Browsers that can do that in CSS need no help.
const growsAlone = CSS.supports("field-sizing", "content");
function grow() {
  if (growsAlone) return;
  const box = $("prompt");
  box.style.height = "auto";
  box.style.height = Math.min(box.scrollHeight, 208) + "px";
}
$("prompt").addEventListener("input", grow);
$("prompt").addEventListener("keydown", (event) => {
  // Enter sends. Not while a word is being composed, as in Japanese or Chinese input, where Enter picks the word.
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  if (matchMedia("(pointer: coarse)").matches) return;   // on a phone, Enter is a new line and the button sends
  event.preventDefault();
  send();
});
$("composer").addEventListener("submit", (event) => { event.preventDefault(); send(); });
$("stop").addEventListener("click", () => busy && busy.stop.abort());

// ------------------------------------------------------------------- images

// An image is kept as a data: address, in the message it was sent with. Only
// these four kinds are sent, and only an address of this shape is ever drawn.
const IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const MOST_IMAGES = 6;          // in one message
const LONGEST_SIDE = 1568;      // a model sees no more in a larger picture
const imagesOf = (message) => (Array.isArray(message.images) ? message.images.filter((url) => typeof url === "string" && IMAGE.test(url)) : []);

const asDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});
// A large photo is made smaller before it is kept or sent. A small one is left as it is.
async function shrink(file) {
  const known = ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type);
  const picture = await createImageBitmap(file);
  const scale = Math.min(1, LONGEST_SIDE / Math.max(picture.width, picture.height));
  if (known && scale === 1 && file.size <= 1_500_000) { picture.close(); return asDataUrl(file); }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(picture.width * scale));
  canvas.height = Math.max(1, Math.round(picture.height * scale));
  const pen = canvas.getContext("2d");
  pen.fillStyle = "#fff";     // a see-through picture gets a white ground, since JPEG has none
  pen.fillRect(0, 0, canvas.width, canvas.height);
  pen.drawImage(picture, 0, 0, canvas.width, canvas.height);
  picture.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
  if (!blob) throw new Error("could not be read");
  return asDataUrl(blob);
}
async function addImages(files) {
  const pictures = [...files].filter((file) => file.type.startsWith("image/"));
  if (!pictures.length) return;
  let failed = 0;
  for (const file of pictures) {
    if (attached.length >= MOST_IMAGES) { notice(`A message can carry up to ${MOST_IMAGES} images.`); break; }
    try {
      const url = await shrink(file);
      if (IMAGE.test(url)) attached.push(url); else failed++;
    } catch { failed++; }
  }
  if (failed) notice(failed === 1 ? "One of those could not be read as an image." : `${failed} of those could not be read as images.`);
  drawAttached();
  $("prompt").focus();
}
function drawAttached() {
  const row = $("attached");
  row.hidden = !attached.length;
  row.innerHTML = attached.map((url, i) => `<span class="thumb"><img src="${esc(url)}" alt="Image ${i + 1} to send"><button type="button" class="quiet" data-drop="${i}" aria-label="Remove image ${i + 1}">×</button></span>`).join("");
}
$("attached").addEventListener("click", (event) => {
  const button = event.target.closest("[data-drop]");
  if (!button) return;
  attached.splice(Number(button.dataset.drop), 1);
  drawAttached();
});
$("attach").addEventListener("click", () => $("attach-file").click());
$("attach-file").addEventListener("change", () => { const files = [...$("attach-file").files]; $("attach-file").value = ""; addImages(files); });
// An image can be pasted into the message box, or dropped anywhere on the conversation.
$("prompt").addEventListener("paste", (event) => {
  const files = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  event.preventDefault();
  addImages(files);
});
const carriesFiles = (event) => [...(event.dataTransfer?.types || [])].includes("Files");
$("main").addEventListener("dragover", (event) => { if (carriesFiles(event)) { event.preventDefault(); $("main").classList.add("dropping"); } });
$("main").addEventListener("dragleave", (event) => { if (!$("main").contains(event.relatedTarget)) $("main").classList.remove("dropping"); });
$("main").addEventListener("drop", (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  $("main").classList.remove("dropping");
  addImages(event.dataTransfer.files);
});

// ------------------------------------------------------------------ buttons

$("thread").addEventListener("click", async (event) => {
  const copyCode = event.target.closest("[data-copy-code]");
  if (copyCode) return copied(copyCode, copyCode.closest(".code").querySelector("code").textContent);
  const button = event.target.closest("[data-act]");
  if (!button) return;
  const act = button.dataset.act;
  if (act === "choose") { if (await choose()) drawThread(); }
  else if (act === "retry") retry();
  else if (act === "copy") {
    const id = button.closest(".msg").dataset.id;
    const message = current.messages.find((m) => m.id === id);
    if (message) copied(button, message.content);
  }
});
async function copied(button, text) {
  const was = button.textContent;
  try { await navigator.clipboard.writeText(text); button.textContent = "Copied"; } catch { button.textContent = "Could not copy"; }
  setTimeout(() => { button.textContent = was; }, 1400);
}

$("new-chat").addEventListener("click", () => open(null));
$("search").addEventListener("input", drawList);
$("list").addEventListener("click", (event) => {
  const link = event.target.closest("a.conv");
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  const found = conversations.find((c) => "#c=" + c.id === link.getAttribute("href"));
  if (found) open(found);
});
addEventListener("hashchange", () => {
  const id = location.hash.startsWith("#c=") ? location.hash.slice(3) : "";
  if (id === (saved(current) ? current.id : "")) return;
  open(conversations.find((c) => c.id === id) || null);
});

// The list, on a narrow screen.
function openSide() { $("app").classList.add("side-is-open"); $("scrim").hidden = false; $("side-open").setAttribute("aria-expanded", "true"); $("side-close").focus(); }
function closeSide() { if (!$("app").classList.contains("side-is-open")) return; $("app").classList.remove("side-is-open"); $("scrim").hidden = true; $("side-open").setAttribute("aria-expanded", "false"); }
$("side-open").addEventListener("click", openSide);
$("side-close").addEventListener("click", () => { closeSide(); $("side-open").focus(); });
$("scrim").addEventListener("click", closeSide);
addEventListener("keydown", (event) => { if (event.key === "Escape" && $("app").classList.contains("side-is-open")) { closeSide(); $("side-open").focus(); } });

// The model, and how this app holds the router.
// The model button opens the router window: to choose a model the first time, to change
// it, or to set up another account. What this app is using, and how it holds the router,
// are under "Model and router" in the menu.
$("model").addEventListener("click", () => { if (ai) choose(); else $("connection-dialog").showModal(); });
$("connection-choose").addEventListener("click", async () => { $("connection-dialog").close(); await choose(); });
$("connection-forget").addEventListener("click", () => { ai.forget(); $("connection-dialog").close(); });
$("via").addEventListener("change", (event) => {
  localStorage.setItem("chat.via", event.target.value);
  location.replace(location.pathname + location.hash);    // connect again, the other way
});

// The menu for the conversation on screen.
const closeMenu = () => { try { $("menu").hidePopover(); } catch { /* not open */ } };
$("menu-connection").addEventListener("click", () => { closeMenu(); $("connection-dialog").showModal(); });
$("menu-instructions").addEventListener("click", () => { closeMenu(); $("instructions-input").value = current.system; $("instructions-dialog").showModal(); });
$("instructions-dialog").addEventListener("close", async () => {
  if ($("instructions-dialog").returnValue !== "save") return;
  current.system = $("instructions-input").value.trim();
  if (saved(current)) await keep(current);
  notice(current.system ? "Instructions saved. They are sent with every message in this conversation." : "");
});
$("menu-rename").addEventListener("click", () => { closeMenu(); $("rename-input").value = current.title; $("rename-dialog").showModal(); $("rename-input").select(); });
$("rename-dialog").addEventListener("close", async () => {
  const title = $("rename-input").value.trim();
  if ($("rename-dialog").returnValue !== "save" || !title) return;
  current.title = title;
  current.named = true;
  await keep(current);
  drawTop();
  drawList();
});
$("menu-delete").addEventListener("click", () => { closeMenu(); $("delete-name").textContent = current.title; $("delete-dialog").showModal(); });
$("delete-dialog").addEventListener("close", async () => {
  if ($("delete-dialog").returnValue !== "delete") return;
  const gone = current;
  gone.deleted = true;
  if (busy && busy.conversation === gone) busy.stop.abort();
  conversations = conversations.filter((c) => c.id !== gone.id);
  await db.remove(gone.id);
  tabs?.postMessage({ removed: gone.id });
  open(null);
});

// ------------------------------------------------------- export and import

function download(name, type, text) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
const fileName = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "conversation";
$("menu-export").addEventListener("click", () => {
  closeMenu();
  const parts = [`# ${current.title}`];
  if (current.system) parts.push(`> Instructions: ${current.system.replace(/\n/g, "\n> ")}`);
  for (const m of current.messages) {
    const pictures = m.role === "user" ? imagesOf(m).length : 0;
    const said = [m.content, pictures ? `_(${pictures === 1 ? "an image" : pictures + " images"})_` : ""].filter(Boolean).join("\n\n");
    if (said) parts.push(`**${m.role === "user" ? "You" : who(m)}**\n\n${said}`);
  }
  download(fileName(current.title) + ".md", "text/markdown", parts.join("\n\n") + "\n");
});
$("export-all").addEventListener("click", () => {
  if (!conversations.length) return notice("There is nothing to export yet.");
  download("chat-conversations.json", "application/json", JSON.stringify({ app: "port-authority-chat", version: 1, exported: new Date().toISOString(), conversations }, null, 2));
});
$("import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async () => {
  const file = $("import-file").files[0];
  $("import-file").value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = (Array.isArray(data) ? data : data.conversations || []).map(db.clean).filter(Boolean);
    if (!list.length) throw new Error("no conversations");
    for (const conversation of list) { await db.save(conversation); conversations.push(conversation); }
    conversations.sort((a, b) => b.updated - a.updated);
    tabs?.postMessage({ changed: list[0].id });
    drawList();
    notice(`${list.length} ${list.length === 1 ? "conversation" : "conversations"} added.`);
  } catch {
    notice("That file has no conversations this app can read. Choose a file made with Export all.");
  }
});

// Another tab changed something: read the list again, and the open conversation if it is not busy here.
if (tabs) tabs.onmessage = async (event) => {
  conversations = (await db.all()).map((c) => (busy && busy.conversation.id === c.id ? busy.conversation : c));
  const { changed, removed } = event.data || {};
  if (removed && current.id === removed) return open(null, { focus: false });
  if (changed && current.id === changed && !(busy && busy.conversation.id === changed)) {
    const fresh = conversations.find((c) => c.id === changed);
    if (fresh) { current = fresh; drawThread(); drawTop(); }
  }
  drawList();
};

// ----------------------------------------------------------------- start

$("router-link").href = $("connection-router").href = sites.router + "/";
drawComposer();
try {
  conversations = await db.all();
} catch {
  notice("This browser would not open its storage, so conversations will not be saved.");
}
const first = location.hash.startsWith("#c=") ? conversations.find((c) => c.id === location.hash.slice(3)) : null;
open(first || null);
connectRouter();
