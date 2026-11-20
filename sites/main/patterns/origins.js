// Between real origins. The outer boxes here are not sandboxes: they are the
// florist's and the library's own sites, embedded, each with its own storage.
// What crosses between boxes crosses between real origins.
import { sites } from "/_sites.js";

const COLOR = { yellow: "#f5b700", red: "#e0364c", teal: "#0e9f8e" };
const actor = (stage, name, site, role, title, color, extra = "") => {
  const box = stage.box(name, { src: `${sites[site]}/actor.html?role=${role}&title=${encodeURIComponent(title)}&color=${encodeURIComponent(COLOR[color])}${extra}` });
  box.frame.title = title;
  return box;
};
const pageBox = (stage, title, extra = "") => {
  const box = stage.box("page", { html: `<div class="here"><h4>${title}</h4>${extra}<ul class="log"></ul></div>` });
  const ul = box.node.querySelector("ul");
  const say = (text) => { const li = document.createElement("li"); li.textContent = text; ul.prepend(li); while (ul.children.length > 6) ul.lastChild.remove(); };
  return { say, node: box.node };
};
const ECDSA = { name: "ECDSA", namedCurve: "P-256" }, SIGN = { name: "ECDSA", hash: "SHA-256" };

export const origins = [
  {
    id: "keycopy",
    title: "Give another site your key, and see that you cannot take it back",
    blurb: "A <code>CryptoKey</code> can be posted to another origin. This page makes a signing key that cannot be read, and sends the key itself to the florist's site. The florist can now sign as you. It cannot read the key either, but it can keep it: it saves the key in its own IndexedDB, and after a reload it still has it. Nothing this page does can undo that. Compare the experiment above, where the key stays put and only a port travels. A copied key is a gift. A port is a loan.",
    code: `const { privateKey } = await crypto.subtle.generateKey(ECDSA, false, ["sign"]);
floristWindow.postMessage({ key: privateKey }, floristOrigin);   <span class="c">// a copy, not a move</span>

<span class="c">// the florist, on its own origin</span>
await db.put(key, "theirs");                 <span class="c">// kept, for as long as it likes</span>
await crypto.subtle.sign(ECDSA, key, bytes); <span class="c">// signs as you</span>`,
    async setup(stage, ui) {
      const { say } = pageBox(stage, "This page made the key");
      const run = Math.random().toString(36).slice(2, 10);
      const keeper = actor(stage, "keeper", "florist", "keeper", "Florist, a real site", "red", `&run=${run}`);
      await keeper.whenReady;
      let pair = null;
      try { pair = await crypto.subtle.generateKey(ECDSA, false, ["sign", "verify"]); say("made a signing key nobody can read"); }
      catch (err) { return say("no WebCrypto here: " + err.message); }
      const publicKey = pair.publicKey;
      let n = 0;
      stage.on(async (name, data) => {
        if (name !== "keeper" || data.wire !== "signed") return;
        const ok = await crypto.subtle.verify(SIGN, publicKey, data.signature, new TextEncoder().encode(data.text));
        say(`${ok ? "verified" : "NOT valid"}: the florist signed "${data.text}" as me`);
        stage.pulse("gift", "keeper");
      });
      const sign = ui.button("Florist: sign an order", () => stage.post("keeper", { cmd: "sign", text: `order ${++n}: tulips` }), true);
      const forget = ui.button("Destroy this page's copy", (btn) => { pair = null; btn.disabled = true; say("this page no longer has the key. The florist still does."); }, true);
      const reload = ui.button("Reload the florist", () => { keeper.frame.src = keeper.frame.src; say("the florist's page was thrown away and loaded again"); }, true);
      ui.button("Send the key itself to the florist", (btn) => {
        stage.post("keeper", { cmd: "key", key: pair.privateKey });
        stage.cable("gift", "page", "keeper", "red");
        say("sent the key. It was copied, so I still hold mine.");
        btn.disabled = true; sign.disabled = forget.disabled = reload.disabled = false;
      }, false, true);
    },
  },
  {
    id: "halves",
    title: "Half a stream is a permission",
    blurb: "A stream has a direction, and you can hand over one direction without the other. The library's site gets only something to read from: it can listen and has nothing to speak into. The florist's site gets only something to write into: it can post notes through the slot and cannot see what else is inside. Each half is also a switch its owner keeps. Close the feed and the listener is told it has ended. Shut the box and the next write fails. No roles, no access lists: what you hold is what you may do.",
    code: `<span class="c">// listen only</span>
library.postMessage({ readable }, origin, [readable]);

<span class="c">// write only</span>
const writable = new WritableStream({ start(c) { box = c; }, write: keep });
florist.postMessage({ writable }, origin, [writable]);
box.error(new Error("shut"));               <span class="c">// later: their next write fails</span>`,
    async setup(stage, ui) {
      const listener = actor(stage, "listener", "library", "listener", "Library, a real site", "teal");
      const { say } = pageBox(stage, "This page owns both");
      const dropper = actor(stage, "dropper", "florist", "dropper", "Florist, a real site", "red");
      await Promise.all([listener.whenReady, dropper.whenReady]);
      let feed = null, timer = null, shut = null, n = 0;
      const drop = ui.button("Florist: drop a note", () => stage.post("dropper", { cmd: "drop" }), true);
      const close = ui.button("Close the feed", (btn) => { clearInterval(timer); try { feed.close(); } catch {} btn.disabled = true; say("closed the feed"); stage.cut("feed"); }, true);
      const shutBtn = ui.button("Shut the drop box", (btn) => { shut.error(new Error("the owner shut it")); btn.disabled = true; stage.cut("box"); say("shut the box. The next note will bounce."); }, true);
      const give = ui.button("Give the florist the writing half", (btn) => {
        const writable = new WritableStream({ start(controller) { shut = controller; }, write(note) { say("found in the box: " + note); } });
        stage.post("dropper", { cmd: "box", writable }, [writable]);
        stage.cable("box", "dropper", "page", "red");
        btn.disabled = true; drop.disabled = shutBtn.disabled = false;
      }, true);
      ui.button("Give the library the listening half", (btn) => {
        const readable = new ReadableStream({ start(controller) { feed = controller; } });
        timer = setInterval(() => { if (!listener.frame.isConnected) return clearInterval(timer); feed.enqueue(`tick ${++n}`); }, 900);
        stage.post("listener", { cmd: "feed", readable }, [readable]);
        stage.cable("feed", "page", "listener", "teal");
        say("gave away the readable half, kept the controller");
        btn.disabled = true; give.disabled = close.disabled = false;
      }, false, true);
    },
  },
  {
    id: "roundtrip",
    title: "Pipe your data through another site, and get it back",
    blurb: "A transform has two ends, and both can be given away. The library's site makes one that blacks out email addresses and long numbers, and hands this page the end to write into and the end to read from. From here it is an ordinary <code>pipeThrough</code>: your lines go in, cross to the library's origin, are changed by code this page never loads or sees, and come back. Back-pressure crosses with them. A service you call by piping.",
    code: `<span class="c">// the library, on its own origin</span>
const { readable, writable } = new TransformStream({ transform: redact });
parent.postMessage({ readable, writable }, "*", [readable, writable]);

<span class="c">// this page</span>
myLines.pipeThrough({ readable, writable }).pipeTo(screen);`,
    async setup(stage, ui) {
      const { say } = pageBox(stage, "This page has private lines");
      const redactor = actor(stage, "redactor", "library", "redactor", "Library, a real site", "teal");
      const out = stage.box("out", { html: `<div class="here"><h4>What came back</h4><ul class="log"><li class="muted">nothing yet</li></ul></div>` });
      await redactor.whenReady;
      const lines = ["Write to ada@example.com about the order", "Card 4929 1234 5678 9012, expires soon", "Call 020 7946 0991 after six", "Nothing secret in this one"];
      let writer = null, i = 0;
      stage.on((name, data) => {
        if (name !== "redactor" || data.wire !== "transform") return;
        writer = data.writable.getWriter();
        const list = out.node.querySelector("ul"); list.innerHTML = "";
        data.readable.pipeTo(new WritableStream({ write(line) { const li = document.createElement("li"); li.textContent = line; list.prepend(li); stage.pulse("back", "redactor"); } }));
        stage.cable("there", "page", "redactor", "teal");
        stage.cable("back", "redactor", "out", "teal");
        say("holding both ends of the library's transform");
        send.disabled = false;
      });
      const send = ui.button("Send a line through it", () => { const line = lines[i++ % lines.length]; writer.write(line); say("sent: " + line); stage.pulse("there", "page"); }, true);
      ui.button("Ask the library for its transform", (btn) => { stage.post("redactor", { cmd: "offer" }); btn.disabled = true; }, false, true);
    },
  },
  {
    id: "lend",
    title: "Lend someone a network connection you opened",
    blurb: "The widget on the right is locked down so that it cannot reach the network at all. This page opens a WebSocket to the server and hands the widget the two streams that are the connection: one to write to, one to read from. The widget is now talking to the server. It never learns the address, it cannot open a second connection, and it keeps talking only until this page closes the socket. Hand over just the readable stream and it becomes a tap that can listen and not speak. Network access, delegated one connection at a time.",
    code: `const { readable, writable } = await new WebSocketStream(url).opened;
widget.postMessage({ readable, writable }, "*", [readable, writable]);

<span class="c">// the widget, which has no network of its own</span>
await writable.getWriter().write("hello");
const { value } = await readable.getReader().read();   <span class="c">// the server's answer</span>`,
    async setup(stage, ui) {
      const echo = `${location.origin.replace(/^http/, "ws")}/echo`;
      const { say } = pageBox(stage, "This page opens the connection");
      await stage.frame("widget", {
        title: "Widget with no network", color: "red",
        csp: "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
        script: () => {
          let writer = null, n = 0;
          on("own", (data) => {
            try {
              const ws = new WebSocket(data.url);
              ws.onopen = () => { log("I opened my own connection"); ws.close(); };
              ws.onerror = () => log("I tried to connect by myself and was blocked");
            } catch { log("I tried to connect by myself and was blocked"); }
          });
          on("line", async (data) => {
            log(`lent ${data.writable ? "both ends" : "the listening end"} of a connection`);
            writer = data.writable ? data.writable.getWriter() : null;
            const reader = data.readable.getReader();
            for (;;) {
              const { value, done } = await reader.read().catch(() => ({ done: true }));
              if (done) { log("the connection was closed by its owner"); writer = null; break; }
              log(String(value)); tell("pulse", { cable: "lent" });
            }
          });
          on("say", async () => {
            if (!writer) return log("I have nothing to speak into");
            try { await writer.write(`hello ${++n} from the widget`); log(`said hello ${n}`); tell("pulse", { cable: "lent" }); }
            catch { log("the connection is gone"); writer = null; }
          });
        },
      });
      // A WebSocket as two streams. WebSocketStream does this natively where it exists.
      const open = async () => {
        if ("WebSocketStream" in self) { const wss = new WebSocketStream(echo); const { readable, writable } = await wss.opened; return { readable, writable, close: () => wss.close(), how: "WebSocketStream" }; }
        const ws = new WebSocket(echo);
        await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error("could not connect")); });
        const readable = new ReadableStream({ start(c) { ws.onmessage = (e) => c.enqueue(e.data); ws.onclose = () => { try { c.close(); } catch {} }; } });
        const writable = new WritableStream({ write(chunk) { ws.send(chunk); } });
        return { readable, writable, close: () => ws.close(), how: "a WebSocket wrapped in streams" };
      };
      let line = null;
      const alone = ui.button("Widget: try to connect by itself", () => stage.post("widget", { cmd: "own", url: echo }));
      const lend = ui.button("Lend the widget the connection", (btn) => {
        stage.post("widget", { cmd: "line", readable: line.readable, writable: line.writable }, [line.readable, line.writable]);
        stage.cable("lent", "page", "widget", "red");
        say("handed over both streams. I kept the socket itself.");
        btn.disabled = true; hello.disabled = back.disabled = false;
      }, true);
      const hello = ui.button("Widget: say hello to the server", () => stage.post("widget", { cmd: "say" }), true);
      const back = ui.button("Close the connection", (btn) => { line.close(); btn.disabled = true; stage.cut("lent"); say("closed the socket. The widget is cut off."); }, true);
      ui.button("Open a connection to the server", async (btn) => {
        btn.disabled = true;
        try { line = await open(); say(`connected, using ${line.how}`); lend.disabled = false; }
        catch (err) { say("could not connect: " + err.message); }
      }, false, true);
      void alone;
    },
  },
];
