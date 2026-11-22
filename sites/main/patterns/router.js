// Routing between windows that do not know each other, through a worker.
// Two versions of one demo: a shared worker with ports, and a service worker
// with the Clients API.

const NAMES = ["orders", "kitchen", "driver"];
const COLORS = { orders: "red", kitchen: "teal", driver: "yellow" };

const routerBox = (stage, title, what, extra = "") => {
  const box = stage.box("router", { ...what, wide: true, html: `<div class="here"><h4>${title}</h4><p class="small" style="margin:0 0 .3rem">Knows: <strong data-table>nobody yet</strong></p><p class="small" style="margin:0 0 .3rem">Passed on: <strong data-routed>0</strong>. Undelivered: <strong data-undelivered>0</strong></p>${extra}<p class="small" data-last style="margin:0;min-height:2.8em;font-family:var(--mono)"></p></div>` });
  const q = (name) => box.node.querySelector(`[data-${name}]`);
  box.show = (state) => {
    q("table").textContent = state.table.join(", ") || "nobody";
    q("routed").textContent = state.routed; q("undelivered").textContent = state.undelivered;
    if ("rollcalls" in state && q("rollcalls")) q("rollcalls").textContent = state.rollcalls;
    if (state.last) q("last").textContent = state.last.ok ? `${state.last.from} → ${state.last.to}: looked up, passed on` : `${state.last.from || "someone"} → ${state.last.to}: no such name`;
  };
  return box;
};

// The windows around the router, and the buttons that make them speak.
const windowBoxes = (stage, via) => Object.fromEntries(NAMES.map((name) => [name, stage.box(name, { src: `/patterns/route.html?name=${name}&via=${via}` })]));
// `line` is what joins a window to the router: a port to a shared worker, or
// plain postMessage to a service worker, which keeps no port.
async function windows(stage, ui, boxes, line = "cable") {
  stage.on((name, data) => { if (data.wire === "sent") stage.pulse("c-" + name, name); if (data.wire === "got") stage.pulse("c-" + name, "router"); });
  await Promise.all(Object.values(boxes).map((box) => box.whenReady));
  for (const name of NAMES) stage.cable("c-" + name, name, "router", COLORS[name], line);
  const say = (from, to) => () => stage.boxes.get(from).frame?.contentWindow?.postMessage({ cmd: "send", to }, location.origin);
  ui.button("Orders: send to the kitchen", say("orders", "kitchen"), false, true);
  ui.button("Kitchen: send to the driver", say("kitchen", "driver"));
  ui.button("Driver: send to orders", say("driver", "orders"));
  ui.button("Orders: send to the florist", say("orders", "florist"));
  return { say };
}

export const router = {
  id: "router",
  title: "A worker that routes between windows that have never met",
  blurb: "The three windows above the router know two things each: their own name, and how to reach the router. None of them has a reference to another, and none of them holds a port of another's. To reach the kitchen, the orders window posts a message to the router addressed to \"kitchen\". The router looks the name up and passes the message on, with the sender's name attached. Address a name nobody has and the router says so. The router here is a shared worker. Each box is a real page of this site, and the link opens a fourth window that can join in.",
  code: `<span class="c">// every window: say who you are, then address others by name</span>
const { port } = new SharedWorker("/router-worker.js");
port.postMessage({ iam: "orders" });
port.postMessage({ to: "kitchen", text: "two tulip bunches" });
port.onmessage = ({ data }) => show(data.from, data.text);

<span class="c">// the router: a table of names, and nothing else</span>
onconnect = ({ ports: [port] }) => {
  port.onmessage = ({ data }) => {
    if (data.iam) return table.set(data.iam, port);
    const target = table.get(data.to);
    target ? target.postMessage({ from: nameOf(port), text: data.text })
           : port.postMessage({ undelivered: data.to });
  };
};`,
  tour: { steps: [
    ["Orders: send to the kitchen", "The orders window posts to the router, addressed to \"kitchen\". The router looks the name up and passes it on."],
    ["Kitchen: send to the driver", "The kitchen does the same for the driver. It has never seen the driver's window."],
    ["Driver: send to orders", "And the driver reaches orders. Every message went through the middle."],
    ["Orders: send to the florist", "Nobody registered that name. The router tells the sender it could not be delivered."],
    ["Close the kitchen", "The kitchen's window is destroyed. The router notices and takes it out of its table.", 2000],
    ["Orders: send to the kitchen", "The same message as the first step. This time there is nobody to give it to."],
  ] },
  async setup(stage, ui) {
    const boxes = windowBoxes(stage, "shared");
    const hub = routerBox(stage, "Router, a shared worker", { kind: "shared", url: "/patterns/router-worker.js" });
    if (!("SharedWorker" in self)) { hub.node.querySelector("[data-last]").textContent = "This browser has no SharedWorker."; return; }
    // This page only watches the router. It is not one of the windows.
    const watch = new SharedWorker("/patterns/router-worker.js").port;
    watch.onmessage = ({ data }) => { if (!hub.node.isConnected) return watch.close(); if (data.state) hub.show(data.state); };
    watch.postMessage({ watch: true });
    await windows(stage, ui, boxes);
    ui.button("Close the kitchen", (btn) => { stage.remove("kitchen"); btn.disabled = true; });
    ui.link("Open a fourth window for real", "/patterns/route.html?name=florist");
  },
};

