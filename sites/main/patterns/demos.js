import { Stage } from "/wire.js";
import { sites } from "/_sites.js";

const pageBox = (stage, title = "This page") => {
  const box = stage.box("page", { html: `<div class="here"><div class="box-title">${title}</div><ul class="log" role="log" aria-live="polite"></ul></div>` });
  const ul = box.node.querySelector("ul");
  return (text) => { const li = document.createElement("li"); li.textContent = text; ul.prepend(li); while (ul.children.length > 6) ul.lastChild.remove(); };
};

export const demos = [
  {
    id: "hello",
    title: "Open a channel and send a message through it",
    blurb: "<code>new MessageChannel()</code> gives you two entangled ports. Keep one, post the other to anyone you can already reach. From then on you have a private line that no other script on either page can listen to, unlike <code>window.postMessage</code>.",
    code: `const { port1, port2 } = new MessageChannel();
frame.contentWindow.postMessage("here", "*", [port2]); <span class="c">// port2 is moved, not copied</span>
port1.onmessage = (e) => console.log(e.data);
port1.postMessage("ping");`,
    async setup(stage, ui) {
      const say = pageBox(stage);
      await stage.frame("frame", {
        title: "A frame on another origin", color: "teal",
        script: () => {
          log("waiting — no channel yet");
          on("port", (_, [port]) => {
            log("a port arrived");
            port.onmessage = (e) => { log("heard " + e.data); send(port, "line", e.data.replace("ping", "pong")); };
          });
        },
      });
      let port = null, n = 0;
      stage.cleanup(() => port?.close());
      const sendBtn = ui.button("Send a ping", () => { port.postMessage(`ping ${++n}`); say(`sent ping ${n}`); stage.pulse("line", "page"); }, true);
      ui.button("Open a channel", (btn) => {
        const channel = new MessageChannel();
        port = channel.port1;
        port.onmessage = (e) => say("heard " + e.data);
        stage.post("frame", { cmd: "port" }, [channel.port2]);
        stage.cable("line", "page", "frame", "teal", "channel");
        say("created channel, moved port2 to the frame");
        btn.disabled = true; sendBtn.disabled = false;
      }, false, true);
    },
  },
  {
    id: "introduce",
    title: "Connect two sites to each other, then remove yourself",
    blurb: "A port can be passed on by whoever holds it. So a third party that knows two sites can make a channel, give each of them an end, and step away. The three windows are three different sites, and each address is in its bar. So that you can see all three at once, each is shown as a frame inside this page. Between real windows the introducer gets its lines to Site A and Site B because it opened them or they opened it. Close the introducer and the other two do not notice. This is how <a href=\"/hub/\">the hub</a> works.",
    code: `<span class="c">// in the introducer, which holds a port to each side</span>
const { port1, port2 } = new MessageChannel();
toLeft.postMessage({ meet: "right" }, [port1]);
toRight.postMessage({ meet: "left" }, [port2]);
<span class="c">// nothing else to do. It can close.</span>`,
    setup: introduce,
  },
  {
    id: "reply",
    title: "Send a reply port with each request",
    blurb: "Instead of matching replies to requests with ids, make a new channel for each request and send one end along with it. The answer comes back on a port that only this request ever had. Answers can't get mixed up, and nobody else can answer in your place. The three boxes are frames in this page. This page gave each client its line to the service before the first press.",
    code: `function ask(service, question) {
  const { port1, port2 } = new MessageChannel();
  service.postMessage(question, [port2]);
  return new Promise((resolve) => (port1.onmessage = (e) => { resolve(e.data); port1.close(); }));
}`,
    async setup(stage, ui) {
      const client = () => function () {
        let service = null, n = 0;
        log("not connected yet");
        on("port", (_, [port]) => { service = port; log("connected to the service"); });
        on("ask", (data) => {
          if (!service) return log("not connected yet");
          const { port1, port2 } = new MessageChannel();
          const q = ++n;
          tell("replyline", { q });
          send(service, "to-" + data.me, { q }, [port2]);
          log(`asked #${q}, sent a fresh reply port`);
          port1.onmessage = (e) => { log(`answer to #${q}: ${e.data}`); port1.close(); tell("replydone", { q }); };
        });
      };
      await Promise.all([
        stage.frame("one", { title: "Client one", color: "red", script: client() }),
        stage.frame("service", {
          title: "Service", color: "yellow",
          script: () => {
            log("waiting for clients");
            on("port", (data, [port]) => {
              log(`connected to ${data.who === "one" ? "Client one" : "Client two"}`);
              port.onmessage = (e) => {
                const wait = 450 + Math.random() * 900;
                log(`question from ${data.who}, thinking ${Math.round(wait)}ms`);
                setTimeout(() => { e.ports[0].postMessage(`${e.data.q * 7} (for ${data.who})`); tell("pulse", { cable: `reply-${data.who}-${e.data.q}` }); }, wait);
              };
            });
          },
        }),
        stage.frame("two", { title: "Client two", color: "teal", script: client() }),
      ]);
      const timers = [];
      stage.cleanup(() => timers.forEach(clearTimeout));
      stage.on((name, data) => {
        if (data.wire === "replyline") stage.cable(`reply-${name}-${data.q}`, "service", name, "ink", `reply #${data.q}`);
        if (data.wire === "replydone") timers.push(setTimeout(() => stage.cut(`reply-${name}-${data.q}`), 1100));
      });
      const ask1 = ui.button("Client one asks", () => stage.post("one", { cmd: "ask", me: "one" }), true);
      const ask2 = ui.button("Client two asks", () => stage.post("two", { cmd: "ask", me: "two" }), true);
      const connect = (who, color, askBtn) => (btn) => {
        btn.disabled = true;
        const channel = new MessageChannel();
        stage.post(who, { cmd: "port" }, [channel.port1]);
        stage.post("service", { cmd: "port", who }, [channel.port2]);
        stage.cable("to-" + who, who, "service", color, "requests");
        askBtn.disabled = false;
      };
      ui.button("Connect Client two", connect("two", "teal", ask2));
      ui.button("Connect Client one", connect("one", "red", ask1), false, true);
    },
  },
  {
    id: "attenuate",
    title: "Give a frame limited access, then revoke it",
    blurb: "Holding a port is the permission to use it. The owner here doesn't hand out its real port. It makes a new channel, keeps one end, and only answers <code>read</code> on it. To revoke, it closes its end. It needs no account, token or list of who is allowed. The two boxes are frames in this page and have no line to each other at the start, so the owner hands the new port to this page, which passes it to the guest.",
    code: `function readOnly(counter) {
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = (e) => port1.postMessage(e.data === "read" ? counter.value : "denied");
  return { port: port2, revoke: () => port1.close() };
}`,
    async setup(stage, ui) {
      await Promise.all([
        stage.frame("owner", {
          title: "Owner of a counter", color: "yellow",
          script: () => {
            let value = 41, mine = null;
            log("counter is 41");
            on("share", () => {
              const { port1, port2 } = new MessageChannel();
              mine = port1;
              port1.onmessage = (e) => {
                if (e.data === "read") { log("guest read the counter"); send(port1, "limited", value); }
                else { log(`guest tried "${e.data}": denied`); send(port1, "limited", "denied"); }
              };
              parent.postMessage({ wire: "handoff" }, "*", [port2]);
              log("shared a read-only port");
            });
            on("bump", () => log("counter is " + ++value));
            on("revoke", () => { mine?.close(); mine = null; log("closed my end"); });
          },
        }),
        stage.frame("guest", {
          title: "Guest", color: "red",
          script: () => {
            let line = null;
            log("no port yet");
            on("port", (_, [port]) => {
              line = port;
              log("holding a read-only line");
              port.onmessage = (e) => { clearTimeout(waiting); log("answer: " + e.data); };
            });
            let waiting;
            // Nothing tells you the other end closed. Silence is the only sign.
            on("try", (data) => {
              if (!line) return log("no line yet");
              line.postMessage(data.what); tell("pulse", { cable: "limited" });
              log(`sent "${data.what}"`);
              waiting = setTimeout(() => log("no answer: the line is dead"), 500);
            });
          },
        }),
      ]);
      const readBtn = ui.button("Guest reads", () => stage.post("guest", { cmd: "try", what: "read" }), true);
      const addBtn = ui.button("Guest tries to add", () => stage.post("guest", { cmd: "try", what: "add" }), true);
      ui.button("Owner adds one", () => stage.post("owner", { cmd: "bump" }));
      const revokeBtn = ui.button("Revoke", (btn) => { stage.post("owner", { cmd: "revoke" }); stage.cut("limited"); btn.disabled = true; }, true);
      stage.on((name, data, ports) => {
        if (data.wire !== "handoff") return;
        stage.post("guest", { cmd: "port" }, ports);
        stage.cable("limited", "owner", "guest", "red", "read-only");
        readBtn.disabled = addBtn.disabled = revokeBtn.disabled = false;
      });
      ui.button("Share read-only", () => stage.post("owner", { cmd: "share" }), false, true);
    },
  },
  {
    id: "exchange",
    title: "Use a SharedWorker to connect tabs to each other",
    blurb: "Every tab on an origin can reach the same SharedWorker. Here it keeps a port to each tab and does one job: when a tab joins, it makes a channel between that tab and every other, then stays out of it. The tabs talk directly. Open a third in a new tab and it joins the same mesh.",
    code: `<span class="c">// in the SharedWorker</span>
onconnect = ({ ports: [port] }) => {
  for (const other of peers) {
    const { port1, port2 } = new MessageChannel();
    port.postMessage({ meet: other.name }, [port1]);
    other.port.postMessage({ meet: name }, [port2]);
  }
  peers.add({ name, port });
};`,
    async setup(stage, ui) {
      const suffix = Math.random().toString(36).slice(2, 5);
      const names = [`Left ${suffix}`, `Right ${suffix}`];
      const leftBox = stage.box(names[0], { src: `/patterns/peer.html?name=${encodeURIComponent(names[0])}&manual=1`, title: "Left peer tab" });
      const workerBox = stage.box("worker", { kind: "shared", url: "/patterns/exchange.js", html: `<div class="here"><div class="box-title">SharedWorker</div><ul class="log" role="log" aria-live="polite"><li>waiting for tabs to join</li></ul></div>` });
      const rightBox = stage.box(names[1], { src: `/patterns/peer.html?name=${encodeURIComponent(names[1])}&manual=1`, title: "Right peer tab" });
      if (!("SharedWorker" in self)) {
        workerBox.node.querySelector("ul").innerHTML = `<li>This browser does not support SharedWorker.</li>`;
        ui.unsupported("This browser does not support SharedWorker, so tabs cannot share a worker here.");
        return;
      }
      const observer = new SharedWorker("/patterns/exchange.js", { name: "exchange" });
      observer.port.onmessage = ({ data }) => {
        if (!workerBox.node.isConnected) return observer.port.close();
        workerBox.node.querySelector("ul").innerHTML = `<li>${data.peers.length} tab${data.peers.length === 1 ? "" : "s"} connected</li><li>${data.introductions} introduction${data.introductions === 1 ? "" : "s"} made</li><li>0 chat messages seen</li>`;
      };
      observer.port.postMessage({ type: "observe" });
      stage.cleanup(() => observer.port.close());
      await Promise.all([leftBox.whenReady, rightBox.whenReady]);

      const leftSay = ui.button("Left tab says hi", () => stage.post(names[0], { cmd: "say" }), true);
      const rightSay = ui.button("Right tab says hi", () => stage.post(names[1], { cmd: "say" }), true);
      const joinRight = ui.button("Right tab joins SharedWorker", (btn) => { btn.disabled = true; stage.post(names[1], { cmd: "join" }); }, true);
      ui.button("Left tab joins SharedWorker", (btn) => { btn.disabled = true; stage.post(names[0], { cmd: "join" }); joinRight.disabled = false; }, false, true);

      let met = 0;
      stage.on((name, data) => {
        if (data.wire === "joined") stage.cable("w-" + name, name, "worker", "ink", "to worker");
        if (data.wire === "met" && names.includes(data.peer)) {
          stage.cable([name, data.peer].sort().join("~"), names[0], names[1], "teal", "direct");
          if (++met >= 2) leftSay.disabled = rightSay.disabled = false;
        }
      });
      ui.link("Open another peer in a new tab", "/patterns/peer.html");
    },
  },
  {
    id: "stream",
    title: "Send a stream to another frame",
    blurb: "A <code>ReadableStream</code> is transferable too, so you can hand another origin a live stream and it reads with back-pressure, as if the source were local. Chrome and Firefox can do this today.",
    code: `const stream = new ReadableStream({ pull(controller) { controller.enqueue(nextChunk()); } });
port.postMessage({ stream }, [stream]);

<span class="c">// other side</span>
port.onmessage = async ({ data }) => { for await (const chunk of data.stream) use(chunk); };`,
    async setup(stage, ui) {
      const say = pageBox(stage, "This page, the source");
      await stage.frame("reader", {
        title: "Reader on another origin", color: "teal",
        script: () => {
          log("waiting — no channel yet");
          on("port", (_, [port]) => {
            log("holding a port to the source");
            port.onmessage = async ({ data }) => {
              log("got a stream");
              const reader = data.stream.getReader();
              for (;;) { const { value, done } = await reader.read(); if (done) break; log("read " + value); }
              log("stream ended");
            };
          });
        },
      });
      let port = null;
      stage.cleanup(() => port?.close());
      const sendBtn = ui.button("Send a stream", () => {
        let n = 0;
        const stream = new ReadableStream({
          async pull(controller) {
            await new Promise((r) => setTimeout(r, 350));
            if (++n > 6) return controller.close();
            controller.enqueue(`chunk ${n}`); say(`wrote chunk ${n}`); stage.pulse("line", "page");
          },
        }, { highWaterMark: 0 });
        try {
          port.postMessage({ stream }, [stream]);
          stage.pulse("line", "page");
          say("transferred the ReadableStream");
        } catch {
          say("This browser cannot transfer streams yet.");
        }
      }, true);
      ui.button("Open a channel", (btn) => {
        const channel = new MessageChannel();
        port = channel.port1;
        stage.post("reader", { cmd: "port" }, [channel.port2]);
        stage.cable("line", "page", "reader", "teal", "channel");
        say("created channel, moved port2 to the reader");
        btn.disabled = true; sendBtn.disabled = false;
      }, false, true);
    },
  },
];

