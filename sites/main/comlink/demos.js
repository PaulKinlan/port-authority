// The live demos on /comlink/. Every frame is a real page on another origin
// (/comlink/peer.html, served by each demo site), reached over a port that was
// offered to that exact origin.
import { sites } from "/_sites.js";
import { wrap, offer, port, closed } from "/hawser.js";
import * as Comlink from "/vendor/comlink.mjs";

const DISPOSE = Symbol.dispose ?? Symbol.for("Symbol.dispose");

// One demo's furniture: a log for this page, frames for the other origins,
// and a row of buttons.
function build(section) {
  const el = section.querySelector(".demo");
  el.innerHTML = `<div class="stage"></div><div class="controls"></div>`;
  const stage = el.querySelector(".stage"), controls = el.querySelector(".controls");
  const here = document.createElement("div");
  here.className = "box";
  here.dataset.name = "page";
  here.innerHTML = `<div class="here"><h4>This page</h4><ul class="log"></ul></div>`;
  stage.append(here);
  const list = here.querySelector("ul");
  const kit = {
    say(text, slot) {
      let li = slot && list.querySelector(`[data-slot="${slot}"]`);
      if (!li) { li = document.createElement("li"); if (slot) li.dataset.slot = slot; }
      li.textContent = text;
      list.prepend(li);
      while (list.children.length > 7) list.lastChild.remove();
    },
    // Add a frame from another origin and resolve once it is listening.
    frame(name, site, title, color) {
      const box = document.createElement("div");
      box.className = "box";
      box.dataset.name = name;
      const frame = document.createElement("iframe");
      frame.title = title;
      const ready = new Promise((resolve) => {
        const listener = (event) => {
          if (event.source !== frame.contentWindow || event.origin !== sites[site] || !event.data?.peer) return;
          removeEventListener("message", listener);
          resolve();
        };
        addEventListener("message", listener);
      });
      frame.src = `${sites[site]}/comlink/peer.html?title=${encodeURIComponent(title)}&color=${color}`;
      box.append(frame);
      stage.append(box);
      return ready.then(() => ({
        // A fresh private channel to the frame, speaking the library asked for.
        line: (lib) => offer(frame.contentWindow, sites[site], { lib }),
        remove() { frame.remove(); box.classList.add("gone"); },
      }));
    },
    button(label, fn, { disabled = false, accent = false } = {}) {
      const b = document.createElement("button");
      b.className = "tiny " + (accent ? "accent" : "quiet");
      b.textContent = label; b.disabled = disabled;
      b.onclick = () => fn(b);
      controls.append(b);
      return b;
    },
  };
  return kit;
}

// An endpoint that counts what goes out through it.
function counted(messagePort) {
  const tally = { sent: 0 };
  return {
    tally,
    endpoint: {
      postMessage: (message, transfer) => { tally.sent++; messagePort.postMessage(message, transfer); },
      addEventListener: (...a) => messagePort.addEventListener(...a),
      removeEventListener: (...a) => messagePort.removeEventListener(...a),
      start: () => messagePort.start(),
    },
  };
}

