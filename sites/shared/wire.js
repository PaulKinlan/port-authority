// A patch bay for demos. Each box on the stage is a real browsing context: a
// sandboxed iframe with its own opaque origin, so every hop you see is a real
// cross-origin hop. Cables are drawn when a port lands somewhere, and a dot
// runs along the cable when a frame says it sent a message.
//
// The frames tell the stage about traffic over window.postMessage purely so it
// can be drawn. The data itself only travels over the ports.

const COLORS = { yellow: "#f5b700", red: "#e0364c", teal: "#0e9f8e", ink: "currentColor" };

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
  }

  // Add a sandboxed frame. `script` is a function that runs inside it.
  frame(name, { title = name, color = "yellow", script = () => {}, csp = "" } = {}) {
    const box = this.box(name);
    const frame = document.createElement("iframe");
    frame.title = title;
    frame.sandbox = "allow-scripts";
    frame.srcdoc = frameDoc(title, COLORS[color] || color, script, csp);
    box.frame = frame;
    box.node.append(frame);
    return box.whenReady;
  }

  // Add a box for something that is not a frame: this page, a worker, a real URL.
  box(name, { html = "", src = null } = {}) {
    const node = document.createElement("div");
    node.className = "box";
    node.dataset.name = name;
    if (src) {
      const frame = document.createElement("iframe");
      frame.src = src;
      frame.title = name;
      node.append(frame);
    } else if (html) {
      node.innerHTML = html;
    }
    this.el.append(node);
    let ready;
    const box = { name, node, frame: node.querySelector("iframe"), whenReady: new Promise((r) => (ready = r)), ready };
    this.boxes.set(name, box);
    return box;
  }

  post(name, message, transfer = []) {
    this.boxes.get(name).frame.contentWindow.postMessage(message, "*", transfer);
  }

  remove(name) {
    const box = this.boxes.get(name);
    if (!box) return;
    box.node.classList.add("gone");
    box.frame?.remove(); // really destroys the context
    for (const [id, cable] of this.cables) if (cable.a === name || cable.b === name) this.cut(id);
  }

  cable(id, a, b, color = "yellow") {
    this.cut(id);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("stroke", COLORS[color] || color);
    path.classList.add("cable");
    this.svg.append(path);
    this.cables.set(id, { a, b, path, color });
    this.redraw();
    path.style.strokeDasharray = path.getTotalLength();
    path.animate({ strokeDashoffset: [path.getTotalLength(), 0] }, { duration: 500, easing: "ease-out" }).finished.then(() => (path.style.strokeDasharray = ""));
  }

  cut(id) {
    this.cables.get(id)?.path.remove();
    this.cables.delete(id);
  }

  anchor(name, towards) {
    const outer = this.el.getBoundingClientRect();
    const r = this.boxes.get(name).node.getBoundingClientRect();
    const t = this.boxes.get(towards).node.getBoundingClientRect();
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
    for (const cable of this.cables.values()) cable.path.remove();
    this.cables.clear();
    for (const box of this.boxes.values()) box.node.remove();
    this.boxes.clear();
    this.listeners.clear();
  }
}