// Three real sites. The pattern is about windows: two sites and something
// like a picker window that knows both. Here each window is a frame that
// loads /actor.html from a different origin, so all three can be seen at
// once, and it is drawn as a window with that address in its bar. The ports
// cross between sites that share no storage and no code beyond that one page.
// What each part does is in /actor.js.
export async function introduce(stage, ui) {
  const part = (name, site, role, title, color) => {
    const box = stage.box(name, { as: "window", title, src: `${sites[site]}/actor.html?role=${role}&title=${encodeURIComponent(title)}&color=${encodeURIComponent(color)}` });
    return box.whenReady;
  };
  await Promise.all([
    part("left", "florist", "side", "Site A", "#e0364c"),
    part("intro", "library", "introducer", "Introducer", "#f5b700"),
    part("right", "planner", "side", "Site B", "#0e9f8e"),
  ]);

  let connected = 0, met = 0;
  const talkA = ui.button("Site A says hello", () => stage.post("left", { cmd: "talk" }), true);
  const talkB = ui.button("Site B says hello", () => stage.post("right", { cmd: "talk" }), true);
  const removeBtn = ui.button("Close the introducer", (btn) => { stage.remove("intro"); btn.disabled = true; }, true);
  const introBtn = ui.button("Introduce them", (btn) => { stage.post("intro", { cmd: "introduce" }); btn.disabled = true; }, true);

  // This page embeds all three, so each Connect button gives one site a line to
  // the introducer and keeps neither end of either channel.
  const wire = (name) => (btn) => {
    btn.disabled = true;
    const channel = new MessageChannel();
    stage.post(name, { cmd: "port" }, [channel.port1]);
    stage.post("intro", { cmd: "port", side: name }, [channel.port2]);
    stage.cable("i-" + name, name, "intro", "ink");
    if (++connected === 2) introBtn.disabled = false;
  };
  const connB = ui.button("Connect Site B to the introducer", wire("right"), true);
  ui.button("Connect Site A to the introducer", (btn) => { wire("left")(btn); connB.disabled = false; }, false, true);
  stage.on((name, data) => {
    if (data.wire === "met" && ++met === 2) {
      stage.cable("direct", "left", "right", "yellow", "direct");
      talkA.disabled = talkB.disabled = removeBtn.disabled = false;
    }
  });
}

