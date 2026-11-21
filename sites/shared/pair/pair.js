// A page of one site whose service worker talks to the service worker of
// another site. This file is served on every demo site at /pair/.
//
// The page does three small jobs, and none of the talking:
//   1. it holds a line to a page of the other site (a MessagePort),
//   2. when its worker hands it a port, it sends that port down the line,
//   3. when a port comes up the line, it gives that port to its worker.
//
// Embedded in a diagram on port-authority.dev it is told what to do by the
// page around it. Opened in a tab of its own it has buttons, and it opens the
// other site in a real window.
import { runtime } from "/wire.js";
import { sites } from "/_sites.js";

const params = new URLSearchParams(location.search);
const SITE = location.hostname.split(".")[0].replace(/^pa-/, "");
const OTHER = params.get("with") || (SITE === "florist" ? "library" : "florist");
const ITEM = { library: "Dune", florist: "tulips" }[OTHER] || "Dune";
const role = params.get("role") || "page";
const framed = self !== top;
const $ = (id) => document.getElementById(id);
const name = (site) => `the ${site}`;

$("title").textContent = params.get("title") || `${SITE[0].toUpperCase()}${SITE.slice(1)}'s page`;
$("title").style.setProperty("--dot", params.get("color") || { florist: "#e0364c", library: "#0e9f8e" }[SITE] || "#f5b700");
$("origin").textContent = location.host;
runtime();

const cmds = {};
const cmd = (label, fn) => { cmds[label] = fn; on(label, fn); };

// ---- a third site that introduces two pages it can reach, and keeps nothing

if (role === "intro") {
  // Told which of the frames beside it are the two sites. A frame can post to
  // the frames beside it, and the address on each message means only that
  // site can receive it.
  cmd("introduce", (data) => {
    const { port1, port2 } = new MessageChannel();
    parent.frames[data.a.frame].postMessage({ pair: "adopt", from: data.b.site }, sites[data.a.site], [port1]);
    parent.frames[data.b.frame].postMessage({ pair: "adopt", from: data.a.site }, sites[data.b.site], [port2]);
    log(`made a channel. Posted one port to ${name(data.a.site)}'s page and the other to ${name(data.b.site)}'s page. I kept neither`);
    tell("introduced");
  });
} else start();

