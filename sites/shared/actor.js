// A part played by a real site. The patterns page embeds this file from the
// florist's and the library's own origins, so that what crosses between the
// boxes crosses between real origins, with real storage on each side.
// The role comes from the URL. The stage talks to it exactly as it talks to
// the sandboxed frames elsewhere.
import { runtime } from "/wire.js";

const params = new URLSearchParams(location.search);
const role = params.get("role");
document.getElementById("title").textContent = params.get("title") || role;
document.getElementById("title").style.setProperty("--dot", params.get("color") || "#f5b700");
document.getElementById("origin").textContent = location.host;

const store = () => new Promise((resolve, reject) => {
  const open = indexedDB.open("pa-actor", 1);
  open.onupgradeneeded = () => open.result.createObjectStore("s");
  open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
});
const done = (request) => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });

const ROLES = {
  // Is handed a CryptoKey itself, not a port to one.
  async keeper() {
    const slot = "key-" + params.get("run");
    const db = await store();
    let key = await done(db.transaction("s").objectStore("s").get(slot));
    if (key) log("I still have the key. It was in my own storage.");
    on("key", async (data) => {
      key = data.key;
      await done(db.transaction("s", "readwrite").objectStore("s").put(key, slot));
      let readable = "yes";
      try { await crypto.subtle.exportKey("jwk", key); } catch { readable = "no"; }
      log(`given a key. can I read it? ${readable}. saved it in my storage.`);
    });
    on("sign", async (data) => {
      if (!key) return log("I have no key");
      const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(data.text));
      log("signed: " + data.text);
      tell("signed", { text: data.text, signature });
    });
  },

  // Is handed only the readable half of something.
  listener() {
    on("feed", async (data) => {
      const feed = data.readable;
      log(`given a ${Object.prototype.toString.call(feed).slice(8, -1)}. can I write to it? ${"getWriter" in feed ? "yes" : "no"}`);
      const reader = feed.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) { log("the feed was closed by its owner"); break; }
        log("heard: " + value); tell("pulse", { cable: "feed" });
      }
    });
  },

  // Is handed only the writable half of something.
  dropper() {
    let writer = null, n = 0;
    on("box", (data) => {
      const box = data.writable;
      log(`given a ${Object.prototype.toString.call(box).slice(8, -1)}. can I read from it? ${"getReader" in box ? "yes" : "no"}`);
      writer = box.getWriter();
    });
    on("drop", async () => {
      if (!writer) return log("I have nowhere to put it");
      try { await writer.write(`note ${++n} from ${location.host}`); log(`dropped note ${n}`); tell("pulse", { cable: "box" }); }
      catch (err) { log("the box is shut: " + (err?.message || err)); }
    });
  },

  // Offers a transform: text goes in one end and comes out the other with
  // anything that looks like an email address or a long number blacked out.
  redactor() {
    on("offer", () => {
      let n = 0;
      const { readable, writable } = new TransformStream({
        transform(chunk, controller) {
          log(`redacted line ${++n}`);
          controller.enqueue(String(chunk).replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]").replace(/\b\d[\d -]{6,}\d\b/g, "[number]"));
        },
      });
      log("made a transform, giving away both ends");
      parent.postMessage({ wire: "transform", writable, readable }, "*", [writable, readable]);
    });
  },

};

// The runtime sets up log(), tell(), send() and on(), then tells the stage we are ready.
runtime();
ROLES[role]?.();
