// A patch bay for demos. Each box on the stage is a real browsing context: a
// sandboxed iframe with its own opaque origin, so every hop you see is a real
// cross-origin hop. Cables are drawn when a port lands somewhere, and a dot
// runs along the cable when a frame says it sent a message.
//
// The frames tell the stage about traffic over window.postMessage purely so it
// can be drawn. The data itself only travels over the ports.

const COLORS = { yellow: "#f5b700", red: "#e0364c", teal: "#0e9f8e", ink: "currentColor" };

// What each box on a stage is. A box is drawn differently for each kind, so a
// window, an iframe and a worker can be told apart without reading the labels.
export const KINDS = {
  window: { label: "Window", about: "A top-level page in a tab or window of its own. Its address is in the bar at the top." },
  iframe: { label: "<iframe>", about: "A page embedded inside another page. Its address is written underneath." },
  worker: { label: "Worker", about: "A background thread that belongs to one page. The script it runs is written underneath." },
  shared: { label: "SharedWorker", about: "One background thread that every page of a site can connect to." },
  service: { label: "Service worker", about: "A background thread that answers network requests for one part of a site. The browser starts and stops it." },
  worklet: { label: "AudioWorklet", about: "Code that runs on the thread that produces sound." },
  device: { label: "Another device", about: "A browser on a different machine." },
  part: { label: "In this page", about: "Something the page draws itself. It is not a separate page or thread." },
  cable: { label: "MessageChannel", about: "A cable is one channel. The plug at each end is one of its two ports, and a moving dot is a message." },
};
const OCT = "h13l4 4v7l-4 4h-13l-4-4v-7z";
const GLYPHS = {
  window: `<rect x="1.5" y="1.5" width="21" height="15" rx="3.5"/><path d="M1.5 6.2h21"/><circle cx="4.7" cy="3.9" r=".7" fill="currentColor" stroke="none"/><circle cx="7.3" cy="3.9" r=".7" fill="currentColor" stroke="none"/>`,
  iframe: `<rect x="1.5" y="1.5" width="21" height="15" stroke-width="1" stroke-dasharray="2 2"/><rect x="6" y="5" width="12" height="8"/>`,
  worker: `<path d="M5.5 1.5${OCT}"/>`,
  shared: `<path d="M4.5 1.5h10.5l3.5 3.5v5.5L15 14H4.5L1 10.5V5z"/><path d="M21 6.5l2 2V13l-3.5 3.5H9.5L8 15"/>`,
  service: `<path d="M5.5 1.5${OCT}"/><path d="M2.5 6.2h19M8 2.2 6 5.6M12 2.2l-2 3.4M16 2.2l-2 3.4M20 3l-2 2.6" stroke-width="1"/>`,
  worklet: `<path d="M5.5 1.5${OCT}"/><path d="M5 9h2l1.5-4 2.5 8 2.5-6 1.5 2H19" stroke-width="1.2"/>`,
  device: `<rect x="6.5" y="1" width="11" height="16" rx="2.5"/><path d="M10.5 14.3h3"/>`,
  part: `<rect x="2.5" y="3.5" width="19" height="11" rx="1.5" stroke-width="1"/>`,
  cable: `<path d="M3.5 5q8.5 12 17 0"/><circle cx="3.5" cy="5" r="2.2" fill="currentColor"/><circle cx="20.5" cy="5" r="2.2" fill="currentColor"/>`,
};
const glyph = (kind) => `<svg class="glyph" viewBox="0 0 24 18" width="24" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter" stroke-linecap="round">${GLYPHS[kind]}</svg>`;
const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// An address as a browser shows it: the host stands out, the rest is quieter.
function address(url) {
  if (!url) return "";
  if (url.startsWith("about:")) return `<b>${esc(url)}</b>`;
  if (url.startsWith("blob:")) return `<b>blob:</b>${esc(location.host)}/… <i>made by this page</i>`;
  let u; try { u = new URL(url, location.href); } catch { return esc(url); }
  return `<b>${esc(u.host)}</b>${esc(u.pathname + u.search + u.hash)}`;
}

// A key to the shapes. With no argument it lists every kind, with what each one is.
export function legend(kinds = Object.keys(KINDS), full = true) {
  return `<ul class="stage-legend${full ? " full" : ""}" aria-label="What the shapes mean">${kinds.map((kind) => `<li>${glyph(kind)}<span><strong>${esc(KINDS[kind].label)}</strong>${full ? " " + KINDS[kind].about : ""}</span></li>`).join("")}</ul>`;
}