// What each demo does when it plays itself: which button, and what to watch.
// A step is [start of the button's label, what happens, pause after in ms].
export const TOURS = {
  hello: { steps: [
    ["Open a channel", "A channel is made. One end stays in this page and the other is posted to the frame."],
    ["Send a ping", "A message goes down the wire, and the frame answers on the same wire."],
  ] },
  introduce: { steps: [
    ["Connect Site A to the introducer", "Site A gets a private line to the introducer. Site B is still separate."],
    ["Connect Site B to the introducer", "Site B gets its own line to the introducer. A and B still cannot reach each other."],
    ["Introduce them", "The introducer makes a new channel and sends one end to Site A and one end to Site B. The yellow direct line appears underneath."],
    ["Site A says hello", "Site A talks directly to Site B on the yellow cable. Nothing passes through the introducer."],
    ["Site B says hello", "Site B answers directly on the same yellow cable."],
    ["Close the introducer", "The introducer's window is closed and its dark cables vanish. The yellow direct line stays."],
    ["Site A says hello", "Site A still reaches Site B. The line never belonged to the introducer."],
  ] },
  reply: { steps: [
    ["Connect Client one", "Client one gets a request channel to the service."],
    ["Connect Client two", "Client two gets its own request channel to the service."],
    ["Client one asks", "Client one sends a question along with a fresh reply port. The answer returns on that reply port, then it closes."],
    ["Client two asks", "Client two sends a question with its own reply port. Answers return on separate ports, so they can never be mixed up."],
  ] },
  attenuate: { steps: [
    ["Share read-only", "The owner makes a channel, keeps one end that only answers read, and hands the other end to the guest."],
    ["Guest reads", "The guest asks to read the counter through its port and gets 41."],
    ["Guest tries to add", "The guest asks to change the counter and is denied. Its port does not allow that."],
    ["Owner adds one", "The owner increments its own counter to 42."],
    ["Revoke", "The owner closes its end of the guest's channel, cutting the cable."],
    ["Guest reads", "The guest asks again and hears nothing. Its port goes nowhere now."],
  ] },
  exchange: { steps: [
    ["Left tab joins SharedWorker", "Left tab connects to the SharedWorker. Nobody else is connected yet."],
    ["Right tab joins SharedWorker", "Right tab connects. The SharedWorker makes a new channel and hands one end to each tab, forming the teal direct line."],
    ["Left tab says hi", "Left tab sends a message directly to Right tab. Notice the SharedWorker saw 0 chat messages."],
    ["Right tab says hi", "Right tab sends a message directly back. The SharedWorker is completely out of the chat."],
  ] },
  stream: { steps: [
    ["Open a channel", "A channel is made between this page and the reader frame."],
    ["Send a stream", "A ReadableStream is transferred over the port. The frame reads it chunk by chunk while this page is still producing it."],
  ] },
  canvas: { steps: [
    ["Open a channel to the painter", "This page makes a channel and sends one end to the painter frame on another origin."],
    ["Ask the painter to paint", "This page sends the canvas size. The painter starts drawing and transfers each finished ImageBitmap back."],
    ["Ask for another colour", "This page sends a new colour over the same port."],
  ] },
  functions: { steps: [
    ["Lend onTick()", "A channel is created wrapping onTick(), and one end is sent to the other origin as a callable handle."],
    ["Start the countdown", "The other origin starts ticking and calls onTick() on each tick; every call runs back here.", 3200],
    ["Take the function back", "This page closes its end of the port. The countdown carries on over there, but its calls no longer arrive."],
  ] },
  zerocopy: { steps: [
    ["Open a channel", "This page opens a channel to the frame on another origin."],
    ["Transfer 64 MB", "64 MB moves to the other origin and back without copying. While it is away, this page holds zero bytes."],
    ["Copy 64 MB", "The same 64 MB is cloned instead of moved, so you can compare the round-trip time."],
  ] },
  tearoff: { steps: [
    ["Connect to the feed", "This page opens a channel to the feed frame on another origin, and live ticks start arriving."],
  ], then: "Now press Tear it off. The widget moves to a window of its own and keeps its live port. Browsers only open a popup window for a real click." },
  tabserver: { steps: [
    ["Connect this tab to the Service Worker", "This page registers the Service Worker and hands it a port so fetch requests can be forwarded here."],
    ["Load the served page", "The box on the right navigates to a real URL. The Service Worker forwards the request up the port to this tab, and this tab writes the response."],
  ], then: "Edit the HTML on the left and press Load the served page again." },
  "stream-intro": { steps: [
    ["Connect Source and Reader to the introducer", "Source and Reader each get a line to the introducer. They have no direct line to each other yet."],
    ["Stream through the introducer", "Source sends a stream to the introducer, which forwards it to Reader. Every chunk now flows through the middle.", 3200],
    ["Remove the introducer", "The introducer is destroyed, and the reader stalls with no error and no end."],
  ], then: "Press Start again, connect to the introducer, then try Introduce them with a port followed by Stream down the direct port." },
  pipeline: { steps: [
    ["Connect the three origins", "Channels are opened from this page to the transformer, and from the transformer to the reader."],
    ["Start the pipe", "A ReadableStream leaves this page, passes through the transformer, and reaches the reader.", 3200],
    ["Pause the reader", "The reader stops pulling. Back-pressure travels upstream and stops the source a few chunks later.", 3200],
    ["Let the reader continue", "The reader resumes pulling, and the source starts producing again."],
  ] },
  reload: { steps: [
    ["Connect the feed to the frame", "A channel is opened between the feed on another origin and the frame, and ticks begin arriving.", 2200],
    ["Reload the frame", "The frame deposits its port in the SharedWorker bank on pagehide, reloads, and withdraws it with zero gaps."],
  ] },
  frozen: { steps: [
    ["Introduce the two workers", "Each worker gets one end of a channel. This page keeps neither."],
  ], then: "Now press Freeze this page for 3 seconds. The page stops completely while the two workers keep counting." },
  filter: { steps: [
    ["Connect the filter", "This page opens a channel to the filter frame on another origin."],
    ["Start the video", "VideoFrames leave this page one at a time, pass through the filter, and come back changed.", 3000],
    ["Ask for another effect", "This page asks the filter to switch effects over the port."],
    ["Remove the filter", "The filter frame is destroyed and the output stops with it."],
  ] },
  keycopy: { steps: [
    ["Send the key itself", "A copy of the key goes to the florist's real site. This page still has its own."],
    ["Florist: sign an order", "The florist signs with the key, and this page checks the signature. It is valid: the florist can sign as this page."],
    ["Reload the florist", "The florist's page is thrown away and loaded again. It saved the key in its own storage first.", 3000],
    ["Florist: sign an order", "It still has the key, and still signs. There is no way to take a copied key back."],
  ] },
  halves: { steps: [
    ["Give the library the listening half", "The library's site gets a stream it can only read. This page keeps the controller.", 3200],
    ["Give the florist the writing half", "The florist's site gets a stream it can only write into."],
    ["Florist: drop a note", "The florist writes a note. It lands here, and the florist cannot see what else is in the box."],
    ["Close the feed", "This page ends the feed. The library is told it is over."],
    ["Shut the drop box", "This page shuts the box."],
    ["Florist: drop a note", "The florist's next note is refused."],
  ] },
  roundtrip: { steps: [
    ["Ask the library for its transform", "The library's site makes a transform and gives this page both of its ends."],
    ["Send a line through it", "A line with an email address goes to the library's origin and comes back blacked out."],
    ["Send a line through it", "A card number goes through the same pipe."],
  ] },
  lend: { steps: [
    ["Widget: try to connect by itself", "The widget tries to reach the server by itself. Its rules forbid any network access."],
    ["Open a connection to the server", "This page opens a WebSocket."],
    ["Lend the widget the connection", "The two streams of that connection are handed to the widget."],
    ["Widget: say hello to the server", "The widget writes into the connection, and the server's answer comes back to it. It still has no network of its own.", 2800],
    ["Close the connection", "This page closes the socket, and the widget is cut off."],
  ] },
  far: { steps: [
    ["Open a line for another device", "This page asks the server for a meeting place and shows its code. Open the link on a phone to be the other device."],
    ["Use a stand-in", "No phone to hand, so a second page plays the other device. The two connect directly and this page gives its end to the counter.", 4500],
    ["Other device: add one", "The other device posts into its port. The message arrives in the counter frame, which was only ever given a port."],
    ["Other device: change the colour", "Another message, the same way. The answer goes back and the far side shows it."],
    ["Hang up", "This page closes the connection, and the far port goes quiet."],
  ], then: "That is all of it. Start again and open the link on your phone to do it across two real devices." },
  audio: { steps: [], then: "Press Start the music, then Freeze this page for 3 seconds. Browsers only make sound for a real click." },
  signer: { steps: [
    ["Ask the vault", "The vault makes a key nobody can read, and gives this page a port that signs."],
    ["Lend the shop", "This page lends the shop a weaker port: orders only, three uses."],
    ["Shop: sign an order", "The shop asks for a signature. The request passes through this page to the vault, and the result is checked here."],
    ["Shop: try to sign a payment", "The shop asks to sign a payment. This page refuses, because that port only does orders."],
    ["Take the port back", "The shop's port is closed."],
  ] },
};

