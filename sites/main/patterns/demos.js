import { Stage } from "/wire.js";

const pageBox = (stage, title = "This page") => {
  const box = stage.box("page", { html: `<div class="here"><h4>${title}</h4><ul class="log"></ul></div>` });
  const ul = box.node.querySelector("ul");
  return (text) => { const li = document.createElement("li"); li.textContent = text; ul.prepend(li); while (ul.children.length > 6) ul.lastChild.remove(); };
};

export const demos = [
  {
    id: "hello",
    title: "A channel is two ends of one wire",
    blurb: "<code>new MessageChannel()</code> gives you two entangled ports. Keep one, post the other to anyone you can already reach. From then on you have a private line that no other script on either page can listen to, unlike <code>window.postMessage</code>.",
    code: `const { port1, port2 } = new MessageChannel();
frame.contentWindow.postMessage("here", "*", [port2]); <span class="c">// port2 is moved, not copied</span>
port1.onmessage = (e) => console.log(e.data);
port1.postMessage("ping");`,
    async setup(stage, ui) {
      const say = pageBox(stage);
      await stage.frame("frame", {
        title: "A frame on another origin", color: "teal",
        script: () => on("port", (_, [port]) => {
          log("a port arrived");
          port.onmessage = (e) => { log("heard " + e.data); send(port, "line", e.data.replace("ping", "pong")); };
        }),
      });
      let port, n = 0;
      const sendBtn = ui.button("Send a ping", () => { port.postMessage(`ping ${++n}`); stage.pulse("line", "page"); }, true);
      ui.button("Open a channel", (btn) => {
        const channel = new MessageChannel();
        port = channel.port1;
        port.onmessage = (e) => say("heard " + e.data);
        stage.post("frame", { cmd: "port" }, [channel.port2]);
        stage.cable("line", "page", "frame", "teal");
        btn.disabled = true; sendBtn.disabled = false;
      });
    },
  },
  {
    id: "introduce",
    title: "Introduce two strangers, then leave",
    blurb: "A port can be passed on by whoever holds it. So a third party that knows two sites can make a channel, give each of them an end, and step away. Remove the introducer here and the other two do not notice. This one move is the whole idea behind the hub.",
    code: `<span class="c">// in the introducer, which holds a port to each side</span>
const { port1, port2 } = new MessageChannel();
toLeft.postMessage({ meet: "right" }, [port1]);
toRight.postMessage({ meet: "left" }, [port2]);
<span class="c">// nothing else to do. It can close.</span>`,
    setup: introduce,
  },
  {
    id: "reply",
    title: "Send a return address with every question",
    blurb: "Instead of matching replies to requests with ids, make a new channel for each request and send one end along with it. The answer comes back on a port that only this request ever had. Slow answers cannot cross, and nobody else can answer in your place.",
    code: `function ask(service, question) {
  const { port1, port2 } = new MessageChannel();
  service.postMessage(question, [port2]);
  return new Promise((resolve) => (port1.onmessage = (e) => { resolve(e.data); port1.close(); }));
}`,
    async setup(stage, ui) {
      const client = (name) => function () {
        let service, n = 0;
        on("port", (_, [port]) => { service = port; log("holding a line to the service"); });
        on("ask", (data) => {
          const { port1, port2 } = new MessageChannel();
          const q = ++n;
          tell("replyline", { q });
          send(service, "to-" + data.me, { q }, [port2]);
          log(`asked #${q}`);
          port1.onmessage = (e) => { log(`answer to #${q}: ${e.data}`); port1.close(); tell("replydone", { q }); };
        });
      };
      await Promise.all([
        stage.frame("one", { title: "Client one", color: "red", script: client() }),
        stage.frame("service", {
          title: "Service", color: "yellow",
          script: () => on("port", (data, [port]) => {
            port.onmessage = (e) => {
              const wait = 300 + Math.random() * 1500;
              log(`question from ${data.who}, thinking ${Math.round(wait)}ms`);
              setTimeout(() => { e.ports[0].postMessage(`${e.data.q * 7} (for ${data.who})`); tell("pulse", { cable: `reply-${data.who}-${e.data.q}` }); }, wait);
            };
          }),
        }),
        stage.frame("two", { title: "Client two", color: "teal", script: client() }),
      ]);
      for (const [me, color] of [["one", "red"], ["two", "teal"]]) {
        const channel = new MessageChannel();
        stage.post(me, { cmd: "port" }, [channel.port1]);
        stage.post("service", { cmd: "port", who: me }, [channel.port2]);
        stage.cable("to-" + me, me, "service", color);
      }
      stage.on((name, data) => {
        if (data.wire === "replyline") stage.cable(`reply-${name}-${data.q}`, "service", name, "ink");
        if (data.wire === "replydone") setTimeout(() => stage.cut(`reply-${name}-${data.q}`), 500);
      });
      ui.button("Client one asks", () => stage.post("one", { cmd: "ask", me: "one" }));
      ui.button("Client two asks", () => stage.post("two", { cmd: "ask", me: "two" }));
    },
  },
  {
    id: "attenuate",
    title: "Give away less than you have, and take it back",
    blurb: "A port is a capability: holding it is the permission. The owner here does not hand out its real line. It makes a new channel, keeps one end, and only answers <code>read</code> on it. To revoke, it closes its end. No account, no token, no list of who is allowed.",
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
            });
            on("bump", () => log("counter is " + ++value));
            on("revoke", () => { mine?.close(); mine = null; log("closed my end"); });
          },
        }),
        stage.frame("guest", {
          title: "Guest", color: "red",
          script: () => {
            let line = null;
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
      const off = stage.on((name, data, ports) => {
        if (data.wire !== "handoff") return;
        stage.post("guest", { cmd: "port" }, ports);
        stage.cable("limited", "owner", "guest", "red");
      });
      ui.button("Share read-only", () => stage.post("owner", { cmd: "share" }));
      ui.button("Guest reads", () => stage.post("guest", { cmd: "try", what: "read" }));
      ui.button("Guest tries to add", () => stage.post("guest", { cmd: "try", what: "add" }));
      ui.button("Owner adds one", () => stage.post("owner", { cmd: "bump" }));
      ui.button("Revoke", () => { stage.post("owner", { cmd: "revoke" }); stage.cut("limited"); });
    },
  },
  {
    id: "exchange",
    title: "A SharedWorker as the exchange",
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
      stage.box(names[0], { src: `/patterns/peer.html?name=${encodeURIComponent(names[0])}` });
      const workerBox = stage.box("worker", { html: `<div class="here"><h4>SharedWorker</h4><ul class="log"><li>starting</li></ul></div>` });
      stage.box(names[1], { src: `/patterns/peer.html?name=${encodeURIComponent(names[1])}` });
      const observer = new SharedWorker("/patterns/exchange.js", { name: "exchange" });
      observer.port.onmessage = ({ data }) => {
        workerBox.node.querySelector("ul").innerHTML = `<li>${data.peers.length} tab${data.peers.length === 1 ? "" : "s"} connected</li><li>${data.introductions} introduction${data.introductions === 1 ? "" : "s"} made</li><li>0 chat messages seen</li>`;
      };
      observer.port.postMessage({ type: "observe" });
      stage.on((name, data) => {
        if (data.wire === "ready") stage.cable("w-" + name, name, "worker", "ink");
        if (data.wire === "met" && names.includes(data.peer)) stage.cable([name, data.peer].sort().join("~"), names[0], names[1], "teal");
      });
      ui.link("Open another peer in a new tab", "/patterns/peer.html");
    },
  },
  {
    id: "stream",
    title: "Send a stream down the wire",
    blurb: "Ports carry more than messages. A <code>ReadableStream</code> is transferable too, so you can hand another origin a live stream and it reads with back-pressure, as if the source were local. Chrome and Firefox can do this today.",
    code: `const stream = new ReadableStream({ pull(controller) { controller.enqueue(nextChunk()); } });
port.postMessage({ stream }, [stream]);

<span class="c">// other side</span>
port.onmessage = async ({ data }) => { for await (const chunk of data.stream) use(chunk); };`,
    async setup(stage, ui) {
      const say = pageBox(stage, "This page, the source");
      await stage.frame("reader", {
        title: "Reader on another origin", color: "teal",
        script: () => on("port", (_, [port]) => {
          port.onmessage = async ({ data }) => {
            log("got a stream");
            const reader = data.stream.getReader();
            for (;;) { const { value, done } = await reader.read(); if (done) break; log("read " + value); }
            log("stream ended");
          };
        }),
      });
      const channel = new MessageChannel();
      stage.post("reader", { cmd: "port" }, [channel.port2]);
      stage.cable("line", "page", "reader", "teal");
      ui.button("Send a stream", () => {
        let n = 0;
        const stream = new ReadableStream({
          async pull(controller) {
            await new Promise((r) => setTimeout(r, 350));
            if (++n > 6) return controller.close();
            controller.enqueue(`chunk ${n}`); say(`wrote chunk ${n}`); stage.pulse("line", "page");
          },
        }, { highWaterMark: 0 });
        try { channel.port1.postMessage({ stream }, [stream]); }
        catch { say("This browser cannot transfer streams yet."); }
      });
    },
  },
];