// What a box is, when the demo that made it did not say.
function guess(name, html) {
  const text = name + " " + ((html.match(/<h4>([^<]*)/) || [])[1] || "");
  if (name === "page") return "window";
  if (/service ?worker|^sw\b/i.test(text)) return "service";
  if (/shared ?worker/i.test(text)) return "shared";
  if (/audio thread|worklet/i.test(text)) return "worklet";
  if (/worker/i.test(text)) return "worker";
  if (name === "far") return "device";
  return "part";
}

// Runs inside every frame.
export function runtime() {
  const logEl = document.getElementById("log");
  window.log = (text) => {
    const li = document.createElement("li");
    li.textContent = text;
    logEl.prepend(li);
    while (logEl.children.length > 6) logEl.lastChild.remove();
  };
  window.tell = (what, data = {}) => parent.postMessage({ wire: what, ...data }, "*");
  // send() is postMessage plus a note to the stage so it can animate the cable.
  window.send = (port, cable, message, transfer = []) => { port.postMessage(message, transfer); tell("pulse", { cable }); };
  const handlers = {};
  window.on = (name, fn) => { handlers[name] = fn; };
  addEventListener("message", (event) => {
    if (event.source !== parent || !event.data || !event.data.cmd) return;
    handlers[event.data.cmd]?.(event.data, event.ports);
  });
  // A frame that breaks says so, on its own face and to the page.
  // Scripts that a browser extension adds to this frame are not ours to report.
  const foreign = (file) => /^(chrome|moz|safari-web|ms-browser)-extension:/.test(file || "");
  addEventListener("error", (event) => { if (foreign(event.filename)) return; log("error: " + event.message); tell("error", { message: String(event.message), file: (event.filename || "").split("/").pop().slice(0, 60), line: event.lineno }); });
  addEventListener("unhandledrejection", (event) => { const m = String(event.reason && event.reason.message || event.reason); log("error: " + m); tell("error", { message: m }); });
  // What the browser itself complains about in this frame: something it blocked, slowed or will remove.
  try { new ReportingObserver((reports) => { for (const r of reports) tell("error", { message: r.type + ": " + (r.body && (r.body.message || r.body.id)) }); }, { types: ["intervention", "deprecation"], buffered: true }).observe(); } catch (err) {}
  tell("ready");
}

function frameDoc(title, color, script, csp) {
  return `<!doctype html><meta charset="utf-8">${csp ? `<meta http-equiv="Content-Security-Policy" content="${csp}">` : ""}<style>
    html{color-scheme:light dark}
    body{margin:0;padding:.7rem .8rem;font:14px/1.4 system-ui,sans-serif;background:light-dark(#fff,#141f47);color:light-dark(#0f1c3f,#e9edfa)}
    h1{font:800 1rem/1.1 "Arial Narrow",system-ui,sans-serif;margin:0 0 .5rem;display:flex;align-items:center;gap:.45rem}
    h1::before{content:"";width:.8em;height:.8em;border-radius:50%;background:${color}}
    ul{list-style:none;margin:0;padding:0;font:12px/1.45 ui-monospace,Menlo,monospace}
    li{padding:.15rem 0;border-top:1px solid light-dark(#c9d1e0,#2b3970);overflow-wrap:anywhere}
    li:first-child{border-top:0;font-weight:700}
  </style><h1>${title}</h1><ul id="log"></ul><script>(${runtime})();(${script})();<\/script>`;
}

export class Stage {
  constructor(el) {
    this.el = el;
    el.classList.add("stage");
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("aria-hidden", "true");
    el.append(this.svg);
    this.boxes = new Map();
    this.cables = new Map();
    this.listeners = new Set();
    this.onMessage = (event) => {
      const data = event.data;
      if (!data || !data.wire) return;
      const box = [...this.boxes.values()].find((b) => b.frame?.contentWindow === event.source);
      if (!box) return;
      if (data.wire === "ready") box.ready();
      if (data.wire === "pulse") this.pulse(data.cable, box.name);
      if (data.wire === "error") dispatchEvent(new CustomEvent("pa-error", { detail: { where: "frame " + box.name + (data.file ? `, ${data.file}:${data.line}` : ""), message: data.message } }));
      for (const fn of this.listeners) fn(box.name, data, event.ports);
    };
    addEventListener("message", this.onMessage);
    this.resize = new ResizeObserver(() => this.redraw());
    this.resize.observe(el);
    // A key under the stage, listing only the shapes that are on it.
    this.key = document.createElement("div");
    el.after(this.key);
  }