export const swRouter = {
  pattern: "router", use: [0], id: "built-swroute",
  title: "The same router as a service worker, which forgets and asks again",
  blurb: "A service worker can do the same job with no ports at all. Each window posts to the service worker, and the service worker reaches the others through its list of open windows. There is one difference that matters. A browser stops a service worker when it is idle, and it wakes with an empty table. So when this one cannot place a name, it asks every open window to say who it is, and then tries again. The button that makes it forget stands in for the browser stopping it, which a page cannot ask for.",
  code: `<span class="c">// every window</span>
registration.active.postMessage({ iam: "orders" });
registration.active.postMessage({ to: "kitchen", text: "two tulip bunches" });
navigator.serviceWorker.onmessage = ({ data }) =>
  data.rollcall ? registration.active.postMessage({ iam: "orders" }) : show(data.from, data.text);

<span class="c">// the service worker</span>
onmessage = async (event) => {
  let target = await clients.get(table.get(event.data.to));
  if (!target) { await rollCall(); target = await clients.get(table.get(event.data.to)); }   <span class="c">// woke up empty?</span>
  target.postMessage({ from: nameOf(event.source.id), text: event.data.text });
};`,
  tour: { steps: [
    ["Orders: send to the kitchen", "The orders window posts to the service worker, which finds the kitchen's window and passes the message on.", 1400],
    ["Make the service worker forget", "Its table is emptied, as it would be if the browser had stopped it."],
    ["Kitchen: send to the driver", "The service worker knows nobody. It asks every window to say who it is, rebuilds its table, and delivers.", 1800],
    ["Orders: send to the florist", "It asks again, nobody answers to that name, and the sender is told.", 1800],
  ] },
  async setup(stage, ui) {
    const boxes = windowBoxes(stage, "sw");
    const hub = routerBox(stage, "Router, a service worker", { kind: "service", url: "/patterns/route-sw.js", scope: "/patterns/routed/" }, `<p class="small" style="margin:0 0 .3rem">Times it asked who is here: <strong data-rollcalls>0</strong></p>`);
    if (!("serviceWorker" in navigator)) { hub.node.querySelector("[data-last]").textContent = "This browser has no service worker."; return; }
    const onMessage = ({ data }) => { if (!hub.node.isConnected) return navigator.serviceWorker.removeEventListener("message", onMessage); if (data.state) hub.show(data.state); };
    navigator.serviceWorker.addEventListener("message", onMessage);
    const registration = await navigator.serviceWorker.register("/patterns/route-sw.js", { scope: "/patterns/routed/" });
    const worker = registration.active || registration.waiting || registration.installing;
    if (worker.state !== "activated") await new Promise((resolve) => worker.addEventListener("statechange", () => worker.state === "activated" && resolve()));
    registration.active.postMessage({ forget: true });   // start from an empty table each time
    await windows(stage, ui, boxes, "post");
    registration.active.postMessage({ watch: true });
    ui.button("Make the service worker forget", () => registration.active.postMessage({ forget: true }));
    ui.link("Open a fourth window for real", "/patterns/route.html?name=florist&via=sw");
  },
};