export async function introduce(stage, ui) {
  const side = (other) => function () {
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
  };
  await Promise.all([
    stage.frame("left", { title: "Site A", color: "red", script: side() }),
    stage.frame("intro", {
      title: "Introducer", color: "yellow",
      script: () => {
        const lines = {};
        on("port", (data, [port]) => { lines[data.side] = port; });
        on("introduce", () => {
          const { port1, port2 } = new MessageChannel();
          send(lines.left, "i-left", { meet: "Site B" }, [port1]);
          send(lines.right, "i-right", { meet: "Site A" }, [port2]);
          log("made a channel, gave away both ends");
        });
      },
    }),
    stage.frame("right", { title: "Site B", color: "teal", script: side() }),
  ]);
  for (const name of ["left", "right"]) {
    const channel = new MessageChannel();
    stage.post(name, { cmd: "port" }, [channel.port1]);
    stage.post("intro", { cmd: "port", side: name }, [channel.port2]);
    stage.cable("i-" + name, name, "intro", "ink");
  }
  let met = 0;
  const talkA = ui.button("Site A says hello", () => stage.post("left", { cmd: "talk" }), true);
  const talkB = ui.button("Site B says hello", () => stage.post("right", { cmd: "talk" }), true);
  const removeBtn = ui.button("Remove the introducer", (btn) => { stage.remove("intro"); btn.disabled = true; }, true);
  stage.on((name, data) => {
    if (data.wire === "met" && ++met === 2) { stage.cable("direct", "left", "right", "yellow"); talkA.disabled = talkB.disabled = removeBtn.disabled = false; }
  });
  ui.button("Introduce them", (btn) => { stage.post("intro", { cmd: "introduce" }); btn.disabled = true; }, false, true);
}