const demos = {
  async gone(kit) {
    const peer = await kit.frame("peer", "florist", "A frame on another origin", "teal");
    const old = Comlink.wrap(peer.line("comlink"));
    const api = wrap(peer.line("hawser"), { heartbeat: 1000 });
    let asked = 0, timer;
    const remove = kit.button("Remove the frame", (b) => { b.disabled = true; asked = performance.now(); peer.remove(); }, { disabled: true });
    kit.button("Ask both a slow question", (b) => {
      b.disabled = true; remove.disabled = false;
      const started = performance.now();
      let comlinkDone = false;
      old.slow(8000).then((v) => { comlinkDone = true; kit.say(`Comlink: ${v}`, "comlink"); });
      api.slow(8000).then(
        (v) => kit.say(`Hawser: ${v}`, "hawser"),
        (e) => kit.say(`Hawser: rejected with ${e.name}, ${Math.round(performance.now() - asked)} ms after the frame went (${/stopped answering/.test(e.message) ? "noticed by the heartbeat" : /closed this link/.test(e.message) ? "the frame said goodbye as it went" : "noticed by the port close event"})`, "hawser"),
      );
      kit.say("Hawser: waiting", "hawser");
      timer = setInterval(() => {
        if (comlinkDone || !document.contains(remove)) return clearInterval(timer);
        kit.say(`Comlink: still waiting, ${Math.round((performance.now() - started) / 1000)}s`, "comlink");
      }, 1000);
      kit.say("Comlink: waiting", "comlink");
    }, { accent: true });
  },

  async cancel(kit) {
    const peer = await kit.frame("peer", "library", "A frame on another origin", "red");
    const api = wrap(peer.line("hawser"));
    let controller;
    const stop = kit.button("Cancel it", (b) => { b.disabled = true; controller.abort(new DOMException("the user pressed cancel", "AbortError")); }, { disabled: true });
    kit.button("Start a long job", async (b) => {
      b.disabled = true; stop.disabled = false;
      controller = new AbortController();
      kit.say("asked the frame to count to 20");
      try { kit.say(await api.count(20, controller.signal)); }
      catch (error) { kit.say(`rejected here with ${error.name}: ${error.message}`); }
      b.disabled = false; stop.disabled = true;
    }, { accent: true });
  },

  async chain(kit) {
    const peer = await kit.frame("peer", "florist", "A frame on another origin", "teal");
    const newLine = counted(peer.line("hawser"));
    const old = Comlink.wrap(peer.line("comlink"));
    const api = wrap(newLine.endpoint);
    kit.button("Hawser: one expression", async () => {
      newLine.tally.sent = 0;
      const title = await api.open("ideas").latest().title();
      kit.say(`Hawser: "${title}" with ${newLine.tally.sent} message sent, on 1 port`);
    }, { accent: true });
    kit.button("Comlink: three awaits", async () => {
      const notebook = await old.open("ideas");
      const note = await notebook.latest();
      const title = await note.title();
      kit.say(`Comlink: "${title}" after 3 round trips, on 3 ports`);
    });
  },

  async ticks(kit) {
    const peer = await kit.frame("peer", "library", "A frame on another origin", "red");
    const api = wrap(peer.line("hawser"));
    let wanted = false;
    const stop = kit.button("Stop reading", (b) => { b.disabled = true; wanted = false; }, { disabled: true });
    kit.button("Start reading ticks", async (b) => {
      b.disabled = true; stop.disabled = false; wanted = true;
      for await (const tick of api.ticks()) {
        kit.say(`read tick ${tick}`);
        if (!wanted) break;
      }
      kit.say("left the loop");
      b.disabled = false;
    }, { accent: true });
  },

  async narrow(kit) {
    const [owner, guest] = await Promise.all([
      kit.frame("owner", "florist", "Owner of a counter", "teal"),
      kit.frame("guest", "library", "Guest", "red"),
    ]);
    const api = wrap(owner.line("hawser"));
    const guestApi = wrap(guest.line("hawser"));
    let revoke;
    const buttons = [];
    kit.button("Add one as this page", async () => kit.say(`this page added, now ${await api.counter.add()}`));
    kit.button("Give the guest a read-only port", async (b) => {
      b.disabled = true;
      revoke = new AbortController();
      const minted = await port(api.counter, { only: ["read"], signal: revoke.signal });
      await guestApi.take(minted);
      kit.say("minted a port for counter.read and passed it on");
      for (const button of buttons) button.disabled = false;
    }, { accent: true });
    buttons.push(
      kit.button("Guest reads", async () => kit.say(`guest says: ${await guestApi.tryRead()}`), { disabled: true }),
      kit.button("Guest tries to add", async () => kit.say(`guest says: ${await guestApi.tryAdd()}`), { disabled: true }),
      kit.button("Revoke", (b) => { b.disabled = true; revoke.abort(); kit.say("revoked the guest's port"); }, { disabled: true }),
    );
  },

  async using(kit) {
    const peer = await kit.frame("peer", "florist", "A frame on another origin", "teal");
    const api = wrap(peer.line("hawser"));
    const names = ["ada", "grace", "hedy", "joan"], sessions = [];
    const leave = kit.button("Leave one scope", (b) => {
      const session = sessions.shift();
      session.remote[DISPOSE]();
      kit.say(`disposed of ${session.name}'s session`);
      b.disabled = !sessions.length;
    }, { disabled: true });
    const close = kit.button("Close the whole link", (b) => { b.disabled = leave.disabled = open.disabled = true; api[DISPOSE](); kit.say("closed the link"); }, { disabled: true });
    const open = kit.button("Open a session", async () => {
      const name = names[(sessions.length + Math.floor(Math.random() * 4)) % 4];
      const remote = await new api.Session(name);
      sessions.push({ name, remote });
      kit.say(`holding a session for ${await remote.who()}`);
      leave.disabled = close.disabled = false;
    }, { accent: true });
    closed(api).then(() => kit.say("link is closed"));
  },
};

// Start each demo when it scrolls near, so a dozen frames do not boot at once.
export function mountAll() {
  for (const section of document.querySelectorAll("section[data-demo]")) {
    const start = async () => {
      const kit = build(section);
      await demos[section.dataset.demo](kit);
      const again = kit.button("Start again", start);
      again.classList.add("reset");
      section.dataset.ready = "true";
    };
    new IntersectionObserver((entries, io) => { if (entries[0].isIntersecting) { io.disconnect(); start(); } }, { rootMargin: "300px" }).observe(section);
  }
}