// The data flow, drawn. Colours come from the page, so it follows the theme.
export const routerDiagram = `<figure class="flow"><svg viewBox="0 0 520 590" role="img" aria-labelledby="flow-title flow-desc" xmlns="http://www.w3.org/2000/svg">
  <title id="flow-title">How a message gets from one window to another through the router</title>
  <desc id="flow-desc">Windows are drawn with rounded corners and an address bar. The router is a worker, drawn with its corners cut off. Three windows each tell the router their name. The orders window posts a message addressed to kitchen. The router looks kitchen up in its table and posts the message to the kitchen window with the sender's name attached. No line joins one window to another.</desc>
  <defs>
    <marker id="flow-tip" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="context-stroke"/></marker>
  </defs>
  <g font-family="system-ui, sans-serif" fill="currentColor">
    <g fill="none" stroke="currentColor" stroke-width="2">
      <rect x="14" y="14" width="224" height="92" rx="12"/><path d="M14 38h224"/>
      <g stroke-width="1.5"><circle cx="28" cy="26" r="3"/><circle cx="39" cy="26" r="3"/><circle cx="50" cy="26" r="3"/></g>
      <rect x="282" y="14" width="224" height="92" rx="12"/><path d="M282 38h224"/>
      <g stroke-width="1.5"><circle cx="296" cy="26" r="3"/><circle cx="307" cy="26" r="3"/><circle cx="318" cy="26" r="3"/></g>
      <rect x="148" y="484" width="224" height="92" rx="12"/><path d="M148 508h224"/>
      <g stroke-width="1.5"><circle cx="162" cy="496" r="3"/><circle cx="173" cy="496" r="3"/><circle cx="184" cy="496" r="3"/></g>
    </g>
    <text x="62" y="30" font-family="ui-monospace, Menlo, monospace" font-size="11" opacity=".8">/route.html?name=orders</text>
    <text x="330" y="30" font-family="ui-monospace, Menlo, monospace" font-size="11" opacity=".8">/route.html?name=driver</text>
    <text x="196" y="500" font-family="ui-monospace, Menlo, monospace" font-size="11" opacity=".8">/route.html?name=kitchen</text>
    <polygon points="122,218 422,218 436,232 436,380 422,394 122,394 108,380 108,232" fill="var(--line, #c9d1e0)"/>
    <polygon points="116,212 416,212 430,226 430,374 416,388 116,388 102,374 102,226" fill="var(--muted, #56628a)"/>
    <polygon points="110,206 410,206 424,220 424,368 410,382 110,382 96,368 96,220" fill="var(--paper, #edf0f4)"/>
    <polygon points="110,206 410,206 424,220 424,368 410,382 110,382 96,368 96,220" fill="var(--yellow, #f5b700)" fill-opacity=".16" stroke="currentColor" stroke-width="2.5"/>
    <text x="126" y="66" text-anchor="middle" font-weight="800" font-size="19">Orders window</text>
    <text x="126" y="90" text-anchor="middle" font-size="14" opacity=".8">knows: its name, the router</text>
    <text x="394" y="66" text-anchor="middle" font-weight="800" font-size="19">Driver window</text>
    <text x="394" y="90" text-anchor="middle" font-size="14" opacity=".8">knows: its name, the router</text>
    <text x="260" y="536" text-anchor="middle" font-weight="800" font-size="19">Kitchen window</text>
    <text x="260" y="560" text-anchor="middle" font-size="14" opacity=".8">knows: its name, the router</text>
    <text x="260" y="238" text-anchor="middle" font-weight="800" font-size="19">Router</text>
    <text x="260" y="260" text-anchor="middle" font-size="14" opacity=".8">a shared worker, or a service worker</text>
    <g font-family="ui-monospace, Menlo, monospace" font-size="15">
      <text x="150" y="296">orders</text><text x="250" y="296">→ window 1</text>
      <text x="150" y="322" font-weight="700" fill="var(--teal, #0e9f8e)">kitchen</text><text x="250" y="322" font-weight="700" fill="var(--teal, #0e9f8e)">→ window 2</text>
      <text x="150" y="348">driver</text><text x="250" y="348">→ window 3</text>
    </g>
    <text x="260" y="370" text-anchor="middle" font-size="13" opacity=".8">2. looks the name up</text>
    <g fill="none" stroke-width="3" marker-end="url(#flow-tip)">
      <path d="M200 106 L200 203" stroke="var(--red, #e0364c)"/>
      <path d="M260 382 L260 482" stroke="var(--teal, #0e9f8e)"/>
    </g>
    <path d="M320 106 L320 203" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="6 6" opacity=".55" marker-end="url(#flow-tip)"/>
    <g font-size="14">
      <text x="188" y="146" text-anchor="end" font-weight="700">1. posts to the router</text>
      <text x="188" y="168" text-anchor="end" font-family="ui-monospace, Menlo, monospace" font-size="13">{ to: "kitchen", text }</text>
      <text x="334" y="146" opacity=".75">any window can,</text>
      <text x="334" y="166" opacity=".75">the same way</text>
      <text x="276" y="420" font-weight="700">3. passes it on</text>
      <text x="276" y="442" font-family="ui-monospace, Menlo, monospace" font-size="13">{ from: "orders", text }</text>
    </g>
  </g>
</svg><figcaption>Every message goes to the router and comes out of it. No line joins one window to another.</figcaption></figure>`;
