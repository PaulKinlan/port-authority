// A patch bay for demos. Each box on the stage is a real browsing context: a
// sandboxed iframe with its own opaque origin, so every hop you see is a real
// cross-origin hop. Cables are drawn when a port lands somewhere, and a dot
// runs along the cable when a frame says it sent a message.
//
// The frames tell the stage about traffic over window.postMessage purely so it
// can be drawn. The data itself only travels over the ports.

const COLORS = { yellow: "#f5b700", red: "#e0364c", teal: "#0e9f8e", ink: "currentColor" };
const SVG_NS = "http://www.w3.org/2000/svg";

// What each box on a stage is. A box is drawn differently for each kind, so a
// window, an iframe and a worker can be told apart without reading the labels.
export const KINDS = {
  window: { label: "Window", about: "A top-level page in a tab or window of its own. Its address is in the bar at the top." },
  iframe: { label: "<iframe>", about: "A page embedded inside another page. Its address is written underneath." },
  worker: { label: "Worker", about: "A background thread that belongs to one page. The script it runs is written underneath." },
  shared: { label: "SharedWorker", about: "One background thread that every page of a site can connect to." },
  service: { label: "Service Worker", about: "A background thread that answers network requests for one part of a site. The browser starts and stops it." },
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
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  const heading = (html.match(/<(?:h4|div class="box-title")>([^<]*)/) || [])[1] || "";
  const text = name + " " + heading;
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>${csp ? `<meta http-equiv="Content-Security-Policy" content="${csp}">` : ""}<style>
    html{color-scheme:light dark}
    body{margin:0;padding:.7rem .8rem;font:14px/1.4 system-ui,sans-serif;background:light-dark(#fff,#141f47);color:light-dark(#0f1c3f,#e9edfa)}
    h1{font:800 1rem/1.1 "Arial Narrow",system-ui,sans-serif;margin:0 0 .5rem;display:flex;align-items:center;gap:.45rem}
    h1::before{content:"";width:.8em;height:.8em;border-radius:50%;background:${color};flex:none}
    ul{list-style:none;margin:0;padding:0;font:12px/1.45 ui-monospace,Menlo,monospace}
    li{padding:.15rem 0;border-top:1px solid light-dark(#c9d1e0,#2b3970);overflow-wrap:anywhere}
    li:first-child{border-top:0;font-weight:700}
  </style></head><body><h1>${esc(title)}</h1><ul id="log" role="log" aria-live="polite"></ul><script>(${runtime})();(${script})();<\/script></body></html>`;
}

export class Stage {
  constructor(el) {
    this.el = el;
    el.classList.add("stage");
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("aria-hidden", "true");
    el.append(this.svg);
    this.boxes = new Map();
    this.cables = new Map();
    this.listeners = new Set();
    this.cleanups = new Set();
    this.timers = new Set();
    this.pulseMeta = new Map();
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

  // Register a teardown callback to run on reset() or destroy().
  cleanup(fn) {
    if (typeof fn === "function") this.cleanups.add(fn);
    return () => this.cleanups.delete(fn);
  }

  _later(fn, ms) {
    const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms);
    this.timers.add(id);
    return id;
  }

  _flashBox(name, cls, color, ms = 850) {
    const box = this.boxes.get(name);
    if (!box || !box.wrap.isConnected) return;
    box.wrap.style.setProperty("--active-color", COLORS[color] || color || "var(--accent)");
    box.wrap.classList.remove("box-active", "box-send", "box-recv");
    void box.wrap.offsetWidth;
    box.wrap.classList.add(cls);
    clearTimeout(box._flashTimer);
    box._flashTimer = this._later(() => box.wrap.classList.remove(cls), ms);
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
  box(name, { html = "", src = null, title = null, kind = null, url = null, scope = null, wide = false } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "ctx" + (wide ? " wide" : "");
    wrap.innerHTML = `<div class="ctx-shape"><div class="ctx-in"><div class="ctx-bar"></div><div class="box"></div><div class="ctx-foot"></div></div></div>`;
    const node = wrap.querySelector(".box");
    node.dataset.name = name;
    if (src) {
      const frame = document.createElement("iframe");
      frame.src = src;
      frame.title = title || name;
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
    box.watch.observe(node, { childList: true, attributes: true, attributeFilter: ["style"] });
    return box;
  }

  // Draw the frame around a box: what kind of thing it is, and its address.
  describe(box) {
    // Older demos widen a box by styling it directly. The frame around it follows.
    if (box.node.style.flexBasis === "100%") box.wrap.classList.add("wide");
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
      if (kind === "device") where = frame ? `<i>stand-in, an iframe at</i> ${where}` : `<i>${box.node.dataset.link === "up" ? "connected directly" : "not connected"}</i>`;
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
    this.boxes.get(name)?.frame?.contentWindow?.postMessage(message, "*", transfer);
  }

  remove(name) {
    const box = this.boxes.get(name);
    if (!box) return;
    box.node.classList.add("gone");
    box.wrap.classList.add("gone");
    box.frame?.remove(); // really destroys the context
    for (const [id, cable] of this.cables) if (cable.a === name || cable.b === name) this.cut(id);
  }

  cable(id, a, b, color = "yellow", opts = {}) {
    const { label = "", dashed = false } = typeof opts === "string" ? { label: opts } : (opts || {});
    this.cut(id);
    const stroke = COLORS[color] || color;
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("stroke", stroke);
    path.classList.add("cable", "cable-new");
    if (dashed) path.classList.add("cable-dashed");
    // The plug at each end is one of the channel's two ports.
    const jacks = [0, 1].map(() => {
      const jack = document.createElementNS(SVG_NS, "circle");
      jack.setAttribute("r", 6.5);
      jack.setAttribute("fill", stroke);
      jack.classList.add("jack-end");
      return jack;
    });
    let labelGroup = null;
    if (label) {
      labelGroup = document.createElementNS(SVG_NS, "g");
      labelGroup.classList.add("cable-label");
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("rx", 8);
      rect.setAttribute("ry", 8);
      rect.setAttribute("stroke", stroke);
      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      text.textContent = label;
      labelGroup.append(rect, text);
    }
    this.svg.append(path, ...jacks);
    if (labelGroup) this.svg.append(labelGroup);
    const entry = { a, b, path, color, jacks, label, labelGroup };
    this.cables.set(id, entry);
    this.redraw();
    this._flashBox(a, "box-active", color, 1000);
    this._flashBox(b, "box-active", color, 1000);
    const clearNew = () => path.classList.remove("cable-new");
    if (reducedMotion()) {
      this._later(clearNew, 1100);
    } else {
      const len = path.getTotalLength();
      if (len > 0 && typeof path.animate === "function") {
        path.style.strokeDasharray = `${len}`;
        const anim = path.animate({ strokeDashoffset: [len, 0] }, { duration: 520, easing: "ease-out" });
        anim.finished.then(() => { path.style.strokeDasharray = ""; this._later(clearNew, 550); }, clearNew);
      } else {
        this._later(clearNew, 700);
      }
    }
  }

  cut(id) {
    const cable = this.cables.get(id);
    if (!cable) return;
    cable.path.remove();
    for (const jack of cable.jacks || []) jack.remove();
    cable.labelGroup?.remove();
    this.cables.delete(id);
    this.pulseMeta.delete(id);
  }

  _rect(name, outer) {
    const r = this.boxes.get(name).wrap.getBoundingClientRect();
    return {
      left: r.left - outer.left,
      right: r.right - outer.left,
      top: r.top - outer.top,
      bottom: r.bottom - outer.top,
      width: r.width,
      height: r.height,
      cx: r.left + r.width / 2 - outer.left,
      cy: r.top + r.height / 2 - outer.top,
    };
  }

  redraw() {
    const outer = this.el.getBoundingClientRect();
    const { width, height } = outer;
    if (!width || !height) return;
    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    // Snapshot geometry for all boxes currently on stage.
    const rects = new Map();
    for (const name of this.boxes.keys()) rects.set(name, this._rect(name, outer));

    // Group parallel cables between the same pair of boxes so they fan cleanly.
    const pairTotals = new Map();
    const pairSeen = new Map();
    for (const cable of this.cables.values()) {
      if (!rects.has(cable.a) || !rects.has(cable.b)) continue;
      const key = [cable.a, cable.b].sort().join("\0");
      pairTotals.set(key, (pairTotals.get(key) || 0) + 1);
    }

    let spanH = 0;
    let spanV = 0;
    let maxCableY = 0;

    for (const cable of this.cables.values()) {
      const ra = rects.get(cable.a), rb = rects.get(cable.b);
      if (!ra || !rb) continue;
      const key = [cable.a, cable.b].sort().join("\0");
      const slot = pairSeen.get(key) || 0;
      pairSeen.set(key, slot + 1);
      const count = pairTotals.get(key) || 1;
      const spread = (slot - (count - 1) / 2);

      const stacked = Math.abs(rb.top - ra.top) > Math.min(ra.height, rb.height) * 0.55;
      let d = "", p1, p2;

      if (!stacked) {
        const leftBox = ra.cx <= rb.cx ? ra : rb;
        const rightBox = ra.cx <= rb.cx ? rb : ra;
        const rowTop = Math.min(leftBox.top, rightBox.top);
        const rowBottom = Math.max(leftBox.bottom, rightBox.bottom);
        // Check if another box sits horizontally between these two on the same row.
        const hasMiddle = [...rects.entries()].some(([n, r]) =>
          n !== cable.a && n !== cable.b &&
          r.cx > leftBox.right && r.cx < rightBox.left &&
          r.bottom > rowTop + 10 && r.top < rowBottom - 10
        );

        if (hasMiddle) {
          // Route cleanly underneath the row so we never obscure the middle box's log text.
          const underY = rowBottom + 24 + spanH * 20;
          spanH++;
          const ax = ra.cx + spread * 16;
          const bx = rb.cx + spread * 16;
          p1 = [ax, ra.bottom];
          p2 = [bx, rb.bottom];
          d = `M${p1[0]},${p1[1]} C${p1[0]},${underY} ${p2[0]},${underY} ${p2[0]},${p2[1]}`;
          maxCableY = Math.max(maxCableY, underY + 12);
        } else {
          // Adjacent horizontal boxes: anchor at facing edges around vertical center.
          const aIsLeft = ra.cx <= rb.cx;
          const ay = ra.top + ra.height * 0.48 + spread * 22;
          const by = rb.top + rb.height * 0.48 + spread * 22;
          p1 = [aIsLeft ? ra.right : ra.left, ay];
          p2 = [aIsLeft ? rb.left : rb.right, by];
          const sag = 14 + Math.abs(p2[0] - p1[0]) * 0.08 + Math.abs(spread) * 6;
          const ctrlY = Math.max(ay, by) + sag;
          d = `M${p1[0]},${p1[1]} Q${(p1[0] + p2[0]) / 2},${ctrlY} ${p2[0]},${p2[1]}`;
          maxCableY = Math.max(maxCableY, ctrlY);
        }
      } else {
        const topBox = ra.cy <= rb.cy ? ra : rb;
        const botBox = ra.cy <= rb.cy ? rb : ra;
        // Check if another box sits vertically between these two in the same column.
        const hasMiddleV = [...rects.entries()].some(([n, r]) =>
          n !== cable.a && n !== cable.b &&
          r.cy > topBox.bottom && r.cy < botBox.top &&
          r.right > Math.min(topBox.left, botBox.left) + 10 &&
          r.left < Math.max(topBox.right, botBox.right) - 10
        );

        if (hasMiddleV) {
          // Bypass around the right outer edge so we never draw through middle box text on mobile.
          const edgeX = Math.min(width + 10, Math.max(topBox.right, botBox.right) + 12 + spanV * 6);
          spanV++;
          const aIsTop = ra.cy <= rb.cy;
          p1 = [ra.right, ra.cy + spread * 14];
          p2 = [rb.right, rb.cy + spread * 14];
          d = `M${p1[0]},${p1[1]} C${edgeX},${p1[1]} ${edgeX},${p2[1]} ${p2[0]},${p2[1]}`;
          void aIsTop;
        } else {
          const aIsTop = ra.cy <= rb.cy;
          const ax = ra.cx + spread * 26;
          const bx = rb.cx + spread * 26;
          p1 = [ax, aIsTop ? ra.bottom : ra.top];
          p2 = [bx, aIsTop ? rb.top : rb.bottom];
          const midY = (p1[1] + p2[1]) / 2;
          d = `M${p1[0]},${p1[1]} C${p1[0]},${midY} ${p2[0]},${midY} ${p2[0]},${p2[1]}`;
        }
      }

      cable.path.setAttribute("d", d);
      cable.jacks[0].setAttribute("cx", p1[0]);
      cable.jacks[0].setAttribute("cy", p1[1]);
      cable.jacks[1].setAttribute("cx", p2[0]);
      cable.jacks[1].setAttribute("cy", p2[1]);

      if (cable.labelGroup) {
        const len = cable.path.getTotalLength();
        const mid = len > 0 ? cable.path.getPointAtLength(len / 2) : { x: (p1[0] + p2[0]) / 2, y: (p1[1] + p2[1]) / 2 };
        const text = cable.labelGroup.querySelector("text");
        const rect = cable.labelGroup.querySelector("rect");
        const w = Math.max(44, cable.label.length * 6.8 + 14);
        const h = 18;
        rect.setAttribute("x", mid.x - w / 2);
        rect.setAttribute("y", mid.y - h / 2);
        rect.setAttribute("width", w);
        rect.setAttribute("height", h);
        text.setAttribute("x", mid.x);
        text.setAttribute("y", mid.y + 0.5);
        maxCableY = Math.max(maxCableY, mid.y + h / 2 + 4);
      }
    }

    // Reserve extra bottom space if multiple spanning cables route underneath,
    // so cables never overlap the legend below the stage.
    const boxesBottom = Math.max(0, ...[...rects.values()].map((r) => r.bottom));
    const needed = maxCableY > boxesBottom ? Math.ceil(maxCableY - boxesBottom + 16) : 0;
    const minPad = needed > 56 ? `${needed}px` : "";
    if (this.el.style.paddingBottom !== minPad) this.el.style.paddingBottom = minPad;
  }

  pulse(id, from) {
    const cable = this.cables.get(id);
    if (!cable) return;
    const to = from === cable.b ? cable.a : cable.b;
    const now = performance.now();
    const prev = this.pulseMeta.get(id);
    // If a message just left in the opposite direction on the same cable, pace
    // the visual reply dot so the reader sees request arrive before reply leaves.
    let delay = 0;
    if (!reducedMotion() && prev && prev.from !== from && now < prev.until) {
      delay = Math.min(420, Math.max(0, prev.until - now));
    }
    this.pulseMeta.set(id, { from, until: now + delay + 380 });

    const fire = () => {
      if (!cable.path.isConnected) return;
      this._flashBox(from, "box-send", cable.color, 650);
      cable.path.classList.add("cable-active");
      this._later(() => cable.path.classList.remove("cable-active"), 550);

      // With reduced motion there is no travelling dot or WAAPI motion:
      // highlight the sending box, the cable, and the receiving box cleanly.
      if (reducedMotion()) {
        this._flashBox(to, "box-recv", cable.color, 750);
        return;
      }

      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("r", 7.5);
      dot.setAttribute("fill", COLORS[cable.color] || cable.color);
      dot.classList.add("pulse");
      this.svg.append(dot);
      const length = cable.path.getTotalLength();
      const backwards = from === cable.b;
      const start = performance.now();
      const duration = 460;
      const step = (ts) => {
        const t = Math.min(1, (ts - start) / duration);
        if (!cable.path.isConnected) return dot.remove();
        const point = cable.path.getPointAtLength((backwards ? 1 - t : t) * length);
        dot.setAttribute("cx", point.x);
        dot.setAttribute("cy", point.y);
        if (t < 1) requestAnimationFrame(step);
        else { dot.remove(); this._flashBox(to, "box-recv", cable.color, 650); }
      };
      requestAnimationFrame(step);
    };

    delay > 0 ? this._later(fire, delay) : fire();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  reset() {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.pulseMeta.clear();
    for (const fn of this.cleanups) { try { fn(); } catch {} }
    this.cleanups.clear();
    for (const id of [...this.cables.keys()]) this.cut(id);
    for (const box of this.boxes.values()) { clearTimeout(box._flashTimer); box.watch.disconnect(); box.wrap.remove(); }
    this.boxes.clear();
    this.el.style.paddingBottom = "";
    this.showKey();
    this.listeners.clear();
  }

  destroy() {
    this.reset();
    removeEventListener("message", this.onMessage);
    this.resize.disconnect();
    this.key.remove();
    this.svg.remove();
  }
}
