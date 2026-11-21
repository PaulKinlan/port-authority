// More built ideas: what a port to another device can carry, and what a
// one-way port is for. Same shape as the entries in built.js, which adds these.
import { far } from "/farport.js";
import { oneWay } from "/oneway.js";
import { qrSvg } from "/qr.js";

const logBox = (stage, name, title, extra = "", keep = 5) => {
  const box = stage.box(name, { html: `<div class="here"><h4>${title}</h4>${extra}<ul class="log"></ul></div>` });
  const ul = box.node.querySelector("ul");
  const say = (text) => { const li = document.createElement("li"); li.textContent = text; ul.prepend(li); while (ul.children.length > keep) ul.lastChild.remove(); };
  return { say, node: box.node, box };
};
const NETLESS = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'";

// The part every cross-device demo shares: a box for the other device with a
// QR code in it, a button that opens the line, and a stand-in for when there
// is no second device to hand. Returns the buttons and a way to hang up.
export function openLine(stage, ui, { makeMe, openLabel = "Open a line to your phone", standLabel = "Use a stand-in for the phone", onPort, onGone = () => {} }) {
  const farBox = stage.box("far", { html: `<div class="here"><h4>Your phone</h4><p class="small muted">Not connected yet.</p></div>` });
  // The other device's box comes first, so the page sits in the middle of the row.
  const me = makeMe();
  if (!("RTCPeerConnection" in self)) { me.say("no WebRTC in this browser"); return null; }
  const state = { line: null, code: null, standIn: false, me };
  const stand = ui.button(standLabel, (btn) => {
    btn.disabled = true; state.standIn = true;
    farBox.node.innerHTML = `<iframe title="A stand-in for your phone" src="/far/?embed=1#${state.code}"></iframe>`;
    farBox.frame = farBox.node.querySelector("iframe");
  }, true);
  const hang = ui.button("Hang up", (btn) => { state.line?.close(); btn.disabled = true; }, true);
  ui.button(openLabel, (btn) => {
    btn.disabled = true;
    state.code = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
    const url = `${location.origin}/far/#${state.code}`;
    farBox.node.innerHTML = `<div class="here" style="display:flex;gap:.6rem;align-items:flex-start"><a href="${url}" target="_blank" data-qr style="flex:none;width:6.6rem;line-height:0;border-radius:6px;overflow:hidden">${qrSvg(url, { label: "QR code for " + url })}</a><div><h4>Your phone</h4><p class="small" style="margin:0">Scan this, or open <a href="${url}" target="_blank">${location.host}/far/#${state.code}</a></p></div></div>`;
    stand.disabled = false;
    me.say("waiting at a meeting place for the other device");
    state.line = far({
      code: state.code, host: true,
      onError: (err) => me.say("could not send: " + err.message),
      onState(s) {
        if (s === "found") me.say("the other device is here, connecting directly");
        if (s === "failed") me.say("could not connect");
        if (s === "gone") { delete farBox.node.dataset.link; me.say("the connection closed"); stage.cut("air"); hang.disabled = true; onGone(); }
      },
      onPort(port) {
        if (!state.standIn) { farBox.node.dataset.link = "up"; farBox.node.innerHTML = `<div class="here"><h4>Your phone</h4><p class="small">Connected. It is a real device, so its screen is not shown here.</p></div>`; }
        stage.cable("air", "far", "page", "teal");
        stand.disabled = true; hang.disabled = false;
        state.line.route().then((route) => me.say(`connected directly${route ? ", " + route : ""}. The server is out of it.`));
        onPort(port, state);
      },
    });
    // Leaving the page or starting again hangs up.
    const watch = setInterval(() => { if (!me.node.isConnected) { clearInterval(watch); state.line?.close(); } }, 1000);
  }, false, true);
  return state;
}

const size = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.round(n / 1e3) + " kB");

