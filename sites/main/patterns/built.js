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
  {
    pattern: "introduce", use: [1, 2], id: "built-wire",
    title: "Two vendors' widgets, wired together by the page that embeds them",
    blurb: "A list of places from one vendor and a map from another, each in its own frame on its own origin. Neither has heard of the other and neither loads the other's code. The page that embeds them makes a channel, gives each widget an end, and is finished. Pick a place in the list and the map moves, with nothing passing through the page.",
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
    title: "A chain of delegation, where each link gives away less",
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
      const boxes = names.map((name) => stage.box(name, { src: "/patterns/crew.html" }));
      if (!("SharedWorker" in self)) return;
      let leader = null;
      stage.on((name, data) => { if (data.wire === "crew" && data.lead) leader = name; });
      await Promise.all(boxes.map((box) => box.whenReady));
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
    blurb: "The plug-in is a frame on another origin. Each frame of this page's video is handed to it, it draws a caption and a watermark on top, and hands the frame back. It has no access to the camera, the page or the network path the video came from. It is given a picture, and it returns a picture.",
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
          port.onmessage = ({ data }) => {
            if (data.caption) { caption = data.caption; return log("caption: " + caption); }
            const frame = data.frame;
            if (!canvas) { canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight); ctx = canvas.getContext("2d"); }
            const { width: w, height: h } = canvas;
            ctx.drawImage(frame, 0, 0);
            const timestamp = frame.timestamp;
            frame.close();
            ctx.fillStyle = "rgba(0,0,0,.65)"; ctx.fillRect(0, h - 38, w, 38);
            ctx.fillStyle = "#fff"; ctx.font = "600 17px system-ui"; ctx.textAlign = "center"; ctx.fillText(caption, w / 2, h - 13);
            ctx.textAlign = "right"; ctx.font = "700 12px system-ui"; ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.fillText("PORT AUTHORITY", w - 10, 18);
            const out = new VideoFrame(canvas, { timestamp });
            send(port, "back", { frame: out }, [out]);
            if (++done % 30 === 0) log(`captioned ${done} frames, kept none`);
          };
        }),
      });
      const out = stage.box("out", { html: `<canvas width="320" height="180" style="width:100%;height:100%;display:block" aria-label="The video after the plug-in"></canvas>` });
      const source = src.node.querySelector("canvas"), sctx = source.getContext("2d");
      const octx = out.node.querySelector("canvas").getContext("2d");
      if (!("VideoFrame" in self)) { src.node.insertAdjacentHTML("beforeend", `<p class="small" style="position:absolute;inset:auto 0 0 0;padding:.5rem;background:var(--panel)">This browser has no VideoFrame.</p>`); return; }
      let running = false, waiting = false, n = 0;
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
          const frame = new VideoFrame(source, { timestamp: Math.round(t * 1000) });
          channel.port1.postMessage({ frame }, [frame]); frame.close();
          waiting = true;
          if (n++ % 8 === 0) stage.pulse("there", "page");
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      channel.port1.onmessage = ({ data }) => { octx.drawImage(data.frame, 0, 0); data.frame.close(); waiting = false; };
      stage.post("plugin", { cmd: "port" }, [channel.port2]);
      stage.cable("there", "page", "plugin", "yellow");
      stage.cable("back", "plugin", "out", "yellow");
      const captions = ["Roses arrive on Thursday", "Peonies: three left", "Tulips are in season"];
      let c = 0;
      const change = ui.button("Change the caption", () => channel.port1.postMessage({ caption: captions[c++ % captions.length] }), true);
      ui.button("Start the video", (btn) => { running = true; btn.disabled = true; change.disabled = false; }, false, true);
    },
  },
  {
    pattern: "zerocopy", use: [0, 2], id: "built-pool",
    title: "Two buffers that go back and forth all day, and are never copied",
    blurb: "A worker needs somewhere to put each result, and making a fresh 8 MB buffer every time is wasteful. This page makes two, once. One goes to the worker, which fills it and sends it back, while the other is being read here. Then they swap. The counters show megabytes moved climbing and megabytes copied staying at zero.",
    code: `const pool = [new ArrayBuffer(SIZE), new ArrayBuffer(SIZE)];
worker.onmessage = ({ data }) => {
  use(data.buffer);                            <span class="c">// read the result</span>
  worker.postMessage({ buffer: data.buffer }, [data.buffer]);   <span class="c">// and send the same memory back</span>
};
for (const buffer of pool) worker.postMessage({ buffer }, [buffer]);`,
    tour: { steps: [["Start the pool", "Two buffers are made once, and then only moved.", 3500], ["Stop", "The pool stops. Two buffers were ever made."]] },
    async setup(stage, ui) {
      const me = stage.box("page", { html: `<div class="here"><h4>This page</h4><p class="small" style="margin:0 0 .25rem">Buffers ever made: <strong data-made>0</strong></p><p class="small" style="margin:0 0 .25rem">Round trips: <strong data-trips>0</strong></p><p class="small" style="margin:0 0 .25rem">Moved: <strong data-moved>0</strong> MB</p><p class="small" style="margin:0 0 .25rem">Copied: <strong>0</strong> MB</p><p class="small" style="margin:0">Held here right now: <strong data-held>0</strong> MB</p></div>` });
      const wbox = logBox(stage, "worker", "Worker");
      const q = (name) => me.node.querySelector(`[data-${name}]`);
      const SIZE = 8 * 1024 * 1024;
      const worker = new Worker(URL.createObjectURL(new Blob([`onmessage = ({ data }) => { new Uint8Array(data.buffer).fill(data.n % 251); postMessage({ buffer: data.buffer, n: data.n }, [data.buffer]); };`], { type: "text/javascript" })));
      let running = false, trips = 0, n = 0, held = 0;
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
parent.postMessage({ seal }, "*", [seal.readable, seal.writable]);

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
          parent.postMessage({ wire: "pipes", seal: { readable: seal.readable, writable: seal.writable }, open: { readable: open.readable, writable: open.writable } }, "*", [seal.readable, seal.writable, open.readable, open.writable]);
        }),
      });
      const out = logBox(stage, "out", "What came back opened");
      const lines = ["Deliver to 14 Mill Lane, back door", "The safe code is 4471", "Mum's birthday: peonies"];
      let pipes = null, i = 0;
      stage.on((name, data) => {
        if (name !== "cipher" || data.wire !== "pipes") return;
        pipes = { sealIn: data.seal.writable.getWriter(), sealOut: data.seal.readable.getReader(), openIn: data.open.writable.getWriter(), openOut: data.open.readable.getReader() };
        stage.cable("seal", "page", "cipher", "yellow");
        stage.cable("open", "cipher", "out", "teal");
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
    title: "Hand a worker 64 MB without ever holding 64 MB",
    blurb: "This page produces a large file a megabyte at a time and gives the worker a stream of it. The worker reads, adds up a checksum and asks for more. The page makes the next megabyte only when asked, so neither side ever holds more than a chunk or two. The progress bar needs no extra messages: the chunks arriving are the progress.",
    code: `const file = new ReadableStream({ pull(controller) {
  made < TOTAL ? controller.enqueue(nextMegabyte()) : controller.close();   <span class="c">// only when asked</span>
} });
worker.postMessage({ file }, [file]);

<span class="c">// the worker</span>
for await (const chunk of file) { sum = checksum(sum, chunk); postMessage({ read: chunk.length }); }`,
    tour: { steps: [["Stream 64 MB to the worker", "The worker is handed a stream. Each megabyte is made when the worker asks for it, and checked as it lands.", 6000]] },
    async setup(stage, ui) {
      const me = stage.box("page", { html: `<div class="here"><h4>This page makes the file</h4><div style="height:.7rem;border:1.5px solid currentColor;border-radius:99px;overflow:hidden;margin:0 0 .5rem"><div data-bar style="height:100%;width:0;background:var(--teal)"></div></div><p class="small" style="margin:0 0 .25rem">Made so far: <strong data-made>0</strong> MB</p><p class="small" style="margin:0">Most held at once: <strong data-peak>0</strong> MB</p></div>` });
      const wbox = logBox(stage, "worker", "Worker checks it");
      const q = (name) => me.node.querySelector(`[data-${name}]`);
      const worker = new Worker(URL.createObjectURL(new Blob([`onmessage = async ({ data }) => {
        const reader = data.file.getReader(); let bytes = 0, sum = 0;
        for (;;) { const { value, done } = await reader.read(); if (done) break; for (let i = 0; i < value.length; i += 4096) sum = (sum + value[i]) >>> 0; bytes += value.length; postMessage({ bytes }); await new Promise((r) => setTimeout(r, 25)); }
        postMessage({ done: true, bytes, sum });
      };`], { type: "text/javascript" })));
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
        worker.postMessage({ file }, [file]);
        stage.cable("file", "page", "worker", "teal");
        wbox.say("given a stream, reading");
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
    blurb: "Giving a key away is permanent, and sometimes that is what you want. This page makes a signing key and posts it to its own worker, then drops its copy. From here on the page cannot sign anything by itself. A script injected into the page finds no key to use. It can only ask the worker, which can say no.",
    code: `const { privateKey, publicKey } = await crypto.subtle.generateKey(ECDSA, false, ["sign", "verify"]);
worker.postMessage({ key: privateKey });     <span class="c">// a copy goes to the worker</span>
<span class="c">// let the page's copy go out of scope: the worker now holds the only one</span>

worker.postMessage({ sign: "order 1" });     <span class="c">// the page can ask</span>`,
    tour: { steps: [["Make a key and give it to the worker", "The page makes a key nobody can read, posts it to its worker and forgets it."], ["Ask the worker to sign", "The worker signs. This page checks the signature with the public half."], ["Page: try to sign by itself", "The page has no key any more."]] },
    async setup(stage, ui) {
      const me = logBox(stage, "page", "This page");
      const wbox = logBox(stage, "worker", "This page's worker");
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
    blurb: "This page has a cart with three methods: add, clear and total. A badge from another origin needs the total. It is given a port that calls <code>cart.total()</code> and nothing else. The badge can ask for the total as often as it likes. It cannot add, and it cannot clear, because those methods are not on the wire it holds.",
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
    blurb: "Twelve lines turn the reply pattern into <code>await call(\"add\", 2, 3)</code>. Each call makes a channel, sends one end with the question, and returns a promise that settles when the other end speaks. Errors come back as rejections. Three calls made at once come back to the right callers, even when the slow one finishes last, because each has its own wire.",
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
];

// Ideas that are already what a demo on the site does. key: "pattern:index".
export const shown = {
  "hello:1": ["/patterns/introduce/", "every other pattern starts this way"],
  "introduce:0": ["/hub/", "the hub on this site"],
  "functions:2": ["/comlink/", "the Comlink page"],
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
  "filter:1": ["/patterns/frozen/", "two workers that keep going while the page is frozen"],
};
