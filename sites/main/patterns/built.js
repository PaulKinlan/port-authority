// The ideas listed under "What you could build with it", built.
// Each entry names the pattern it belongs to and which of that pattern's
// ideas it covers (by position in deep.js). Same stage as the patterns.
import { far } from "/farport.js";

const logBox = (stage, name, title, extra = "") => {
  const box = stage.box(name, { html: `<div class="here"><h4>${title}</h4>${extra}<ul class="log"></ul></div>` });
  const ul = box.node.querySelector("ul");
  const say = (text) => { const li = document.createElement("li"); li.textContent = text; ul.prepend(li); while (ul.children.length > 6) ul.lastChild.remove(); };
  return { say, node: box.node, box };
};

export const built = [
  {
    pattern: "canvas", use: [0], id: "built-chart",
    title: "A chart drawn by another origin, inside your layout",
    blurb: "The chart maker is a site on another origin. This page gives it the drawing surface of one canvas and a port, and sends it numbers. The bars you see are drawn by the chart maker straight into this page. It never sees the page, and this page never loads its code.",
    code: `const surface = canvas.transferControlToOffscreen();
chartMaker.postMessage({ surface, numbers }, [surface]);
<span class="c">// later, new figures: the chart redraws itself</span>
chartMaker.postMessage({ numbers: [12, 30, 22, 41, 17] });`,
    tour: { steps: [["Give the chart maker the canvas", "The canvas's drawing surface and the first numbers go to the other origin. It draws the bars into this page."], ["Send new numbers", "This page posts new figures. The chart maker animates to them.", 2600], ["Send new numbers", "And again. Only numbers go one way, and only pixels come back."]] },
    async setup(stage, ui) {
      const box = stage.box("page", { html: `<canvas width="460" height="230" style="width:100%;height:100%;display:block" aria-label="A chart in this page, drawn by another origin"></canvas>` });
      const canvas = box.node.querySelector("canvas");
      await stage.frame("maker", {
        title: "Chart maker on another origin", color: "teal",
        script: () => on("port", (_, [port]) => {
          let ctx = null, shown = [], target = [];
          const draw = () => {
            const { width: w, height: h } = ctx.canvas;
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
            requestAnimationFrame(draw);
          };
          port.onmessage = ({ data }) => {
            if (data.surface) { ctx = data.surface.getContext("2d"); log("holding a canvas. I cannot see the page it is in."); requestAnimationFrame(draw); }
            if (data.numbers) { target = data.numbers; log("drew " + data.numbers.join(", ")); tell("pulse", { cable: "line" }); }
          };
        }),
      });
      const channel = new MessageChannel();
      stage.post("maker", { cmd: "port" }, [channel.port2]);
      stage.cable("line", "page", "maker", "teal");
      const numbers = () => Array.from({ length: 5 }, () => 5 + Math.floor(Math.random() * 44));
      const again = ui.button("Send new numbers", () => { channel.port1.postMessage({ numbers: numbers() }); stage.pulse("line", "page"); }, true);
      ui.button("Give the chart maker the canvas", (btn) => {
        const surface = canvas.transferControlToOffscreen();
        channel.port1.postMessage({ surface, numbers: numbers() }, [surface]);
        stage.pulse("line", "page");
        btn.disabled = true; again.disabled = false;
      }, false, true);
    },
  },
  {
    pattern: "attenuate", use: [1], id: "built-expiry",
    title: "Access that runs out after eight seconds",
    blurb: "The owner lends the guest a port to its diary, and starts a clock. While the clock runs, the guest's questions are answered. When it stops, the owner closes its end. The guest still holds a port. Nothing comes back from it. There was no token to expire and no session to clean up: the permission was the wire, and the wire is gone.",
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
    blurb: "The reply port does not have to carry one answer. This page asks a slow service for a job and keeps the reply port open. Progress arrives on it, ten per cent at a time. To cancel, this page says so on the same port and closes it. The service stops work, because the only party that wanted the result has let go of the wire.",
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
    blurb: "Two bidders on two origins each get something to write into, and nothing to read from. Their bids land in this page. Neither can see the other's bid, or even whether the other has bid. When the owner closes the box, both writers are refused from then on. A sealed auction with no server and no trust between the bidders.",
    code: `const slot = (who) => new WritableStream({
  start(controller) { slots.push(controller); },
  write(bid) { bids.push({ who, bid }); },
});
bidderOne.postMessage({ slot: slot("one") }, "*", [slot]);   <span class="c">// write only</span>
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
        for (const who of ["one", "two"]) {
          const slot = new WritableStream({ start(controller) { slots.push(controller); }, write(amount) { bids.push({ who, amount }); owner.say(`bidder ${who} bid ${amount}`); } });
          stage.post(who, { cmd: "slot", slot }, [slot]);
          stage.cable(who, who, "page", who === "one" ? "red" : "teal");
        }
        owner.say("gave out two slots, kept what they lead to");
        btn.disabled = true; b1.disabled = b2.disabled = close.disabled = false;
      }, false, true);
    },
  },
  {
    pattern: "functions", use: [0], id: "built-listener",
    title: "An event listener that lives on another origin",
    blurb: "<code>addEventListener</code> takes a function, and a function cannot cross origins. A port can. This page listens to its own button and posts each press down a port. The analytics frame on another origin counts presses of a button it cannot see, in a page it cannot read. Close the port and it is unsubscribed, whether it likes it or not.",
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
      const stop = ui.button("Stop writing", (btn) => { clearInterval(timer); try { feed.close(); } catch {} btn.disabled = true; start.disabled = false; me.say("stopped, and closed the stream"); }, true);
      const start = ui.button("Stream an answer to the viewer", (btn) => {
        let i = 0;
        const answer = new ReadableStream({ start(controller) { feed = controller; } });
        timer = setInterval(() => {
          if (!me.node.isConnected) return clearInterval(timer);
          if (i >= text.length) { clearInterval(timer); feed.close(); stop.disabled = true; btn.disabled = false; return me.say("finished the answer"); }
          feed.enqueue(text[i++]);
        }, 110);
        stage.post("viewer", { cmd: "answer", answer }, [answer]);
        stage.cable("answer", "page", "viewer", "yellow");
        me.say("handed over a stream, now writing into it");
        btn.disabled = true; stop.disabled = false;
      }, false, true);
    },
  },
  {
    pattern: "signer", use: [2], id: "built-cap",
    title: "A wallet the shop can charge, up to a limit you set",
    blurb: "The wallet is a frame on its own origin that pays whoever asks down its port. This page holds that port and does not pass it on. It gives the shop a port of its own, and forwards a charge to the wallet only if the running total stays under fifty. The shop cannot go around it, because the only wire the shop has ends in this page.",
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
      const phone = stage.box("far", { html: `<div class="here"><h4>Your phone</h4><p class="small muted">Not connected yet.</p></div>` });
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
            stage.cable("air", "page", "far", "teal");
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
    title: "A logger that can hear a connection and cannot speak on it",
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
      const give = ui.button("Give the logger the listening half", (btn) => {
        writer = line.writable.getWriter();
        stage.post("logger", { cmd: "tap", readable: line.readable }, [line.readable]);
        stage.cable("tap", "page", "logger", "teal");
        me.say("gave away the readable, kept the writable");
        btn.disabled = true; say.disabled = speak.disabled = false;
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
];