export const further = [
  {
    pattern: "far", use: [3], id: "built-farfile",
    title: "Send a photo from your phone to this page as a stream",
    blurb: "The phone picks a picture and posts <code>file.stream()</code> into its port. A stream cannot be moved to another machine, so the port on this side hands over a new <code>ReadableStream</code> and feeds it with the bytes as they arrive over the direct connection. This page does not read it. It transfers the stream to a sandboxed viewer, which reads it chunk by chunk and draws the picture at the end. The phone's file is read only as fast as the viewer reads. No server sees a byte of it.",
    code: `<span class="c">// phone</span>
const body = file.stream();
port.postMessage({ file: { name: file.name, size: file.size }, body }, [body]);

<span class="c">// this page: a stream arrived from another device. Pass it on unread.</span>
port.onmessage = ({ data }) =>
  viewer.postMessage({ file: data.file, body: data.body }, "*", [data.body]);

<span class="c">// the viewer, a sandboxed frame</span>
for await (const chunk of body) show(chunk);`,
    tour: { steps: [
      ["Open a line to your phone", "This page opens a meeting place and shows a QR code. Scan it with a phone to be the other device."],
      ["Use a stand-in for the phone", "A second page plays the phone, and the two connect directly.", 4500],
      ["Other device: send a sample picture", "The other device posts a stream into its port. This page receives a stream and passes it to the viewer without reading it. The viewer draws the picture when the last byte arrives.", 3500],
      ["Hang up", "This page closes the connection."],
    ] },
    async setup(stage, ui) {
      let sample = null, me = null;
      const state = openLine(stage, ui, {
        makeMe: () => (me = logBox(stage, "page", "This page, in the middle", `<p class="small" style="margin:0 0 .4rem">Streams riding on the connection: <strong data-streams>0</strong></p>`, 4)),
        onPort(port, line) {
          port.postMessage({ want: "file" });
          port.onmessage = ({ data }) => {
            if (!data.file) return;
            me.say(`${data.file.name}, ${size(data.file.size)}, is arriving as a ${data.body.constructor.name}. Passed it to the viewer unread.`);
            stage.post("viewer", { cmd: "show", file: data.file, body: data.body }, [data.body]);
            stage.cable("view", "page", "viewer", "yellow");
          };
          sample.disabled = !line.standIn;
        },
        onGone() { sample.disabled = true; },
      });
      await stage.frame("viewer", {
        title: "Viewer, a sandboxed frame", color: "yellow", csp: NETLESS,
        script: () => {
          const canvas = document.createElement("canvas");
          canvas.width = 320; canvas.height = 200;
          canvas.style.cssText = "width:100%;max-height:5.2rem;object-fit:contain;display:none;border-radius:6px";
          const meter = document.createElement("p");
          meter.style.cssText = "font:12px/1.4 ui-monospace,Menlo,monospace;margin:0 0 .3rem";
          meter.textContent = "nothing to show yet";
          document.getElementById("log").before(canvas, meter);
          on("show", async (data) => {
            const { file, body } = data;
            log(`given a ${body.constructor.name}. I do not know where it starts.`);
            const chunks = []; let got = 0;
            const reader = body.getReader();
            try {
              for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                chunks.push(value); got += value.byteLength;
                meter.textContent = `${file.name}: ${Math.round(got / 1000)} of ${Math.round(file.size / 1000)} kB`;
                if (chunks.length % 3 === 1) tell("pulse", { cable: "view" });
              }
              const picture = await createImageBitmap(new Blob(chunks, { type: file.type }));
              const scale = Math.min(canvas.width / picture.width, canvas.height / picture.height);
              const c = canvas.getContext("2d");
              c.clearRect(0, 0, canvas.width, canvas.height);
              c.drawImage(picture, (canvas.width - picture.width * scale) / 2, (canvas.height - picture.height * scale) / 2, picture.width * scale, picture.height * scale);
              canvas.style.display = "block";
              log(`all ${got} bytes arrived, in ${chunks.length} chunks`);
              tell("drawn", { bytes: got });
            } catch (err) { log("the stream ended early: " + (err.message || err)); }
          });
        },
      });
      if (!state) return;
      sample = ui.button("Other device: send a sample picture", () => stage.post("far", { cmd: "sample" }), true);
      const streams = me.node.querySelector("[data-streams]");
      const tick = setInterval(() => { if (!me.node.isConnected) return clearInterval(tick); streams.textContent = state.line ? state.line.counts.streams : 0; }, 300);
    },
  },
  {
    pattern: "far", use: [4], id: "built-farports",
    title: "Lend the other device a port to one thing, then take it back",
    blurb: "The connection between the two devices is one port. This page posts more ports into it. Each is a line to one sandboxed frame here: a lamp, and a counter. The phone receives each as a <code>MessagePort</code> of its own and uses it like any other. The lines pass through this page, so this page can close one. Take the lamp back and the phone's lamp button does nothing, while its counter port and the connection carry on. The phone was never given the page, only two ports.",
    code: `<span class="c">// this page: a line to the lamp that it can close</span>
const toLamp = new MessageChannel(), toPhone = new MessageChannel();
lampFrame.postMessage({ cmd: "port" }, "*", [toLamp.port1]);
toPhone.port1.onmessage = (e) => toLamp.port2.postMessage(e.data);
toLamp.port2.onmessage = (e) => toPhone.port1.postMessage(e.data);

<span class="c">// a port, posted into the port that crosses devices</span>
far.postMessage({ lent: "lamp", port: toPhone.port2 }, [toPhone.port2]);

<span class="c">// the phone</span>
far.onmessage = ({ data }) => { data.port.postMessage({ do: "switch" }); };

<span class="c">// later, this page</span>
toPhone.port1.close();`,
    tour: { steps: [
      ["Open a line to your phone", "This page opens a meeting place and shows a QR code."],
      ["Use a stand-in for the phone", "A second page plays the phone, and the two connect directly.", 4500],
      ["Lend the lamp", "This page posts a port into the connection. The other device receives a port of its own that leads to the lamp."],
      ["Lend the counter", "A second port, to the counter. Both ride on the one connection."],
      ["Other device: switch the lamp", "The other device posts into its lamp port. The lamp frame here hears it and answers."],
      ["Other device: add one", "The same, on the counter's port."],
      ["Take the lamp back", "This page closes its end of the lamp's line."],
      ["Other device: switch the lamp", "The other device posts into its lamp port again. Nothing is on the other end."],
      ["Other device: add one", "The counter's port still works. Only one port was closed."],
    ] },
    async setup(stage, ui) {
      const lent = {};
      let farPort = null, me = null;
      const buttons = {};
      const state = openLine(stage, ui, {
        makeMe: () => (me = logBox(stage, "page", "This page, in the middle", "", 5)),
        onPort(port, line) {
          farPort = port;
          buttons.lamp.disabled = buttons.counter.disabled = false;
          state.usable = line.standIn;
        },
        onGone() { for (const b of Object.values(buttons)) b.disabled = true; for (const name of Object.keys(lent)) stage.cut(name); },
      });
      await Promise.all([
        stage.frame("lamp", {
          title: "Lamp, sandboxed", color: "yellow",
          script: () => {
            let lit = false;
            const bulb = document.createElement("div");
            bulb.style.cssText = "width:2.6rem;height:2.6rem;border-radius:50%;border:3px solid currentColor;margin:0 0 .4rem";
            document.getElementById("log").before(bulb);
            on("port", (data, ports) => {
              log("given a port. I do not know where it goes.");
              ports[0].onmessage = (event) => {
                if (event.data.do !== "switch") return;
                lit = !lit; bulb.style.background = lit ? "#f5b700" : "transparent";
                log("asked to switch. Now " + (lit ? "on" : "off"));
                ports[0].postMessage({ show: "the lamp is " + (lit ? "on" : "off") });
              };
            });
          },
        }),
        stage.frame("counter", {
          title: "Counter, sandboxed", color: "red",
          script: () => {
            let count = 0;
            const big = document.createElement("p");
            big.style.cssText = "font:800 2rem/1 system-ui;margin:0 0 .4rem";
            big.textContent = "0";
            document.getElementById("log").before(big);
            on("port", (data, ports) => {
              log("given a port. I do not know where it goes.");
              ports[0].onmessage = (event) => {
                if (event.data.do !== "add") return;
                big.textContent = ++count;
                log("asked to add one");
                ports[0].postMessage({ show: "the count is " + count });
              };
            });
          },
        }),
      ]);
      if (!state) return;
      const TOOLS = {
        lamp: { name: "lamp", title: "The lamp", color: "yellow", buttons: [{ label: "Switch the lamp", do: "switch" }] },
        counter: { name: "counter", title: "The counter", color: "red", buttons: [{ label: "Add one", do: "add" }] },
      };
      // A line to one frame that this page can close: two channels, joined here.
      const lend = (name) => {
        const toTool = new MessageChannel(), toFar = new MessageChannel();
        stage.post(name, { cmd: "port" }, [toTool.port1]);
        toFar.port1.onmessage = (event) => { toTool.port2.postMessage(event.data); stage.pulse("air", "far"); stage.pulse(name, "page"); };
        toTool.port2.onmessage = (event) => { toFar.port1.postMessage(event.data); stage.pulse(name, name); stage.pulse("air", "page"); };
        farPort.postMessage({ lent: TOOLS[name], port: toFar.port2 }, [toFar.port2]);
        stage.cable(name, "page", name, TOOLS[name].color);
        lent[name] = () => { toFar.port1.close(); toTool.port2.close(); farPort.postMessage({ taken: name }); stage.cut(name); delete lent[name]; };
        me.say(`posted a port to the ${name} into the connection`);
      };
      const use = (name, verb) => stage.post("far", { cmd: `use:${name}:${verb}` });
      buttons.lamp = ui.button("Lend the lamp", (btn) => { lend("lamp"); btn.disabled = true; buttons.take.disabled = false; buttons.useLamp.disabled = !state.usable; }, true);
      buttons.counter = ui.button("Lend the counter", (btn) => { lend("counter"); btn.disabled = true; buttons.useCounter.disabled = !state.usable; }, true);
      buttons.useLamp = ui.button("Other device: switch the lamp", () => use("lamp", "switch"), true);
      buttons.useCounter = ui.button("Other device: add one", () => use("counter", "add"), true);
      buttons.take = ui.button("Take the lamp back", (btn) => { lent.lamp?.(); btn.disabled = true; me.say("closed my end of the lamp's line. The connection is still up."); }, true);
    },
  },
  {
    pattern: "oneway", use: [1], id: "built-figures",
    title: "Give a chart widget your figures on a port it cannot answer on",
    blurb: "The widget is someone else's code in a sandboxed frame, with a rule that forbids it any network access. This page sends it a month of spending to draw. The widget receives the figures on a real port, and then tries two ways to send them somewhere: a network request, and a message back into the port. The browser blocks the first. The second reaches this page's valve and stops there, and this page counts it.",
    code: `const link = oneWay();
widget.postMessage({ cmd: "feed" }, "*", [link.receive]);

link.send.postMessage({ figures });       <span class="c">// the widget draws them</span>

<span class="c">// the widget, trying</span>
port.postMessage({ stolen: figures });    <span class="c">// stops at the valve</span>
fetch(somewhere, { body: figures });      <span class="c">// blocked: default-src 'none'</span>`,
    tour: { steps: [
      ["Give the widget a one-way port", "This page makes the two channels and gives the widget the end it can hear on."],
      ["Send this month's spending", "The figures go down the port, and the widget draws them."],
      ["Widget: try to send the figures out", "The widget posts the figures back into its port and tries a network request. Neither arrives anywhere."],
    ] },
    async setup(stage, ui) {
      const box = stage.box("page", { html: `<div class="here"><h4>This page has the figures</h4>
        <p class="small" style="margin:0 0 .25rem">Sent to the widget: <strong data-passed>0</strong></p>
        <p class="small" style="margin:0 0 .25rem">Stopped, coming back: <strong data-dropped>0</strong></p>
        <p class="small" style="margin:0 0 .4rem">Heard from the widget on my port: <strong data-heard>0</strong></p>
        <ul class="log"></ul></div>` });
      const ul = box.node.querySelector("ul");
      const say = (text) => { const li = document.createElement("li"); li.textContent = text; ul.prepend(li); while (ul.children.length > 3) ul.lastChild.remove(); };
      await stage.frame("widget", {
        title: "Chart widget, someone else's code", color: "teal", csp: NETLESS,
        script: () => {
          let port = null, last = null;
          const chart = document.createElement("div");
          chart.style.cssText = "display:flex;align-items:flex-end;gap:.35rem;height:3.6rem;margin:0 0 .4rem";
          document.getElementById("log").before(chart);
          on("feed", (data, ports) => {
            port = ports[0];
            log("given a port to hear figures on");
            port.onmessage = (event) => {
              last = event.data.figures;
              const top = Math.max(...Object.values(last));
              chart.replaceChildren(...Object.entries(last).map(([name, amount]) => {
                const bar = document.createElement("div");
                bar.title = `${name}: ${amount}`;
                bar.style.cssText = `flex:1;height:${Math.round((amount / top) * 100)}%;background:#0e9f8e;border-radius:3px 3px 0 0`;
                return bar;
              }));
              log("drew " + Object.entries(last).map(([name, amount]) => `${name} ${amount}`).join(", "));
            };
          });
          on("leak", async (data) => {
            if (!last) return log("I have nothing to send yet");
            port.postMessage({ stolen: last });
            log("posted the figures back into the port");
            tell("pulse", { cable: "feed" });
            try { await fetch(data.url, { method: "POST", body: JSON.stringify(last), mode: "no-cors" }); log("network request: sent"); tell("leaked"); }
            catch (err) { log("network request: blocked"); }
          });
        },
      });
      let link = null, month = 0;
      const show = () => { box.node.querySelector("[data-passed]").textContent = link.counts.passed; box.node.querySelector("[data-dropped]").textContent = link.counts.dropped; };
      const send = ui.button("Send this month's spending", () => {
        const wobble = (base) => Math.round(base * (0.8 + ((month * 37 + base) % 40) / 100));
        month++;
        link.send.postMessage({ figures: { rent: 900, food: wobble(310), travel: wobble(120), flowers: wobble(45) } });
        stage.pulse("feed", "page");
      }, true);
      const leak = ui.button("Widget: try to send the figures out", () => stage.post("widget", { cmd: "leak", url: location.origin + "/echo" }), true);
      ui.button("Give the widget a one-way port", (btn) => {
        btn.disabled = true;
        link = oneWay({ onPass: () => { show(); say("sent the figures"); }, onDrop: () => { show(); say("stopped a message from the widget"); } });
        // This page listens on its own end too. Nothing has ever arrived on it.
        let heard = 0;
        link.send.onmessage = () => { box.node.querySelector("[data-heard]").textContent = ++heard; };
        stage.post("widget", { cmd: "feed" }, [link.receive]);
        stage.cable("feed", "page", "widget", "teal");
        say("gave the widget the end it can hear on");
        send.disabled = leak.disabled = false;
      }, false, true);
    },
  },
  {
    pattern: "oneway", use: [2], id: "built-covert",
    title: "A stream given as read-only still lets the reader signal the writer",
    blurb: "A <code>ReadableStream</code> looks one-way: the holder can read and has nothing to write into. But a stream asks its source for the next chunk only when the reader wants one, so the writer can see when each read happens. The frame here holds only a readable stream. It spells a word by choosing when to read: a short wait for a 0, a long wait for a 1. This page reads the word back from nothing but the times its own <code>pull()</code> was called. Then the same frame gets a one-way port. Messages on a port arrive when the sender posts them, and nothing the receiver does changes that, so there is nothing to read back.",
    code: `<span class="c">// the writer sees when the reader reads</span>
const readable = new ReadableStream({
  pull(controller) { times.push(performance.now()); controller.enqueue("tick"); },
}, { highWaterMark: 0 });
frame.postMessage({ readable }, "*", [readable]);

<span class="c">// the reader, holding only the readable, sends bits with its timing</span>
for (const bit of bits) { await wait(bit ? 360 : 120); await reader.read(); }`,
    tour: { steps: [
      ["Give the frame a read-only stream", "The frame gets a stream it can read. It has nothing to write into."],
      ["Frame: spell a word by when it reads", "The frame reads slowly or quickly, one bit per read. This page works the word out from the times its source was asked.", 6500],
      ["Give the frame a one-way port", "Now the same ticks go to the frame as messages on a one-way port."],
      ["Frame: try the same on the port", "The frame takes its messages on the same rhythm as before. This page sends on its own clock and sees no difference.", 5000],
    ] },
    async setup(stage, ui) {
      const box = stage.box("page", { html: `<div class="here"><h4>This page writes the ticks</h4>
        <p class="small" style="margin:0 0 .25rem">Bits read from the frame's timing:</p>
        <p class="small" data-bits style="margin:0 0 .25rem;font-family:var(--mono);min-height:2.6em;overflow-wrap:anywhere">none</p>
        <p class="small" style="margin:0 0 .25rem">As text: <strong data-word>nothing</strong></p>
        <p class="small" style="margin:0 0 .4rem">Read from the one-way port: <strong data-port>not tried yet</strong></p>
        <ul class="log"></ul></div>` });
      const ul = box.node.querySelector("ul");
      const say = (text) => { const li = document.createElement("li"); li.textContent = text; ul.prepend(li); while (ul.children.length > 2) ul.lastChild.remove(); };
      const bitsEl = box.node.querySelector("[data-bits]"), wordEl = box.node.querySelector("[data-word]"), portEl = box.node.querySelector("[data-port]");
      await stage.frame("reader", {
        title: "A frame that knows a word", color: "red",
        script: () => {
          const word = "HI";
          const bits = [...word].map((ch) => ch.charCodeAt(0).toString(2).padStart(8, "0")).join("");
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          let reader = null, port = null, heard = 0;
          log(`my word is ${word}. Nobody gave me a way to say it.`);
          on("stream", async (data) => {
            reader = data.readable.getReader();
            log(`given a ${data.readable.constructor.name}. can I write to it? ${"getWriter" in data.readable ? "yes" : "no"}`);
            await reader.read();
          });
          on("spell", async () => {
            if (!reader) return;
            log("reading on a rhythm");
            // A long pause marks the start. Then one read per bit.
            await wait(900); await reader.read();
            for (const bit of bits) { await wait(bit === "1" ? 360 : 120); await reader.read(); tell("pulse", { cable: "ticks" }); }
            log("done. I only ever read.");
            tell("spelled");
          });
          const waiting = [];
          on("port", (data, ports) => {
            port = ports[0];
            log("given a port for the same ticks");
            port.onmessage = (event) => { waiting.push(event.data); };
          });
          on("try", async () => {
            if (!port) return;
            log("taking messages on the same rhythm");
            // The same rhythm as before. Here it only decides when this frame looks at what has already arrived.
            for (const bit of bits) { await wait(bit === "1" ? 360 : 120); if (waiting.length) { waiting.shift(); heard++; } }
            log(`done. I took ${heard} ticks. They arrived when they were sent.`);
            tell("tried");
          });
        },
      });
      let last = 0, bits = null, pulls = 0, ticker = null, link = null;
      const decode = () => {
        const text = bits.match(/.{8}/g)?.map((byte) => String.fromCharCode(parseInt(byte, 2))).join("") || "";
        bitsEl.textContent = bits.replace(/(.{8})/g, "$1 ") || "none";
        wordEl.textContent = text || "nothing";
      };
      const spell = ui.button("Frame: spell a word by when it reads", (btn) => { btn.disabled = true; stage.post("reader", { cmd: "spell" }); }, true);
      const giveStream = ui.button("Give the frame a read-only stream", (btn) => {
        btn.disabled = true;
        const readable = new ReadableStream({
          // Called once for each read the frame makes. The time between calls is the message.
          pull(controller) {
            const now = performance.now(), gap = now - last;
            last = now; pulls++;
            if (gap > 650 && pulls > 1) { bits = ""; say("a long pause: the frame is starting"); }
            else if (bits !== null && bits.length < 16) { bits += gap > 240 ? "1" : "0"; decode(); }
            controller.enqueue("tick " + pulls);
          },
        }, { highWaterMark: 0 });
        last = performance.now();
        stage.post("reader", { cmd: "stream", readable }, [readable]);
        stage.cable("ticks", "page", "reader", "red");
        say("gave away the readable side only");
        spell.disabled = false;
      }, false, true);
      const attempt = ui.button("Frame: try the same on the port", (btn) => { btn.disabled = true; stage.post("reader", { cmd: "try" }); }, true);
      const givePort = ui.button("Give the frame a one-way port", (btn) => {
        btn.disabled = true;
        link = oneWay();
        stage.post("reader", { cmd: "port" }, [link.receive]);
        stage.cut("ticks"); stage.cable("port", "page", "reader", "teal");
        let n = 0, late = 0, due = performance.now() + 400;
        // The only thing this page could measure is its own clock: was a tick ever sent late?
        ticker = setInterval(() => {
          if (!box.node.isConnected) return clearInterval(ticker);
          if (performance.now() - due > 100) late++;
          due += 400;
          link.send.postMessage("tick " + ++n); stage.pulse("port", "page");
          portEl.textContent = `nothing. ${n} ticks sent, ${late} of them late`;
        }, 400);
        say("sending a tick every 400 ms, whatever the frame does");
        attempt.disabled = false;
      }, true);
      stage.on((name, data) => {
        if (data.wire === "spelled") { say(`read "${wordEl.textContent}" from the frame's timing`); givePort.disabled = false; }
        if (data.wire === "tried") { clearInterval(ticker); say("the frame has finished. Its timing changed nothing here."); }
      });
    },
  },
];