// What each demo does when it plays itself: which button, and what to watch.
// A step is [start of the button's label, what happens, pause after in ms].
export const TOURS = {
  hello: { steps: [["Open a channel", "A channel is made. One end stays in this page and the other is posted to the frame."], ["Send a ping", "A message goes down the wire, and the frame answers on the same wire."]] },
  introduce: { steps: [["Introduce them", "The introducer makes a channel and gives one end to each site."], ["Site A says hello", "A talks to B directly, on the yellow cable. Nothing passes through the introducer."], ["Site B says hello", "B answers the same way."], ["Remove the introducer", "The introducer is destroyed."], ["Site A says hello", "The two sites still talk. The line was never the introducer's."]] },
  reply: { steps: [["Client one asks", "Client one sends a question, and with it a fresh port to answer on."], ["Client two asks", "Client two does the same. Each answer returns on its own port, so they cannot be mixed up."]] },
  attenuate: { steps: [["Share read-only", "The owner gives the guest a port that can read the counter and do nothing else."], ["Guest reads", "The guest reads the counter through its port."], ["Guest tries to add", "The guest asks to change it and is denied. Its port does not do that."], ["Owner adds one", "The owner still can."], ["Revoke", "The owner closes its end of the guest's port."], ["Guest reads", "The guest asks again and hears nothing. Its port goes nowhere now."]] },
  stream: { steps: [["Send a stream", "A stream is transferred. The frame reads it chunk by chunk while this page is still producing it."]] },
  canvas: { steps: [["Hand over the canvas", "The drawing surface of the canvas on the left moves to another origin, which starts painting into this page."], ["Ask for another colour", "This page asks for a new colour over the port."]] },
  functions: { steps: [["Lend onTick", "A port standing in for a function goes to the other origin. It calls the function once a tick, and each call runs here.", 3600], ["Take the function back", "The port is closed. The countdown carries on over there, and its calls no longer arrive."]] },
  zerocopy: { steps: [["Transfer 64 MB", "64 MB goes to another origin and back without being copied. While it is away, this page holds zero bytes."]], then: "Now press Copy 64 MB to compare the time." },
  tearoff: { steps: [], then: "Press Tear it off. The widget moves to a window of its own and keeps its live port. This one needs your click, because browsers only open a window for a person." },
  tabserver: { steps: [["Load the served page", "The box on the right asks for a real URL. The service worker passes the request up a port to this tab, and this tab writes the response."]], then: "Edit the HTML on the left and press the button again." },
  "stream-intro": { steps: [["Stream through the introducer", "The stream is passed on by the introducer, so every chunk flows through it.", 3200], ["Remove the introducer", "The introducer is destroyed, and the reader stalls. No error, no end."]], then: "Press Start again, then try Introduce, then stream directly." },
  pipeline: { steps: [["Start the pipe", "Chunks flow from this page, through the transformer, to the reader.", 3600], ["Pause the reader", "The reader stops. A few chunks later the source stops being asked for more.", 3600], ["Let the reader continue", "The reader resumes, and so does the source."]] },
  reload: { before: 2500, steps: [["Reload the frame", "The frame reloads. Its port waits in the bank and is collected afterwards, and the count has no gaps."]] },
  frozen: { steps: [["Introduce the two workers", "Each worker is given one end of a channel. This page keeps neither."]], then: "Now press Freeze this page. Everything here stops for 3 seconds except the two workers." },
  filter: { steps: [["Start the video", "Frames leave this page one at a time, pass through the filter on another origin, and come back changed.", 3200], ["Ask for another effect", "This page asks the filter to do something different."]] },
  signer: { steps: [["Ask the vault", "The vault makes a key nobody can read, and gives this page a port that signs."], ["Lend the shop", "This page lends the shop a weaker port: orders only, three uses."], ["Shop: sign an order", "The shop asks for a signature. The request passes through this page to the vault, and the result is checked here."], ["Shop: try to sign a payment", "The shop asks to sign a payment. This page refuses, because that port only does orders."], ["Take the port back", "The shop's port is closed."]] },
};