async function start() {
  if (!("serviceWorker" in navigator)) return log("this browser has no service worker");
  let registration;
  try {
    registration = await navigator.serviceWorker.register("/pair-sw.js", { scope: "/pair/" });
    const worker = registration.active || registration.waiting || registration.installing;
    if (worker.state !== "activated") await new Promise((resolve) => worker.addEventListener("statechange", () => worker.state === "activated" && resolve()));
  } catch (err) { return log("could not start my service worker: " + err.message); }
  // Posting to a service worker starts it if the browser had stopped it.
  const worker = () => registration.active;

  let trunk = null, trunkTo = null;    // my line to a page of the other site
  let line = null;                     // a port of my own to the other site's worker
  let otherWindow = null;
  let lastRun = null;

  const setTrunk = (port, to) => {
    trunk?.close();
    trunk = port; trunkTo = to;
    port.onmessage = (event) => {
      if (!event.data?.carry || !event.ports[0]) return;
      // A port arrived over my port. The browser says nothing about where it
      // came from, so what I tell my worker is what I know about this line.
      worker().postMessage({ pair: "peer", from: trunkTo }, [event.ports[0]]);
      log(`a port came over my line from ${name(trunkTo)}'s page. Gave it to my worker`);
    };
    log(`holding a line to ${name(to)}'s page`);
    alone?.sync();
  };
  const canCarry = () => !!trunk && (framed || (otherWindow && !otherWindow.closed));

  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || !data.pair) return;
    if (data.pair === "state") {
      if (lastRun && lastRun !== data.state.run) log(`the browser stopped my worker and started it again. It was run ${lastRun} and is now run ${data.state.run}`);
      lastRun = data.state.run;
      tell("sw", { state: data.state, note: data.note, sent: data.sent, got: data.got, via: data.via });
      alone?.show(data.state, data.note);
    }
    if (data.pair === "need-carrier" && canCarry()) worker().postMessage({ pair: "carrier", to: trunkTo });
    if (data.pair === "carry" && event.ports[0]) {
      if (!trunk) return log("my worker gave me a port and I have nowhere to send it");
      trunk.postMessage({ carry: true }, [event.ports[0]]);
      tell("pulse", { cable: "trunk" });
      log(`my worker gave me a port. Sent it over my line to ${name(trunkTo)}'s page`);
    }
    if (data.pair === "answer") log(data.answer ? `my worker asked ${name(data.answer.by)}'s worker about ${data.item}: ${data.answer.answer}` : `my worker could not reach the other worker to ask about ${data.item}`);
    if (data.pair === "line") {
      if (data.failed) return log("my worker could not get me a line");
      line?.close();
      line = event.ports[0];
      log(`my worker gave me a port. Its other end is held by ${name(data.by)}'s worker`);
      tell("line", { up: true });
    }
  });

  // ---- what this page can be asked to do

  cmd("trunk", (data, ports) => setTrunk(ports[0], data.to));
  cmd("join", () => worker().postMessage({ pair: "join" }));
  cmd("ask", (data) => worker().postMessage({ pair: "ask", item: data?.item || ITEM }));
  cmd("forget", () => worker().postMessage({ pair: "forget" }));
  cmd("line", () => worker().postMessage({ pair: "line" }));
  // Ask the other site's worker directly, on this page's own port to it.
  cmd("askline", (data) => {
    const item = data?.item || ITEM;
    if (!line) return log("I have no line of my own yet");
    const { port1, port2 } = new MessageChannel();
    const timer = setTimeout(() => { port1.close(); log(`no answer on my line in 1.5 seconds. The worker at the other end has lost it`); tell("line", { up: false }); }, 1500);
    port1.onmessage = (event) => {
      clearTimeout(timer); port1.close();
      log(`asked ${name(event.data.by)}'s worker about ${item} on my own line: ${event.data.answer}. My worker took no part`);
      tell("pulse", { cable: "line-" + params.get("id") });
    };
    line.postMessage({ ask: item, from: SITE }, [port2]);
    tell("pulse", { cable: "line-" + params.get("id") });
  });
  // Fetch an address on this site that the other site's worker answers.
  cmd("fetch", async (data) => {
    const path = "/pair/from-other/" + (data?.file || "shelf.txt");
    if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    log(`fetching ${location.host}${path}`);
    try {
      const response = await fetch(path, { cache: "no-store" });
      log(`${response.status}, ${response.headers.get("content-type")}`);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let rest = "", rows = 0;
      for (;;) {
        const { value, done } = await reader.read();
        rest += value || "";
        const parts = rest.split("\n"); rest = parts.pop();
        for (const row of parts) { rows++; log(row); }
        if (done) break;
      }
      if (rest) { rows++; log(rest); }
      tell("fetched", { status: response.status, rows });
    } catch (err) { log("the fetch failed: " + err.message); tell("fetched", { status: 0 }); }
  });
  // A port from a third site that has introduced my worker to someone.
  addEventListener("message", (event) => {
    if (event.data?.pair !== "adopt" || !event.ports[0]) return;
    if (event.origin !== sites.planner) return log(`refused a port from ${event.origin}`);
    worker().postMessage({ pair: "peer", from: event.data.from }, [event.ports[0]]);
    log(`${event.origin.replace(/^https?:\/\//, "")} posted me a port and says the other end is ${name(event.data.from)}'s. Gave it to my worker`);
  });

  // ---- in a tab of its own: real windows, and buttons

  const alone = framed ? null : (() => {
    document.body.classList.add("alone");
    $("alone").hidden = false;
    $("about").textContent = `This page belongs to ${name(SITE)}'s site. Its service worker can be joined to the service worker of ${name(OTHER)}'s site. To do that, this page has to open a window on that site once, so that the port can be carried across.`;
    const buttons = {};
    const button = (label, fn) => { const b = document.createElement("button"); b.textContent = label; b.onclick = fn; $("buttons").append(b); return b; };
    // Opened by the other site's page: say so, and wait to be given a line.
    if (opener && params.get("opened")) {
      addEventListener("message", (event) => {
        if (event.data?.pair !== "trunk" || event.source !== opener || event.origin !== sites[OTHER] || !event.ports[0]) return;
        otherWindow = opener;
        setTrunk(event.ports[0], OTHER);
      });
      opener.postMessage({ pair: "window-ready" }, sites[OTHER]);
      $("about").textContent = `This window was opened by ${name(OTHER)}'s page so that a port could be carried to this site's service worker. Keep it open: if either worker is stopped, the two pages carry a new port across.`;
    } else {
      buttons.open = button(`Open ${name(OTHER)}'s window`, () => {
        otherWindow = window.open(`${sites[OTHER]}/pair/?with=${SITE}&opened=1`, "pair-" + OTHER, "popup,width=460,height=640");
        if (!otherWindow) log("the browser blocked the window");
      });
      // The other window says when it has loaded. Check who it is, then give it one end of a new channel.
      addEventListener("message", (event) => {
        if (event.data?.pair !== "window-ready" || event.source !== otherWindow || event.origin !== sites[OTHER]) return;
        const { port1, port2 } = new MessageChannel();
        otherWindow.postMessage({ pair: "trunk" }, sites[OTHER], [port2]);
        setTrunk(port1, OTHER);
      });
    }
    buttons.join = button("Join the two workers", cmds.join);
    buttons.ask = button(`My worker: ask about ${ITEM}`, () => cmds.ask());
    buttons.fetch = button("Fetch /pair/from-other/shelf.txt", () => cmds.fetch());
    buttons.line = button("Get this page a line of its own", cmds.line);
    buttons.askline = button(`Ask about ${ITEM} on my own line`, () => cmds.askline());
    buttons.forget = button("Make my worker forget its ports", cmds.forget);
    const sync = () => { buttons.join.disabled = !trunk; };
    sync();
    return {
      sync,
      show(state, note) {
        $("run").textContent = state.run;
        $("born").textContent = new Date(state.born).toLocaleTimeString();
        $("peer").textContent = state.peer ? `held, to ${name(state.peerName)}'s worker` : "none";
        if (note) $("note").textContent = note;
      },
    };
  })();

  worker().postMessage({ pair: "hello" });
  tell("up");
}