// Mount one demo into a container: a stage, a step bar, and a row of buttons.
// Next does the next step for you and says what it did. Back returns to the
// step before, by starting over and redoing the steps up to it. The buttons
// underneath are the same actions, for doing it in your own order.
export function mount(container, demo, tours = TOURS, { autoplay = false } = {}) {
  container.innerHTML = `<div class="stage-el"></div><div class="stepper"><p class="caption" aria-live="polite"></p><div class="steps" hidden><button class="tiny quiet back" type="button">‹ Back</button><button class="tiny accent fwd" type="button"></button><button class="tiny quiet pause" type="button" hidden>Pause</button></div></div><div class="controls"></div>`;
  const stage = new Stage(container.querySelector(".stage-el"));
  const controls = container.querySelector(".controls");
  const caption = container.querySelector(".caption");
  const stepsEl = container.querySelector(".steps");
  const back = container.querySelector(".back");
  const fwd = container.querySelector(".fwd");
  const pauseBtn = container.querySelector(".pause");
  const tour = demo.tour || tours[demo.id] || { steps: [] };
  const total = tour.steps.length;
  let playing = 0;       // changes whenever something new takes over, stopping prior runs
  let at = 0;            // how many steps have been done
  let busy = false;      // true while a step/back/reset transition is running
  let autoPlaying = false;
  let unsupportedReason = "";
  let playBtn = null;

  const say = (html) => { caption.innerHTML = html; };
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const hints = new Map(tour.steps.map(([label, text]) => [label, text]));
  const hintFor = (label) => { for (const [start, text] of hints) if (label.startsWith(start)) return text; return ""; };
  const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const sync = () => {
    const usable = total > 0 && !unsupportedReason;
    stepsEl.hidden = !usable;
    back.disabled = busy || at === 0;
    fwd.disabled = busy;
    pauseBtn.hidden = !autoPlaying;
    if (playBtn) playBtn.textContent = autoPlaying ? "Stop" : "Play it for me";
    if (usable) {
      fwd.textContent = at < total ? `Next: ${tour.steps[at][0]} ›` : "Start again ↺";
    }
  };

  const stopPlayback = (note = "") => {
    playing++;
    autoPlaying = false;
    busy = false;
    controls.querySelector(".next")?.classList.remove("next");
    if (note) say(note);
    sync();
  };

  const ui = {
    button(label, fn, disabled = false, first = false) {
      const b = document.createElement("button");
      b.type = "button";
      // With a step bar, Next is the one bright button.
      b.className = "tiny" + (first && !total ? " accent" : " quiet");
      b.textContent = label; b.disabled = disabled;
      b.onclick = (event) => {
        // A real press takes over from the tour, and still says what it did.
        if (event.isTrusted) {
          if (autoPlaying) autoPlaying = false;
          playing++;
          controls.querySelector(".next")?.classList.remove("next");
          const hint = hintFor(b.textContent); if (hint) say(`<strong>${esc(b.textContent)}.</strong> ${esc(hint)}`);
          if (at < total && b.textContent.startsWith(tour.steps[at][0])) { at++; }
          sync();
        }
        fn(b);
      };
      first ? controls.prepend(b) : controls.append(b);
      return b;
    },
    link(label, href) {
      const a = document.createElement("a");
      a.textContent = label; a.href = href; a.target = "_blank"; a.rel = "noopener"; a.className = "small";
      controls.append(a);
      return a;
    },
    unsupported(reason) {
      unsupportedReason = reason || "This demo needs a browser feature that is not available here.";
    },
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const find = (start) => [...controls.querySelectorAll("button")].find((b) => b.textContent.startsWith(start));

  // Do step i: wait for its button, show which one it is, press it, say what it did.
  async function step(i, mine, lead = 450) {
    const [start, text] = tour.steps[i];
    let button = null;
    for (let waited = 0; waited < 10000 && playing === mine; waited += 150) {
      button = find(start);
      if (button && !button.disabled) break;
      // If the button does not exist in DOM at all after 1.2s, stop early instead of hanging 10s.
      if (!button && waited >= 1200) break;
      await sleep(150);
    }
    if (playing !== mine) return false;
    if (!button || button.disabled) {
      say(`<span class="step">Stopped</span> Could not run "${esc(start)}" in this browser.`);
      return false;
    }
    button.classList.add("next");
    say(`<span class="step">${i + 1} of ${total}</span> <strong>${esc(button.textContent)}.</strong> ${esc(text)}`);
    await sleep(reducedMotion() ? Math.min(lead, 120) : lead);
    button.classList.remove("next");
    if (playing !== mine) return false;
    button.click();
    at = i + 1; sync();
    return true;
  }

  const ending = () => esc(tour.then || "That is all of it. Press any button to do it yourself, or Start again.");

  async function play() {
    if (unsupportedReason || !total) return;
    const mine = ++playing;
    autoPlaying = true;
    busy = false;
    sync();
    if (tour.before) { say("Starting in a moment."); await sleep(tour.before); if (playing !== mine) return; }
    for (let i = at; i < total; i++) {
      if (!(await step(i, mine, 950))) {
        if (playing === mine) { autoPlaying = false; sync(); }
        return;
      }
      await sleep(tour.steps[i][2] || 2200);
      if (playing !== mine) return;
    }
    autoPlaying = false;
    sync();
    say(ending());
  }

  const reset = async (auto, { restoreFocus = false } = {}) => {
    const mine = ++playing;
    autoPlaying = false;
    busy = true;
    at = 0;
    unsupportedReason = "";
    playBtn = null;
    sync();
    stage.reset(); controls.innerHTML = ""; say("");
    await demo.setup(stage, ui);
    if (playing !== mine) return;
    // If the demo declared steps but no matching first button exists, treat as unsupported
    // so Next never hangs silently for 10 seconds.
    if (!unsupportedReason && total > 0 && !find(tour.steps[0][0])) {
      unsupportedReason = "This demo needs a browser feature that is not available here.";
    }
    const usable = total > 0 && !unsupportedReason;
    if (usable) {
      const label = document.createElement("span");
      label.className = "small muted own";
      label.textContent = "Or press them yourself:";
      controls.prepend(label);
    }
    const again = ui.button("Start again", () => reset(false, { restoreFocus: true }));
    again.classList.add("reset");
    if (usable) {
      playBtn = ui.button("Play it for me", () => {
        if (autoPlaying) {
          stopPlayback(`<span class="step">${at} of ${total}</span> Paused. Press <strong>Next</strong> to continue, or <strong>Play it for me</strong> to resume.`);
          fwd.focus();
        } else {
          at >= total ? reset(true) : play();
        }
      });
      playBtn.classList.add("reset");
      playBtn.style.marginLeft = "0";
    }
    busy = false;
    sync();
    if (unsupportedReason) {
      say(esc(unsupportedReason));
      return;
    }
    if (auto) {
      play();
    } else {
      say(total ? `<span class="step">${total} steps</span> Press <strong>Next</strong>. Each press does one step for you and says what happened.` : esc(tour.then || ""));
      if (restoreFocus) {
        if (usable) fwd.focus();
        else controls.querySelector("button:not(:disabled)")?.focus();
      }
    }
  };

  pauseBtn.onclick = () => {
    stopPlayback(`<span class="step">${at} of ${total}</span> Paused. Press <strong>Next</strong> to continue, or <strong>Play it for me</strong> to resume.`);
    fwd.focus();
  };

  fwd.onclick = async () => {
    if (busy) return;
    if (at >= total) return reset(false, { restoreFocus: true });
    const mine = ++playing;
    autoPlaying = false;
    busy = true;
    sync();
    const i = at;
    let ok = false;
    try {
      ok = await step(i, mine);
    } finally {
      if (playing === mine) { busy = false; sync(); }
    }
    if (ok && i + 1 === total) {
      await sleep(Math.min(tour.steps[i][2] || 2200, 2200));
      if (playing === mine && tour.then) say(`${caption.innerHTML} ${ending()}`);
    }
  };

  // There is no undo for a port that has been closed or a frame that has been
  // destroyed, so going back means starting over and redoing the earlier steps.
  back.onclick = async () => {
    if (busy || at === 0) return;
    const target = Math.max(0, at - 1);
    const mineStart = ++playing;
    autoPlaying = false;
    busy = true;
    sync();
    await reset(false);
    if (playing < mineStart) return;
    const mine = ++playing;
    busy = true;
    sync();
    try {
      for (let i = 0; i < target; i++) {
        if (!(await step(i, mine, 120))) break;
        const pause = tour.steps[i][2] || 0;
        await sleep(i === target - 1 ? 0 : pause > 2200 ? pause : 450);
        if (playing !== mine) return;
      }
    } finally {
      if (playing === mine) {
        busy = false;
        sync();
        (back.disabled ? fwd : back).focus();
      }
    }
  };

  // Set up now. A pattern's own page plays its demo when it comes into view, so
  // that it is seen working. ?play=1 forces that anywhere and ?play=0 stops it.
  // Never autoplay when prefers-reduced-motion is enabled or for heavy demos.
  const ready = reset(false);
  const wish = new URLSearchParams(location.search).get("play");
  const shouldAuto = total && wish !== "0" && (wish === "1" || (autoplay && !demo.noAutoplay && !reducedMotion() && !navigator.webdriver));
  let io = null;
  if (shouldAuto) {
    io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      const before = playing;
      ready.then(() => { if (playing === before && !unsupportedReason) play(); });
    }, { threshold: 0.6 });
    io.observe(container.querySelector(".stage-el"));
  }
  return { stage, destroy() { io?.disconnect(); playing++; stage.destroy(); } };
}
