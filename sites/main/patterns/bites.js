// Runnable examples for the guide's list of things that go wrong, each with
// the habit that deals with it. Same stage as the patterns.

const logBox = (stage, name, title, extra = "", what = {}) => {
  const box = stage.box(name, { html: `<div class="here"><div class="box-title">${title}</div>${extra}<ul class="log" role="log" aria-live="polite"></ul></div>`, ...what });
  const ul = box.node.querySelector("ul");
  const say = (text) => { const li = document.createElement("li"); li.textContent = text; ul.prepend(li); while (ul.children.length > 6) ul.lastChild.remove(); };
  return { say, node: box.node, box };
};

export const bites = [
  {
    id: "bite-start", bite: true,
    title: "A port that is listening and hears nothing",
    blurb: "The frame attached its listener with <code>addEventListener</code> and did not call <code>start()</code>. Two messages are sent and nothing happens. They are not lost: they are waiting in the port. Call <code>start()</code> and both arrive at once, in order.",
    code: `port.addEventListener("message", onMessage);
port.start();                    <span class="c">// without this line, nothing is ever delivered</span>

port.onmessage = onMessage;      <span class="c">// or use this, which starts the port for you</span>`,
    tour: { steps: [["Send a message", "The frame is listening with addEventListener. Nothing arrives."], ["Send a message", "A second message. Still nothing."], ["Frame: call port.start()", "Both messages were waiting in the port. They arrive now, in order."]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page sends");
      await stage.frame("frame", {
        title: "A frame that forgot start()", color: "red",
        script: () => {
          let port = null;
          on("port", (_, [p]) => { port = p; port.addEventListener("message", ({ data }) => log("received: " + data)); log("listening with addEventListener"); });
          on("start", () => { port.start(); log("called port.start()"); });
        },
      });
      const channel = new MessageChannel();
      stage.post("frame", { cmd: "port" }, [channel.port2]);
      stage.cable("line", "page", "frame", "red");
      let n = 0;
      ui.button("Send a message", () => { channel.port1.postMessage(`message ${++n}`); stage.pulse("line", "page"); me.say(`sent message ${n}. No error, and no way to tell it is not being read.`); }, false, true);
      ui.button("Frame: call port.start()", (btn) => { stage.post("frame", { cmd: "start" }); btn.disabled = true; });
    },
  },
  {
    id: "bite-gone", bite: true,
    title: "The other end goes away, and a heartbeat notices",
    blurb: "This page holds a port to a service in a frame. Remove the frame and the port looks exactly as it did: no event fires, and posting to it throws nothing. The only way to know is to ask and time the answer. Here the page pings once a second, and treats a second and a half of silence as the end.",
    code: `let alive = true;
port.onmessage = ({ data }) => { if (data === "pong") alive = true; else handle(data); };
const beat = setInterval(() => {
  if (!alive) { clearInterval(beat); port.close(); return onGone(); }   <span class="c">// no answer to the last ping</span>
  alive = false;
  port.postMessage("ping");
}, 1000);

<span class="c">// on one origin there is something better: a lock the other side holds for life</span>
navigator.locks.request(theirLockName, () => onGone());   <span class="c">// granted only when they are gone</span>`,
    tour: { steps: [["Start a heartbeat", "The page pings once a second and the service answers.", 2400], ["Remove the service", "The frame is destroyed. The port gives no sign. The next ping gets no answer, and the page calls it.", 3200]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page holds a port");
      await stage.frame("service", {
        title: "Service on another origin", color: "teal",
        script: () => on("port", (_, [port]) => { log("answering pings"); port.onmessage = ({ data }) => { if (data === "ping") send(port, "line", "pong"); }; }),
      });
      const channel = new MessageChannel(), port = channel.port1;
      stage.post("service", { cmd: "port" }, [channel.port2]);
      stage.cable("line", "page", "service", "teal");
      let alive = true, n = 0, beat = null;
      stage.cleanup(() => { clearInterval(beat); port.close(); });
      port.onmessage = ({ data }) => { if (data === "pong") { alive = true; me.say(`pong ${n}: the other end is there`); } };
      const remove = ui.button("Remove the service", (btn) => { stage.remove("service"); btn.disabled = true; me.say("the frame is gone. My port fired no event."); }, true);
      ui.button("Start a heartbeat", (btn) => {
        btn.disabled = true; remove.disabled = false;
        const tick = () => {
          if (!me.node.isConnected) return clearInterval(beat);
          if (!alive) { clearInterval(beat); port.close(); return me.say(`no answer to ping ${n}. Treating the other end as gone, and closing my port.`); }
          alive = false; port.postMessage("ping"); n++;
        };
        tick(); beat = setInterval(tick, 1000);
      }, false, true);
    },
  },
  {
    id: "bite-lost", bite: true,
    title: "A buffer that is moved and arrives nowhere",
    blurb: "The transfer list says what to move. The message says what the receiver gets. Put a buffer in the list and leave it out of the message, and it is moved out of this page and handed to nobody. Nothing warns you. A port is the one exception: a port in the list turns up in <code>event.ports</code>.",
    code: `port.postMessage({ a }, [a.buffer, b.buffer]);     <span class="c">// b is moved, and is in no message: lost</span>
port.postMessage({ a, b }, [a.buffer, b.buffer]);  <span class="c">// right: everything moved is also sent</span>

<span class="c">// a habit that makes the mistake impossible: build the list from the message</span>
const send = (port, message) => port.postMessage(message, Object.values(message).map((v) => v.buffer));`,
    tour: { steps: [["Move two buffers, mention one", "Both buffers leave this page. The frame is told about one."], ["Move two buffers, mention both", "The same call with both in the message. Both arrive."]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page has two buffers");
      await stage.frame("frame", {
        title: "Receiver on another origin", color: "teal",
        script: () => on("port", (_, [port]) => { port.onmessage = ({ data }) => log("received: " + (Object.entries(data).map(([k, v]) => `${k} (${v.byteLength / 1024} KB)`).join(" and ") || "nothing")); log("waiting"); }),
      });
      const channel = new MessageChannel();
      stage.post("frame", { cmd: "port" }, [channel.port2]);
      stage.cable("line", "page", "frame", "teal");
      const go = (both) => {
        const a = new Uint8Array(64 * 1024), b = new Uint8Array(64 * 1024);
        channel.port1.postMessage(both ? { a, b } : { a }, [a.buffer, b.buffer]);
        stage.pulse("line", "page");
        me.say(`${both ? "sent a and b" : "sent a, moved a and b"}. Left here: a ${a.byteLength} bytes, b ${b.byteLength} bytes.${both ? "" : " b is nowhere."}`);
      };
      ui.button("Move two buffers, mention one", () => go(false), false, true);
      ui.button("Move two buffers, mention both", () => go(true));
    },
  },
  {
    id: "bite-unreadable", bite: true,
    title: "A message that cannot be rebuilt, and a sender that finds out",
    blurb: "A compiled WebAssembly module can be posted to a worker of the same page, and cannot be rebuilt in a shared worker. The call to <code>postMessage</code> succeeds either way. Sent with no checks, the module disappears and the sender waits for ever. Sent with the three checks below, the sender is told straight away: the receiver listens for <code>messageerror</code> and says so, every message is acknowledged, and the sender puts a time limit on the wait.",
    code: `<span class="c">// the receiver: answer what you could read, and report what you could not</span>
port.onmessage = ({ data }) => { handle(data.value); port.postMessage({ ack: data.id }); };
port.onmessageerror = () => port.postMessage({ unreadable: true });

<span class="c">// the sender: every send is a promise with a time limit</span>
const waiting = new Map();
const send = (value, transfer = []) => new Promise((resolve, reject) => {
  const id = crypto.randomUUID();
  const timer = setTimeout(() => { waiting.delete(id); reject(new Error("no answer")); }, 2000);
  waiting.set(id, { resolve, reject, timer });
  port.postMessage({ id, value }, transfer);
});
port.onmessage = ({ data }) => {
  <span class="c">// the receiver cannot say which message it lost, so fail the oldest one still waiting</span>
  const [id, entry] = data.unreadable ? waiting.entries().next().value ?? [] : [data.ack, waiting.get(data.ack)];
  if (!entry) return;
  clearTimeout(entry.timer); waiting.delete(id);
  data.unreadable ? entry.reject(new Error("the receiver could not rebuild it")) : entry.resolve();
};`,
    tour: { steps: [["Send some text", "An ordinary message. The receiver acknowledges it."], ["Send a module, carelessly", "postMessage does not throw. The receiver is not listening for messageerror, and the sender is not timing anything. Silence.", 1800], ["Send a module, with the habits", "The receiver reports that something arrived that it could not read, and the sender's promise rejects."]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page sends");
      const there = logBox(stage, "worker", "A SharedWorker receives", "", { kind: "shared", url: "/patterns/bite-worker.js" });
      if (!("SharedWorker" in self)) {
        me.say("This browser has no SharedWorker.");
        ui.unsupported("This browser does not support SharedWorker.");
        return;
      }
      const port = new SharedWorker("/patterns/bite-worker.js").port;
      stage.cleanup(() => port.close());
      const waiting = new Map();
      let n = 0;
      const send = (value, limit = 2000) => new Promise((resolve, reject) => {
        const id = ++n;
        const timer = limit && setTimeout(() => { waiting.delete(id); reject(new Error("no answer in 2 s")); }, limit);
        waiting.set(id, { resolve, reject, timer });
        port.postMessage({ id, value }); stage.pulse("line", "page");
      });
      port.onmessage = ({ data }) => {
        if (!me.node.isConnected) return port.close();
        stage.pulse("line", "worker");
        const [id, entry] = data.unreadable ? waiting.entries().next().value ?? [] : [data.ack, waiting.get(data.ack)];
        there.say(data.unreadable ? "messageerror: something arrived that I could not rebuild. Told the sender." : `read message ${data.ack}, a ${data.got}. Acknowledged.`);
        if (!entry) return;
        clearTimeout(entry.timer); waiting.delete(id);
        data.unreadable ? entry.reject(new Error("the receiver could not rebuild it")) : entry.resolve(data.got);
      };
      stage.cable("line", "page", "worker", "teal");
      const module = () => new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
      ui.button("Send some text", async () => { await send("hello"); me.say("text: acknowledged"); }, false, true);
      ui.button("Send a module, carelessly", () => {
        port.postMessage({ careless: true });
        try { port.postMessage({ id: ++n, value: module() }); } catch (err) { return me.say("refused at once: " + err.name); }
        stage.pulse("line", "page");
        me.say("module: postMessage returned without complaint. Waiting. Nothing will ever come back.");
      });
      ui.button("Send a module, with the habits", async () => {
        port.postMessage({ careless: false });
        try { await send(module()); me.say("module: acknowledged. This browser can rebuild it there."); }
        catch (err) { me.say("module: failed, and I know it: " + err.message); }
      });
    },
  },
];
