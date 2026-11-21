// More of the ideas listed under "What you could build with it", built.
// Same shape as the entries in built.js, which includes these in its list.

const logBox = (stage, name, title, extra = "", what = {}) => {
  const box = stage.box(name, { html: `<div class="here"><h4>${title}</h4>${extra}<ul class="log"></ul></div>`, ...what });
  const ul = box.node.querySelector("ul");
  const say = (text) => { const li = document.createElement("li"); li.textContent = text; ul.prepend(li); while (ul.children.length > 6) ul.lastChild.remove(); };
  return { say, node: box.node, box };
};

// The windows of one app around a shared worker (post-worker.js). Every window
// is a real page of this site, /patterns/desk.html. Each demo gets a worker of
// its own, so the three demos on one page do not share a table.
function postRoom(stage, kind, title) {
  const room = `${kind}-${Math.random().toString(36).slice(2, 8)}`;
  const hub = stage.box("router", { kind: "shared", url: "/patterns/post-worker.js", wide: true, html: `<div class="here"><h4>${title}</h4><p class="small" style="margin:0 0 .3rem">Open windows: <strong data-table>none yet</strong></p><p class="small" style="margin:0 0 .3rem">Holding: <strong data-held>nothing</strong></p><p class="small" data-last style="margin:0;min-height:1.5em;font-family:var(--mono)"></p></div>` });
  const q = (name) => hub.node.querySelector(`[data-${name}]`);
  const ok = "SharedWorker" in self;
  if (!ok) q("last").textContent = "This browser has no SharedWorker.";
  else {
    // This page only watches the worker. It is not one of the windows.
    const watch = new SharedWorker("/patterns/post-worker.js", { name: "pa-post-" + room }).port;
    watch.onmessage = ({ data }) => {
      if (!hub.node.isConnected) return watch.close();
      if (!data.state) return;
      q("table").textContent = data.state.table.map((w) => w.name + (w.tool ? ` (offers ${w.tool})` : w.role ? ` (${w.role})` : "")).join(", ") || "none";
      q("held").textContent = Object.entries(data.state.held).map(([name, count]) => `${count} for ${name}`).join(", ") || "nothing";
      q("last").textContent = data.state.last;
    };
    watch.postMessage({ watch: true });
  }
  stage.on((name, data) => { if (data.wire === "sent") stage.pulse("c-" + name, name); if (data.wire === "got") stage.pulse("c-" + name, "router"); });
  const colors = ["red", "teal", "yellow", "ink"];
  let count = 0;
  const open = async (name, extra = "") => {
    const color = colors[count++ % colors.length];
    const box = stage.box(name, { src: `/patterns/desk.html?room=${room}&name=${name}${extra}` });
    stage.el.insertBefore(box.wrap, hub.wrap);
    await box.whenReady;
    stage.cable("c-" + name, name, "router", color);
    return box;
  };
  const tell = (name, message) => stage.boxes.get(name)?.frame?.contentWindow?.postMessage(message, location.origin);
  return { ok, open, tell };
}