  // Add a sandboxed frame. `script` is a function that runs inside it.
  frame(name, { title = name, color = "yellow", script = () => {}, csp = "" } = {}) {
    const box = this.box(name, { kind: "iframe" });
    const frame = document.createElement("iframe");
    frame.title = title;
    frame.sandbox = "allow-scripts";
    frame.srcdoc = frameDoc(title, COLORS[color] || color, script, csp);
    box.node.append(frame);
    this.describe(box);
    return box.whenReady;
  }

  // Add a box for something that is not a sandboxed frame: this page, a worker,
  // a real URL. `kind` is one of KINDS and decides how the box is drawn; left
  // out, it is worked out from the name and the heading. `url` is the address
  // shown for it: a worker's script, or "blob:" for one made from a string.
  // A box that is given an iframe later becomes an iframe, with that address.
  box(name, { html = "", src = null, kind = null, url = null, scope = null, wide = false } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "ctx" + (wide ? " wide" : "");
    wrap.innerHTML = `<div class="ctx-shape"><div class="ctx-in"><div class="ctx-bar"></div><div class="box"></div><div class="ctx-foot"></div></div></div>`;
    const node = wrap.querySelector(".box");
    node.dataset.name = name;
    if (src) {
      const frame = document.createElement("iframe");
      frame.src = src;
      frame.title = name;
      node.append(frame);
    } else if (html) {
      node.innerHTML = html;
    }
    this.el.append(wrap);
    let ready;
    const box = { name, node, wrap, kind: kind || (src ? "iframe" : guess(name, html)), url, scope, frame: node.querySelector("iframe"), whenReady: new Promise((r) => (ready = r)), ready };
    this.boxes.set(name, box);
    this.describe(box);
    box.watch = new MutationObserver(() => this.describe(box));
    box.watch.observe(node, { childList: true });
    return box;
  }

  // Draw the frame around a box: what kind of thing it is, and its address.
  describe(box) {
    const frame = box.node.querySelector(":scope > iframe");
    if (frame) {
      box.frame = frame;
      box.sandboxed = frame.hasAttribute("sandbox");
      box.url = frame.getAttribute("src") ? frame.src : "about:srcdoc";
      if (box.kind !== "device") box.kind = "iframe";
    }
    const { kind } = box, bar = box.wrap.querySelector(".ctx-bar"), foot = box.wrap.querySelector(".ctx-foot");
    box.wrap.dataset.kind = kind;
    let label = KINDS[kind].label, where = address(box.url), full = box.url || "";
    if (kind === "window") {
      full = location.href;
      bar.innerHTML = `<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="ctx-url" title="${esc(full)}">${address(box.url || location.origin + location.pathname)}</span>`;
    } else {
      if (kind === "iframe") {
        label = box.sandboxed ? "<iframe sandbox>" : "<iframe>";
        if (!box.url) where = "<i>no page loaded yet</i>";
        else if (box.url === "about:srcdoc") where += " <i>written by this page, with no origin of its own</i>";
      }
      if (kind === "device") where = frame ? `<i>stand-in, an iframe at</i> ${where}` : "<i>not connected</i>";
      if (kind === "service" && box.scope) where += ` <i>scope</i> ${esc(box.scope)}`;
      if (kind === "part") where = "";
      bar.innerHTML = `${glyph(kind)}<span class="ctx-kind">${esc(label)}</span>`;
    }
    foot.innerHTML = kind === "window" || kind === "part" ? "" : `<span class="ctx-url" title="${esc(full)}">${where}</span>`;
    foot.hidden = !foot.innerHTML;
    this.showKey();
  }

  showKey() {
    const kinds = Object.keys(KINDS).filter((kind) => kind === "cable" || [...this.boxes.values()].some((box) => box.kind === kind));
    const html = this.boxes.size ? legend(kinds, false) : "";
    if (this.key.innerHTML !== html) this.key.innerHTML = html;
  }

  post(name, message, transfer = []) {
    this.boxes.get(name).frame.contentWindow.postMessage(message, "*", transfer);
  }