// Mount one demo into a container: a caption, a stage, a row of buttons.
// The demo plays itself once when it comes into view, pressing its own
// buttons and saying what each one does. Any press of yours stops that.
export function mount(container, demo, tours = TOURS) {
  container.innerHTML = `<div class="stage-el"></div><p class="caption" aria-live="polite"></p><div class="controls"></div>`;
  const stage = new Stage(container.querySelector(".stage-el"));
  const controls = container.querySelector(".controls");
  const caption = container.querySelector(".caption");
  const tour = tours[demo.id] || { steps: [] };
  let playing = 0;
  const say = (html) => { caption.innerHTML = html; };
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const hints = new Map(tour.steps.map(([label, text]) => [label, text]));
  const hintFor = (label) => { for (const [start, text] of hints) if (label.startsWith(start)) return text; return ""; };
  const ui = {
    button(label, fn, disabled = false, first = false) {
      const b = document.createElement("button");
      b.className = "tiny" + (first ? " accent" : " quiet");
      b.textContent = label; b.disabled = disabled;
      b.onclick = (event) => {
        // A real press takes over from the tour, and still says what it did.
        if (event.isTrusted) { playing++; controls.querySelector(".next")?.classList.remove("next"); const hint = hintFor(b.textContent); if (hint) say(`<strong>${esc(b.textContent)}.</strong> ${esc(hint)}`); }
        fn(b);
      };
      first ? controls.prepend(b) : controls.append(b);
      return b;
    },
    link(label, href) {
      const a = document.createElement("a");
      a.textContent = label; a.href = href; a.target = "_blank"; a.className = "small";
      controls.append(a);
    },
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const find = (start) => [...controls.querySelectorAll("button")].find((b) => b.textContent.startsWith(start));
  async function play() {
    const mine = ++playing;
    if (tour.before) { say("Starting in a moment."); await sleep(tour.before); }
    for (const [i, [start, text, pause = 2400]] of tour.steps.entries()) {
      let button = null;
      for (let waited = 0; waited < 6000 && playing === mine; waited += 200) { button = find(start); if (button && !button.disabled) break; await sleep(200); }
      if (playing !== mine) return;
      if (!button || button.disabled) break;
      button.classList.add("next");
      say(`<span class="step">${i + 1} of ${tour.steps.length}</span> <strong>${esc(button.textContent)}.</strong> ${esc(text)}`);
      await sleep(1100);
      if (playing !== mine) return void button.classList.remove("next");
      button.classList.remove("next");
      button.click();
      await sleep(pause);
      if (playing !== mine) return;
    }
    say(esc(tour.then || "That is all of it. Press any button to do it yourself, or Start again."));
  }
  const reset = async (auto) => {
    playing++;
    stage.reset(); controls.innerHTML = ""; say("");
    await demo.setup(stage, ui);
    const again = ui.button("Start again", () => reset(false));
    again.classList.add("reset");
    if (tour.steps.length) { const show = ui.button("Play it for me", () => reset(true)); show.classList.add("reset"); show.style.marginLeft = "0"; }
    if (auto) play();
    else say(tour.steps.length ? `Press <strong>${esc(tour.steps[0][0])}</strong> to begin, or Play it for me.` : esc(tour.then || ""));
  };
  // Set up now, and play when most of the demo is on screen.
  const ready = reset(false);
  if (tour.steps.length || tour.then) {
    new IntersectionObserver((entries, io) => {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      const before = playing;
      // Automated browsers press the buttons themselves. ?play=1 forces a tour, ?play=0 stops them.
      const wish = new URLSearchParams(location.search).get("play");
      if (wish === "0" || (navigator.webdriver && wish !== "1")) return;
      ready.then(() => { if (playing === before) tour.steps.length ? play() : say(esc(tour.then)); });
    }, { threshold: 0.6 }).observe(container.querySelector(".stage-el"));
  }
}