export const built2 = [
  {
    pattern: "router", use: [2], id: "built-queue",
    title: "Messages kept in the worker until the window they are for opens",
    blurb: "The orders and kitchen windows are open. The driver's window is not. When either of them sends to \"driver\", the shared worker finds no such name in its table and keeps the message in a list under that name. When a window opens and says it is the driver, the worker hands over everything in the list, oldest first. After that it passes messages straight through. The senders do the same thing in both cases. The list is in the worker's memory, so it lasts for as long as at least one window of the app stays open.",
    code: `<span class="c">// the worker</span>
const table = new Map();   <span class="c">// name -> port</span>
const held = new Map();    <span class="c">// name -> messages waiting for that name</span>

port.onmessage = ({ data }) => {
  if (data.iam) {
    table.set(data.iam, port);
    for (const message of held.get(data.iam) || []) port.postMessage(message);
    held.delete(data.iam);
  }
  if (data.to) {
    const target = table.get(data.to);
    const message = { from: nameOf(port), text: data.text };
    target ? target.postMessage(message)
           : held.set(data.to, [...(held.get(data.to) || []), message]);
  }
};`,
    tour: { steps: [
      ["Orders: send to the driver", "No window is called driver. The worker keeps the message."],
      ["Kitchen: send to the driver", "A second message for the driver, from a different window. The worker is now holding two."],
      ["Open the driver's window", "The new window tells the worker its name. The worker hands over both messages, in the order they were sent.", 2200],
      ["Orders: send to the driver", "The driver is open now, so this one is passed straight on."],
    ] },
    async setup(stage, ui) {
      const post = postRoom(stage, "queue", "Router, a shared worker that holds messages");
      if (!post.ok) return;
      await post.open("orders"); await post.open("kitchen");
      let n = 0;
      ui.button("Orders: send to the driver", () => post.tell("orders", { cmd: "send", to: "driver", text: `order ${++n} is ready` }), false, true);
      ui.button("Kitchen: send to the driver", () => post.tell("kitchen", { cmd: "send", to: "driver", text: `bag ${++n} is packed` }));
      ui.button("Open the driver's window", (btn) => { btn.disabled = true; post.open("driver"); });
    },
  },
  {
    pattern: "router", use: [3], id: "built-everyone",
    title: "One message to every window with a role",
    blurb: "Each window tells the worker its name and its role. Two of these are editors and one is a preview. The settings window does not know how many editors are open or what they are called. It posts one message addressed to the role \"editor\", and the worker sends a copy to every window that gave that role. Open another editor and it is included from then on. Close one and the worker takes it out of the table, so the next message goes to the ones that are left.",
    code: `<span class="c">// each window</span>
port.postMessage({ iam: "editor-1", role: "editor" });

<span class="c">// the settings window</span>
port.postMessage({ toRole: "editor", text: "use font size 18" });

<span class="c">// the worker</span>
if (data.toRole) {
  for (const [, w] of table)
    if (w.role === data.toRole && w.port !== port)
      w.port.postMessage({ from: nameOf(port), text: data.text });
}`,
    tour: { steps: [
      ["Settings: tell every editor", "One message, addressed to the role \"editor\". Both editors get it. The preview has a different role and gets nothing."],
      ["Open a third editor", "Another window opens and gives the same role.", 2200],
      ["Settings: tell every editor", "The same call as before. This time three windows get it."],
      ["Close editor 1", "The window is destroyed. The worker notices and takes it out of its table.", 2200],
      ["Settings: tell every editor", "Two editors are left, and those two get it."],
    ] },
    async setup(stage, ui) {
      const post = postRoom(stage, "roles", "Router, a shared worker that knows each window's role");
      if (!post.ok) return;
      await post.open("settings"); await post.open("editor-1", "&role=editor"); await post.open("editor-2", "&role=editor"); await post.open("preview", "&role=preview");
      let size = 16;
      ui.button("Settings: tell every editor", () => post.tell("settings", { cmd: "all", role: "editor", text: `use font size ${(size += 2)}` }), false, true);
      ui.button("Open a third editor", (btn) => { btn.disabled = true; post.open("editor-3", "&role=editor"); });
      ui.button("Close editor 1", (btn) => { btn.disabled = true; stage.remove("editor-1"); });
    },
  },
  {
    pattern: "router", use: [1], id: "built-toolroute",
    title: "A request sent to whichever open window offers the tool",
    blurb: "Windows tell the worker which tool they offer. The shop window asks for a tool by what it does, \"print-label\" or \"find-route\", and never names a window. The worker looks for an open window that offers it, passes the request on, and that window answers the shop by name through the same worker. Close the label printer and the request has nowhere to go, and the shop is told. Open a different window that offers the same tool and the same request reaches that one. <a href=\"/hub/\">The hub on this site</a> does this between sites on different origins.",
    code: `<span class="c">// a window that offers a tool</span>
port.postMessage({ iam: "label-printer", tool: "print-label" });
port.onmessage = ({ data }) =>
  data.job && port.postMessage({ to: data.from, text: print(data.text) });

<span class="c">// the shop: asks for the tool, not for a window</span>
port.postMessage({ need: "print-label", text: "order 1" });

<span class="c">// the worker</span>
if (data.need) {
  const found = [...table].find(([, w]) => w.tool === data.need);
  found ? found[1].port.postMessage({ from: nameOf(port), job: data.need, text: data.text })
        : port.postMessage({ nobody: data.need });
}`,
    tour: { steps: [
      ["Shop: ask for a label", "The shop asks for \"print-label\". The worker finds the window that offers it. The answer comes back to the shop."],
      ["Shop: ask for a route", "A different tool, so the worker picks a different window."],
      ["Close the label printer", "The only window that prints labels is destroyed.", 2200],
      ["Shop: ask for a label", "No open window offers that tool now. The worker tells the shop."],
      ["Open the back office", "A different window opens. It also offers \"print-label\".", 2200],
      ["Shop: ask for a label", "The same request as before. It goes to the back office."],
    ] },
    async setup(stage, ui) {
      const post = postRoom(stage, "tools", "Router, a shared worker that knows which window offers which tool");
      if (!post.ok) return;
      await post.open("shop"); await post.open("label-printer", "&tool=print-label"); await post.open("route-finder", "&tool=find-route");
      let n = 0;
      ui.button("Shop: ask for a label", () => post.tell("shop", { cmd: "need", tool: "print-label", text: `order ${++n}` }), false, true);
      ui.button("Shop: ask for a route", () => post.tell("shop", { cmd: "need", tool: "find-route", text: `order ${Math.max(n, 1)}` }));
      ui.button("Close the label printer", (btn) => { btn.disabled = true; stage.remove("label-printer"); });
      ui.button("Open the back office, which also prints labels", (btn) => { btn.disabled = true; post.open("back-office", "&tool=print-label"); });
    },
  },
  {
    pattern: "hello", use: [1], id: "built-oneknock",
    title: "One window.postMessage to deliver a port, and everything after it on the port",
    blurb: "This page calls <code>window.postMessage</code> on the frame once. That message carries nothing except one end of a channel. Everything after it goes over the port: a question with an answer, then a subscription that sends five prices. The frame counts what it hears on its window and what it hears on the port, and sends both counts back with every reply. The window count stays at one however long the conversation goes on. The buttons below use the port only.",
    code: `const { port1, port2 } = new MessageChannel();
frame.contentWindow.postMessage({ cmd: "port" }, "*", [port2]);   <span class="c">// the only window message</span>

<span class="c">// from here on, only the port</span>
port1.postMessage({ id: 1, sum: [19, 23] });
port1.postMessage({ subscribe: "prices" });
port1.onmessage = ({ data }) => show(data);`,
    tour: { steps: [
      ["Deliver a port with one window.postMessage", "The frame's window hears one message. It holds a port and no data."],
      ["Ask for a sum over the port", "The question and the answer both travel on the port. The window count is still one."],
      ["Subscribe to prices over the port", "Five prices arrive, half a second apart, all on the port.", 3600],
      ["Ask for a sum over the port", "Still the same port, and the frame's window has still heard one message."],
    ] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page", `<p class="small" style="margin:0 0 .4rem">Calls to window.postMessage: <strong data-w>0</strong>. Sent on the port: <strong data-s>0</strong>. Received on the port: <strong data-r>0</strong>.</p>`);
      await stage.frame("widget", {
        title: "Widget on another origin", color: "teal",
        script: () => {
          let onWindow = 0, onPort = 0;
          addEventListener("message", (event) => { if (event.source === parent && event.data && event.data.cmd) onWindow++; });
          on("port", (_, [port]) => {
            log("my window heard a message. It held a port.");
            const reply = (message) => send(port, "line", { ...message, heard: { onWindow, onPort } });
            port.onmessage = ({ data }) => {
              onPort++;
              if (data.sum) reply({ id: data.id, total: data.sum.reduce((a, b) => a + b, 0) });
              if (data.subscribe) { let n = 0; const timer = setInterval(() => { reply({ price: (4 + Math.random()).toFixed(2) }); if (++n === 5) clearInterval(timer); }, 500); }
              log(`heard on my window: ${onWindow}. Heard on the port: ${onPort}.`);
            };
          });
        },
      });
      const q = (name) => me.node.querySelector(`[data-${name}]`);
      let port = null, sent = 0, received = 0, id = 0;
      const post = (message) => { port.postMessage(message); q("s").textContent = ++sent; stage.pulse("line", "page"); };
      const sum = ui.button("Ask for a sum over the port", () => { const a = 10 + Math.floor(Math.random() * 30), b = 10 + Math.floor(Math.random() * 30); me.say(`asked for ${a} + ${b}`); post({ id: ++id, sum: [a, b] }); }, true);
      const prices = ui.button("Subscribe to prices over the port", (btn) => { btn.disabled = true; me.say("subscribed to prices"); post({ subscribe: "prices" }); }, true);
      ui.button("Deliver a port with one window.postMessage", (btn) => {
        btn.disabled = true;
        const channel = new MessageChannel();
        port = channel.port1;
        port.onmessage = ({ data }) => {
          if (!me.node.isConnected) return port.close();
          q("r").textContent = ++received;
          me.say(`${data.total !== undefined ? "the sum is " + data.total : "price " + data.price}. The widget's window has heard ${data.heard.onWindow} message.`);
        };
        stage.post("widget", { cmd: "port" }, [channel.port2]);
        q("w").textContent = 1;
        stage.cable("line", "page", "widget", "teal");
        me.say("called window.postMessage once, with a port");
        sum.disabled = prices.disabled = false;
      }, false, true);
    },
  },
  {
    pattern: "introduce", use: [0], id: "built-picker",
    title: "A picker that connects a shop to the florist the person chose, then closes",
    blurb: "Two florists have each registered with the picker. The shop holds a port to the picker and knows neither florist. The shop asks for someone who can send flowers. The picker waits for the person to choose. Then it makes a channel, sends one end to the chosen florist and the other to the shop, and keeps neither. After that the picker can be closed. The order goes from the shop to the florist on the new channel, and the florist that was not picked hears nothing. <a href=\"/hub/\">The hub on this site</a> is this, with the list of tools kept on a server.",
    code: `<span class="c">// the shop</span>
picker.postMessage({ want: "send flowers" });
picker.onmessage = ({ data, ports: [florist] }) => {
  florist.postMessage({ order: "twelve tulips" });      <span class="c">// straight to the florist</span>
};

<span class="c">// the picker, when the person has chosen</span>
const { port1, port2 } = new MessageChannel();
tools.get(choice).postMessage({ introduced: "the shop" }, [port1]);
shop.postMessage({ tool: choice }, [port2]);
<span class="c">// it kept neither end, so it can close</span>`,
    tour: { steps: [
      ["Shop: ask for someone to send flowers", "The shop asks the picker. The picker knows two florists that can, and waits for the person."],
      ["Person: pick Petal Post", "The picker makes a channel and gives one end to Petal Post and the other to the shop."],
      ["Close the picker", "The picker's frame is destroyed. The line between the shop and the florist is still there.", 1800],
      ["Shop: order twelve tulips", "The order goes straight to Petal Post, and the answer comes straight back. Rose and Thorn hears nothing."],
    ] },
    async setup(stage, ui) {
      const shop = logBox(stage, "page", "This page: a shop");
      const florist = () => on("register", (me, [port]) => {
        log("registered with the picker");
        port.onmessage = ({ data, ports: [line] }) => {
          log(`introduced to ${data.introduced}`);
          line.onmessage = ({ data: order }) => { log(`order: ${order.order}`); send(line, "direct", { ok: `${order.order}, delivered Friday by ${me.name}` }); };
        };
      });
      await Promise.all([
        stage.frame("picker", {
          title: "Picker", color: "yellow",
          script: () => {
            const tools = new Map(); let shop = null;
            on("tool", (data, [port]) => { tools.set(data.id, { port, name: data.name }); log(`${data.name} registered: sends flowers`); });
            on("shop", (_, [port]) => { shop = port; port.onmessage = ({ data }) => log(`the shop wants: ${data.want}. ${tools.size} florists offer it. Waiting for the person.`); });
            on("pick", (data) => {
              const tool = tools.get(data.id), { port1, port2 } = new MessageChannel();
              send(tool.port, "reg-" + data.id, { introduced: "the shop" }, [port1]);
              send(shop, "ask", { tool: tool.name, id: data.id }, [port2]);
              log(`connected the shop to ${tool.name}. I kept neither end.`);
            });
          },
        }),
        stage.frame("rose", { title: "Rose and Thorn, a florist", color: "red", script: florist }),
        stage.frame("petal", { title: "Petal Post, a florist", color: "teal", script: florist }),
      ]);
      // What happened before the demo starts: each florist registered with the picker, and the shop has a port to it.
      for (const [id, name] of [["rose", "Rose and Thorn"], ["petal", "Petal Post"]]) {
        const { port1, port2 } = new MessageChannel();
        stage.post(id, { cmd: "register", name }, [port1]);
        stage.post("picker", { cmd: "tool", id, name }, [port2]);
        stage.cable("reg-" + id, "picker", id, "ink");
      }
      const toPicker = new MessageChannel();
      stage.post("picker", { cmd: "shop" }, [toPicker.port2]);
      stage.cable("ask", "page", "picker", "yellow");
      let direct = null;
      const picks = [["petal", "Person: pick Petal Post"], ["rose", "Person: pick Rose and Thorn"]].map(([id, label]) => ui.button(label, () => { picks.forEach((b) => (b.disabled = true)); stage.post("picker", { cmd: "pick", id }); }, true));
      const close = ui.button("Close the picker", (btn) => { btn.disabled = true; stage.remove("picker"); shop.say("the picker has gone"); }, true);
      const order = ui.button("Shop: order twelve tulips", () => { direct.postMessage({ order: "twelve tulips" }); stage.pulse("direct", "page"); shop.say("ordered on the port the picker gave me"); }, true);
      toPicker.port1.onmessage = ({ data, ports }) => {
        direct = ports[0];
        direct.onmessage = ({ data: answer }) => shop.node.isConnected ? shop.say(answer.ok) : direct.close();
        stage.cable("direct", "page", data.id, "teal");
        shop.say(`given a port to ${data.tool}`);
        order.disabled = close.disabled = false;
      };
      ui.button("Shop: ask for someone to send flowers", (btn) => {
        btn.disabled = true;
        toPicker.port1.postMessage({ want: "send flowers" });
        stage.pulse("ask", "page");
        shop.say("asked the picker for someone who sends flowers");
        picks.forEach((b) => (b.disabled = false));
      }, false, true);
    },
  },
  {
    pattern: "functions", use: [2], id: "built-proxy",
    title: "Call another origin's object as if it were local, in about twenty lines",
    blurb: "Libraries such as Comlink turn a port into something you call like an ordinary object. This is that idea at its smallest. On this page, <code>wrap(port)</code> returns a <code>Proxy</code>. Reading a property extends a path, and calling it posts the path and the arguments down the port and returns a promise. In the frame, <code>expose(api, port)</code> walks the path, calls the function, and posts back the result or the error. The walk only follows properties the object itself has. Without that check, a caller could ask for <code>constructor</code> and reach <code>Function</code>, which <a href=\"/comlink/\">the Comlink page</a> shows happening in Comlink 4.4.2.",
    code: `<span class="c">// this page</span>
function wrap(port) {
  let last = 0; const waiting = new Map();
  port.onmessage = ({ data }) => {
    const { resolve, reject } = waiting.get(data.id); waiting.delete(data.id);
    "error" in data ? reject(new Error(data.error)) : resolve(data.result);
  };
  const at = (path) => new Proxy(() => {}, {
    get: (_, key) => key === "then" ? undefined : at([...path, key]),
    apply: (_, __, args) => new Promise((resolve, reject) => {
      waiting.set(++last, { resolve, reject });
      port.postMessage({ id: last, path, args });
    }),
  });
  return at([]);
}
const shop = wrap(port);
await shop.basket.total();

<span class="c">// the frame on another origin</span>
function expose(api, port) {
  port.onmessage = async ({ data: { id, path, args } }) => {
    try {
      let owner = null, target = api;
      for (const key of path) {
        if (!Object.hasOwn(target, key)) throw new Error("nothing called " + path.join("."));
        owner = target; target = target[key];
      }
      port.postMessage({ id, result: await target.apply(owner, args) });
    } catch (err) { port.postMessage({ id, error: err.message }); }
  };
}`,
    tour: { steps: [
      ["Wrap the port", "The frame exposes an object on its end. This page wraps the other end in a Proxy."],
      ["shop.add(2, 3)", "A call that looks local. The path and the arguments went down the port, and 5 came back."],
      ["shop.basket.add(\"lilies\")", "A method two levels down. It changes the basket that lives in the frame."],
      ["shop.basket.total()", "The total is worked out in the frame, from the basket as it is now."],
      ["shop.reserve()", "This method throws in the frame. The promise on this page rejects with the same message."],
      ["shop.constructor(\"return 1\")", "The object has no property of its own called constructor, so the frame refuses."],
    ] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page");
      await stage.frame("shop", {
        title: "Shop object, on another origin", color: "teal",
        script: () => on("port", (_, [port]) => {
          const api = {
            add: (a, b) => a + b,
            basket: { items: ["tulips", "roses"], add(item) { this.items.push(item); return this.items.length; }, total() { return this.items.length * 4.5; } },
            reserve() { throw new Error("out of stock"); },
          };
          log("exposing an object on my end of the port");
          port.onmessage = async ({ data: { id, path, args } }) => {
            const call = `${path.join(".")}(${args.map((a) => JSON.stringify(a)).join(", ")})`;
            try {
              let owner = null, target = api;
              for (const key of path) { if (!Object.hasOwn(target, key)) throw new Error("nothing called " + path.join(".")); owner = target; target = target[key]; }
              const result = await target.apply(owner, args);
              log(`ran ${call}`);
              send(port, "line", { id, result });
            } catch (err) { log(`${call}: ${err.message}`); send(port, "line", { id, error: err.message }); }
          };
        }),
      });
      function wrap(port) {
        let last = 0; const waiting = new Map();
        port.onmessage = ({ data }) => {
          const { resolve, reject } = waiting.get(data.id); waiting.delete(data.id);
          "error" in data ? reject(new Error(data.error)) : resolve(data.result);
        };
        const at = (path) => new Proxy(() => {}, {
          get: (_, key) => (key === "then" ? undefined : at([...path, key])),
          apply: (_, __, args) => new Promise((resolve, reject) => { waiting.set(++last, { resolve, reject }); port.postMessage({ id: last, path, args }); stage.pulse("line", "page"); }),
        });
        return at([]);
      }
      let shop = null;
      const calls = [
        ["shop.add(2, 3)", () => shop.add(2, 3)],
        ["shop.basket.add(\"lilies\")", () => shop.basket.add("lilies")],
        ["shop.basket.total()", () => shop.basket.total()],
        ["shop.reserve()", () => shop.reserve()],
        ["shop.constructor(\"return 1\")", () => shop.constructor("return 1")],
      ].map(([label, call]) => ui.button(label, async () => {
        try { me.say(`await ${label} gave ${JSON.stringify(await call())}`); } catch (err) { me.say(`await ${label} threw: ${err.message}`); }
      }, true));
      ui.button("Wrap the port", (btn) => {
        btn.disabled = true;
        const channel = new MessageChannel();
        stage.post("shop", { cmd: "port" }, [channel.port2]);
        stage.cable("line", "page", "shop", "teal");
        shop = wrap(channel.port1);
        me.say("const shop = wrap(port)");
        calls.forEach((b) => (b.disabled = false));
      }, false, true);
    },
  },
  {
    pattern: "filter", use: [1], id: "built-effect",
    title: "A blur that runs in a worker, so the page does not stop",
    blurb: "The picture is 1600 by 900, which is 1.4 million pixels. Blurring it takes a noticeable part of a second. Run on the page, the blur holds the main thread for that long: the marker under \"Main thread\" stops moving and nothing on the page can respond. Run in a worker, the same function gets the same pixels and the marker keeps moving. The pixels are not copied either way. Their buffer is transferred to the worker and transferred back, so for that time the page does not have them. The number shown is the longest gap between two frames of the page while the blur ran.",
    code: `import { blur } from "/patterns/effect.js";
const image = ctx.getImageData(0, 0, width, height);

<span class="c">// on the page: nothing else happens until this returns</span>
blur(image.data, width, height);
ctx.putImageData(image, 0, 0);

<span class="c">// in a worker: the buffer leaves, the page carries on, the buffer comes back</span>
worker.postMessage({ buffer: image.data.buffer, width, height }, [image.data.buffer]);
worker.onmessage = ({ data }) =>
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data.buffer), width, height), 0, 0);

<span class="c">// the worker</span>
onmessage = ({ data }) => {
  const pixels = blur(new Uint8ClampedArray(data.buffer), data.width, data.height);
  postMessage({ buffer: pixels.buffer }, [pixels.buffer]);
};`,
    tour: { steps: [
      ["Blur it on the page", "The blur runs on the main thread. The marker stops until it has finished.", 3200],
      ["Draw the picture again", "The sharp picture is back."],
      ["Blur it in a worker", "The pixels go to a worker and come back blurred. The marker did not stop.", 3200],
    ] },
    async setup(stage, ui) {
      const W = 1600, H = 900;
      const picture = stage.box("page", { html: `<canvas width="${W}" height="${H}" style="width:100%;height:100%;display:block;object-fit:cover" aria-label="A picture that the buttons blur"></canvas>` });
      const canvas = picture.node.querySelector("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const main = logBox(stage, "main", "Main thread", `<div style="height:.7rem;border:1.5px solid currentColor;border-radius:99px;margin:0 0 .4rem;position:relative;overflow:hidden"><i data-marker style="position:absolute;top:0;bottom:0;width:18%;background:var(--red, #e0364c);border-radius:99px"></i></div><p class="small" style="margin:0 0 .4rem">Longest stop during the last blur: <strong data-gap>not run yet</strong></p>`);
      const helper = logBox(stage, "worker", "Worker", "", { kind: "worker", url: "/patterns/effect-worker.js" });
      const draw = () => {
        const sky = ctx.createLinearGradient(0, 0, W, H);
        sky.addColorStop(0, "#0f1c3f"); sky.addColorStop(1, "#0e9f8e");
        ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
        ["#f5b700", "#e0364c", "#ffffff", "#f5b700", "#e0364c"].forEach((color, i) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(200 + i * 300, 300 + (i % 2) * 260, 110, 0, 7); ctx.fill(); });
        ctx.fillStyle = "#fff"; ctx.font = "800 150px system-ui, sans-serif"; ctx.textAlign = "center";
        ctx.fillText("SHARP EDGES", W / 2, H / 2 + 50);
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 6;
        for (let x = 40; x < W; x += 80) { ctx.beginPath(); ctx.moveTo(x, H - 150); ctx.lineTo(x + 40, H - 40); ctx.stroke(); }
      };
      draw();
      // The marker is moved by the page on every frame. While the main thread is busy it cannot move.
      const marker = main.node.querySelector("[data-marker]"), gapEl = main.node.querySelector("[data-gap]");
      let previous = performance.now(), longest = 0;
      const frame = (now) => {
        if (!marker.isConnected) return;
        longest = Math.max(longest, now - previous); previous = now;
        marker.style.left = `${41 + 41 * Math.sin(now / 300)}%`;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const worker = new Worker("/patterns/effect-worker.js", { type: "module" });
      worker.onerror = () => helper.say("the worker could not start in this browser");
      const { blur } = await import("/patterns/effect.js");
      const buttons = [];
      const run = (where) => async () => {
        buttons.forEach((b) => (b.disabled = true));
        const image = ctx.getImageData(0, 0, W, H);
        await nextFrame(); await nextFrame();
        longest = 0;
        const started = performance.now();
        if (where === "page") {
          main.say("blurring 1.4 million pixels here");
          blur(image.data, W, H);
          ctx.putImageData(image, 0, 0);
        } else {
          const answer = new Promise((resolve) => (worker.onmessage = ({ data }) => resolve(data)));
          worker.postMessage({ buffer: image.data.buffer, width: W, height: H }, [image.data.buffer]);
          stage.pulse("line", "main");
          main.say(`sent the pixels to the worker. I now hold ${image.data.length} bytes of them.`);
          helper.say("blurring 1.4 million pixels");
          const { buffer, took } = await answer;
          if (!canvas.isConnected) return worker.terminate();
          stage.pulse("line", "worker");
          helper.say(`done in ${took} ms. Sent the pixels back.`);
          ctx.putImageData(new ImageData(new Uint8ClampedArray(buffer), W, H), 0, 0);
        }
        const took = Math.round(performance.now() - started);
        await nextFrame(); await nextFrame();
        gapEl.textContent = `${Math.round(longest)} ms`;
        main.say(`${where === "page" ? "blurred on the page" : "blurred in the worker"} in ${took} ms. The page stopped for ${Math.round(longest)} ms.`);
        buttons.forEach((b) => (b.disabled = false));
      };
      stage.cable("line", "main", "worker", "teal");
      buttons.push(ui.button("Blur it on the page", run("page"), false, true));
      buttons.push(ui.button("Blur it in a worker", run("worker")));
      ui.button("Draw the picture again", () => { draw(); main.say("drew the sharp picture again"); });
    },
  },
];
