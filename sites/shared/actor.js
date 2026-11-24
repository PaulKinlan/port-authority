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
  // One of two sites that do not know each other. It is given a port to the
  // introducer, and later a second port arrives down that one.
  side() {
    let n = 0;
    on("port", (_, [port]) => {
      log("holding a line to the introducer");
      port.onmessage = (e) => {
        const direct = e.ports[0];
        log(`introduced to ${e.data.meet}`);
        tell("met");
        direct.onmessage = (m) => { log(`${e.data.meet} says ${m.data}`); };
        on("talk", () => { send(direct, "direct", `hello ${++n}`); log(`said hello ${n}`); });
      };
    });
    on("talk", () => log("I do not know anyone yet"));
  },

  // Holds a port to each of the two sides. Makes a channel and gives each side one end.
  introducer() {
    const lines = {};
    on("port", (data, [port]) => { lines[data.side] = port; });
    on("introduce", () => {
      const { port1, port2 } = new MessageChannel();
      send(lines.left, "i-left", { meet: "Site B" }, [port1]);
      send(lines.right, "i-right", { meet: "Site A" }, [port2]);
      log("made a channel, gave away both ends");
    });
  },

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

  // Serves files to whoever holds the other end of a port. The patterns page
  // gives that end to its service worker, which mounts this site at a path.
  shelf() {
    let served = 0;
    const text = (body, type, status = 200) => ({ status, headers: { "content-type": type + "; charset=utf-8", "cache-control": "no-store" }, body });
    // A body that arrives a line at a time, to show that it is a stream.
    const slowly = (lines) => {
      let i = 0;
      return new ReadableStream({
        async pull(controller) {
          if (i >= lines.length) return controller.close();
          await new Promise((r) => setTimeout(r, 450));
          controller.enqueue(new TextEncoder().encode(lines[i++] + "\n"));
        },
      });
    };
    // What this site has on its shelf. The florist and the library serve different things.
    const SHELVES = {
      florist: { heading: "The florist's catalogue", icon: "tulip.svg", lines: ["tulips: 24", "roses: 9", "peonies: 3"],
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 30V17" stroke="#0e9f8e" stroke-width="3" stroke-linecap="round"/><path d="M8 4c0 9 3 14 8 14s8-5 8-14l-4 4-4-6-4 6z" fill="#e0364c"/></svg>` },
      library: { heading: "The library's catalogue", icon: "book.svg", lines: ["Middlemarch: on the shelf", "Dune: out until Friday", "Beloved: on the shelf"],
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M5 6h10a3 3 0 0 1 3 3v19a3 3 0 0 0-3-3H5z" fill="#0e9f8e"/><path d="M27 6H17a3 3 0 0 0-3 3v19a3 3 0 0 1 3-3h10z" fill="#f5b700"/></svg>` },
    };
    const who = SHELVES[params.get("shelf")] ? params.get("shelf") : "florist";
    const shelf = SHELVES[who];
    const FILES = {
      "catalogue.html": () => text(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>html{color-scheme:light dark}body{font:14px/1.4 system-ui,sans-serif;margin:.7rem .8rem}h1{font-size:1rem;margin:0 0 .3rem;display:flex;gap:.4rem;align-items:center}img{width:1.6rem;height:1.6rem}p,li{font:12px/1.45 ui-monospace,Menlo,monospace;margin:0;overflow-wrap:anywhere}ul{list-style:none;padding:0;margin:.3rem 0 0}</style>
<h1><img src="${shelf.icon}" alt="">${shelf.heading}</h1>
<p>Written by ${location.host}. My address is <span id="where"></span>.</p>
<ul id="stock"></ul>
<script>
  document.getElementById("where").textContent = location.host + location.pathname;
  // A relative fetch. It goes to the same mount, and its body arrives as it is written.
  fetch("stock.txt").then(async (response) => {
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    const start = performance.now();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const line of value.split("\\n").filter(Boolean)) { const li = document.createElement("li"); li.textContent = line + " (" + ((performance.now() - start) / 1000).toFixed(1) + " s)"; document.getElementById("stock").append(li); }
    }
  });
<\/script>`, "text/html"),
      [shelf.icon]: () => text(shelf.svg, "image/svg+xml"),
      "stock.txt": () => ({ status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }, body: slowly(shelf.lines) }),
    };
    on("serve", (data, ports) => {
      log("given a port. I will answer what comes down it.");
      ports[0].onmessage = (event) => {
        const { path } = event.data, reply = event.ports[0];
        const make = FILES[path];
        const answer = make ? make() : text(`The ${who} has no ${path}`, "text/plain", 404);
        log(`${answer.status} ${path}`); served++;
        tell("pulse", { cable: "mount" });
        // The body is transferred when it is a stream: the far side reads it as it is produced.
        try { reply.postMessage(answer, answer.body instanceof ReadableStream ? [answer.body] : []); }
        catch (err) { reply.postMessage(text("could not send: " + err.message, "text/plain", 500)); }
      };
    });
  },

  // Is handed a port to post prices into. It also listens on that port, to
  // show whether anything ever comes back.
  publisher() {
    let port = null, n = 0;
    on("feed", (data, ports) => {
      port = ports[0];
      log("given a port to publish on");
      port.onmessage = (event) => { log("heard back: " + JSON.stringify(event.data)); tell("heard"); };
    });
    on("publish", () => {
      if (!port) return log("I have nowhere to publish");
      const price = (4 + Math.sin(++n) * 0.6).toFixed(2);
      port.postMessage({ tulips: price });
      log(`published tulips at ${price}`); tell("pulse", { cable: "in" });
    });
    // Try to give the other side a private line by sending a port forward.
    on("smuggle", () => {
      if (!port) return;
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = (event) => { log("the private line works: " + event.data); tell("leak"); };
      port.postMessage({ line: port2 }, [port2]);
      log("sent a message with a port in it"); tell("pulse", { cable: "in" });
    });
  },

  // Is handed a port to hear prices on. It tries to answer on it.
  subscriber() {
    let port = null, n = 0;
    on("feed", (data, ports) => {
      port = ports[0];
      log(`given a ${port.constructor.name}. It has postMessage like any other.`);
      port.onmessage = (event) => {
        if (event.data.line) { event.data.line.postMessage("hello from " + location.host); return log("got a port. Answered on it."); }
        log("heard: tulips at " + event.data.tulips); tell("got");
      };
    });
    on("answer", () => {
      if (!port) return log("I have no port");
      port.postMessage({ order: `${++n} tulips, from ${location.host}` });
      log(`posted an order into the port (${n})`); tell("pulse", { cable: "out" });
    });
    // Try to open a way back by posting a port.
    on("smuggle", () => {
      if (!port) return;
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = () => log("someone used the port I sent");
      port.postMessage({ reply: port2 }, [port2]);
      log("posted a port into the port"); tell("pulse", { cable: "out" });
    });
  },

};

// The runtime sets up log(), tell(), send() and on(), then tells the stage we are ready.
runtime();
ROLES[role]?.();
