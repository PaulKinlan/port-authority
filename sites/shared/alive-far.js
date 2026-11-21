// The far side of a port, for the demos about knowing whether it is still
// there. Served on every origin. A price list is the data it serves: a flower
// name goes in on the data port and a price comes back. Health checks never
// touch that port. How the health port is set up comes from ?wiring=
//   pair    the caller sends two ports: data and health. This side answers pings on the second.
//   back    the caller sends one port: data. This side makes the health channel and sends one end back.
//   beats   each side makes a channel, keeps the end it posts into, and gives away the end to listen on.
//   all     data, a port to answer pings on, a port to send beats on, a port that only
//           carries the goodbye, and a Web Lock. Each signal on its own, for comparing them.
//   none    a page that takes no ports. What a frame holds after it has navigated away.
import { runtime } from "/wire.js";
import { answer, beat, listen, holdLock, announce } from "/alive.js";

const params = new URLSearchParams(location.search);
const wiring = params.get("wiring") || "pair";
const every = Number(params.get("every")) || 1000;
document.getElementById("title").textContent = params.get("title") || "The far side";
document.getElementById("title").style.setProperty("--dot", params.get("color") || "#e0364c");
document.getElementById("origin").textContent = location.host;
runtime();

const PRICES = { tulips: "£4.50", roses: "£9.00", peonies: "£12.00", daffodils: "£2.75" };
const open = [];
let asked = 0;

function serve(data) {
  open.push(data);
  // The whole data protocol: a flower name in, a line of text out.
  data.onmessage = (event) => {
    log(`asked for ${event.data} (${++asked})`);
    send(data, "data", `${event.data}: ${PRICES[event.data] || "not stocked"} a bunch`);
  };
}

on("port", async (_, ports) => {
  serve(ports[0]);
  if (wiring === "pair") {
    open.push(ports[1]);
    answer(ports[1], { onPing: () => tell("pulse", { cable: "health" }) });
    log("given two ports: data, and one to answer pings on");
  }
  if (wiring === "back") {
    const health = new MessageChannel();
    open.push(health.port1);
    answer(health.port1, { onPing: () => tell("pulse", { cable: "health" }) });
    // The health port goes back the way the data port came: to the window that sent it.
    parent.postMessage({ wire: "health" }, "*", [health.port2]);
    log("given one port. made a health channel and sent one end back");
  }
  if (wiring === "beats") {
    const mine = new MessageChannel();
    open.push(mine.port1, ports[1]);
    beat(mine.port1, { every, onBeat: () => tell("pulse", { cable: "beats-far" }) });
    parent.postMessage({ wire: "beats" }, "*", [mine.port2]);
    listen(ports[1], { onState: (state, why) => { log(`the page is ${state}${why ? ": " + why : ""}`); tell("heard", { state }); } });
    log("sending beats, and listening for the page's");
  }
  if (wiring === "all") {
    open.push(ports[1], ports[2], ports[3]);
    answer(ports[1], { announce: false });
    beat(ports[2], { every, announce: false });
    announce(ports[3]);
    const lock = navigator.locks ? await holdLock().catch(() => null) : null;
    tell("lock", { name: lock });
    log("answering pings, sending beats" + (lock ? ", holding a lock" : ""));
  }
});

// Alive, and not answering anything: the thread is busy.
on("stuck", (data) => { log(`busy for ${data.ms / 1000} s`); setTimeout(() => { const end = Date.now() + data.ms; while (Date.now() < end); log("free again"); tell("free"); }, 30); });
on("close", () => { for (const port of open) port.close(); log("called close() on every port"); });
on("leave", () => location.replace(`/alive-far.html?wiring=none&title=${encodeURIComponent("A different page")}&color=${encodeURIComponent("#8892b0")}`));
if (wiring === "none") log("a new page loaded in this frame. The page that held the ports is gone");
