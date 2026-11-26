// The ideas listed under "What you could build with it", built.
// Each entry names the pattern it belongs to and which of that pattern's
// ideas it covers (by position in deep.js). Same stage as the patterns.
import { far } from "/farport.js";
import { swRouter } from "/patterns/router.js";
import { built2 } from "/patterns/built2.js";
import { further } from "/patterns/further.js";
import { pairBuilt } from "/patterns/pairs.js";

const logBox = (stage, name, title, extra = "", what = {}) => {
  const box = stage.box(name, { html: `<div class="here"><div class="box-title">${title}</div>${extra}<ul class="log" role="log" aria-live="polite"></ul></div>`, ...what });
  const ul = box.node.querySelector("ul");
  const say = (text) => { const li = document.createElement("li"); li.textContent = text; ul.prepend(li); while (ul.children.length > 6) ul.lastChild.remove(); };
  return { say, node: box.node, box };
};

// A tab that answers requests for the Service Worker, for the paths under one prefix.
// Adds a box for the Service Worker to the stage. Returns null where there is no Service Worker.
const serveFrom = async (stage, prefix, ui) => {
  const sw = logBox(stage, "sw", "Service Worker", "", { kind: "service", url: "/patterns/tabserver-sw.js", scope: "/patterns/served/" });
  if (!("serviceWorker" in navigator)) {
    sw.say("no Service Worker support here");
    ui?.unsupported("This browser does not support Service Workers.");
    return null;
  }
  let handler = () => ({ status: 503, body: "not ready", headers: {} });
  const offer = (worker) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = async (event) => {
      if (!sw.node.isConnected) return channel.port1.close();
      sw.say(`asked the tab for ${new URL(event.data.url).pathname.replace(prefix, "") || "/"}`);
      stage.pulse("up", "sw");
      event.ports[0].postMessage(await handler(event.data.url));
    };
    worker.postMessage({ serve: true, prefix }, [channel.port2]);
  };
  const registration = await navigator.serviceWorker.register("/patterns/tabserver-sw.js", { scope: "/patterns/served/" });
  const worker = registration.active || registration.waiting || registration.installing;
  if (worker.state !== "activated") await new Promise((resolve) => worker.addEventListener("statechange", () => worker.state === "activated" && resolve()));
  offer(registration.active);
  // A Service Worker that was stopped has forgotten the port, and asks for another.
  const onSwMessage = (event) => { if (event.data === "need-port" && registration.active && sw.node.isConnected) offer(registration.active); };
  navigator.serviceWorker.addEventListener("message", onSwMessage);
  stage.cleanup(() => navigator.serviceWorker.removeEventListener("message", onSwMessage));
  sw.say("holding a port to this tab");
  stage.cable("up", "page", "sw", "yellow");
  return { handle: (fn) => (handler = fn) };
};