  remove(name) {
    const box = this.boxes.get(name);
    if (!box) return;
    box.node.classList.add("gone");
    box.wrap.classList.add("gone");
    box.frame?.remove(); // really destroys the context
    for (const [id, cable] of this.cables) if (cable.a === name || cable.b === name) this.cut(id);
  }

  cable(id, a, b, color = "yellow") {
    this.cut(id);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("stroke", COLORS[color] || color);
    path.classList.add("cable");
    // The plug at each end is one of the channel's two ports.
    const jacks = [0, 1].map(() => {
      const jack = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      jack.setAttribute("r", 6.5);
      jack.setAttribute("fill", COLORS[color] || color);
      jack.classList.add("jack-end");
      return jack;
    });
    this.svg.append(path, ...jacks);
    this.cables.set(id, { a, b, path, color, jacks });
    this.redraw();
    path.style.strokeDasharray = path.getTotalLength();
    path.animate({ strokeDashoffset: [path.getTotalLength(), 0] }, { duration: 500, easing: "ease-out" }).finished.then(() => (path.style.strokeDasharray = ""));
  }

  cut(id) {
    const cable = this.cables.get(id);
    cable?.path.remove();
    for (const jack of cable?.jacks || []) jack.remove();
    this.cables.delete(id);
  }

  anchor(name, towards) {
    const outer = this.el.getBoundingClientRect();
    const r = this.boxes.get(name).wrap.getBoundingClientRect();
    const t = this.boxes.get(towards).wrap.getBoundingClientRect();
    const stacked = Math.abs(t.top - r.top) > r.height / 2;
    if (stacked) return { x: r.left + r.width / 2 - outer.left, y: (t.top > r.top ? r.bottom : r.top) - outer.top, stacked };
    return { x: (t.left > r.left ? r.right : r.left) - outer.left, y: r.top + r.height * 0.3 - outer.top, stacked };
  }

  redraw() {
    const { width, height } = this.el.getBoundingClientRect();
    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    let i = 0;
    for (const cable of this.cables.values()) {
      if (!this.boxes.get(cable.a) || !this.boxes.get(cable.b)) continue;
      const p = this.anchor(cable.a, cable.b);
      const q = this.anchor(cable.b, cable.a);
      const lift = i++ * 14;
      // A cable hangs: sag grows with its length, like a patch lead.
      const d = p.stacked
        ? `M${p.x + lift},${p.y} C${p.x + lift + 40},${(p.y + q.y) / 2} ${q.x + lift - 40},${(p.y + q.y) / 2} ${q.x + lift},${q.y}`
        : `M${p.x},${p.y + lift} Q${(p.x + q.x) / 2},${Math.max(p.y, q.y) + lift + 30 + Math.abs(q.x - p.x) * 0.12} ${q.x},${q.y + lift}`;
      cable.path.setAttribute("d", d);
      const ends = p.stacked ? [[p.x + lift, p.y], [q.x + lift, q.y]] : [[p.x, p.y + lift], [q.x, q.y + lift]];
      cable.jacks.forEach((jack, n) => { jack.setAttribute("cx", ends[n][0]); jack.setAttribute("cy", ends[n][1]); });
    }
  }

  pulse(id, from) {
    const cable = this.cables.get(id);
    if (!cable) return;
    // With reduced motion there is no travelling dot: the cable blinks instead.
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return void cable.path.animate({ opacity: [0.25, 1] }, { duration: 450 });
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("r", 7);
    dot.setAttribute("fill", COLORS[cable.color] || cable.color);
    dot.classList.add("pulse");
    this.svg.append(dot);
    const length = cable.path.getTotalLength();
    const backwards = from === cable.b;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 450);
      if (!cable.path.isConnected) return dot.remove();
      const point = cable.path.getPointAtLength((backwards ? 1 - t : t) * length);
      dot.setAttribute("cx", point.x);
      dot.setAttribute("cy", point.y);
      t < 1 ? requestAnimationFrame(step) : dot.remove();
    };
    requestAnimationFrame(step);
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  reset() {
    for (const id of [...this.cables.keys()]) this.cut(id);
    for (const box of this.boxes.values()) { box.watch.disconnect(); box.wrap.remove(); }
    this.boxes.clear();
    this.showKey();
    this.listeners.clear();
  }
}