export const built = [
  {
    pattern: "canvas", use: [0], id: "built-chart",
    title: "A chart drawn by another origin, inside your layout",
    blurb: "The chart maker is a sandboxed frame with an opaque origin. It stands in for a charting service from another site. This page gives it a port and sends it numbers. The chart maker draws the bars on a canvas of its own and sends back each finished frame as an <code>ImageBitmap</code>, which this page shows in a canvas it owns. The chart maker never sees the page, and its code never runs in this page.",
    code: `const show = canvas.getContext("bitmaprenderer");
chartMaker.onmessage = ({ data }) => show.transferFromImageBitmap(data.frame);
chartMaker.postMessage({ size: [460, 230], numbers });
<span class="c">// later, new figures: the chart redraws itself</span>
chartMaker.postMessage({ numbers: [12, 30, 22, 41, 17] });

<span class="c">// the chart maker, after each redraw</span>
const frame = await createImageBitmap(mine);
port.postMessage({ frame }, [frame]);`,
    tour: { steps: [["Ask the chart maker for a chart", "The size and the first numbers go to the other origin. It draws the bars and sends back finished frames."], ["Send new numbers", "This page posts new figures. The chart maker animates to them.", 2600], ["Send new numbers", "And again. Only numbers go one way, and only pixels come back."]] },
    async setup(stage, ui) {
      const box = stage.box("page", { html: `<canvas width="460" height="230" style="width:100%;height:100%;display:block" aria-label="A chart in this page, drawn by another origin"></canvas>` });
      const canvas = box.node.querySelector("canvas");
      await stage.frame("maker", {
        title: "Chart maker on another origin", color: "teal",
        script: () => on("port", (_, [port]) => {
          let ctx = null, shown = [], target = [], w = 0, h = 0, still = 0;
          const draw = async () => {
            ctx.fillStyle = "#0f1c3f"; ctx.fillRect(0, 0, w, h);
            shown = target.map((v, i) => (shown[i] ?? 0) + (v - (shown[i] ?? 0)) * 0.12);
            const bar = (w - 40) / shown.length;
            shown.forEach((v, i) => {
              const tall = (v / 50) * (h - 50);
              ctx.fillStyle = ["#f5b700", "#e0364c", "#0e9f8e"][i % 3];
              ctx.fillRect(20 + i * bar + 6, h - 24 - tall, bar - 12, tall);
              ctx.fillStyle = "#fff"; ctx.font = "600 14px system-ui"; ctx.textAlign = "center";
              ctx.fillText(Math.round(v), 20 + i * bar + bar / 2, h - 30 - tall);
            });
            // Send the finished frame. Once the bars have settled there is nothing new to send.
            still = shown.every((v, i) => Math.abs(v - target[i]) < 0.3) ? still + 1 : 0;
            if (still < 3) { const frame = await createImageBitmap(ctx.canvas); port.postMessage({ frame }, [frame]); }
            requestAnimationFrame(draw);
          };
          port.onmessage = ({ data }) => {
            if (data.size) { [w, h] = data.size; ctx = new OffscreenCanvas(w, h).getContext("2d"); log("drawing a chart for a page I cannot see"); requestAnimationFrame(draw); }
            if (data.numbers) { target = data.numbers; log("drew " + data.numbers.join(", ")); tell("pulse", { cable: "line" }); }
          };
        }),
      });
      const channel = new MessageChannel();
      stage.post("maker", { cmd: "port" }, [channel.port2]);
      stage.cable("line", "page", "maker", "teal");
      const numbers = () => Array.from({ length: 5 }, () => 5 + Math.floor(Math.random() * 44));
      const again = ui.button("Send new numbers", () => { channel.port1.postMessage({ numbers: numbers() }); stage.pulse("line", "page"); }, true);
      const show = canvas.getContext("bitmaprenderer");
      channel.port1.onmessage = ({ data }) => { if (!data.frame) return; if (!canvas.isConnected) { data.frame.close(); return channel.port1.close(); } show.transferFromImageBitmap(data.frame); };
      ui.button("Ask the chart maker for a chart", (btn) => {
        channel.port1.postMessage({ size: [canvas.width, canvas.height], numbers: numbers() });
        stage.pulse("line", "page");
        btn.disabled = true; again.disabled = false;
      }, false, true);
    },
  },
  {
    pattern: "attenuate", use: [1], id: "built-expiry",
    title: "Access that runs out after eight seconds",
    blurb: "The owner lends the guest a port to its diary, and starts a clock. While the clock runs, the guest's questions are answered. When it stops, the owner closes its end. The guest still holds a port. Nothing comes back from it. There was no token to expire and no session to clean up.",
    code: `const { port1, port2 } = new MessageChannel();
port1.onmessage = () => port1.postMessage(diary.today());
guest.postMessage({ cmd: "port" }, "*", [port2]);
setTimeout(() => port1.close(), 8000);      <span class="c">// that is the whole expiry</span>`,
    tour: { steps: [["Lend the diary for 8 seconds", "The guest is given a port. The owner will close its end in eight seconds."], ["Guest: ask what is on today", "Inside the time, the guest gets an answer.", 7500], ["Guest: ask what is on today", "Time is up. The guest asks again and hears nothing."]] },
    async setup(stage, ui) {
      const owner = logBox(stage, "page", "This page owns the diary", `<p class="small" style="margin:0 0 .4rem">Time left on the loan: <strong data-left>none</strong></p>`);
      await stage.frame("guest", {
        title: "Guest on another origin", color: "red",
        script: () => {
          let port = null;
          on("port", (_, [p]) => { port = p; log("lent a port to the diary"); });
          on("ask", () => {
            if (!port) return log("I have no port");
            let heard = false;
            port.onmessage = ({ data }) => { heard = true; log("today: " + data); };
            send(port, "loan", "today?");
            setTimeout(() => { if (!heard) log("asked, and heard nothing. The port goes nowhere."); }, 700);
          });
        },
      });
      const left = owner.node.querySelector("[data-left]");
      const ask = ui.button("Guest: ask what is on today", () => stage.post("guest", { cmd: "ask" }), true);
      ui.button("Lend the diary for 8 seconds", (btn) => {
        btn.disabled = true; ask.disabled = false;
        const { port1, port2 } = new MessageChannel();
        port1.onmessage = () => { port1.postMessage("dentist at 3, florist at 5"); stage.pulse("loan", "page"); owner.say("answered the guest"); };
        stage.post("guest", { cmd: "port" }, [port2]);
        stage.cable("loan", "page", "guest", "red");
        owner.say("lent a port, started the clock");
        let seconds = 8;
        left.textContent = seconds + " s";
        const tick = setInterval(() => {
          if (!left.isConnected) return clearInterval(tick);
          left.textContent = --seconds > 0 ? seconds + " s" : "none";
          if (seconds <= 0) { clearInterval(tick); port1.close(); stage.cut("loan"); owner.say("time is up. Closed my end."); }
        }, 1000);
      }, false, true);
    },
  },
  {
    pattern: "reply", use: [1, 2], id: "built-progress",
    title: "A long job that reports progress, and can be cancelled",
    blurb: "The reply port does not have to carry one answer. This page asks a slow service for a job and keeps the reply port open. Progress arrives on it, ten per cent at a time. To cancel, this page says so on the same port and closes it. The service stops work, because nobody is waiting for the result any more.",
    code: `const { port1, port2 } = new MessageChannel();
service.postMessage({ job: "render" }, [port2]);
port1.onmessage = ({ data }) => data.done ? finish(data) : showProgress(data.percent);

<span class="c">// changed your mind</span>
port1.postMessage({ cancel: true });
port1.close();`,
    tour: { steps: [["Start a long job", "The question goes out with a fresh reply port. Progress comes back on that port.", 4200], ["Start a long job", "The first job finished. Start a second one.", 1800], ["Cancel it", "This page tells the service to stop, on the reply port, and closes it. The service stops part-way."]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page asked for a job", `<div style="height:.7rem;border:1.5px solid currentColor;border-radius:99px;overflow:hidden;margin:0 0 .5rem"><div data-bar style="height:100%;width:0;background:var(--teal)"></div></div>`);
      await stage.frame("service", {
        title: "Slow service on another origin", color: "teal",
        script: () => on("port", (_, [port]) => {
          let n = 0;
          port.onmessage = (event) => {
            const reply = event.ports[0], job = ++n;
            let percent = 0;
            log(`job ${job}: started`);
            const timer = setInterval(() => {
              percent += 10;
              reply.postMessage(percent < 100 ? { percent } : { done: true, result: `job ${job} is ready` });
              tell("pulse", { cable: "reply" });
              if (percent >= 100) { clearInterval(timer); log(`job ${job}: finished`); }
            }, 300);
            reply.onmessage = ({ data }) => { if (data.cancel) { clearInterval(timer); log(`job ${job}: cancelled at ${percent}%. Stopped work.`); } };
          };
        }),
      });
      const service = new MessageChannel();
      stage.post("service", { cmd: "port" }, [service.port2]);
      stage.cable("ask", "page", "service", "yellow");
      const bar = me.node.querySelector("[data-bar]");
      let reply = null;
      const cancel = ui.button("Cancel it", (btn) => {
        if (!reply) return;
        reply.postMessage({ cancel: true }); reply.close(); reply = null;
        stage.cut("reply"); btn.disabled = true; start.disabled = false;
        me.say("cancelled, and closed the reply port");
      }, true);
      const start = ui.button("Start a long job", (btn) => {
        const channel = new MessageChannel();
        reply = channel.port1;
        bar.style.width = "0";
        reply.onmessage = ({ data }) => {
          if (data.done) { bar.style.width = "100%"; me.say(data.result); stage.cut("reply"); reply = null; cancel.disabled = true; btn.disabled = false; }
          else { bar.style.width = data.percent + "%"; me.say(data.percent + "% done"); }
        };
        service.port1.postMessage({ job: "render" }, [channel.port2]);
        stage.pulse("ask", "page");
        stage.cable("reply", "service", "page", "teal");
        me.say("asked, with a reply port");
        btn.disabled = true; cancel.disabled = false;
      }, false, true);
    },
  },
  {
    pattern: "halves", use: [1], id: "built-sealed",
    title: "A sealed bid box that two rivals write into",
    blurb: "Two bidders on two origins each get something to write into, and nothing to read from. Their bids land in this page. Neither can see the other's bid, or even whether the other has bid. When the owner closes the box, both writers are refused from then on. It is a sealed auction with no server.",
    code: `const makeSlot = (who) => new WritableStream({
  start(controller) { slots.push(controller); },
  write(bid) { bids.push({ who, bid }); },
});
const slot = makeSlot("one");
bidderOne.postMessage({ slot }, "*", [slot]);   <span class="c">// write only</span>
<span class="c">// closing time</span>
slots.forEach((s) => s.error(new Error("bidding has closed")));`,
    tour: { steps: [["Give each bidder a slot", "Each bidder gets a stream it can write to and cannot read."], ["Bidder one: bid", "Bidder one's bid arrives here. Bidder two is told nothing."], ["Bidder two: bid", "Bidder two bids without knowing what it is up against."], ["Close the box", "The owner shuts both slots and names the winner."], ["Bidder one: bid", "A late bid is refused."]] },
    async setup(stage, ui) {
      const bidder = () => {
        let writer = null;
        on("slot", (data) => {
          writer = data.slot.getWriter();
          log(`given a slot. can I read from it? ${"getReader" in data.slot ? "yes" : "no"}`);
        });
        on("bid", async (data) => {
          if (!writer) return log("I have nowhere to put a bid");
          try { await writer.write(data.amount); log(`bid ${data.amount}. I do not know the other bid.`); tell("pulse", { cable: data.cable }); }
          catch (err) { log("refused: " + (err?.message || err)); }
        });
      };
      await stage.frame("one", { title: "Bidder one", color: "red", script: bidder });
      const owner = logBox(stage, "page", "This page holds the box");
      await stage.frame("two", { title: "Bidder two", color: "teal", script: bidder });
      const bids = [], slots = [];
      const bid = (name) => stage.post(name, { cmd: "bid", amount: 40 + Math.floor(Math.random() * 60), cable: name });
      const b1 = ui.button("Bidder one: bid", () => bid("one"), true);
      const b2 = ui.button("Bidder two: bid", () => bid("two"), true);
      const close = ui.button("Close the box", (btn) => {
        for (const slot of slots) slot.error(new Error("bidding has closed"));
        stage.cut("one"); stage.cut("two"); btn.disabled = true;
        const best = bids.slice().sort((a, b) => b.amount - a.amount)[0];
        owner.say(best ? `closed. Bidder ${best.who} wins with ${best.amount}.` : "closed, with no bids");
      }, true);
      ui.button("Give each bidder a slot", (btn) => {
        try {
          for (const who of ["one", "two"]) {
            const slot = new WritableStream({ start(controller) { slots.push(controller); }, write(amount) { bids.push({ who, amount }); owner.say(`bidder ${who} bid ${amount}`); } });
            stage.post(who, { cmd: "slot", slot }, [slot]);
            stage.cable(who, who, "page", who === "one" ? "red" : "teal", "stream");
          }
          owner.say("gave out two slots, kept what they lead to");
          btn.disabled = true; b1.disabled = b2.disabled = close.disabled = false;
        } catch {
          owner.say("This browser cannot transfer streams yet.");
        }
      }, false, true);
    },
  },
  {
    pattern: "functions", use: [0], id: "built-listener",
    title: "An event listener that lives on another origin",
    blurb: "<code>addEventListener</code> takes a function, and a function cannot cross origins. A port can. This page listens to its own button and posts each press down a port. The analytics frame on another origin counts presses of a button it cannot see, in a page it cannot read. Close the port and it is unsubscribed.",
    code: `<span class="c">// the other origin wants: button.addEventListener("click", theirFunction)</span>
const { port1, port2 } = new MessageChannel();
button.addEventListener("click", () => port1.postMessage({ type: "click", at: Date.now() }));
analytics.postMessage({ cmd: "listen" }, "*", [port2]);
<span class="c">// unsubscribe them</span>
port1.close();`,
    tour: { steps: [["Let analytics listen", "A port goes to the analytics frame. Presses of this page's button will be posted down it."], ["Press the page's button", "The press is heard on the other origin."], ["Press the page's button", "And again."], ["Unsubscribe analytics", "This page closes the port."], ["Press the page's button", "The button still works here. The other origin hears nothing."]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page has a button", `<p style="margin:0 0 .5rem"><button class="tiny accent" data-real>Buy tulips</button> <span class="small">pressed <strong data-count>0</strong> times</span></p>`);
      await stage.frame("analytics", {
        title: "Analytics on another origin", color: "teal",
        script: () => on("listen", (_, [port]) => {
          let n = 0;
          log("listening. I cannot see the button.");
          port.onmessage = ({ data }) => log(`heard ${data.type} ${++n}: "${data.label}"`);
        }),
      });
      const real = me.node.querySelector("[data-real]"), count = me.node.querySelector("[data-count]");
      let port = null, n = 0;
      real.addEventListener("click", () => {
        count.textContent = ++n;
        if (port) { port.postMessage({ type: "click", label: real.textContent }); stage.pulse("events", "page"); }
      });
      ui.button("Press the page's button", () => real.click());
      const stop = ui.button("Unsubscribe analytics", (btn) => { port.close(); port = null; stage.cut("events"); btn.disabled = true; me.say("closed the port. They are unsubscribed."); }, true);
      ui.button("Let analytics listen", (btn) => {
        const channel = new MessageChannel();
        port = channel.port1;
        stage.post("analytics", { cmd: "listen" }, [channel.port2]);
        stage.cable("events", "page", "analytics", "teal");
        me.say("posting each click down a port");
        btn.disabled = true; stop.disabled = false;
      }, false, true);
    },
  },
  {
    pattern: "stream", use: [1], id: "built-typing",
    title: "An answer that appears in another origin as it is written",
    blurb: "A language model answers a word at a time. This page stands in for one, and hands the answer to a viewer on another origin as a stream. The viewer shows each word as it arrives. It does not poll and is not sent a message per word by hand: it reads a stream, and when this page stops, the stream ends and the viewer knows the answer is complete.",
    code: `const answer = new ReadableStream({ async pull(controller) {
  const word = await nextWord();
  word ? controller.enqueue(word) : controller.close();
} });
viewer.postMessage({ answer }, "*", [answer]);

<span class="c">// the viewer</span>
for await (const word of answer) page.append(word + " ");`,
    tour: { steps: [["Stream an answer to the viewer", "The answer is handed over as a stream before it has been written. Words appear on the other origin as they are produced.", 5200], ["Stop writing", "This page ends the stream early. The viewer is told it is over."]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page writes the answer");
      await stage.frame("viewer", {
        title: "Viewer on another origin", color: "yellow",
        script: () => {
          const out = document.createElement("p");
          out.style.cssText = "font:14px/1.45 system-ui;margin:0 0 .4rem";
          document.getElementById("log").before(out);
          on("answer", async (data) => {
            out.textContent = ""; log("reading an answer");
            const reader = data.answer.getReader();
            let words = 0;
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              out.textContent += value + " "; words++;
              if (words % 4 === 0) tell("pulse", { cable: "answer" });
            }
            log(`the answer ended after ${words} words`);
          });
        },
      });
      const text = "A port is one end of a private wire. You can give it to anyone, and whoever holds it can talk to whoever holds the other end. Nothing else is needed: no address, no name, and no check on every message. That is why a stream of words can cross to another origin as easily as this.".split(" ");
      let feed = null, timer = null;
      stage.cleanup(() => { clearInterval(timer); try { feed?.close(); } catch {} });
      const stop = ui.button("Stop writing", (btn) => { clearInterval(timer); try { feed.close(); } catch {} btn.disabled = true; start.disabled = false; me.say("stopped, and closed the stream"); }, true);
      const start = ui.button("Stream an answer to the viewer", (btn) => {
        let i = 0;
        const answer = new ReadableStream({ start(controller) { feed = controller; } });
        try {
          stage.post("viewer", { cmd: "answer", answer }, [answer]);
          timer = setInterval(() => {
            if (!me.node.isConnected) return clearInterval(timer);
            if (i >= text.length) { clearInterval(timer); feed.close(); stop.disabled = true; btn.disabled = false; return me.say("finished the answer"); }
            feed.enqueue(text[i++]);
          }, 110);
          stage.cable("answer", "page", "viewer", "yellow", "stream");
          me.say("handed over a stream, now writing into it");
          btn.disabled = true; stop.disabled = false;
        } catch {
          me.say("This browser cannot transfer streams yet.");
        }
      }, false, true);
    },
  },
  {
    pattern: "signer", use: [2], id: "built-cap",
    title: "A wallet the shop can charge, up to a limit you set",
    blurb: "The wallet is a frame on its own origin that pays whoever asks down its port. This page holds that port and does not pass it on. It gives the shop a port of its own, and forwards a charge to the wallet only if the running total stays under fifty. The shop cannot go around it, because the only port the shop has ends in this page.",
    code: `let spent = 0;
shopPort.onmessage = ({ data }) => {
  if (spent + data.amount > 50) return shopPort.postMessage({ refused: "over the limit" });
  spent += data.amount;
  walletPort.postMessage(data);             <span class="c">// only now does the wallet hear of it</span>
};`,
    tour: { steps: [["Let the shop charge up to 50", "The shop gets a port that ends here, not at the wallet."], ["Shop: charge 20", "20 is under the limit. This page passes it on and the wallet pays."], ["Shop: charge 20", "40 so far. Still allowed."], ["Shop: charge 20", "This would make 60. This page refuses, and the wallet never hears of it."]] },
    async setup(stage, ui) {
      await stage.frame("wallet", {
        title: "Wallet, origin one", color: "yellow",
        script: () => on("port", (_, [port]) => {
          let balance = 200;
          log("balance 200. I pay whoever asks on this port.");
          port.onmessage = ({ data }) => { balance -= data.amount; log(`paid ${data.amount} to ${data.to}. balance ${balance}`); send(port, "wallet", { paid: data.amount, id: data.id }); };
        }),
      });
      const me = logBox(stage, "page", "This page sets the limit", `<p class="small" style="margin:0 0 .4rem">Spent through the shop: <strong data-spent>0</strong> of 50</p>`);
      await stage.frame("shop", {
        title: "Shop, origin two", color: "teal",
        script: () => {
          let port = null, n = 0;
          on("port", (_, [p]) => { port = p; log("given a port to charge"); port.onmessage = ({ data }) => log(data.refused ? "refused: " + data.refused : `charge of ${data.paid} went through`); });
          on("charge", (data) => { if (!port) return log("I have no way to charge"); log("charging " + data.amount); send(port, "lent", { amount: data.amount, to: "the shop", id: ++n }); });
        },
      });
      const wallet = new MessageChannel();
      stage.post("wallet", { cmd: "port" }, [wallet.port2]);
      stage.cable("wallet", "page", "wallet", "yellow");
      const spentEl = me.node.querySelector("[data-spent]");
      let spent = 0, shop = null;
      wallet.port1.onmessage = ({ data }) => shop?.postMessage(data);
      const charge = ui.button("Shop: charge 20", () => stage.post("shop", { cmd: "charge", amount: 20 }), true);
      ui.button("Let the shop charge up to 50", (btn) => {
        const channel = new MessageChannel();
        shop = channel.port1;
        shop.onmessage = ({ data }) => {
          if (spent + data.amount > 50) { me.say(`refused ${data.amount}: it would make ${spent + data.amount}`); stage.pulse("lent", "page"); return shop.postMessage({ refused: "over the limit of 50" }); }
          spent += data.amount; spentEl.textContent = spent;
          me.say(`allowed ${data.amount}, passed it to the wallet`);
          wallet.port1.postMessage(data); stage.pulse("wallet", "page");
        };
        stage.post("shop", { cmd: "port" }, [channel.port2]);
        stage.cable("lent", "page", "shop", "teal");
        btn.disabled = true; charge.disabled = false;
      }, false, true);
    },
  },
  {
    pattern: "far", use: [1], id: "built-approve",
    title: "Approve on your phone what you started on your laptop",
    blurb: "This page is a checkout. Before it pays, it asks another device. The two are joined by a pairing code and a direct connection, and each holds a port. The question goes down the port, the other device shows Approve and Deny, and the answer comes back up it. Open the link on your phone to do it for real, or let a second page stand in for the phone.",
    code: `<span class="c">// laptop</span>
const port = await far({ code, host: true });
port.postMessage({ ask: "Pay 20 to the florist?" });
port.onmessage = ({ data }) => data.answer === "approve" ? pay() : stop();

<span class="c">// phone</span>
port.onmessage = ({ data }) => show(data.ask);
approveButton.onclick = () => port.postMessage({ answer: "approve" });`,
    tour: { steps: [["Open a line to your phone", "This page opens a meeting place and shows its code. The link is for your phone."], ["Use a stand-in for the phone", "A second page plays the phone, and the two connect directly.", 4500], ["Pay 20 to the florist", "The checkout stops and asks the other device."], ["Other device: approve", "The other device says yes, down its port. The checkout goes ahead."], ["Pay 20 to the florist", "A second payment asks again."], ["Other device: deny", "This time the answer is no, and nothing is paid."]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "Laptop: the checkout", `<p class="small" data-code style="margin:0 0 .4rem" hidden></p>`);
      const phone = stage.box("far", { html: `<div class="here"><div class="box-title">Your phone</div><p class="small muted">Not connected yet.</p></div>` });
      if (!("RTCPeerConnection" in self)) return me.say("no WebRTC in this browser");
      const codeEl = me.node.querySelector("[data-code]");
      let line = null, port = null, code = null, waiting = false;
      const standIn = ui.button("Use a stand-in for the phone", (btn) => {
        btn.disabled = true;
        phone.node.innerHTML = `<iframe title="A stand-in for your phone" src="/far/?embed=1#${code}"></iframe>`;
        phone.frame = phone.node.querySelector("iframe");
      }, true);
      const pay = ui.button("Pay 20 to the florist", (btn) => {
        port.postMessage({ ask: "Pay 20 to the florist?" });
        stage.pulse("air", "page"); waiting = true; btn.disabled = true;
        me.say("stopped. Waiting for the other device.");
        if (phone.frame) yes.disabled = no.disabled = false;
      }, true);
      const answer = (cmd) => { stage.post("far", { cmd }); yes.disabled = no.disabled = true; };
      const yes = ui.button("Other device: approve", () => answer("approve"), true);
      const no = ui.button("Other device: deny", () => answer("deny"), true);
      ui.button("Open a line to your phone", (btn) => {
        btn.disabled = true;
        code = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
        codeEl.hidden = false;
        codeEl.innerHTML = `Code <strong>${code}</strong>. On your phone: <a href="${location.origin}/far/#${code}" target="_blank">${location.host}/far/#${code}</a>`;
        standIn.disabled = false;
        line = far({
          code, host: true,
          onState(state) { if (state === "gone") { me.say("the other device hung up"); stage.cut("air"); pay.disabled = true; } },
          onPort(p) {
            port = p;
            port.onmessage = ({ data }) => {
              if (!data.answer || !waiting) return;
              waiting = false; pay.disabled = false; stage.pulse("air", "far");
              me.say(data.answer === "approve" ? "approved on the other device. Paid 20." : "denied on the other device. Nothing paid.");
            };
            stage.cable("air", "page", "far", "teal", "rtc");
            me.say("connected directly to the other device");
            standIn.disabled = true; pay.disabled = false;
          },
        });
        const watch = setInterval(() => { if (!me.node.isConnected) { clearInterval(watch); line?.close(); } }, 1000);
      }, false, true);
    },
  },
  {
    pattern: "lend", use: [2], id: "built-tap",
    title: "Give a logger the incoming half of a connection only",
    blurb: "A WebSocket seen as streams has two halves. This page keeps the half that speaks and gives a logger only the half that listens. The logger has no network access of its own. It records everything the server says, and it has no way to send the server anything, because it was never given anything to write into.",
    code: `const { readable, writable } = await new WebSocketStream(url).opened;
logger.postMessage({ readable }, "*", [readable]);   <span class="c">// listening half only</span>
const writer = writable.getWriter();                 <span class="c">// this page keeps the voice</span>
writer.write("hello");`,
    tour: { steps: [["Open a connection", "This page opens a WebSocket to the server."], ["Give the logger the listening half", "Only the readable stream is handed over."], ["This page: say something", "This page speaks. The server's answer goes to the logger.", 2600], ["Logger: try to speak", "The logger has nothing to write into."]] },
    async setup(stage, ui) {
      const echo = `${location.origin.replace(/^http/, "ws")}/echo`;
      const me = logBox(stage, "page", "This page keeps the voice");
      await stage.frame("logger", {
        title: "Logger with no network", color: "teal",
        csp: "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
        script: () => {
          let hasWriter = false;
          on("tap", async (data) => {
            hasWriter = !!data.writable;
            log(`given the ${hasWriter ? "whole connection" : "listening half only"}`);
            const reader = data.readable.getReader();
            for (;;) {
              const { value, done } = await reader.read().catch(() => ({ done: true }));
              if (done) { log("the connection closed"); break; }
              log("logged: " + value); tell("pulse", { cable: "tap" });
            }
          });
          on("speak", () => log(hasWriter ? "spoke" : "I have nothing to speak into"));
        },
      });
      const open = async () => {
        if ("WebSocketStream" in self) { const wss = new WebSocketStream(echo); const { readable, writable } = await wss.opened; return { readable, writable, close: () => wss.close() }; }
        const ws = new WebSocket(echo);
        await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error("could not connect")); });
        const readable = new ReadableStream({ start(c) { ws.onmessage = (e) => c.enqueue(e.data); ws.onclose = () => { try { c.close(); } catch {} }; } });
        return { readable, writable: new WritableStream({ write(chunk) { ws.send(chunk); } }), close: () => ws.close() };
      };
      let line = null, writer = null, n = 0;
      stage.cleanup(() => { try { line?.close(); } catch {} });
      const give = ui.button("Give the logger the listening half", (btn) => {
        try {
          writer = line.writable.getWriter();
          stage.post("logger", { cmd: "tap", readable: line.readable }, [line.readable]);
          stage.cable("tap", "page", "logger", "teal", "stream");
          me.say("gave away the readable, kept the writable");
          btn.disabled = true; say.disabled = speak.disabled = false;
        } catch {
          me.say("This browser cannot transfer streams yet.");
        }
      }, true);
      const say = ui.button("This page: say something", () => { writer.write(`hello ${++n}`); me.say(`said hello ${n}`); }, true);
      const speak = ui.button("Logger: try to speak", () => stage.post("logger", { cmd: "speak" }), true);
      ui.button("Open a connection", async (btn) => {
        btn.disabled = true;
        try { line = await open(); me.say("connected to the server"); give.disabled = false; }
        catch (err) { me.say("could not connect: " + err.message); }
        const watch = setInterval(() => { if (!me.node.isConnected) { clearInterval(watch); try { line?.close(); } catch {} } }, 1000);
      }, false, true);
    },
  },
  {
    pattern: "introduce", use: [1, 2], id: "built-wire",
    title: "Two vendors' widgets, wired together by the page that embeds them",
    blurb: "A list of places from one vendor and a map from another, each in its own frame on its own origin. Neither has heard of the other and neither loads the other's code. The page that embeds them makes a channel, and gives each widget an end. Pick a place in the list and the map moves, with nothing passing through the page.",
    code: `const { port1, port2 } = new MessageChannel();
listFrame.postMessage({ cmd: "port" }, "*", [port1]);
mapFrame.postMessage({ cmd: "port" }, "*", [port2]);
<span class="c">// that is all the integration code there is</span>`,
    tour: { steps: [["Wire the two widgets together", "Each widget gets one end of a channel. This page keeps neither."], ["List: pick the next place", "The list tells the map directly. The map answers the list."], ["List: pick the next place", "Again. Nothing passes through the page in the middle."]] },
    async setup(stage, ui) {
      await stage.frame("list", {
        title: "Places list, vendor A", color: "red",
        script: () => {
          const places = [["Kew Gardens", 51.478, -0.295], ["Columbia Road", 51.529, -0.07], ["Covent Garden", 51.512, -0.123]];
          let port = null, i = -1;
          on("port", (_, [p]) => { port = p; log("holding a line to something that shows places"); port.onmessage = ({ data }) => log("it says: " + data.shown); });
          on("pick", () => { if (!port) return log("nobody to tell"); i = (i + 1) % places.length; log("picked " + places[i][0]); send(port, "wire", { name: places[i][0], lat: places[i][1], lon: places[i][2] }); });
        },
      });
      const me = logBox(stage, "page", "This page embeds both");
      await stage.frame("map", {
        title: "Map, vendor B", color: "teal",
        script: () => {
          const pin = document.createElement("p");
          pin.style.cssText = "font:800 1.1rem/1.2 system-ui;margin:0 0 .4rem";
          pin.textContent = "No place yet";
          document.getElementById("log").before(pin);
          on("port", (_, [port]) => {
            log("holding a line to something that picks places");
            port.onmessage = ({ data }) => { pin.textContent = "● " + data.name; log(`moved to ${data.lat}, ${data.lon}`); send(port, "wire", { shown: "showing " + data.name }); };
          });
        },
      });
      const pick = ui.button("List: pick the next place", () => stage.post("list", { cmd: "pick" }), true);
      ui.button("Wire the two widgets together", (btn) => {
        const { port1, port2 } = new MessageChannel();
        stage.post("list", { cmd: "port" }, [port1]);
        stage.post("map", { cmd: "port" }, [port2]);
        stage.cable("wire", "list", "map", "yellow");
        me.say("gave each widget an end, and kept nothing");
        btn.disabled = true; pick.disabled = false;
      }, false, true);
    },
  },
  {
    pattern: "attenuate", use: [2], id: "built-chain",
    title: "Pass access on to a third party, with less than you were given",
    blurb: "The owner lets an assistant read the diary and add to it. The assistant passes part of that on to an intern: reading only. The intern's port ends at the assistant, and the assistant's ends at the owner. Nobody in the chain can hand on more than they hold. When the owner cuts off the assistant, the intern is cut off too, without the owner knowing the intern exists.",
    code: `<span class="c">// the assistant, passing on less than it was given</span>
const { port1, port2 } = new MessageChannel();
port1.onmessage = ({ data }) => {
  if (data.do !== "read") return port1.postMessage({ refused: "read only" });
  ownerPort.postMessage(data);            <span class="c">// forwarded up the chain</span>
};
give(intern, port2);`,
    tour: { steps: [["Give the assistant read and add", "The assistant gets a port that reads and adds."], ["Assistant: pass on read only", "The assistant makes a weaker port and gives it to the intern."], ["Intern: read", "The intern's question goes to the assistant, then to the owner, and the answer comes back down."], ["Intern: try to add", "The assistant refuses. It never reaches the owner."], ["Owner: cut off the assistant", "The owner closes the assistant's port."], ["Intern: read", "The intern asks again. The chain is broken above it, and nothing comes back."]] },
    async setup(stage, ui) {
      const owner = logBox(stage, "page", "Owner of the diary", `<p class="small" style="margin:0 0 .4rem">Entries: <strong data-n>2</strong></p>`);
      await stage.frame("assistant", {
        title: "Assistant", color: "yellow",
        script: () => {
          let up = null, down = null;
          on("port", (_, [p]) => { up = p; log("can read and add"); up.onmessage = ({ data }) => { if (data.from === "intern" && down) { send(down, "sub", data); } else log("owner says: " + data.text); }; });
          on("add", () => { if (!up) return; log("adding an entry"); send(up, "main", { do: "add" }); });
          on("delegate", () => {
            const { port1, port2 } = new MessageChannel();
            down = port1;
            down.onmessage = ({ data }) => {
              if (data.do !== "read") { log("refused the intern: " + data.do); return send(down, "sub", { refused: "this port is read only" }); }
              log("passing the intern's question up");
              send(up, "main", { do: "read", from: "intern" });
            };
            parent.postMessage({ wire: "forward" }, "*", [port2]);
            log("made a read-only port for the intern");
          });
        },
      });
      await stage.frame("intern", {
        title: "Intern", color: "teal",
        script: () => {
          let port = null, heard = false;
          on("port", (_, [p]) => { port = p; log("given a port by the assistant"); port.onmessage = ({ data }) => { heard = true; log(data.refused ? "refused: " + data.refused : "read: " + data.text); }; });
          on("ask", (data) => { if (!port) return log("I have no port"); heard = false; send(port, "sub", { do: data.what }); setTimeout(() => { if (!heard) log("asked, and heard nothing"); }, 800); });
        },
      });
      const nEl = owner.node.querySelector("[data-n]");
      let entries = 2, main = null;
      stage.on((name, data, ports) => {
        if (name !== "assistant" || data.wire !== "forward") return;
        stage.post("intern", { cmd: "port" }, [ports[0]]);
        stage.cable("sub", "assistant", "intern", "teal");
        read.disabled = tryAdd.disabled = false;
      });
      const add = ui.button("Assistant: add an entry", () => stage.post("assistant", { cmd: "add" }), true);
      const pass = ui.button("Assistant: pass on read only to the intern", (btn) => { stage.post("assistant", { cmd: "delegate" }); btn.disabled = true; }, true);
      const read = ui.button("Intern: read", () => stage.post("intern", { cmd: "ask", what: "read" }), true);
      const tryAdd = ui.button("Intern: try to add", () => stage.post("intern", { cmd: "ask", what: "add" }), true);
      const cut = ui.button("Owner: cut off the assistant", (btn) => { main.close(); stage.cut("main"); btn.disabled = add.disabled = true; owner.say("closed the assistant's port. I never met the intern."); }, true);
      ui.button("Give the assistant read and add", (btn) => {
        const channel = new MessageChannel();
        main = channel.port1;
        main.onmessage = ({ data }) => {
          if (data.do === "add") { nEl.textContent = ++entries; owner.say("the assistant added an entry"); }
          else owner.say("answered a read");
          main.postMessage({ text: `${entries} entries`, from: data.from }); stage.pulse("main", "page");
        };
        stage.post("assistant", { cmd: "port" }, [channel.port2]);
        stage.cable("main", "page", "assistant", "yellow");
        btn.disabled = true; add.disabled = pass.disabled = cut.disabled = false;
      }, false, true);
    },
  },
  {
    pattern: "exchange", use: [1, 2], id: "built-leader",
    title: "One tab does the background job, and another takes over when it closes",
    blurb: "Three tabs of this site are open in the boxes below. A shared worker holds a port to each, keeps the list of who is here, and names one the leader. Only the leader runs the sync job. Close it, and the worker notices through a lock the tab was holding, promotes the tab that has been here longest, and tells everyone. The link opens a fourth tab for real.",
    code: `<span class="c">// each tab</span>
navigator.locks.request(myName, () => new Promise(() => {}));   <span class="c">// held until this tab dies</span>
port.postMessage({ join: true, lock: myName });
port.onmessage = ({ data }) => { iAmLeader = data.lead; };

<span class="c">// the worker</span>
navigator.locks.request(lock, () => leave(port));   <span class="c">// runs when the tab has gone</span>`,
    tour: { steps: [["Close the leader", "The leading tab is destroyed. The worker gets its lock, and promotes the next tab.", 3000], ["Close the leader", "And again. The last tab left is the leader.", 3000]] },
    async setup(stage, ui) {
      const names = ["tab-a", "tab-b", "tab-c"];
      const boxes = names.map((name, i) => stage.box(name, { src: "/patterns/crew.html", title: `Tab ${i + 1}` }));
      stage.box("worker", { kind: "shared", url: "/patterns/crew-worker.js", wide: true, html: `<div class="here"><div class="box-title">SharedWorker</div><p class="small muted" style="margin:0">Holds a port to each tab, and names the leader.</p></div>` });
      if (!("SharedWorker" in self)) {
        ui.unsupported("This browser does not support SharedWorker.");
        return;
      }
      let leader = null;
      stage.on((name, data) => { if (data.wire === "crew" && data.lead) leader = name; });
      await Promise.all(boxes.map((box) => box.whenReady));
      for (const name of names) stage.cable("c-" + name, name, "worker", "ink");
      ui.button("Close the leader", (btn) => {
        if (!leader || !stage.boxes.get(leader)?.frame?.isConnected) return;
        stage.remove(leader); leader = null;
        if (names.filter((n) => stage.boxes.get(n).frame?.isConnected).length < 2) btn.disabled = true;
      }, false, true);
      ui.link("Open another tab for real", "/patterns/crew.html");
    },
  },
  {
    pattern: "filter", use: [0], id: "built-watermark",
    title: "A captions and watermark plug-in that only ever sees pixels",
    blurb: "The plug-in is a frame on another origin. Each frame of this page's video is handed to it, it draws a caption and a watermark on top, and hands the frame back. It has no access to the camera, the page or the network path the video came from. A frame goes as a <code>VideoFrame</code> where the browser will hand one to the plug-in, and as an <code>ImageBitmap</code> where it will not. Chrome will not hand a <code>VideoFrame</code> to another process, which is where a frame like this one runs.",
    code: `<span class="c">// the plug-in</span>
port.onmessage = ({ data }) => {
  ctx.drawImage(data.frame, 0, 0); data.frame.close();
  ctx.fillText(caption, 12, height - 14);
  const out = new VideoFrame(canvas, { timestamp: data.frame.timestamp });
  port.postMessage({ frame: out }, [out]);
};`,
    tour: { steps: [["Start the video", "Frames go to the plug-in one at a time and come back with a caption and a watermark.", 3200], ["Change the caption", "This page sends new caption text. The next frame comes back with it."]] },
    async setup(stage, ui) {
      const src = stage.box("page", { html: `<canvas width="320" height="180" style="width:100%;height:100%;display:block" aria-label="The video before the plug-in"></canvas>` });
      await stage.frame("plugin", {
        title: "Captions plug-in, another origin", color: "yellow",
        script: () => on("port", (_, [port]) => {
          let canvas = null, ctx = null, caption = "Tulips are in season", done = 0;
          log("waiting for frames");
          // The browser could not rebuild what was sent. It says so with this event, and gives no reason. Tell the page.
          port.onmessageerror = () => { log("a frame arrived that could not be rebuilt here"); send(port, "there", { unreadable: true }); };
          port.onmessage = ({ data }) => {
            if (data.caption) { caption = data.caption; return log("caption: " + caption); }
            // The picture comes as a VideoFrame, or as an ImageBitmap where a VideoFrame cannot cross.
            const frame = data.frame || data.bitmap;
            if (!canvas) { canvas = new OffscreenCanvas(frame.displayWidth || frame.width, frame.displayHeight || frame.height); ctx = canvas.getContext("2d"); }
            const { width: w, height: h } = canvas;
            ctx.drawImage(frame, 0, 0);
            const timestamp = frame.timestamp;
            frame.close();
            ctx.fillStyle = "rgba(0,0,0,.65)"; ctx.fillRect(0, h - 38, w, 38);
            ctx.fillStyle = "#fff"; ctx.font = "600 17px system-ui"; ctx.textAlign = "center"; ctx.fillText(caption, w / 2, h - 13);
            ctx.textAlign = "right"; ctx.font = "700 12px system-ui"; ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.fillText("PORT AUTHORITY", w - 10, 18);
            // It goes back as what it came as.
            if (data.frame) { const out = new VideoFrame(canvas, { timestamp }); send(port, "there", { frame: out }, [out]); }
            else { const out = canvas.transferToImageBitmap(); send(port, "there", { bitmap: out }, [out]); }
            if (++done % 30 === 0) log(`captioned ${done} frames, kept none`);
          };
        }),
      });
      const out = stage.box("out", { html: `<canvas width="320" height="180" style="width:100%;height:100%;display:block" aria-label="The video after the plug-in"></canvas>` });
      const source = src.node.querySelector("canvas"), sctx = source.getContext("2d");
      const octx = out.node.querySelector("canvas").getContext("2d");
      if (!("VideoFrame" in self)) {
        src.node.insertAdjacentHTML("beforeend", `<p class="small" style="position:absolute;inset:auto 0 0 0;padding:.5rem;background:var(--panel)">This browser has no VideoFrame.</p>`);
        ui.unsupported("This browser does not support WebCodecs VideoFrame.");
        return;
      }
      let running = false, waiting = false, n = 0;
      let carry = "VideoFrame";      // what each picture is sent as: an ImageBitmap once the plug-in says a VideoFrame did not arrive
      const paint = (t) => {
        const { width: w, height: h } = source;
        sctx.fillStyle = "#0e9f8e"; sctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 5; i++) { sctx.fillStyle = ["#f5b700", "#e0364c", "#fff"][i % 3]; sctx.beginPath(); sctx.arc(w / 2 + Math.cos(t / 700 + i * 1.3) * w * 0.36, h * 0.42 + Math.sin(t / 500 + i) * h * 0.26, 16, 0, 7); sctx.fill(); }
      };
      const channel = new MessageChannel();
      const loop = (t) => {
        if (!source.isConnected) return;
        paint(t);
        if (running && !waiting) {
          waiting = true;
          if (carry === "VideoFrame") {
            const frame = new VideoFrame(source, { timestamp: Math.round(t * 1000) });
            channel.port1.postMessage({ frame }, [frame]); frame.close();
          } else {
            createImageBitmap(source).then((bitmap) => { if (!source.isConnected) return bitmap.close(); channel.port1.postMessage({ bitmap }, [bitmap]); }, () => { waiting = false; });
          }
          if (n++ % 8 === 0) stage.pulse("there", "page");
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      channel.port1.onmessage = ({ data }) => {
        // The plug-in is in another process, and this browser will not hand a VideoFrame to one. An ImageBitmap does cross.
        if (data.unreadable) { carry = "ImageBitmap"; waiting = false; return; }
        const picture = data.frame || data.bitmap;
        octx.drawImage(picture, 0, 0); picture.close(); waiting = false;
      };
      stage.post("plugin", { cmd: "port" }, [channel.port2]);
      stage.cable("there", "page", "plugin", "yellow");
      const captions = ["Roses arrive on Thursday", "Peonies: three left", "Tulips are in season"];
      let c = 0;
      const change = ui.button("Change the caption", () => channel.port1.postMessage({ caption: captions[c++ % captions.length] }), true);
      ui.button("Start the video", (btn) => { running = true; btn.disabled = true; change.disabled = false; }, false, true);
    },
  },
  {
    pattern: "zerocopy", use: [0, 2], id: "built-pool",
    title: "Reuse two buffers between a page and a worker without copying",
    blurb: "A worker needs somewhere to put each result, and making a fresh 8 MB buffer every time is wasteful. This page makes two, once. One goes to the worker, which fills it and sends it back, while the other is being read here. Then they swap. The counters show megabytes moved climbing and megabytes copied staying at zero.",
    code: `const pool = [new ArrayBuffer(SIZE), new ArrayBuffer(SIZE)];
worker.onmessage = ({ data }) => {
  use(data.buffer);                            <span class="c">// read the result</span>
  worker.postMessage({ buffer: data.buffer }, [data.buffer]);   <span class="c">// and send the same memory back</span>
};
for (const buffer of pool) worker.postMessage({ buffer }, [buffer]);`,
    tour: { steps: [["Start the pool", "Two buffers are made once, and then only moved.", 3500], ["Stop", "The pool stops. Two buffers were ever made."]] },
    async setup(stage, ui) {
      const me = stage.box("page", { html: `<div class="here"><div class="box-title">This page</div><p class="small" style="margin:0 0 .25rem">Buffers ever made: <strong data-made>0</strong></p><p class="small" style="margin:0 0 .25rem">Round trips: <strong data-trips>0</strong></p><p class="small" style="margin:0 0 .25rem">Moved: <strong data-moved>0</strong> MB</p><p class="small" style="margin:0 0 .25rem">Copied: <strong>0</strong> MB</p><p class="small" style="margin:0">Held here right now: <strong data-held>0</strong> MB</p></div>` });
      const wbox = logBox(stage, "worker", "Worker", "", { kind: "worker", url: "blob:" });
      const q = (name) => me.node.querySelector(`[data-${name}]`);
      const SIZE = 8 * 1024 * 1024;
      const workerUrl = URL.createObjectURL(new Blob([`onmessage = ({ data }) => { new Uint8Array(data.buffer).fill(data.n % 251); postMessage({ buffer: data.buffer, n: data.n }, [data.buffer]); };`], { type: "text/javascript" }));
      const worker = new Worker(workerUrl);
      let running = false, trips = 0, n = 0, held = 0;
      stage.cleanup(() => { running = false; worker.terminate(); URL.revokeObjectURL(workerUrl); });
      const show = () => { q("trips").textContent = trips; q("moved").textContent = (trips * 2 * 8).toLocaleString(); q("held").textContent = held * 8; };
      const send = (buffer) => { held--; worker.postMessage({ buffer, n: ++n }, [buffer]); stage.pulse("pool", "page"); show(); };
      worker.onmessage = ({ data }) => {
        held++; trips++;
        if (trips % 10 === 0) wbox.say(`filled buffer ${trips} with ${new Uint8Array(data.buffer)[0]}s and sent it back`);
        show();
        if (!me.node.isConnected) return worker.terminate();
        if (running) setTimeout(() => (running ? send(data.buffer) : null), 60);
      };
      const stop = ui.button("Stop", (btn) => { running = false; btn.disabled = true; }, true);
      ui.button("Start the pool", (btn) => {
        btn.disabled = true; stop.disabled = false; running = true;
        const pool = [new ArrayBuffer(SIZE), new ArrayBuffer(SIZE)];
        held = 2; q("made").textContent = 2;
        stage.cable("pool", "page", "worker", "teal");
        send(pool[0]); setTimeout(() => send(pool[1]), 30);
      }, false, true);
    },
  },
  {
    pattern: "roundtrip", use: [0, 1], id: "built-cipher",
    title: "An encryption service you pipe through, whose key you never hold",
    blurb: "The cipher service makes a key that cannot be read, even by itself, and offers two pipes: one that seals and one that opens. This page writes a line into the first and gets back bytes it cannot read. It writes those bytes into the second and gets its line back. The key, and the code that uses it, stay on the service's origin. It could meter each line and charge for it, and this page would have no way around that.",
    code: `<span class="c">// the service</span>
const seal = new TransformStream({ async transform(text, out) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  out.enqueue({ iv, data: await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encode(text)) });
} });
parent.postMessage({ seal: { readable: seal.readable, writable: seal.writable } }, "*", [seal.readable, seal.writable]);

<span class="c">// this page</span>
lines.pipeThrough(seal).pipeTo(storage);`,
    tour: { steps: [["Ask the cipher service for its pipes", "The service makes a key and hands over both ends of two transforms."], ["Seal a line, then open it", "A line goes into the sealing pipe and comes back as bytes. Those bytes go into the opening pipe and come back as the line.", 2600], ["Seal a line, then open it", "A second line. The key never left the service."]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page has the lines");
      await stage.frame("cipher", {
        title: "Cipher service, another origin", color: "yellow",
        script: () => on("offer", async () => {
          let key;
          try { key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); }
          catch (err) { return log("no WebCrypto here: " + err.message); }
          let sealed = 0, opened = 0;
          const seal = new TransformStream({ async transform(text, out) {
            const iv = crypto.getRandomValues(new Uint8Array(12));
            out.enqueue({ iv, data: await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text)) });
            log(`sealed line ${++sealed}`); tell("pulse", { cable: "seal" });
          } });
          const open = new TransformStream({ async transform(box, out) {
            out.enqueue(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: box.iv }, key, box.data)));
            log(`opened line ${++opened}`); tell("pulse", { cable: "open" });
          } });
          log("made a key nobody can read, and two pipes");
          try {
            parent.postMessage({ wire: "pipes", seal: { readable: seal.readable, writable: seal.writable }, open: { readable: open.readable, writable: open.writable } }, "*", [seal.readable, seal.writable, open.readable, open.writable]);
          } catch {
            log("This browser cannot transfer streams yet.");
          }
        }),
      });
      const out = logBox(stage, "out", "What came back opened");
      const lines = ["Deliver to 14 Mill Lane, back door", "The safe code is 4471", "Mum's birthday: peonies"];
      let pipes = null, i = 0;
      stage.on((name, data) => {
        if (name !== "cipher" || data.wire !== "pipes") return;
        pipes = { sealIn: data.seal.writable.getWriter(), sealOut: data.seal.readable.getReader(), openIn: data.open.writable.getWriter(), openOut: data.open.readable.getReader() };
        stage.cable("seal", "page", "cipher", "yellow", "stream");
        stage.cable("open", "cipher", "out", "teal", "stream");
        me.say("holding both ends of two pipes");
        go.disabled = false;
      });
      const go = ui.button("Seal a line, then open it", async () => {
        const line = lines[i++ % lines.length];
        pipes.sealIn.write(line); stage.pulse("seal", "page");
        const { value: box } = await pipes.sealOut.read();
        const hex = [...new Uint8Array(box.data).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
        me.say(`sealed: ${hex}… (${box.data.byteLength} bytes I cannot read)`);
        pipes.openIn.write(box);
        const { value: plain } = await pipes.openOut.read();
        out.say(plain);
      }, true);
      ui.button("Ask the cipher service for its pipes", (btn) => { stage.post("cipher", { cmd: "offer" }); btn.disabled = true; }, false, true);
    },
  },
  {
    pattern: "stream", use: [0, 2], id: "built-bigfile",
    title: "Stream 64 MB to a worker a megabyte at a time",
    blurb: "This page produces a large file a megabyte at a time and gives the worker a stream of it. The worker reads, adds up a checksum and asks for more. The page makes the next megabyte only when asked, so neither side ever holds more than a chunk or two. The progress bar needs no extra messages, because it counts the chunks.",
    code: `const file = new ReadableStream({ pull(controller) {
  made < TOTAL ? controller.enqueue(nextMegabyte()) : controller.close();   <span class="c">// only when asked</span>
} });
worker.postMessage({ file }, [file]);

<span class="c">// the worker</span>
for await (const chunk of file) { sum = checksum(sum, chunk); postMessage({ read: chunk.length }); }`,
    tour: { steps: [["Stream 64 MB to the worker", "The worker is handed a stream. Each megabyte is made when the worker asks for it, and checked as it lands.", 6000]] },
    async setup(stage, ui) {
      const me = stage.box("page", { html: `<div class="here"><div class="box-title">This page makes the file</div><div style="height:.7rem;border:1.5px solid currentColor;border-radius:99px;overflow:hidden;margin:0 0 .5rem"><div data-bar style="height:100%;width:0;background:var(--teal)"></div></div><p class="small" style="margin:0 0 .25rem">Made so far: <strong data-made>0</strong> MB</p><p class="small" style="margin:0">Most held at once: <strong data-peak>0</strong> MB</p></div>` });
      const wbox = logBox(stage, "worker", "Worker checks it", "", { kind: "worker", url: "blob:" });
      const q = (name) => me.node.querySelector(`[data-${name}]`);
      const workerUrl = URL.createObjectURL(new Blob([`onmessage = async ({ data }) => {
        const reader = data.file.getReader(); let bytes = 0, sum = 0;
        for (;;) { const { value, done } = await reader.read(); if (done) break; for (let i = 0; i < value.length; i += 4096) sum = (sum + value[i]) >>> 0; bytes += value.length; postMessage({ bytes }); await new Promise((r) => setTimeout(r, 25)); }
        postMessage({ done: true, bytes, sum });
      };`], { type: "text/javascript" }));
      const worker = new Worker(workerUrl);
      stage.cleanup(() => { worker.terminate(); URL.revokeObjectURL(workerUrl); });
      const MB = 1024 * 1024, TOTAL = 64;
      let made = 0, read = 0, peak = 0;
      const start = ui.button("Stream 64 MB to the worker", (btn) => {
        btn.disabled = true; made = read = peak = 0;
        const file = new ReadableStream({ pull(controller) {
          if (made >= TOTAL) return controller.close();
          const chunk = new Uint8Array(MB); chunk.fill(made % 251);
          controller.enqueue(chunk); made++;
          peak = Math.max(peak, made - read);
          q("made").textContent = made; q("peak").textContent = peak;
        } }, { highWaterMark: 1 });
        try {
          worker.postMessage({ file }, [file]);
          stage.cable("file", "page", "worker", "teal", "stream");
          wbox.say("given a stream, reading");
        } catch {
          wbox.say("This browser cannot transfer streams yet.");
          btn.disabled = false;
        }
      }, false, true);
      worker.onmessage = ({ data }) => {
        if (!me.node.isConnected) return worker.terminate();
        if (data.done) { wbox.say(`read all ${data.bytes / MB} MB. checksum ${data.sum}`); start.disabled = false; return; }
        read = data.bytes / MB; q("bar").style.width = (read / TOTAL) * 100 + "%";
        if (read % 8 === 0) { wbox.say(`${read} MB checked`); stage.pulse("file", "page"); }
      };
    },
  },
  {
    pattern: "keycopy", use: [1], id: "built-keyworker",
    title: "Make a key on the page, then keep it only in a worker",
    blurb: "Giving a key away is permanent, which is sometimes what you want. This page makes a signing key and posts it to its own worker, then drops its copy. From here on the page cannot sign anything by itself. A script injected into the page finds no key to use. It can only ask the worker, which can say no.",
    code: `const { privateKey, publicKey } = await crypto.subtle.generateKey(ECDSA, false, ["sign", "verify"]);
worker.postMessage({ key: privateKey });     <span class="c">// a copy goes to the worker</span>
<span class="c">// let the page's copy go out of scope: the worker now holds the only one</span>

worker.postMessage({ sign: "order 1" });     <span class="c">// the page can ask</span>`,
    tour: { steps: [["Make a key and give it to the worker", "The page makes a key nobody can read, posts it to its worker and forgets it."], ["Ask the worker to sign", "The worker signs. This page checks the signature with the public half."], ["Page: try to sign by itself", "The page has no key any more."]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page");
      const wbox = logBox(stage, "worker", "This page's worker", "", { kind: "worker", url: "blob:" });
      const ECDSA = { name: "ECDSA", namedCurve: "P-256" }, SIGN = { name: "ECDSA", hash: "SHA-256" };
      const worker = new Worker(URL.createObjectURL(new Blob([`let key = null; onmessage = async ({ data }) => {
        if (data.key) { key = data.key; return postMessage({ log: "holding the key. Nobody can read it, me included." }); }
        const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(data.sign));
        postMessage({ log: "signed: " + data.sign, text: data.sign, signature });
      };`], { type: "text/javascript" })));
      let mine = null, publicKey = null, n = 0;
      worker.onmessage = async ({ data }) => {
        if (!me.node.isConnected) return worker.terminate();
        wbox.say(data.log); stage.pulse("key", "worker");
        if (data.signature) me.say(`${(await crypto.subtle.verify(SIGN, publicKey, data.signature, new TextEncoder().encode(data.text))) ? "verified" : "NOT valid"}: "${data.text}"`);
      };
      const ask = ui.button("Ask the worker to sign", () => { worker.postMessage({ sign: `order ${++n}` }); stage.pulse("key", "page"); }, true);
      const alone = ui.button("Page: try to sign by itself", async () => {
        try { await crypto.subtle.sign(SIGN, mine, new TextEncoder().encode("x")); me.say("signed by myself"); }
        catch { me.say("I cannot sign. I have no key to sign with."); }
      }, true);
      ui.button("Make a key and give it to the worker", async (btn) => {
        btn.disabled = true;
        try { const pair = await crypto.subtle.generateKey(ECDSA, false, ["sign", "verify"]); publicKey = pair.publicKey; mine = pair.privateKey; }
        catch (err) { return me.say("no WebCrypto here: " + err.message); }
        worker.postMessage({ key: mine });
        mine = null;
        stage.cable("key", "page", "worker", "red");
        me.say("gave the key to my worker and dropped my copy");
        ask.disabled = alone.disabled = false;
      }, false, true);
    },
  },
  {
    pattern: "functions", use: [1], id: "built-method",
    title: "Lend one method of an object, and not the object",
    blurb: "This page has a cart with three methods: add, clear and total. A badge from another origin needs the total. It is given a port that calls <code>cart.total()</code> and nothing else. The badge can ask for the total as often as it likes. It cannot add, and it cannot clear, because the port it holds doesn't offer those methods.",
    code: `const cart = { items: [], add(item) {…}, clear() {…}, total() {…} };
const { port1, port2 } = new MessageChannel();
port1.onmessage = ({ data }) =>
  port1.postMessage(data.call === "total" ? { result: cart.total() } : { error: "not on this port" });
badge.postMessage({ cmd: "port" }, "*", [port2]);`,
    tour: { steps: [["Lend the badge cart.total", "The badge gets a port that reaches one method."], ["Add tulips to the cart", "This page uses its own cart, with all its methods."], ["Badge: ask for the total", "The badge calls total through its port."], ["Badge: try to clear the cart", "The badge asks for a method it was not lent."]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page owns the cart", `<p class="small" style="margin:0 0 .4rem">In the cart: <strong data-items>nothing</strong></p>`);
      await stage.frame("badge", {
        title: "Cart badge, another origin", color: "teal",
        script: () => {
          let port = null;
          on("port", (_, [p]) => { port = p; log("lent something I can call"); port.onmessage = ({ data }) => log(data.error ? `${data.call}(): ${data.error}` : `total() returned ${data.result}`); });
          on("call", (data) => { if (!port) return log("I have nothing to call"); log(`calling ${data.name}()`); send(port, "lent", { call: data.name }); });
        },
      });
      const itemsEl = me.node.querySelector("[data-items]");
      const cart = { items: [], add(item) { this.items.push(item); }, clear() { this.items = []; }, total() { return this.items.length * 4.5; } };
      ui.button("Add tulips to the cart", () => { cart.add("tulips"); itemsEl.textContent = `${cart.items.length} bunches`; me.say("cart.add(\"tulips\")"); });
      const total = ui.button("Badge: ask for the total", () => stage.post("badge", { cmd: "call", name: "total" }), true);
      const clear = ui.button("Badge: try to clear the cart", () => stage.post("badge", { cmd: "call", name: "clear" }), true);
      ui.button("Lend the badge cart.total", (btn) => {
        const { port1, port2 } = new MessageChannel();
        port1.onmessage = ({ data }) => {
          if (data.call === "total") { me.say("ran cart.total() for the badge"); port1.postMessage({ result: cart.total() }); }
          else { me.say(`refused ${data.call}(): not lent`); port1.postMessage({ call: data.call, error: "not on this port" }); }
          stage.pulse("lent", "page");
        };
        stage.post("badge", { cmd: "port" }, [port2]);
        stage.cable("lent", "page", "badge", "teal");
        btn.disabled = true; total.disabled = clear.disabled = false;
      }, false, true);
    },
  },
  {
    pattern: "reply", use: [0], id: "built-rpc",
    title: "Call a function on another origin and await the answer",
    blurb: "Twelve lines turn the reply pattern into <code>await call(\"add\", 2, 3)</code>. Each call makes a channel, sends one end with the question, and returns a promise that settles when the other end speaks. Errors come back as rejections. Three calls made at once come back to the right callers, even when the slow one finishes last, because each has its own channel.",
    code: `const call = (method, ...args) => new Promise((resolve, reject) => {
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = ({ data }) => { "error" in data ? reject(new Error(data.error)) : resolve(data.result); port1.close(); };
  service.postMessage({ method, args }, [port2]);
});

await call("add", 2, 3);       <span class="c">// 5, computed on another origin</span>`,
    tour: { steps: [["await call(\"add\", 2, 3)", "A question goes out with a reply port. The promise resolves with the answer."], ["await call(\"divide\", 1, 0)", "The service refuses. The promise rejects with its message."], ["Three calls at once", "Three questions, three wires. The slow one comes back last and still reaches the right caller.", 3000]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page calls");
      await stage.frame("service", {
        title: "Calculator, another origin", color: "teal",
        script: () => on("port", (_, [port]) => {
          const methods = {
            add: (a, b) => a + b,
            divide: (a, b) => { if (b === 0) throw new Error("cannot divide by zero"); return a / b; },
            slow: (ms, value) => new Promise((r) => setTimeout(() => r(value), ms)),
          };
          port.onmessage = async (event) => {
            const { method, args } = event.data, reply = event.ports[0];
            log(`${method}(${args.join(", ")})`);
            try { reply.postMessage({ result: await methods[method](...args) }); } catch (err) { reply.postMessage({ error: err.message }); }
            tell("pulse", { cable: "calls" });
          };
        }),
      });
      const service = new MessageChannel();
      stage.post("service", { cmd: "port" }, [service.port2]);
      stage.cable("calls", "page", "service", "teal");
      const call = (method, ...args) => new Promise((resolve, reject) => {
        const { port1, port2 } = new MessageChannel();
        port1.onmessage = ({ data }) => { "error" in data ? reject(new Error(data.error)) : resolve(data.result); port1.close(); };
        service.port1.postMessage({ method, args }, [port2]);
        stage.pulse("calls", "page");
      });
      ui.button(`await call("add", 2, 3)`, async () => me.say(`add(2, 3) resolved with ${await call("add", 2, 3)}`), false, true);
      ui.button(`await call("divide", 1, 0)`, async () => { try { await call("divide", 1, 0); } catch (err) { me.say(`divide(1, 0) rejected: ${err.message}`); } });
      ui.button("Three calls at once", async () => {
        const [a, b, c] = await Promise.all([call("slow", 1200, "first asked, last back"), call("add", 20, 22), call("slow", 300, "third asked")]);
        me.say(`all three back: "${a}", ${b}, "${c}"`);
      });
    },
  },
  {
    pattern: "hello", use: [0], id: "built-private",
    title: "A private line that other scripts on the page cannot hear",
    blurb: "A sign-in widget from another origin has a token to hand to this page. If it posts the token to the window, every script in the page hears it, including an advert's. If the page first gives the widget one end of a channel, the token arrives on the page's own port, and there is nothing for the advert's script to listen to.",
    code: `<span class="c">// heard by every "message" listener in the page</span>
parent.postMessage({ token }, "*");

<span class="c">// heard only by whoever holds the other end</span>
port.postMessage({ token });`,
    tour: { steps: [["Widget: post the token to the window", "The page gets the token. So does the advert's script, which only had to listen."], ["Open a private line", "This page makes a channel, keeps one end and gives the widget the other."], ["Widget: post the token down the line", "The token arrives on the page's port. The advert's script hears nothing."]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page's own code");
      await stage.frame("widget", {
        title: "Sign-in widget, another origin", color: "teal",
        script: () => {
          let port = null, n = 0;
          on("port", (_, [p]) => { port = p; log("given a private line"); });
          on("shout", () => { const token = "token-" + ++n; log(`posted ${token} to the window`); parent.postMessage({ wire: "shout", token }, "*"); });
          on("whisper", () => { if (!port) return log("I have no line"); const token = "token-" + ++n; log(`posted ${token} down the line`); send(port, "line", { token }); });
        },
      });
      const snoop = logBox(stage, "snoop", "An advert's script, in this same page");
      let overheard = 0;
      // Any script in a page can do this. It needs no permission.
      const listen = (event) => { if (!snoop.node.isConnected) return removeEventListener("message", listen); if (event.data && event.data.token) { overheard++; snoop.say("overheard " + event.data.token); } };
      addEventListener("message", listen);
      snoop.say("listening for messages to this window");
      stage.on((name, data) => { if (name === "widget" && data.wire === "shout") me.say(`received ${data.token} from the window`); });
      ui.button("Widget: post the token to the window", () => stage.post("widget", { cmd: "shout" }), false, true);
      const whisper = ui.button("Widget: post the token down the line", () => {
        const before = overheard;
        stage.post("widget", { cmd: "whisper" });
        setTimeout(() => { if (overheard === before && snoop.node.isConnected) snoop.say("heard nothing that time"); }, 600);
      }, true);
      ui.button("Open a private line", (btn) => {
        const { port1, port2 } = new MessageChannel();
        port1.onmessage = ({ data }) => me.say(`received ${data.token} on my port`);
        stage.post("widget", { cmd: "port" }, [port2]);
        stage.cable("line", "page", "widget", "teal");
        me.say("kept one end, gave the widget the other");
        btn.disabled = true; whisper.disabled = false;
      });
    },
  },
  {
    pattern: "attenuate", use: [0], id: "built-narrow",
    title: "An embed that is shown two fields of your app's state, and no others",
    blurb: "This page's state has a name, an email address, a theme and a basket. A reviews embed from another origin needs to match the theme and show how many things are in the basket. It is given a port that carries those two fields, each time they change. A change to the email address sends nothing, and asking for it is refused.",
    code: `const view = ({ theme, basket }) => ({ theme, basket });     <span class="c">// the whole of what the embed may know</span>
const { port1, port2 } = new MessageChannel();
onStateChange((state, changed) => {
  if (changed in view(state)) port1.postMessage(view(state));
});
embed.postMessage({ cmd: "port" }, "*", [port2]);`,
    tour: { steps: [["Give the embed a narrow view", "The embed gets a port, and the two fields it may see."], ["Switch the theme", "The theme is in the view, so the embed hears of it."], ["Add to the basket", "So is the basket."], ["Change the email address", "The email address is not in the view. Nothing is sent."], ["Embed: ask for the email address", "The embed asks anyway, and is refused."]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page's state", `<p class="small" data-state style="margin:0 0 .4rem;font-family:ui-monospace,Menlo,monospace"></p>`);
      await stage.frame("embed", {
        title: "Reviews embed, another origin", color: "teal",
        script: () => {
          let port = null;
          const seen = document.createElement("p");
          seen.style.cssText = "font:700 .95rem/1.3 system-ui;margin:0 0 .4rem;padding:.35rem .5rem;border-radius:6px;border:1.5px solid currentColor";
          seen.textContent = "I know nothing about this app";
          document.getElementById("log").before(seen);
          on("port", (_, [p]) => {
            port = p;
            port.onmessage = ({ data }) => {
              if (data.refused) return log("refused: " + data.refused);
              seen.textContent = `${data.theme} theme, ${data.basket} in the basket`;
              seen.style.background = data.theme === "dark" ? "#0f1c3f" : "#fff"; seen.style.color = data.theme === "dark" ? "#fff" : "#0f1c3f";
              log("all I was told: " + JSON.stringify(data));
            };
          });
          on("ask", (data) => { if (!port) return log("I have no port"); log("asking for " + data.field); send(port, "view", { want: data.field }); });
        },
      });
      const state = { name: "Ada", email: "ada@example.com", theme: "light", basket: 0 };
      const view = () => ({ theme: state.theme, basket: state.basket });
      const stateEl = me.node.querySelector("[data-state]");
      let port = null, emails = 0;
      const change = (field, value) => {
        state[field] = value;
        stateEl.textContent = JSON.stringify(state).replace(/,/g, ", ");
        if (!port) return;
        if (field in view()) { port.postMessage(view()); stage.pulse("view", "page"); me.say(`${field} changed: sent the view`); }
        else me.say(`${field} changed: not in the view, sent nothing`);
      };
      change("theme", "light");
      const theme = ui.button("Switch the theme", () => change("theme", state.theme === "light" ? "dark" : "light"), true);
      const basket = ui.button("Add to the basket", () => change("basket", state.basket + 1), true);
      const email = ui.button("Change the email address", () => change("email", `ada${++emails}@example.com`), true);
      const ask = ui.button("Embed: ask for the email address", () => stage.post("embed", { cmd: "ask", field: "email" }), true);
      ui.button("Give the embed a narrow view", (btn) => {
        const channel = new MessageChannel();
        port = channel.port1;
        port.onmessage = ({ data }) => { me.say(`refused a request for ${data.want}`); port.postMessage({ refused: `${data.want} is not on this port` }); stage.pulse("view", "page"); };
        stage.post("embed", { cmd: "port" }, [channel.port2]);
        stage.cable("view", "page", "embed", "teal");
        port.postMessage(view());
        btn.disabled = true; theme.disabled = basket.disabled = email.disabled = ask.disabled = false;
      }, false, true);
    },
  },
  {
    pattern: "exchange", use: [0], id: "built-sync",
    title: "A list that stays the same in every tab, with no server",
    blurb: "The two boxes are two tabs of this site, each showing a shopping list. Add an item in one and it appears in the other. Tick it in the other and it is ticked in the first. The list lives in a shared worker that holds a port to every tab. Nothing is sent to a server, and nothing is written to storage. The checkboxes in the boxes work too, and the link opens a third tab for real.",
    code: `<span class="c">// every tab</span>
const port = new SharedWorker("/sync-worker.js").port;
port.onmessage = ({ data }) => render(data.list);
addButton.onclick = () => port.postMessage({ add: true });

<span class="c">// the worker</span>
onconnect = ({ ports: [port] }) => {
  ports.add(port);
  port.onmessage = ({ data }) => { change(list, data); for (const p of ports) p.postMessage({ list }); };
};`,
    tour: { steps: [["Tab one: add an item", "Tab one tells the worker. The worker tells every tab."], ["Tab one: add an item", "A second item, in both tabs."], ["Tab two: tick the first item", "Tab two ticks it, and it is ticked in tab one."]] },
    async setup(stage, ui) {
      const one = stage.box("tab-one", { src: "/patterns/sync.html", title: "Shopping list, tab one" });
      stage.box("worker", { kind: "shared", url: "/patterns/sync-worker.js", html: `<div class="here"><div class="box-title">SharedWorker</div><p class="small muted" style="margin:0">Keeps the list, and holds a port to each tab.</p></div>` });
      const two = stage.box("tab-two", { src: "/patterns/sync.html", title: "Shopping list, tab two" });
      if (!("SharedWorker" in self)) {
        ui.unsupported("This browser does not support SharedWorker.");
        return;
      }
      await Promise.all([one.whenReady, two.whenReady]);
      stage.cable("c-one", "tab-one", "worker", "red"); stage.cable("c-two", "tab-two", "worker", "teal");
      stage.on((name, data) => { if (data.wire === "sync") stage.pulse(name === "tab-one" ? "c-one" : "c-two", "worker"); });
      stage.post("tab-one", { cmd: "clear" });
      ui.button("Tab one: add an item", () => stage.post("tab-one", { cmd: "add" }), false, true);
      ui.button("Tab two: tick the first item", () => stage.post("tab-two", { cmd: "tick" }));
      ui.link("Open a third tab for real", "/patterns/sync.html");
    },
  },
  {
    pattern: "canvas", use: [1], id: "built-render",
    title: "The same heavy drawing, on the page's thread and then on a worker's",
    blurb: "Both canvases get the same job: two seconds of zooming into the Mandelbrot set, frame after frame. Drawn by the page, the page can do nothing else: its counter stops, and you see only the last frame. Drawn by a worker that was handed the canvas, every frame appears as it is finished, and the page's counter keeps going.",
    code: `const surface = canvas.transferControlToOffscreen();
worker.postMessage({ surface }, [surface]);

<span class="c">// the worker: draw as hard as you like, the page is not waiting for you</span>
onmessage = ({ data }) => { const ctx = data.surface.getContext("2d"); for (;;) drawNextFrame(ctx); };`,
    tour: { steps: [["Draw on the page's thread", "The page draws for two seconds. Watch its counter: it stops.", 3200], ["Draw in the worker", "The worker draws the same frames into a canvas it was handed. The counter keeps going.", 3200]] },
    async setup(stage, ui) {
      const me = stage.box("page", { html: `<div class="here" style="display:flex;flex-direction:column;height:100%;box-sizing:border-box"><div class="box-title">Drawn by this page</div><p class="small" style="margin:0 0 .3rem">Page ticks: <strong data-ticks>0</strong></p><canvas width="240" height="135" style="width:100%;flex:1;min-height:0;display:block;object-fit:contain;background:#000" aria-label="Drawn on the page's own thread"></canvas><p class="small" data-said style="margin:.3rem 0 0;min-height:2.6em"></p></div>` });
      const wb = stage.box("worker", { kind: "worker", url: "blob:", html: `<div class="here" style="display:flex;flex-direction:column;height:100%;box-sizing:border-box"><div class="box-title">Drawn by a worker</div><p class="small" style="margin:0 0 .3rem">The canvas below was handed over.</p><canvas width="240" height="135" style="width:100%;flex:1;min-height:0;display:block;object-fit:contain;background:#000" aria-label="Drawn by a worker"></canvas><p class="small" data-said style="margin:.3rem 0 0;min-height:2.6em"></p></div>` });
      const ticksEl = me.node.querySelector("[data-ticks]");
      const said = (box, text) => (box.node.querySelector("[data-said]").textContent = text);
      if (!("OffscreenCanvas" in self) || typeof HTMLCanvasElement.prototype.transferControlToOffscreen !== "function") {
        said(wb, "This browser cannot transfer canvas control to a worker.");
        ui.unsupported("This browser does not support OffscreenCanvas transfer to workers.");
        return;
      }
      let ticks = 0;
      const beat = setInterval(() => { if (!ticksEl.isConnected) return clearInterval(beat); ticksEl.textContent = ++ticks; }, 100);
      const frame = function (ctx, k) {
        const w = ctx.canvas.width, h = ctx.canvas.height, img = ctx.createImageData(w, h), d = img.data;
        const scale = 3 / (w * Math.pow(1.045, k)), cx = -0.7435, cy = 0.1314;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const a = cx + (x - w / 2) * scale, b = cy + (y - h / 2) * scale;
          let zr = 0, zi = 0, i = 0;
          while (i < 220 && zr * zr + zi * zi < 4) { const t = zr * zr - zi * zi + a; zi = 2 * zr * zi + b; zr = t; i++; }
          const o = (y * w + x) * 4, c = i === 220 ? 0 : i * 9;
          d[o] = c % 256; d[o + 1] = (c * 2) % 256; d[o + 2] = 120 + (c % 136); d[o + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      };
      const ctx = me.node.querySelector("canvas").getContext("2d");
      const workerUrl = URL.createObjectURL(new Blob([`const frame = ${frame}; let ctx = null;
        onmessage = async ({ data }) => {
          if (data.surface) { ctx = data.surface.getContext("2d"); return; }
          const until = performance.now() + 2000; let k = 0;
          while (performance.now() < until) { frame(ctx, k++); await new Promise((r) => setTimeout(r, 0)); }
          postMessage({ frames: k });
        };`], { type: "text/javascript" }));
      const worker = new Worker(workerUrl);
      stage.cleanup(() => { clearInterval(beat); worker.terminate(); URL.revokeObjectURL(workerUrl); });
      const surface = wb.node.querySelector("canvas").transferControlToOffscreen();
      worker.postMessage({ surface }, [surface]);
      stage.cable("canvas", "page", "worker", "teal");
      let before = 0;
      worker.onmessage = ({ data }) => { if (!wb.node.isConnected) return worker.terminate(); said(wb, `${data.frames} frames, each shown as it was finished. The page ticked ${ticks - before} times meanwhile.`); onWorker.disabled = false; };
      ui.button("Draw on the page's thread", async (btn) => {
        btn.disabled = true; said(me, "drawing…");
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
        const start = ticks, until = performance.now() + 2000; let k = 0;
        while (performance.now() < until) frame(ctx, k++);
        said(me, `${k} frames, and you saw one. The page ticked ${ticks - start} times meanwhile.`);
        btn.disabled = false;
      }, false, true);
      const onWorker = ui.button("Draw in the worker", (btn) => { btn.disabled = true; before = ticks; said(wb, "drawing…"); worker.postMessage({ go: true }); stage.pulse("canvas", "page"); });
    },
  },
  {
    pattern: "zerocopy", use: [1], id: "built-result",
    title: "A sandboxed calculation that hands back 16 MB without copying it",
    blurb: "The frame is sandboxed and on another origin, which is where you want code you did not write. It marks every prime below 16.7 million in a 16 MB buffer. Posting that back the ordinary way makes a second 16 MB and takes time that grows with the size. Posting it with the buffer in the transfer list moves the memory itself. The frame measures how long each call took, and how much it has left afterwards.",
    code: `<span class="c">// in the sandbox</span>
const sieve = findPrimes(16 * 1024 * 1024);                <span class="c">// a 16 MB Uint8Array</span>
port.postMessage({ sieve }, [sieve.buffer]);               <span class="c">// moved</span>
sieve.byteLength;                                          <span class="c">// 0: it is the page's now</span>`,
    tour: { steps: [["Sandbox: work it out and send a copy", "The frame computes, then posts the result the ordinary way. It keeps its 16 MB, and the page gets another.", 2600], ["Sandbox: work it out and move it", "The same work, and this time the buffer is in the transfer list.", 2600]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page wants the answer");
      await stage.frame("sandbox", {
        title: "Sandboxed calculation, another origin", color: "yellow",
        script: () => on("port", (_, [port]) => {
          log("ready to work");
          port.onmessage = ({ data }) => {
            const N = 16 * 1024 * 1024, sieve = new Uint8Array(N).fill(1);
            sieve[0] = sieve[1] = 0;
            for (let i = 2; i * i < N; i++) if (sieve[i]) for (let j = i * i; j < N; j += i) sieve[j] = 0;
            const start = performance.now();
            if (data.move) port.postMessage({ sieve, moved: true }, [sieve.buffer]); else port.postMessage({ sieve, moved: false });
            const ms = performance.now() - start;
            tell("pulse", { cable: "result" });
            log(`${data.move ? "moved" : "copied"} it in ${ms.toFixed(1)} ms. I still hold ${sieve.byteLength / 1048576} MB.`);
          };
        }),
      });
      const channel = new MessageChannel();
      channel.port1.onmessage = ({ data }) => {
        let count = 0; const s = data.sieve;
        for (let i = 0; i < s.length; i++) count += s[i];
        me.say(`${data.moved ? "moved" : "copied"}: ${s.byteLength / 1048576} MB arrived. ${count.toLocaleString("en")} primes below ${s.length.toLocaleString("en")}.`);
      };
      stage.post("sandbox", { cmd: "port" }, [channel.port2]);
      stage.cable("result", "page", "sandbox", "yellow");
      const ask = (move) => { channel.port1.postMessage({ move }); stage.pulse("result", "page"); };
      ui.button("Sandbox: work it out and send a copy", () => ask(false), false, true);
      ui.button("Sandbox: work it out and move it", () => ask(true));
    },
  },
  {
    pattern: "pipeline", use: [0], id: "built-stages",
    also: { roundtrip: [2] },   // the same demo also runs on that pattern's page
    title: "Three parties each supply one stage, and none of them sees the others",
    blurb: "A zipped order needs unzipping, turning from bytes into text, and its card number hiding before it is shown. Each of those is a stream stage supplied by a different origin. This page asks each for a stage, joins the three end to end and sends the file through. This page holds both ends of every stage, so the data comes back here between one stage and the next. Each party sees only what flows through its own stage, and none of them needs to know the others exist.",
    code: `<span class="c">// each party</span>
const stage = new TransformStream({ transform(chunk, out) { out.enqueue(work(chunk)); } });
parent.postMessage({ readable: stage.readable, writable: stage.writable }, "*", [stage.readable, stage.writable]);

<span class="c">// this page</span>
zippedFile.pipeThrough(unzip).pipeThrough(decode).pipeThrough(redact).pipeTo(screen);`,
    tour: { steps: [["Ask each party for a stage", "Three origins each hand over both ends of one transform."], ["Pour a zipped order through all three", "Bytes go in at one end. Readable text with the card number hidden comes out of the other.", 2600]] },
    async setup(stage, ui) {
      // One script for all three. Each frame works out which stage it is from its own title.
      const script = () => on("offer", () => {
        const title = document.querySelector("h1").textContent;
        const kind = title.startsWith("Unzip") ? "unzip" : title.startsWith("Bytes") ? "decode" : "redact";
        const seen = new TransformStream({ transform(chunk, out) { log(kind === "redact" ? `text in: ${chunk.length} characters` : `bytes in: ${chunk.byteLength}`); tell("pulse", { cable: kind }); out.enqueue(chunk); } });
        const work = kind === "unzip" ? new DecompressionStream("gzip") : kind === "decode" ? new TextDecoderStream() : new TransformStream({ transform(text, out) { out.enqueue(text.replace(/\b\d{4} \d{4} \d{4} (\d{4})\b/g, "•••• •••• •••• $1")); } });
        const readable = seen.readable.pipeThrough(work);
        log("made a stage and handed over both its ends");
        try { parent.postMessage({ wire: "stage", kind, readable, writable: seen.writable }, "*", [readable, seen.writable]); }
        catch { log("This browser cannot transfer streams yet."); }
      });
      await stage.frame("unzip", { title: "Unzip, origin one", color: "red", script });
      await stage.frame("decode", { title: "Bytes to text, origin two", color: "yellow", script });
      await stage.frame("redact", { title: "Hide card numbers, origin three", color: "teal", script });
      const out = logBox(stage, "page", "This page joins them, and shows the result", "", { wide: true });
      const order = "Order 1182\nTwo dozen tulips, one roll of brown paper\nCard 4929 1234 5678 9012\nDeliver Thursday before noon\n";
      let stages = {};
      stage.on((name, data, ports) => {
        if (data.wire !== "stage") return;
        stages[data.kind] = { readable: data.readable, writable: data.writable };
        if (Object.keys(stages).length < 3) return;
        // Each stage is two streams, and this page holds both: one to write into and one to read from.
        for (const [kind, color] of [["unzip", "red"], ["decode", "yellow"], ["redact", "teal"]]) { stage.cable(kind + "-in", "page", kind, color, "stream"); stage.cable(kind, kind, "page", color, "stream"); }
        out.say("holding three stages from three origins");
        pour.disabled = false;
      });
      const pour = ui.button("Pour a zipped order through all three", async (btn) => {
        btn.disabled = true;
        const zipped = new Blob([order]).stream().pipeThrough(new CompressionStream("gzip"));
        const { unzip, decode, redact } = stages; stages = {};
        let text = "";
        await zipped.pipeThrough(unzip).pipeThrough(decode).pipeThrough(redact).pipeTo(new WritableStream({ write(chunk) { text += chunk; } }));
        for (const line of text.trim().split("\n").reverse()) out.say(line);
        ask.disabled = false;
      }, true);
      const ask = ui.button("Ask each party for a stage", (btn) => { for (const name of ["unzip", "decode", "redact"]) stage.post(name, { cmd: "offer" }); btn.disabled = true; }, false, true);
    },
  },
  {
    pattern: "frozen", use: [0, 1], id: "built-relay",
    title: "A decoder worker feeding a renderer worker, while the page is busy",
    blurb: "One worker makes video frames. Another paints them into a canvas it was handed. This page introduces the two with a channel and steps away, so frames go from one worker straight to the other and never touch the page's thread. Freeze the page for three seconds, as a long layout or a garbage collection would, and the picture keeps moving.",
    code: `const { port1, port2 } = new MessageChannel();
decoder.postMessage({ out: port1 }, [port1]);
renderer.postMessage({ in: port2, surface }, [port2, surface]);

<span class="c">// the decoder: each frame's memory is moved to the renderer</span>
out.postMessage({ pixels }, [pixels.buffer]);`,
    tour: { steps: [["Connect the decoder to the renderer", "Each worker gets one end of a channel. Frames start to flow between them."], ["Freeze this page for 3 seconds", "The page's counter stops. The picture does not.", 4200]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page", `<p class="small" style="margin:0 0 .4rem">Page ticks: <strong data-ticks>0</strong></p>`);
      const dec = logBox(stage, "decoder", "Decoder worker", "", { kind: "worker", url: "blob:" });
      const screen = stage.box("renderer", { kind: "worker", url: "blob:", html: `<canvas width="160" height="90" style="width:100%;height:100%;display:block;background:#000" aria-label="Painted by the renderer worker"></canvas>` });
      if (!("OffscreenCanvas" in self) || typeof HTMLCanvasElement.prototype.transferControlToOffscreen !== "function") {
        me.say("This browser cannot transfer canvas control to a worker.");
        ui.unsupported("This browser does not support OffscreenCanvas transfer to workers.");
        return;
      }
      const ticksEl = me.node.querySelector("[data-ticks]");
      let ticks = 0;
      const urls = [];
      const work = (source) => { const u = URL.createObjectURL(new Blob([source], { type: "text/javascript" })); urls.push(u); return new Worker(u); };
      const decoder = work(`onmessage = ({ data }) => {
        const out = data.out, W = 160, H = 90; let n = 0;
        setInterval(() => {
          const pixels = new Uint8ClampedArray(W * H * 4), t = n / 12;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const v = Math.sin(x / 14 + t) + Math.sin(y / 9 - t * 1.3) + Math.sin((x + y) / 18 + t / 2), o = (y * W + x) * 4;
            pixels[o] = 128 + 127 * Math.sin(v * 2); pixels[o + 1] = 128 + 127 * Math.sin(v * 2 + 2); pixels[o + 2] = 128 + 127 * Math.sin(v * 2 + 4); pixels[o + 3] = 255;
          }
          out.postMessage({ pixels, n: ++n }, [pixels.buffer]);
          if (n % 60 === 0) postMessage({ made: n });
        }, 33);
      };`);
      const renderer = work(`let painted = 0; onmessage = ({ data }) => {
        if (data.count) return postMessage({ painted });
        const ctx = data.surface.getContext("2d");
        data.in.onmessage = ({ data: frame }) => {
          ctx.putImageData(new ImageData(frame.pixels, 160, 90), 0, 0);
          ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 62, 15); ctx.fillStyle = "#fff"; ctx.font = "11px monospace"; ctx.fillText("frame " + frame.n, 3, 11);
          painted++;
        };
      };`);
      const beat = setInterval(() => { if (!ticksEl.isConnected) { decoder.terminate(); renderer.terminate(); return clearInterval(beat); } ticksEl.textContent = ++ticks; }, 100);
      stage.cleanup(() => { clearInterval(beat); decoder.terminate(); renderer.terminate(); urls.forEach((u) => URL.revokeObjectURL(u)); });
      decoder.onmessage = ({ data }) => dec.say(`made ${data.made} frames, kept none`);
      const count = () => new Promise((resolve) => { renderer.onmessage = ({ data }) => resolve(data.painted); renderer.postMessage({ count: true }); });
      const freeze = ui.button("Freeze this page for 3 seconds", async () => {
        const before = await count(), mine = ticks;
        me.say("frozen");
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
        const until = performance.now() + 3000;
        while (performance.now() < until) { /* the main thread is stuck here */ }
        me.say(`3 s frozen: I ticked ${ticks - mine} times, the renderer painted ${(await count()) - before} frames`);
      }, true);
      ui.button("Connect the decoder to the renderer", (btn) => {
        const { port1, port2 } = new MessageChannel();
        const surface = screen.node.querySelector("canvas").transferControlToOffscreen();
        renderer.postMessage({ in: port2, surface }, [port2, surface]);
        decoder.postMessage({ out: port1 }, [port1]);
        stage.cable("frames", "decoder", "renderer", "teal");
        me.say("introduced them, and kept no port");
        btn.disabled = true; freeze.disabled = false;
      }, false, true);
    },
  },
  {
    pattern: "halves", use: [2], id: "built-roles",
    title: "One feed, with a writing role and a reading role",
    blurb: "A greenhouse sensor should be able to report and never read. A dashboard should be able to read and never report. This page makes one stream and gives the writing end to the sensor and the reading end to the dashboard. Nobody has to check the roles. The sensor holds an object with no way to read, and the dashboard holds one with no way to write. The stream was made in this page and still runs through it, so readings stop if this page closes.",
    code: `const { readable, writable } = new TransformStream();
sensor.postMessage({ feed: writable }, "*", [writable]);       <span class="c">// can write, cannot read</span>
dashboard.postMessage({ feed: readable }, "*", [readable]);    <span class="c">// can read, cannot write</span>`,
    tour: { steps: [["Give out the two ends", "The sensor gets the writing end and the dashboard the reading end. This page keeps neither end, but the stream still runs through it."], ["Sensor: report a reading", "A reading goes from the sensor, through the stream in this page, to the dashboard."], ["Sensor: try to read the feed", "The sensor's end has nothing to read with."], ["Dashboard: try to write a reading", "The dashboard's end has nothing to write with."]] },
    async setup(stage, ui) {
      await stage.frame("sensor", {
        title: "Greenhouse sensor", color: "red",
        script: () => {
          let writer = null, feed = null, n = 0;
          on("feed", (data) => { feed = data.feed; writer = feed.getWriter(); log("given an end of the feed: " + feed.constructor.name); });
          on("report", () => { if (!writer) return log("I have no feed"); const reading = { n: ++n, temp: (18 + Math.random() * 6).toFixed(1) }; writer.write(reading); tell("pulse", { cable: "feed" }); log(`reported ${reading.temp}°`); });
          on("read", () => log(feed && "getReader" in feed ? "I can read" : "I cannot read: a WritableStream has no getReader"));
        },
      });
      const me = logBox(stage, "page", "This page made the feed");
      await stage.frame("dashboard", {
        title: "Dashboard", color: "teal",
        script: () => {
          let feed = null;
          on("feed", async (data) => {
            feed = data.feed; log("given an end of the feed: " + feed.constructor.name);
            const reader = feed.getReader();
            for (;;) { const { value, done } = await reader.read(); if (done) break; log(`reading ${value.n}: ${value.temp}°`); }
          });
          on("write", () => log(feed && "getWriter" in feed ? "I can write" : "I cannot write: a ReadableStream has no getWriter"));
        },
      });
      const report = ui.button("Sensor: report a reading", () => stage.post("sensor", { cmd: "report" }), true);
      const read = ui.button("Sensor: try to read the feed", () => stage.post("sensor", { cmd: "read" }), true);
      const write = ui.button("Dashboard: try to write a reading", () => stage.post("dashboard", { cmd: "write" }), true);
      ui.button("Give out the two ends", (btn) => {
        try {
          const { readable, writable } = new TransformStream();
          stage.post("sensor", { cmd: "feed", feed: writable }, [writable]);
          stage.post("dashboard", { cmd: "feed", feed: readable }, [readable]);
          stage.cable("feed", "sensor", "page", "teal", "stream");
          stage.cable("feed-out", "page", "dashboard", "teal", "stream");
          me.say("gave away both ends. I can neither read nor write it now.");
          btn.disabled = true; report.disabled = read.disabled = write.disabled = false;
        } catch {
          me.say("This browser cannot transfer streams yet.");
        }
      }, false, true);
    },
  },
  {
    pattern: "lend", use: [1], id: "built-delegate",
    title: "Sign in on the page, then hand the open session to a worker",
    blurb: "The page signs in to an account service on another origin and gets back a port: the open session. The page does not need it. Its worker does, to keep the balance fresh in the background. So the page posts the port to the worker. The session is not copied and nobody signs in twice. The worker now holds it, and the page's own variable holds a dead port.",
    code: `const session = await signIn(password);         <span class="c">// a port to the account service</span>
worker.postMessage({ session }, [session]);     <span class="c">// the worker has it now</span>
session.postMessage({ ask: "balance" });        <span class="c">// goes nowhere: this end has left</span>`,
    tour: { steps: [["Sign in", "The page sends a password and gets a session back, as a port."], ["Hand the session to my worker", "The port moves to the worker, which starts asking for the balance."], ["Page: try to use the session", "The page still has its variable. The port behind it has gone.", 1600]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page signs in");
      const wbox = logBox(stage, "worker", "This page's worker", "", { kind: "worker", url: "blob:" });
      await stage.frame("account", {
        title: "Account service, another origin", color: "yellow",
        script: () => {
          let balance = 240, asked = 0;
          on("login", (data) => {
            if (data.password !== "tulips") return log("wrong password");
            const { port1, port2 } = new MessageChannel();
            port1.onmessage = ({ data }) => { if (data.ask !== "balance") return; balance += 5; log(`balance asked for (${++asked})`); send(port1, "session", { balance }); };
            log("signed in. Here is a session.");
            parent.postMessage({ wire: "session" }, "*", [port2]);
          });
        },
      });
      const workerUrl = URL.createObjectURL(new Blob([`onmessage = ({ data }) => {
        const session = data.session;
        session.onmessage = ({ data }) => postMessage({ balance: data.balance });
        const ask = () => { session.postMessage({ ask: "balance" }); postMessage({ asked: true }); };
        ask(); setInterval(ask, 1500);
      };`], { type: "text/javascript" }));
      const worker = new Worker(workerUrl);
      stage.cleanup(() => { worker.terminate(); URL.revokeObjectURL(workerUrl); });
      let session = null;
      worker.onmessage = ({ data }) => {
        if (!me.node.isConnected) return worker.terminate();
        if (data.asked) return stage.pulse("session", "worker");
        wbox.say(`balance is ${data.balance}, fetched without the page`);
      };
      stage.on((name, data, ports) => {
        if (name !== "account" || data.wire !== "session") return;
        session = ports[0];
        stage.cable("session", "page", "account", "yellow");
        me.say("signed in. I hold the session.");
        hand.disabled = false;
      });
      const hand = ui.button("Hand the session to my worker", (btn) => {
        worker.postMessage({ session }, [session]);
        stage.cable("session", "worker", "account", "yellow");
        me.say("posted the session to my worker");
        wbox.say("given an open session. I never saw a password.");
        btn.disabled = true; mine.disabled = false;
      }, true);
      const mine = ui.button("Page: try to use the session", () => {
        let heard = false;
        session.onmessage = () => (heard = true);
        try { session.postMessage({ ask: "balance" }); } catch { /* a moved port may refuse outright */ }
        setTimeout(() => { if (!heard && me.node.isConnected) me.say("asked on my old port, and heard nothing. It moved."); }, 700);
      }, true);
      ui.button("Sign in", (btn) => { stage.post("account", { cmd: "login", password: "tulips" }); btn.disabled = true; }, false, true);
    },
  },
  {
    pattern: "signer", use: [1], id: "built-quota",
    title: "One API key, used by two apps, each under its own limit",
    blurb: "The key holder has a key that cannot be read, and signs requests with it. Two apps from other origins need signed requests. Neither is given the key. Each is given its own port to the key holder, and each port has its own allowance: three requests for the weather app, one for the garden app. The key holder counts per port, so it knows who is asking without anyone having to say.",
    code: `<span class="c">// the key holder, once per app</span>
const { port1, port2 } = new MessageChannel();
let left = allowance;
port1.onmessage = async ({ data }) => {
  if (left-- <= 0) return port1.postMessage({ refused: "allowance used" });
  port1.postMessage({ signed: await crypto.subtle.sign("HMAC", key, encode(data.request)) });
};
give(app, port2);`,
    tour: { steps: [["Give each app a line to the key holder", "Two ports, two allowances. The key stays where it is."], ["Weather app: sign a request", "The key holder signs it. One of three used."], ["Garden app: sign a request", "The garden app's one request."], ["Garden app: sign a request", "Its allowance is used. The weather app's is untouched."]] },
    async setup(stage, ui) {
      await stage.frame("weather", {
        title: "Weather app, allowed 3", color: "teal",
        script: () => {
          let port = null, n = 0;
          on("port", (_, [p]) => { port = p; log("given a line to a key holder"); port.onmessage = ({ data }) => log(data.refused ? "refused: " + data.refused : `signed: ${data.signature}…`); });
          on("ask", () => { if (!port) return log("I have no line"); send(port, "weather", { request: "GET /forecast?n=" + ++n }); });
        },
      });
      await stage.frame("keeper", {
        title: "Key holder, another origin", color: "yellow",
        script: () => {
          const key = crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
          key.then(() => log("made a key nobody can read"), (err) => log("no WebCrypto here: " + err.message));
          on("client", (data, [port]) => {
            let left = data.allowance;
            log(`${data.name}: a line, allowed ${left}`);
            port.onmessage = async ({ data: ask }) => {
              if (left <= 0) { log(`${data.name}: refused, allowance used`); return send(port, data.name, { refused: "allowance used" }); }
              left--;
              const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", await key, new TextEncoder().encode(ask.request)));
              log(`${data.name}: signed "${ask.request}", ${left} left`);
              send(port, data.name, { signature: [...bytes.slice(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("") });
            };
          });
        },
      });
      await stage.frame("garden", {
        title: "Garden app, allowed 1", color: "red",
        script: () => {
          let port = null, n = 0;
          on("port", (_, [p]) => { port = p; log("given a line to a key holder"); port.onmessage = ({ data }) => log(data.refused ? "refused: " + data.refused : `signed: ${data.signature}…`); });
          on("ask", () => { if (!port) return log("I have no line"); send(port, "garden", { request: "GET /frost?n=" + ++n }); });
        },
      });
      const w = ui.button("Weather app: sign a request", () => stage.post("weather", { cmd: "ask" }), true);
      const g = ui.button("Garden app: sign a request", () => stage.post("garden", { cmd: "ask" }), true);
      ui.button("Give each app a line to the key holder", (btn) => {
        for (const [name, allowance, color] of [["weather", 3, "teal"], ["garden", 1, "red"]]) {
          const { port1, port2 } = new MessageChannel();
          stage.post("keeper", { cmd: "client", name, allowance }, [port1]);
          stage.post(name, { cmd: "port" }, [port2]);
          stage.cable(name, name, "keeper", color);
        }
        btn.disabled = true; w.disabled = g.disabled = false;
      }, false, true);
    },
  },
  {
    pattern: "tearoff", use: [1], id: "built-pip",
    title: "Float a tool above every other window, without moving its port",
    blurb: "Document Picture-in-Picture gives a page a small window that stays on top of everything. It differs from tearing off into a popup in one useful way: the new window has no script of its own. This page's script keeps running it. So the meter's element moves into the floating window and the port stays exactly where it was. Close the floating window and the element comes home. This needs Chrome or Edge on a desktop, and a real press of the button.",
    code: `const pip = await documentPictureInPicture.requestWindow({ width: 260, height: 150 });
pip.document.body.append(meter);          <span class="c">// the element moves</span>
port.onmessage = ({ data }) => { meter.textContent = data; };   <span class="c">// the port and its listener do not</span>
pip.addEventListener("pagehide", () => sidebar.append(meter));`,
    tour: { steps: [], then: "Press Float the meter above other windows. Browsers only open a Document Picture-in-Picture window for a real click." },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page's sidebar", `<div data-slot><p data-tool style="font:800 2.4rem/1 var(--display);margin:.1rem 0 .4rem">0</p></div>`);
      await stage.frame("feed", {
        title: "Feed on another origin", color: "teal",
        script: () => on("port", (_, [port]) => { let n = 0; log("ticking into one port"); setInterval(() => send(port, "line", ++n), 900); }),
      });
      const slot = me.node.querySelector("[data-slot]"), tool = me.node.querySelector("[data-tool]");
      const channel = new MessageChannel();
      channel.port1.onmessage = ({ data }) => { tool.textContent = data; };
      stage.post("feed", { cmd: "port" }, [channel.port2]);
      stage.cable("line", "page", "feed", "teal");
      let pip = null;
      stage.cleanup(() => { channel.port1.close(); try { pip?.close(); } catch {} });
      const back = ui.button("Bring it back", () => pip?.close(), true);
      ui.button("Float the meter above other windows", async (btn) => {
        if (!("documentPictureInPicture" in self)) return me.say("This browser has no Document Picture-in-Picture. Chrome and Edge on a desktop do.");
        try { pip = await documentPictureInPicture.requestWindow({ width: 260, height: 150 }); }
        catch (err) { return me.say("the browser would not open it: " + err.message); }
        pip.document.body.style.cssText = "margin:0;display:grid;place-items:center;height:100vh;font-family:system-ui;background:#0f1c3f;color:#fff";
        pip.document.body.append(tool);
        me.say("the element moved to the floating window. The port did not move.");
        btn.disabled = true; back.disabled = false;
        pip.addEventListener("pagehide", () => { slot.append(tool); if (me.node.isConnected) me.say("the window closed and the meter came home"); btn.disabled = false; back.disabled = true; pip = null; });
      }, false, true);
    },
  },
  {
    pattern: "tearoff", use: [2], id: "built-upgrade",
    also: { reload: [2] },   // the same demo also runs on that pattern's page
    title: "Replace a running widget with its next version, and keep its connection",
    blurb: "Version 1 of a chat widget is holding a port to a service that sends it numbered messages. Version 2 is ready. Loading it the usual way would mean dropping the connection and making another, and losing whatever arrived in between. Here version 1 stops listening, hands its port to version 2, and is removed. Messages that arrive during the swap wait in the port. The service is never told that anything changed.",
    code: `<span class="c">// version 1, when asked to step aside</span>
port.onmessage = null;                                       <span class="c">// stop reading: what arrives now will wait</span>
parent.postMessage({ handover: true, last }, "*", [port]);

<span class="c">// version 2</span>
port.onmessage = ({ data }) => { /* carries on from last + 1 */ };`,
    tour: { steps: [["Connect version 1 to the service", "The service starts sending numbered messages down a port."], ["Load version 2 and hand over", "Version 1 gives up its port and is removed. Version 2 picks up at the next message.", 2400]] },
    async setup(stage, ui) {
      const widget = () => {
        let port = null, last = 0, missed = 0;
        const listen = () => { port.onmessage = ({ data }) => { if (last && data !== last + 1) missed += data - last - 1; last = data; log(`message ${data}. Missed so far: ${missed}`); tell("at", { last, missed }); }; };
        on("port", (data, [p]) => { port = p; if (data.last) { last = data.last; log(`took over a live port. The last version saw message ${last}.`); } else log("connected"); listen(); });
        on("handover", () => { if (!port) return; port.onmessage = null; log("stopped listening and gave my port away"); parent.postMessage({ wire: "handover", last }, "*", [port]); port = null; });
      };
      await stage.frame("service", {
        title: "Chat service, another origin", color: "teal",
        script: () => on("port", (_, [port]) => { let n = 0; log("sending to one port. I do not know who holds it."); setInterval(() => { send(port, "line", ++n); if (n % 5 === 0) log(`sent ${n} messages`); }, 400); }),
      });
      await stage.frame("v1", { title: "Chat widget, version 1", color: "red", script: widget });
      const me = logBox(stage, "page", "This page swaps the versions");
      let current = "v1";
      stage.on(async (name, data, ports) => {
        if (name !== "v1" || data.wire !== "handover") return;
        stage.post("v2", { cmd: "port", last: data.last }, [ports[0]]);
        stage.remove("v1"); current = "v2";
        stage.cable("line", "service", "v2", "teal");
        me.say(`moved the port from version 1 to version 2 at message ${data.last}`);
      });
      const upgrade = ui.button("Load version 2 and hand over", async (btn) => {
        btn.disabled = true;
        await stage.frame("v2", { title: "Chat widget, version 2", color: "yellow", script: widget });
        me.say("version 2 has loaded. Asking version 1 to step aside.");
        stage.post("v1", { cmd: "handover" });
      }, true);
      ui.button("Connect version 1 to the service", (btn) => {
        const { port1, port2 } = new MessageChannel();
        stage.post("service", { cmd: "port" }, [port1]);
        stage.post("v1", { cmd: "port" }, [port2]);
        stage.cable("line", "service", "v1", "teal");
        btn.disabled = true; upgrade.disabled = false;
      }, false, true);
    },
  },
  {
    pattern: "reload", use: [0], id: "built-shop",
    title: "A connection granted once, kept across every page of a site",
    blurb: "The box on the right is a small site with three pages, and each link is a real navigation that throws the old page away. On the first page it was granted a port to an order feed on another origin. On the way out of each page it leaves that port with a shared worker, and on the way in it collects it. The feed keeps sending throughout. Updates sent while no page existed wait in the port, so none are missed.",
    code: `<span class="c">// on every page of the site</span>
const bank = new SharedWorker("/bank.js", { extendedLifetime: true });
bank.port.postMessage({ withdraw: "orders" });                 <span class="c">// is one waiting for me?</span>
bank.port.onmessage = ({ ports }) => ports[0] ? resume(ports[0]) : askToBeGranted();
addEventListener("pagehide", () => bank.port.postMessage({ deposit: "orders" }, [port]));`,
    tour: { steps: [["Go to the next page", "A real navigation, from Shop to Basket. The new page collects the port.", 2200], ["Go to the next page", "And again, to Account. The count has no gaps.", 2200]] },
    async setup(stage, ui) {
      const key = "s" + Math.random().toString(36).slice(2, 8);
      await stage.frame("feed", {
        title: "Order feed, another origin", color: "teal",
        script: () => on("port", (_, [port]) => { let n = 0; log("granted this site one port"); setInterval(() => send(port, "line", ++n), 400); }),
      });
      const note = logBox(stage, "bank", "Port bank, a SharedWorker", "", { kind: "shared", url: "/patterns/bank.js" });
      const site = stage.box("site", { src: `/patterns/shop.html?key=${key}`, title: "Shop site" });
      if (!("SharedWorker" in self)) {
        note.say("This browser does not support SharedWorker.");
        ui.unsupported("This browser does not support SharedWorker.");
        return;
      }
      // Each page's own connection to the shared worker, made again on every load.
      stage.cable("bank", "site", "bank", "ink");
      let moves = 0, page = "Shop", grants = 0;
      stage.on((name, data) => {
        if (name !== "site") return;
        if (data.wire === "need-port") {
          const channel = new MessageChannel();
          stage.post("feed", { cmd: "port" }, [channel.port1]);
          site.frame.contentWindow.postMessage({ cmd: "port" }, location.origin, [channel.port2]);
          stage.cable("line", "feed", "site", "teal");
          if (++grants > 1) note.say("The bank did not keep the port. This browser may not support extendedLifetime.");
        }
        if (data.wire === "tick" && data.page !== page) { page = data.page; note.say(`${moves} page change${moves === 1 ? "" : "s"}. On ${page} at update ${data.n}, ${data.gaps} missed`); }
      });
      ui.button("Go to the next page", () => { moves++; note.say("holding the port while there is no page"); site.frame.contentWindow.postMessage({ cmd: "go" }, location.origin); }, false, true);
    },
  },
  {
    pattern: "tabserver", use: [1], id: "built-files",
    title: "A website served out of this origin's private file system",
    blurb: "This tab writes three files into the Origin Private File System: a page, a stylesheet and a picture. Then it serves them. The box on the right is a real navigation to a real URL. The service worker passes each request up a port to this tab, the tab opens the file, and the <code>File</code> itself goes back down the port as the response. No server has these files. Rewrite the stylesheet and reload, and the site changes.",
    code: `<span class="c">// this tab, for each request the service worker passes up</span>
port.onmessage = async ({ data, ports: [reply] }) => {
  const name = new URL(data.url).pathname.split("/").pop() || "index.html";
  const file = await (await root.getFileHandle(name)).getFile();
  reply.postMessage({ body: file, headers: { "content-type": typeFor(name) } });
};`,
    tour: { steps: [["Write three files to the private file system", "A page, a stylesheet and a picture, written by this tab into storage only this origin can see."], ["Load the site from them", "Three requests reach the service worker. Each is answered by this tab, from a file.", 2200], ["Rewrite the stylesheet and reload", "This tab overwrites one file. The site is loaded again and looks different.", 2200]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This tab has the files");
      const server = await serveFrom(stage, "/patterns/served/files/", ui);
      const served = stage.box("served", { kind: "iframe", html: `<div class="here"><div class="box-title">/patterns/served/files/</div><p class="small muted">Nothing loaded yet.</p></div>` });
      if (!server) return;
      if (!navigator.storage?.getDirectory) return me.say("This browser has no Origin Private File System.");
      const types = { html: "text/html; charset=utf-8", css: "text/css", svg: "image/svg+xml" };
      let root = null, dark = false;
      const write = async (name, text) => { const w = await (await root.getFileHandle(name, { create: true })).createWritable(); await w.write(text); await w.close(); };
      const css = () => `body{font:15px system-ui;margin:.8rem;background:${dark ? "#0f1c3f" : "#fff8e1"};color:${dark ? "#fff" : "#0f1c3f"}}h1{font-size:1.15rem;margin:0 0 .3rem}img{width:54px;float:right}`;
      server.handle(async (url) => {
        const name = new URL(url).pathname.split("/").pop() || "index.html";
        try {
          const file = await (await root.getFileHandle(name)).getFile();
          me.say(`served ${name} from the file system, ${file.size} bytes`);
          return { body: file, headers: { "content-type": types[name.split(".").pop()] || "application/octet-stream", "cache-control": "no-store" } };
        } catch { me.say(`no file called ${name}`); return { status: 404, body: "no such file", headers: { "content-type": "text/plain" } }; }
      });
      const show = () => { served.node.innerHTML = `<iframe title="A site served from this tab's files" src="/patterns/served/files/index.html?${Date.now()}"></iframe>`; stage.cable("down", "served", "sw", "teal", "fetch"); };
      const load = ui.button("Load the site from them", show, true);
      const restyle = ui.button("Rewrite the stylesheet and reload", async () => { dark = !dark; await write("style.css", css()); me.say("overwrote style.css"); show(); }, true);
      ui.button("Write three files to the private file system", async (btn) => {
        btn.disabled = true;
        try {
          root = await (await navigator.storage.getDirectory()).getDirectoryHandle("pa-served", { create: true });
          await write("index.html", `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="style.css"><img src="flower.svg" alt="A flower"><h1>Served from a file system</h1><p>This page, its stylesheet and its picture are three files in a browser tab.</p>`);
          await write("style.css", css());
          await write("flower.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><g fill="#e0364c"><circle cx="20" cy="9" r="7"/><circle cx="31" cy="20" r="7"/><circle cx="20" cy="31" r="7"/><circle cx="9" cy="20" r="7"/></g><circle cx="20" cy="20" r="6" fill="#f5b700"/></svg>`);
        } catch (err) { return me.say("could not write: " + err.message); }
        me.say("wrote index.html, style.css and flower.svg");
        load.disabled = restyle.disabled = false;
      }, false, true);
      ui.link("Open the site in a new tab", "/patterns/served/files/index.html");
    },
  },
  {
    pattern: "tabserver", use: [2], id: "built-notes",
    title: "One tab holds the data, and the others fetch it with fetch()",
    blurb: "The notes exist in one place: an array in this tab's memory. The reader on the right is an ordinary page that calls <code>fetch(\"notes.json\")</code>, as it would against any server. The request goes to the service worker, up a port to this tab, and the answer comes back as JSON. The reader does not know its server is a tab. Add a note here, fetch again there, and it has arrived.",
    code: `<span class="c">// the reader: nothing unusual</span>
const notes = await (await fetch("notes.json")).json();

<span class="c">// this tab, which is the server</span>
port.onmessage = ({ data, ports: [reply] }) =>
  reply.postMessage({ body: JSON.stringify(notes), headers: { "content-type": "application/json" } });`,
    tour: { steps: [["Open a reader", "A real page loads, and fetches the notes. This tab answers.", 2000], ["Add a note in this tab", "The note is added to an array in this tab, and nowhere else."], ["Reader: fetch again", "The reader asks again and gets the new note.", 1600]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This tab holds the notes", `<p class="small" style="margin:0 0 .4rem">Notes in memory: <strong data-n>1</strong></p>`);
      const server = await serveFrom(stage, "/patterns/served/notes/", ui);
      const served = stage.box("served", { kind: "iframe", html: `<div class="here"><div class="box-title">A reader, in another page</div><p class="small muted">Not open yet.</p></div>` });
      if (!server) return;
      const notes = ["Water the ferns"], more = ["Order brown paper", "Ring the tulip grower", "Sweep the shop floor"];
      const reader = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{font:14px system-ui;margin:.7rem;color-scheme:light dark}h1{font-size:1rem;margin:0 0 .3rem}ul{margin:0 0 .4rem;padding-left:1.1rem}p{font:12px ui-monospace,monospace;margin:0}</style><h1>Reader</h1><ul id="list"></ul><p id="said"></p><script>
        let fetches = 0;
        const load = async () => { const response = await fetch("notes.json"); const notes = await response.json(); document.getElementById("list").replaceChildren(...notes.map((n) => Object.assign(document.createElement("li"), { textContent: n }))); document.getElementById("said").textContent = "fetch " + (++fetches) + ": " + response.status + ", " + notes.length + " notes"; };
        load(); addEventListener("message", (e) => { if (e.data === "again") load(); });
      <\/script>`;
      server.handle((url) => {
        if (new URL(url).pathname.endsWith("notes.json")) { me.say(`answered a fetch with ${notes.length} notes`); return { body: JSON.stringify(notes), headers: { "content-type": "application/json", "cache-control": "no-store" } }; }
        me.say("served the reader's own page");
        return { body: reader, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } };
      });
      const again = ui.button("Reader: fetch again", () => served.node.querySelector("iframe")?.contentWindow.postMessage("again", location.origin), true);
      ui.button("Add a note in this tab", () => { notes.push(more[(notes.length - 1) % more.length]); me.node.querySelector("[data-n]").textContent = notes.length; me.say(`added "${notes.at(-1)}"`); });
      ui.button("Open a reader", (btn) => {
        served.node.innerHTML = `<iframe title="A reader that fetches from this tab" src="/patterns/served/notes/?${Date.now()}"></iframe>`;
        stage.cable("down", "served", "sw", "teal", "fetch");
        btn.disabled = true; again.disabled = false;
      }, false, true);
      ui.link("Open a reader in a new tab", "/patterns/served/notes/");
    },
  },
  {
    pattern: "filter", use: [2], id: "built-recorder",
    title: "A recorder that gets its own copy of a stream, and cannot touch the original",
    blurb: "Orders flow from this page to a kitchen display on another origin. An auditor wants a record of every one. The page splits the stream in two with <code>tee()</code> and gives the second branch to a recorder on a third origin. The recorder sees every order and keeps them. It has no way to change, delay or drop what the kitchen receives, because it holds a different stream.",
    code: `const [forKitchen, forRecorder] = orders.tee();
kitchen.postMessage({ orders: forKitchen }, "*", [forKitchen]);
recorder.postMessage({ orders: forRecorder }, "*", [forRecorder]);`,
    tour: { steps: [["Attach the kitchen and a recorder", "The order stream is split, and each origin is handed one branch."], ["Send an order", "One order is written once. Both branches carry it."], ["Send an order", "And another."], ["Recorder: say what you hold", "The recorder reports what it kept."]] },
    async setup(stage, ui) {
      await stage.frame("kitchen", {
        title: "Kitchen display, origin one", color: "red",
        script: () => on("orders", async (data) => { log("given the order stream"); const reader = data.orders.getReader(); for (;;) { const { value, done } = await reader.read(); if (done) break; log("cook: " + value.text); } }),
      });
      const me = logBox(stage, "page", "This page takes the orders");
      await stage.frame("recorder", {
        title: "Recorder, origin two", color: "yellow",
        script: () => {
          const kept = [];
          on("orders", async (data) => { log("given a branch of a stream"); const reader = data.orders.getReader(); for (;;) { const { value, done } = await reader.read(); if (done) break; kept.push(value); log(`recorded order ${value.n}`); } });
          on("report", () => log(`I hold ${kept.length} orders, ${JSON.stringify(kept).length} bytes. The last: ${kept.at(-1)?.text || "none"}`));
        },
      });
      const menu = ["2 tulip bunches for table 4", "1 peony wreath, to collect", "3 rose buttonholes for Friday"];
      let controller = null, n = 0;
      const order = ui.button("Send an order", () => { const text = menu[n % menu.length]; controller.enqueue({ n: ++n, text }); stage.pulse("kitchen", "page"); stage.pulse("recorder", "page"); me.say(`order ${n} written once`); }, true);
      const report = ui.button("Recorder: say what you hold", () => stage.post("recorder", { cmd: "report" }), true);
      ui.button("Attach the kitchen and a recorder", (btn) => {
        const orders = new ReadableStream({ start(c) { controller = c; } });
        const [forKitchen, forRecorder] = orders.tee();
        stage.post("kitchen", { cmd: "orders", orders: forKitchen }, [forKitchen]);
        stage.post("recorder", { cmd: "orders", orders: forRecorder }, [forRecorder]);
        stage.cable("kitchen", "page", "kitchen", "red", "stream"); stage.cable("recorder", "page", "recorder", "yellow", "stream");
        me.say("split the stream and gave away both branches");
        btn.disabled = true; order.disabled = report.disabled = false;
      }, false, true);
    },
  },
  {
    pattern: "far", use: [2], id: "built-agent",
    title: "An agent on one machine, using tools that live in a browser on another",
    blurb: "This page is a shop with a basket, and it offers three tools: read the basket, add tulips, and empty it. The agent runs somewhere else. The two are paired with a code and connect directly, and the agent's side holds a port. It is sent the list of tools and calls them by name. This page decides what each name does, and refuses any name it never offered. Here a second page stands in for the agent's machine, and its buttons stand in for the agent's choices.",
    code: `<span class="c">// this browser owns the tools</span>
const tools = { readBasket: () => basket.join(", "), addTulips: () => { basket.push("tulips"); return "added"; } };
const port = await far({ code, host: true });
port.postMessage({ tools: Object.keys(tools) });
port.onmessage = ({ data }) =>
  port.postMessage(data.call in tools ? { result: tools[data.call]() } : { error: "no such tool" });`,
    tour: { steps: [["Open a line for the agent", "This page opens a meeting place and shows its code."], ["Use a stand-in for the agent's machine", "A second page plays the other machine. The two connect directly, and the tool list is sent.", 4500], ["Agent: call addTulips", "The call crosses to this browser, which runs its own tool."], ["Agent: call readBasket", "The agent reads what is in the basket."], ["Agent: call deleteAccount", "A name this page never offered. It is refused here."]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This browser has the tools", `<p class="small" data-code style="margin:0 0 .4rem" hidden></p><p class="small" style="margin:0 0 .4rem">Basket: <strong data-basket>empty</strong></p>`);
      const other = stage.box("far", { html: `<div class="here"><div class="box-title">The agent's machine</div><p class="small muted">Not connected yet.</p></div>` });
      if (!("RTCPeerConnection" in self)) return me.say("no WebRTC in this browser");
      const codeEl = me.node.querySelector("[data-code]"), basketEl = me.node.querySelector("[data-basket]");
      const basket = [];
      const show = () => (basketEl.textContent = basket.length ? `${basket.length} bunches of tulips` : "empty");
      const tools = {
        readBasket: { about: "Say what is in the basket", run: () => (basket.length ? `${basket.length} bunches of tulips` : "the basket is empty") },
        addTulips: { about: "Add a bunch of tulips", run: () => { basket.push("tulips"); show(); return "added one bunch"; } },
        emptyBasket: { about: "Take everything out", run: () => { basket.length = 0; show(); return "emptied"; } },
      };
      let line = null, code = null;
      const calls = ["addTulips", "readBasket", "deleteAccount"].map((name) => ui.button(`Agent: call ${name}`, () => stage.post("far", { cmd: "call:" + name }), true));
      const standIn = ui.button("Use a stand-in for the agent's machine", (btn) => {
        btn.disabled = true;
        other.node.innerHTML = `<iframe title="A stand-in for the agent's machine" src="/far/?embed=1#${code}"></iframe>`;
        other.frame = other.node.querySelector("iframe");
      }, true);
      ui.button("Open a line for the agent", (btn) => {
        btn.disabled = true;
        code = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
        codeEl.hidden = false;
        codeEl.innerHTML = `Code <strong>${code}</strong>. On another machine: <a href="${location.origin}/far/#${code}" target="_blank">${location.host}/far/#${code}</a>`;
        standIn.disabled = false;
        line = far({
          code, host: true,
          onState(state) { if (state === "gone") { me.say("the other machine hung up"); stage.cut("air"); for (const b of calls) b.disabled = true; } },
          onPort(port) {
            const offer = () => port.postMessage({ tools: Object.entries(tools).map(([name, tool]) => ({ name, about: tool.about })) });
            port.onmessage = ({ data }) => {
              if (data.do === "read") return offer();
              if (!data.call) return;
              stage.pulse("air", "far");
              const tool = Object.hasOwn(tools, data.call) ? tools[data.call] : null;
              if (!tool) { me.say(`refused ${data.call}: I never offered that`); return port.postMessage({ tool: data.call, error: "no such tool" }); }
              const result = tool.run();
              me.say(`ran ${data.call} for the agent: ${result}`);
              port.postMessage({ tool: data.call, result });
            };
            offer();
            stage.cable("air", "page", "far", "teal", "rtc");
            me.say("connected directly, and sent the list of tools");
            standIn.disabled = true;
            if (other.frame) for (const b of calls) b.disabled = false;
          },
        });
        const watch = setInterval(() => { if (!me.node.isConnected) { clearInterval(watch); line?.close(); } }, 1000);
      }, false, true);
    },
  },
  {
    pattern: "mounted", use: [1], id: "built-plugins",
    title: "Plug-ins that each add a page, with its own picture, to a host app",
    blurb: "The host app is a real page on this site. Two plug-ins each want to add a page to it. Each plug-in here is a sandboxed frame with an opaque origin, standing in for a frame from the plug-in maker's site. Installing a plug-in means giving the service worker a port to it, and a path. From then on, requests under that path are answered by the plug-in: its page, and the picture that page asks for. No server is asked for the plug-in's page, and nothing was uploaded. The same caution applies as for any mounted site: a plug-in's page runs as this origin.",
    code: `<span class="c">// installing a plug-in: a path, and a port to whoever will answer for it</span>
const { port1, port2 } = new MessageChannel();
pluginFrame.postMessage({ cmd: "serve" }, "*", [port1]);
serviceWorker.postMessage({ serve: true, prefix: "/app/calendar/" }, [port2]);`,
    tour: { steps: [["Install the calendar plug-in", "The service worker gets a port to the plug-in and a path to use it for. The app lists it."], ["Open the calendar's page", "A real navigation inside the app. The page and its picture come from the plug-in.", 2200], ["Install the invoices plug-in", "A second plug-in, a second port, a second path."], ["Open the invoices' page", "The other plug-in answers this one.", 2200]] },
    async setup(stage, ui) {
      const plugin = () => on("serve", (_, [port]) => {
        const name = document.querySelector("h1").textContent.split(" ")[0];
        const colour = name === "Calendar" ? "#0e9f8e" : "#e0364c";
        log("installed. Waiting for requests.");
        port.onmessage = (event) => {
          const file = new URL(event.data.url).pathname.split("/").pop() || "index.html";
          log("asked for " + file); tell("pulse", { cable: name });
          const answer = file === "icon.svg"
            ? { body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="${colour}"/><text x="20" y="27" font-size="20" text-anchor="middle" fill="#fff" font-family="system-ui">${name[0]}</text></svg>`, headers: { "content-type": "image/svg+xml", "cache-control": "no-store" } }
            : { body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{font:14px system-ui;margin:.7rem;color-scheme:light dark}h1{font-size:1.05rem;margin:0 0 .3rem}img{width:38px;float:right}</style><img src="icon.svg" alt=""><h1>${name}</h1><p>${name === "Calendar" ? "Thursday: tulip delivery. Friday: wedding order." : "Invoice 31: paid. Invoice 32: due Friday."}</p><p><a href="../">Back to the app</a></p>`, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } };
          event.ports[0].postMessage(answer);
        };
      });
      await stage.frame("Calendar", { title: "Calendar plug-in, origin one", color: "teal", script: plugin });
      const me = logBox(stage, "page", "This tab is the host app's server");
      const server = await serveFrom(stage, "/patterns/served/app/");
      await stage.frame("Invoices", { title: "Invoices plug-in, origin two", color: "red", script: plugin });
      const view = stage.box("served", { kind: "iframe", html: `<div class="here"><div class="box-title">The host app</div><p class="small muted">Not open yet.</p></div>` });
      if (!server) return;
      const installed = [];
      server.handle(() => {
        me.say("served the app's own page");
        return { body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{font:14px system-ui;margin:.7rem;color-scheme:light dark}h1{font-size:1.05rem;margin:0 0 .3rem}ul{margin:0;padding-left:1.1rem}</style><h1>Host app</h1><p>Installed plug-ins:</p><ul>${installed.map((n) => `<li><a href="${n.toLowerCase()}/">${n}</a></li>`).join("") || "<li>none yet</li>"}</ul>`, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } };
      });
      const registration = await navigator.serviceWorker.getRegistration("/patterns/served/");
      const go = (path) => { view.node.innerHTML = `<iframe title="The host app" src="/patterns/served/app/${path}?${Date.now()}"></iframe>`; stage.cable("down", "served", "sw", "teal", "fetch"); };
      const install = (name, open) => (btn) => {
        const { port1, port2 } = new MessageChannel();
        stage.post(name, { cmd: "serve" }, [port1]);
        registration.active.postMessage({ serve: true, prefix: `/patterns/served/app/${name.toLowerCase()}/` }, [port2]);
        stage.cable(name, name, "sw", name === "Calendar" ? "teal" : "red");
        installed.push(name);
        me.say(`installed ${name} at /app/${name.toLowerCase()}/`);
        btn.disabled = true; open.disabled = false;
        go("");
      };
      const openCal = ui.button("Open the calendar's page", () => go("calendar/"), true);
      const openInv = ui.button("Open the invoices' page", () => go("invoices/"), true);
      ui.button("Install the invoices plug-in", install("Invoices", openInv));
      ui.button("Install the calendar plug-in", install("Calendar", openCal), false, true);
    },
  },
  {
    pattern: "mounted", use: [2], id: "built-preview",
    title: "Preview a page whose files are kept by a storage provider on another origin",
    blurb: "A person's draft lives with a storage provider. The provider here is a sandboxed frame with an opaque origin, standing in for a frame from the provider's site. This editor wants to show it as a real page, with real relative links, and without copying the files here. So the provider is given a path. The preview on the right is a real navigation, and each file it asks for is fetched from the provider over a port as it is needed. Save a new version at the provider and reload: the preview has it, and the editor never held a file.",
    code: `<span class="c">// the storage provider, answering one request</span>
port.onmessage = ({ data, ports: [reply] }) => {
  const file = files.get(nameFrom(data.url));
  reply.postMessage(file ? { body: file.text, headers: { "content-type": file.type } } : { status: 404, body: "no such file" });
};`,
    tour: { steps: [["Mount the provider's files for preview", "The service worker gets a port to the storage provider."], ["Open the preview", "The draft loads as a real page. Its stylesheet is a second request, to the same provider.", 2200], ["Provider: save a new version", "The file changes at the provider. Nothing is sent here."], ["Reload the preview", "The preview asks again and gets the new version.", 2200]] },
    async setup(stage, ui) {
      await stage.frame("provider", {
        title: "Storage provider, another origin", color: "yellow",
        script: () => {
          let version = 1;
          const files = () => ({
            "index.html": ["text/html; charset=utf-8", `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="draft.css"><h1>Spring price list</h1><p>Draft ${version}. Tulips ${version === 1 ? "4.50" : "4.20, down this week"}.</p>`],
            "draft.css": ["text/css", "body{font:15px Georgia,serif;margin:.8rem;color-scheme:light dark}h1{font-size:1.2rem;margin:0 0 .3rem}"],
          });
          log("holding 2 files for one person");
          on("serve", (_, [port]) => {
            log("mounted for preview");
            port.onmessage = (event) => {
              const name = new URL(event.data.url).pathname.split("/").pop() || "index.html", file = files()[name];
              log(file ? `sent ${name}, version ${version}` : `no file called ${name}`); tell("pulse", { cable: "mount" });
              event.ports[0].postMessage(file ? { body: file[1], headers: { "content-type": file[0], "cache-control": "no-store" } } : { status: 404, body: "no such file", headers: { "content-type": "text/plain" } });
            };
          });
          on("save", () => { version++; log(`saved version ${version} of index.html`); });
        },
      });
      const me = logBox(stage, "page", "This page is the editor");
      const sw = logBox(stage, "sw", "Service Worker", "", { kind: "service", url: "/patterns/tabserver-sw.js", scope: "/patterns/served/" });
      const view = stage.box("served", { kind: "iframe", html: `<div class="here"><div class="box-title">Preview</div><p class="small muted">Nothing to preview yet.</p></div>` });
      if (!("serviceWorker" in navigator)) return sw.say("no Service Worker support here");
      const prefix = "/patterns/served/preview/";
      let registration = null, mounted = false;
      const mount = () => { const { port1, port2 } = new MessageChannel(); stage.post("provider", { cmd: "serve" }, [port1]); registration.active.postMessage({ serve: true, prefix }, [port2]); };
      const again = (event) => { if (!sw.node.isConnected) return navigator.serviceWorker.removeEventListener("message", again); if (event.data === "need-port" && mounted) mount(); };
      navigator.serviceWorker.addEventListener("message", again);
      const show = () => { view.node.innerHTML = `<iframe title="A preview served by the storage provider" src="${prefix}index.html?${Date.now()}"></iframe>`; stage.cable("down", "served", "sw", "teal", "fetch"); me.say("asked for the preview. I hold none of its files."); };
      const open = ui.button("Open the preview", (btn) => { show(); btn.disabled = true; save.disabled = false; }, true);
      const save = ui.button("Provider: save a new version", () => { stage.post("provider", { cmd: "save" }); reload.disabled = false; }, true);
      const reload = ui.button("Reload the preview", show, true);
      ui.button("Mount the provider's files for preview", async (btn) => {
        btn.disabled = true;
        try {
          registration = await navigator.serviceWorker.register("/patterns/tabserver-sw.js", { scope: "/patterns/served/" });
          const worker = registration.active || registration.waiting || registration.installing;
          if (worker.state !== "activated") await new Promise((resolve) => worker.addEventListener("statechange", () => worker.state === "activated" && resolve()));
        } catch (err) { return sw.say("could not start: " + err.message); }
        mounted = true; mount();
        stage.cable("mount", "provider", "sw", "yellow");
        sw.say("holding a port to the storage provider");
        open.disabled = false;
      }, false, true);
    },
  },
  {
    pattern: "socket", use: [1, 2], id: "built-feed",
    title: "One subscription feeds every tab, and one place handles reconnecting",
    blurb: "Both tabs show a live price, and neither has a connection to the server. A shared worker holds the one subscription and passes each price down a port to every tab. When the connection drops, the worker is the only thing that notices. It waits, tries again, waits longer if that fails, and carries on. The tabs contain no reconnection code at all. Drop the connection and watch them wait.",
    code: `<span class="c">// the worker: the only code that knows about the connection</span>
socket.onmessage = ({ data }) => { for (const port of tabs) port.postMessage({ price: data }); };
socket.onclose = () => setTimeout(connect, Math.min(8000, 500 * 2 ** attempt++));

<span class="c">// every tab, in full</span>
port.onmessage = ({ data }) => show(data.price);`,
    tour: { steps: [["Drop the connection", "The server hangs up on the worker. The worker waits half a second and connects again. The tabs did nothing.", 3500], ["Close tab one", "One tab goes. The subscription stays up for the other."]] },
    async setup(stage, ui) {
      const one = stage.box("tab1", { src: "/patterns/feed-tab.html", title: "Feed tab one" });
      const hub = stage.box("worker", { kind: "shared", url: "/patterns/feed-worker.js", html: `<div class="here"><div class="box-title">SharedWorker</div><p class="small" style="margin:0 0 .3rem">Connections it has made: <strong data-opened>0</strong></p><p class="small" style="margin:0 0 .3rem">Connected now: <strong data-open>no</strong></p><p class="small" style="margin:0 0 .3rem">Tabs it feeds: <strong data-tabs>none</strong></p><p class="small" data-said style="margin:0;min-height:1.4em"></p></div>` });
      const two = stage.box("tab2", { src: "/patterns/feed-tab.html", title: "Feed tab two" });
      const q = (name) => hub.node.querySelector(`[data-${name}]`);
      if (!("SharedWorker" in self)) {
        q("said").textContent = "This browser has no SharedWorker.";
        ui.unsupported("This browser does not support SharedWorker.");
        return;
      }
      const watch = new SharedWorker("/patterns/feed-worker.js").port;
      stage.cleanup(() => watch.close());
      watch.onmessage = ({ data }) => {
        if (!hub.node.isConnected) return watch.close();
        const { state } = data; if (!state) return;
        q("opened").textContent = state.opened; q("open").textContent = state.open ? "yes" : "no"; q("tabs").textContent = state.tabs.length || "none";
        q("said").textContent = state.open ? "" : state.retryIn ? `dropped. Trying again in ${(state.retryIn / 1000).toFixed(1)} s.` : "connecting";
      };
      watch.postMessage({ watch: true });
      stage.on((name, data) => { if (data.wire === "price") stage.pulse(name === "tab1" ? "c1" : "c2", "worker"); });
      await Promise.all([one.whenReady, two.whenReady]);
      stage.cable("c1", "tab1", "worker", "red");
      stage.cable("c2", "tab2", "worker", "teal");
      ui.button("Drop the connection", () => watch.postMessage({ drop: true }), false, true);
      ui.button("Close tab one", (btn) => { stage.remove("tab1"); btn.disabled = true; });
      ui.link("Open a third tab for real", "/patterns/feed-tab.html");
    },
  },
  {
    pattern: "audio", use: [1], id: "built-pcm",
    title: "A decoder worker that hands sound straight to the speakers",
    blurb: "A worker produces sound a tenth of a second at a time, as a decoder would, and moves each block of samples down a port to the audio thread. The audio thread plays them and reports how far it has got, and the worker uses that to stay about half a second ahead. This page introduced the two and holds nothing. Freeze it for three seconds and the sound carries on without a gap, because no sample ever passes through here.",
    code: `<span class="c">// the worker: stay half a second ahead of what has been played</span>
port.onmessage = ({ data }) => {
  while (sent - data.played < sampleRate / 2) {
    const block = decodeNext();                       <span class="c">// a Float32Array</span>
    port.postMessage({ block }, [block.buffer]);      <span class="c">// moved to the audio thread</span>
    sent += block.length;
  }
};`,
    tour: { steps: [["Start the decoder", "The worker and the audio thread are introduced. Blocks of sound start to flow between them."], ["Freeze this page for 3 seconds", "The page stops. The worker keeps decoding and the audio thread keeps playing.", 4200], ["Stop the sound", "The audio is closed."]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page", `<p class="small" style="margin:0 0 .4rem">Page ticks: <strong data-ticks>0</strong></p>`);
      const dec = logBox(stage, "decoder", "Decoder worker", "", { kind: "worker", url: "blob:" });
      stage.box("audio", { kind: "worklet", url: "blob:", html: `<div class="here"><div class="box-title">The audio thread</div><p class="small muted" style="margin:0">Plays whatever blocks of samples arrive on its port, and reports how many it has played.</p></div>` });
      if (!("AudioWorkletNode" in self)) {
        me.say("this browser has no AudioWorklet");
        ui.unsupported("This browser does not support AudioWorklet.");
        return;
      }
      const ticksEl = me.node.querySelector("[data-ticks]");
      let ticks = 0, audio = null, playerUrl = null;
      const PLAYER = `class Player extends AudioWorkletProcessor {
        constructor() { super(); this.queue = []; this.at = 0; this.played = 0; this.gaps = 0; this.calls = 0; this.far = null;
          this.port.onmessage = (event) => { this.far = event.ports[0]; this.far.onmessage = ({ data }) => this.queue.push(data.block); this.far.postMessage({ played: 0, gaps: 0 }); }; }
        process(inputs, outputs) {
          const out = outputs[0][0]; if (!out) return true;
          for (let i = 0; i < out.length; i++) {
            const block = this.queue[0];
            if (!block) { if (this.played) this.gaps++; break; }
            out[i] = block[this.at++]; this.played++;
            if (this.at >= block.length) { this.queue.shift(); this.at = 0; }
          }
          for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
          if (this.far && ++this.calls % 8 === 0) this.far.postMessage({ played: this.played, gaps: this.gaps });
          return true;
        }
      }
      registerProcessor("player", Player);`;
      const workerUrl = URL.createObjectURL(new Blob([`let sent = 0, blocks = 0, gaps = 0, phase = 0, t = 0;
        const tune = [262, 330, 392, 523, 392, 330, 294, 349, 440, 587, 440, 349];
        onmessage = ({ data }) => {
          if (data.count) return postMessage({ blocks, gaps });
          const port = data.port, rate = data.rate, size = Math.round(rate / 10);
          port.onmessage = ({ data: report }) => {
            gaps = report.gaps;
            while (sent - report.played < rate / 2) {
              const block = new Float32Array(size);
              for (let i = 0; i < size; i++, t++) { const note = Math.floor(t / (rate / 4)), into = (t % (rate / 4)) / rate; phase += 2 * Math.PI * tune[note % tune.length] / rate; block[i] = Math.sin(phase) * 0.25 * Math.exp(-into * 9); }
              port.postMessage({ block }, [block.buffer]);
              sent += size; blocks++;
              if (blocks % 20 === 0) postMessage({ said: "decoded " + blocks + " blocks, " + (sent / rate).toFixed(1) + " s of sound" });
            }
          };
        };`], { type: "text/javascript" }));
      const worker = new Worker(workerUrl);
      const stop = () => { audio?.close(); audio = null; worker.terminate(); if (playerUrl) { URL.revokeObjectURL(playerUrl); playerUrl = null; } };
      const beat = setInterval(() => { if (!ticksEl.isConnected) { clearInterval(beat); stop(); return; } ticksEl.textContent = ++ticks; }, 100);
      stage.cleanup(() => { clearInterval(beat); stop(); URL.revokeObjectURL(workerUrl); });
      let asked = null;
      worker.onmessage = ({ data }) => { if (data.said) return dec.say(data.said); asked?.(data); };
      const count = () => new Promise((resolve) => { asked = resolve; worker.postMessage({ count: true }); });
      const freeze = ui.button("Freeze this page for 3 seconds", async () => {
        const before = await count(), mine = ticks;
        me.say("frozen");
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
        const until = performance.now() + 3000;
        while (performance.now() < until) { /* the main thread is stuck here */ }
        const after = await count();
        me.say(`3 s frozen: I ticked ${ticks - mine} times, the worker delivered ${after.blocks - before.blocks} blocks, and the sound had ${after.gaps - before.gaps} gaps`);
      }, true);
      const resumeBtn = ui.button("Tap to resume audio", async (btn) => {
        if (!audio) return;
        try {
          await audio.resume();
          if (audio.state === "running") { btn.hidden = true; me.say("audio resumed"); }
        } catch (err) { me.say("could not resume audio: " + err.message); }
      }, false);
      resumeBtn.hidden = true;
      const quiet = ui.button("Stop the sound", (btn) => { stop(); stage.cut("pcm"); btn.disabled = freeze.disabled = true; resumeBtn.hidden = true; me.say("stopped"); }, true);
      ui.button("Start the decoder", async (btn) => {
        btn.disabled = true;
        try {
          audio = new AudioContext();
          const resuming = audio.resume();
          playerUrl = URL.createObjectURL(new Blob([PLAYER], { type: "text/javascript" }));
          await audio.audioWorklet.addModule(playerUrl);
          const node = new AudioWorkletNode(audio, "player", { outputChannelCount: [2] });
          node.connect(audio.destination);
          const { port1, port2 } = new MessageChannel();
          worker.postMessage({ port: port1, rate: audio.sampleRate }, [port1]);
          node.port.postMessage({}, [port2]);
          await Promise.race([resuming, new Promise((r) => setTimeout(r, 250))]);
        } catch (err) { btn.disabled = false; return me.say("could not start: " + err.message); }
        stage.cable("pcm", "decoder", "audio", "teal");
        if (audio.state === "running") {
          me.say("introduced the decoder to the audio thread, and kept no port");
        } else {
          resumeBtn.hidden = false;
          me.say("the browser paused audio until a real tap — press Tap to resume audio");
        }
        freeze.disabled = quiet.disabled = false;
      }, false, true);
    },
  },
  {
    pattern: "audio", use: [2], id: "built-meter",
    title: "A level meter drawn by a worker, fed from the audio thread",
    blurb: "A tone swells and fades. A processor on the audio thread measures how loud it is, twenty times a second, and posts each reading down a port. The other end is held by a worker, which draws the meter into a canvas it was handed. The readings go from the audio thread to the worker to the screen. Freeze this page and the meter keeps moving, in time with what you hear.",
    code: `<span class="c">// on the audio thread</span>
process([input]) {
  const level = Math.sqrt(input[0].reduce((sum, s) => sum + s * s, 0) / input[0].length);
  meterPort.postMessage({ level });        <span class="c">// the other end is in a worker</span>
  return true;
}`,
    tour: { steps: [["Start the tone and the meter", "The audio thread and the meter's worker are given one end each of a channel."], ["Freeze this page for 3 seconds", "The page stops. The meter does not.", 4200], ["Stop the sound", "The audio is closed."]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page", `<p class="small" style="margin:0 0 .4rem">Page ticks: <strong data-ticks>0</strong></p>`);
      stage.box("audio", { kind: "worklet", url: "blob:", html: `<div class="here"><div class="box-title">The audio thread</div><p class="small muted" style="margin:0">Measures the level of the sound passing through it, and posts each reading to a port.</p></div>` });
      const screen = stage.box("meter", { kind: "worker", url: "blob:", html: `<canvas width="300" height="170" style="width:100%;height:100%;display:block" aria-label="A level meter, drawn by a worker"></canvas>` });
      if (!("AudioWorkletNode" in self) || !("OffscreenCanvas" in self) || typeof HTMLCanvasElement.prototype.transferControlToOffscreen !== "function") {
        me.say("this browser lacks an AudioWorklet or OffscreenCanvas transfer");
        ui.unsupported("This browser lacks AudioWorklet or OffscreenCanvas transfer.");
        return;
      }
      const ticksEl = me.node.querySelector("[data-ticks]");
      let ticks = 0, audio = null, meterUrl = null;
      const METER = `class Meter extends AudioWorkletProcessor {
        constructor() { super(); this.sum = 0; this.n = 0; this.far = null; this.port.onmessage = (event) => { this.far = event.ports[0]; }; }
        process(inputs, outputs) {
          const input = inputs[0][0], out = outputs[0];
          if (!input) return true;
          for (let c = 0; c < out.length; c++) out[c].set(input);
          for (let i = 0; i < input.length; i++) this.sum += input[i] * input[i];
          this.n += input.length;
          if (this.n >= sampleRate / 20) { if (this.far) this.far.postMessage({ level: Math.sqrt(this.sum / this.n) }); this.sum = 0; this.n = 0; }
          return true;
        }
      }
      registerProcessor("meter", Meter);`;
      const css = getComputedStyle(screen.node);
      const workerUrl = URL.createObjectURL(new Blob([`let ctx = null, look = null, readings = 0, peak = 0;
        onmessage = ({ data }) => {
          if (data.count) return postMessage({ readings });
          if (data.surface) { ctx = data.surface.getContext("2d"); look = data.look; draw(0); return; }
          data.port.onmessage = ({ data: reading }) => { readings++; draw(reading.level); };
        };
        function draw(level) {
          const w = ctx.canvas.width, h = ctx.canvas.height, v = Math.min(1, level / 0.5);
          peak = Math.max(v, peak - 0.01);
          ctx.fillStyle = look.panel; ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = look.ink; ctx.font = "700 14px system-ui"; ctx.fillText("Meter worker", 14, 24);
          ctx.font = "12px ui-monospace, monospace"; ctx.fillText(readings + " readings drawn", 14, 44);
          ctx.strokeStyle = look.ink; ctx.lineWidth = 1.5; ctx.strokeRect(14, 70, w - 28, 34);
          ctx.fillStyle = v > 0.8 ? "#e0364c" : "#0e9f8e"; ctx.fillRect(16, 72, (w - 32) * v, 30);
          ctx.fillStyle = look.ink; ctx.fillRect(16 + (w - 32) * peak - 2, 68, 3, 38);
          ctx.fillText("level " + level.toFixed(3), 14, 128);
        }`], { type: "text/javascript" }));
      const worker = new Worker(workerUrl);
      const surface = screen.node.querySelector("canvas").transferControlToOffscreen();
      worker.postMessage({ surface, look: { panel: css.backgroundColor, ink: css.color } }, [surface]);
      const stop = () => { audio?.close(); audio = null; if (meterUrl) { URL.revokeObjectURL(meterUrl); meterUrl = null; } };
      const beat = setInterval(() => { if (!ticksEl.isConnected) { clearInterval(beat); stop(); worker.terminate(); return; } ticksEl.textContent = ++ticks; }, 100);
      stage.cleanup(() => { clearInterval(beat); stop(); worker.terminate(); URL.revokeObjectURL(workerUrl); });
      const count = () => new Promise((resolve) => { worker.onmessage = ({ data }) => resolve(data.readings); worker.postMessage({ count: true }); });
      const freeze = ui.button("Freeze this page for 3 seconds", async () => {
        const before = await count(), mine = ticks;
        me.say("frozen");
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
        const until = performance.now() + 3000;
        while (performance.now() < until) { /* the main thread is stuck here */ }
        me.say(`3 s frozen: I ticked ${ticks - mine} times, the worker drew ${(await count()) - before} readings`);
      }, true);
      const resumeBtn = ui.button("Tap to resume audio", async (btn) => {
        if (!audio) return;
        try {
          await audio.resume();
          if (audio.state === "running") { btn.hidden = true; me.say("audio resumed"); }
        } catch (err) { me.say("could not resume audio: " + err.message); }
      }, false);
      resumeBtn.hidden = true;
      const quiet = ui.button("Stop the sound", (btn) => { stop(); stage.cut("levels"); btn.disabled = freeze.disabled = true; resumeBtn.hidden = true; me.say("stopped"); }, true);
      ui.button("Start the tone and the meter", async (btn) => {
        btn.disabled = true;
        try {
          audio = new AudioContext();
          const resuming = audio.resume();
          meterUrl = URL.createObjectURL(new Blob([METER], { type: "text/javascript" }));
          await audio.audioWorklet.addModule(meterUrl);
          const tone = new OscillatorNode(audio, { frequency: 220 }), swell = new GainNode(audio, { gain: 0.3 });
          const slow = new OscillatorNode(audio, { frequency: 0.4 }), depth = new GainNode(audio, { gain: 0.28 });
          slow.connect(depth).connect(swell.gain);
          const node = new AudioWorkletNode(audio, "meter", { outputChannelCount: [2] }), volume = new GainNode(audio, { gain: 0.4 });
          tone.connect(swell).connect(node).connect(volume).connect(audio.destination);
          tone.start(); slow.start();
          const { port1, port2 } = new MessageChannel();
          worker.postMessage({ port: port1 }, [port1]);
          node.port.postMessage({}, [port2]);
          await Promise.race([resuming, new Promise((r) => setTimeout(r, 250))]);
        } catch (err) { btn.disabled = false; return me.say("could not start: " + err.message); }
        stage.cable("levels", "audio", "meter", "teal");
        if (audio.state === "running") {
          me.say("introduced the audio thread to the meter's worker, and kept no port");
        } else {
          resumeBtn.hidden = false;
          me.say("the browser paused audio until a real tap — press Tap to resume audio");
        }
        freeze.disabled = quiet.disabled = false;
      }, false, true);
    },
  },
  swRouter,
  ...built2,
  ...further,
  ...pairBuilt,
];

// Ideas that are already what a demo on the site does. key: "pattern:index".
export const shown = {
  "health-pair:0": ["#demo", "the demo at the top of this page"],
  "health-pair:1": ["/patterns/alive-restart/", "a worker restarted when it stops answering"],
  "health-back:0": ["#demo", "the demo at the top of this page"],
  "health-beats:0": ["#demo", "the demo at the top of this page"],
  "alive-signals:0": ["#demo", "the demo at the top of this page"],
  "alive-restart:0": ["#demo", "the demo at the top of this page"],
  "canvas:2": ["#demo", "the demo at the top of this page"],
  "tearoff:0": ["#demo", "the demo at the top of this page"],
  "tabserver:0": ["#demo", "the demo at the top of this page"],
  "stream-intro:0": ["#demo", "the demo at the top of this page"],
  "pipeline:1": ["#demo", "the demo at the top of this page"],
  "reload:1": ["#demo", "the demo at the top of this page"],
  "signer:0": ["#demo", "the demo at the top of this page"],
  "keycopy:0": ["#demo", "the demo at the top of this page"],
  "keycopy:2": ["/patterns/signer/", "the signer, which sends a port instead"],
  "halves:0": ["#demo", "the demo at the top of this page"],
  "lend:0": ["#demo", "the demo at the top of this page"],
  "far:0": ["#demo", "the demo at the top of this page"],
  "mounted:0": ["#demo", "the demo at the top of this page"],
  "socket:0": ["#demo", "the demo at the top of this page"],
  "frozen:2": ["/patterns/frozen/#built-relay", "a decoder worker handing frames to a renderer worker"],
  "audio:0": ["#demo", "the demo at the top of this page"],
  "oneway:0": ["#demo", "the demo at the top of this page"],
};
