// A patch bay for demos. A box made with frame() is a real browsing context: a
// sandboxed srcdoc iframe with an opaque origin, so a hop to or from it is
// cross-origin. It is not a site: it has no address and no storage. A demo
// that says "site" must use box() with the `src` of a page on a real origin. Cables are drawn when a port lands somewhere, and a dot
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
  iframe: { label: "<iframe>", about: "A page embedded in this one. Its address is written underneath. One marked sandbox with the address about:srcdoc has no site behind it: this page wrote its HTML, and the sandbox gives it an opaque origin, which matches no other origin. It stands in for code from someone else." },
  worker: { label: "Worker", about: "A background thread that belongs to one page. The script it runs is written underneath." },
  shared: { label: "SharedWorker", about: "One background thread that every page of a site can connect to." },
  service: { label: "Service Worker", about: "A background thread that answers network requests for one part of a site. The browser starts and stops it." },
  worklet: { label: "AudioWorklet", about: "Code that runs on the thread that produces sound." },
  device: { label: "Another device", about: "A browser on a different machine." },
  part: { label: "In this page", about: "Something the page draws itself. It is not a separate page or thread." },
  cable: { label: "MessageChannel", about: "A solid cable is one channel. The plug at each end is one of its two ports, and a moving dot is a message. The line a page has to its own worker, and a tab has to a shared worker, is a pair of ports too." },
  stream: { label: "Stream", about: "A dashed line marked stream is a ReadableStream or WritableStream that was transferred. Chunks go one way, towards the arrow." },
  post: { label: "postMessage, no channel", about: "A dashed line marked postMessage is a message sent straight to a window or a service worker. Neither side keeps a port." },
  fetch: { label: "fetch", about: "A dashed line marked fetch is a network request that a service worker answers." },
  rtc: { label: "WebRTC data channel", about: "A dashed line marked WebRTC is a direct connection to another device. Each side wraps its end so that it can be used as a MessagePort." },
};
// What is written on a line that is not a MessageChannel.
const LINES = { stream: "stream", post: "postMessage", fetch: "fetch", rtc: "WebRTC" };
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
  stream: `<path d="M2 9h16" stroke-dasharray="4 2.5"/><path d="M17 5.5l5 3.5-5 3.5z" fill="currentColor"/>`,
  post: `<path d="M2 9h20" stroke-dasharray="4 2.5"/>`,
  fetch: `<path d="M2 9h16" stroke-dasharray="4 2.5"/><path d="M17 5.5l5 3.5-5 3.5z" fill="currentColor"/>`,
  rtc: `<path d="M2 9h20" stroke-dasharray="4 2.5"/>`,
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
    this.seen = new Set(); // every kind of line drawn since the last reset, for the key
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
  // `as: "window"` is for a frame that stands for a site's own window: it is
  // drawn as a window with the frame's address in its bar, and the key says
  // that it is a frame in this page.
  box(name, { html = "", src = null, title = null, kind = null, url = null, scope = null, wide = false, as = null } = {}) {
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
    const box = { name, node, wrap, as, kind: kind || (src ? "iframe" : guess(name, html)), url, scope, frame: node.querySelector("iframe"), whenReady: new Promise((r) => (ready = r)), ready };
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
      if (box.kind !== "device") box.kind = box.as === "window" ? "window" : "iframe";
    }
    const { kind } = box, bar = box.wrap.querySelector(".ctx-bar"), foot = box.wrap.querySelector(".ctx-foot");
    box.wrap.dataset.kind = kind;
    let label = KINDS[kind].label, where = address(box.url), full = box.url || "";
    if (kind === "window") {
      full = box.url || location.href;
      bar.innerHTML = `<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="ctx-url" title="${esc(full)}">${address(box.url || location.origin + location.pathname)}</span>`;
    } else {
      if (kind === "iframe") {
        label = box.sandboxed ? "<iframe sandbox>" : "<iframe>";
        if (!box.url) where = "<i>no page loaded yet</i>";
        else if (box.url === "about:srcdoc") where += box.sandboxed ? " <i>opaque origin. This page wrote its HTML.</i>" : " <i>same origin as this page, which wrote its HTML</i>";
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
    const lines = this.seen.size ? this.seen : new Set(["cable"]);
    const kinds = Object.keys(KINDS).filter((kind) => lines.has(kind) || [...this.boxes.values()].some((box) => box.kind === kind));
    // Frames are always inside this page. When the page has no box of its own, the key says so.
    const all = [...this.boxes.values()];
    const hidden = all.some((box) => box.kind === "iframe") && !all.some((box) => box.kind === "window");
    const standIns = all.some((box) => box.as === "window" && box.frame);
    const html = this.boxes.size ? legend(kinds, false) + (hidden ? `<p class="stage-note">Not drawn: this page, ${address(location.origin + location.pathname)}, which embeds every frame above.</p>` : "") + (standIns ? `<p class="stage-note">Each window above is shown as a frame inside this page, ${address(location.origin + location.pathname)}. It loads the address in its bar.</p>` : "") : "";
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

  // Draw a line from box a to box b. `kind` says what the line is, and only
  // "cable" is a MessageChannel: a solid line with a plug at each end, one for
  // each port. The others are dashed, say what they are in words, and point:
  // "stream" (a transferred stream, read at b) and "fetch" (a request that b
  // answers) have an arrow at b. "post" (messages to a window or a service
  // worker, with no port kept) and "rtc" (a WebRTC data channel) have none.
  cable(id, a, b, color = "yellow", kindOrOpts = "cable") {
    let kind = "cable", customLabel = "", dashed = false;
    if (typeof kindOrOpts === "string") {
      if (kindOrOpts === "cable" || kindOrOpts in LINES) kind = kindOrOpts;
      else customLabel = kindOrOpts;
    } else if (kindOrOpts && typeof kindOrOpts === "object") {
      if (kindOrOpts.kind && (kindOrOpts.kind === "cable" || kindOrOpts.kind in LINES)) kind = kindOrOpts.kind;
      customLabel = kindOrOpts.label || "";
      dashed = !!kindOrOpts.dashed;
    }
    this.cut(id);
    const make = (tag) => document.createElementNS(SVG_NS, tag);
    const stroke = COLORS[color] || color;
    const path = make("path");
    path.setAttribute("stroke", stroke);
    path.classList.add("cable", "cable-new");
    path.dataset.kind = kind;
    if (dashed) path.classList.add("cable-dashed");
    const parts = [path];
    let jacks = [], arrow = null, kindLabel = null, labelGroup = null;
    if (kind === "cable") {
      // The plug at each end is one of the channel's two ports.
      jacks = [0, 1].map(() => {
        const jack = make("circle");
        jack.setAttribute("r", 6.5);
        jack.setAttribute("fill", stroke);
        jack.classList.add("jack-end");
        return jack;
      });
      parts.push(...jacks);
    } else {
      if (kind === "stream" || kind === "fetch") {
        arrow = make("path");
        arrow.setAttribute("fill", stroke);
        arrow.classList.add("cable-arrow");
        parts.push(arrow);
      }
      kindLabel = make("text");
      kindLabel.textContent = customLabel || LINES[kind];
      kindLabel.classList.add("cable-label");
      parts.push(kindLabel);
    }
    if (kind === "cable" && customLabel) {
      labelGroup = make("g");
      labelGroup.classList.add("cable-label");
      const rect = make("rect");
      rect.setAttribute("rx", 8);
      rect.setAttribute("ry", 8);
      rect.setAttribute("stroke", stroke);
      const text = make("text");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      text.textContent = customLabel;
      labelGroup.append(rect, text);
      parts.push(labelGroup);
    }
    this.svg.append(...parts);
    this.cables.set(id, { a, b, path, color, jacks, arrow, kindLabel, label: customLabel, labelGroup, kind, parts });
    this.seen.add(kind);
    this.redraw();
    this.showKey();
    this._flashBox(a, "box-active", color, 1000);
    this._flashBox(b, "box-active", color, 1000);
    const clearNew = () => path.classList.remove("cable-new");
    if (reducedMotion()) {
      this._later(clearNew, 1100);
    } else if (kind === "cable") {
      const len = path.getTotalLength();
      if (len > 0 && typeof path.animate === "function") {
        path.style.strokeDasharray = `${len}`;
        const anim = path.animate({ strokeDashoffset: [len, 0] }, { duration: 520, easing: "ease-out" });
        anim.finished.then(() => { path.style.strokeDasharray = ""; this._later(clearNew, 550); }, clearNew);
      } else {
        this._later(clearNew, 700);
      }
    } else {
      for (const part of parts) if (typeof part.animate === "function") part.animate({ opacity: [0, 1] }, { duration: 400 });
      this._later(clearNew, 600);
    }
  }

  cut(id) {
    const cable = this.cables.get(id);
    for (const part of cable?.parts || []) part.remove();
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
          // Bypass around the right outer edge inside a reserved gutter so we
          // never draw through middle box text or clip off-screen on mobile.
          const edgeX = Math.min(width - 4, Math.max(topBox.right, botBox.right) + 14 + spanV * 6);
          spanV++;
          p1 = [ra.right, ra.cy + spread * 14];
          p2 = [rb.right, rb.cy + spread * 14];
          d = `M${p1[0]},${p1[1]} C${edgeX},${p1[1]} ${edgeX},${p2[1]} ${p2[0]},${p2[1]}`;
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
      if (cable.jacks.length === 2) {
        cable.jacks[0].setAttribute("cx", p1[0]);
        cable.jacks[0].setAttribute("cy", p1[1]);
        cable.jacks[1].setAttribute("cx", p2[0]);
        cable.jacks[1].setAttribute("cy", p2[1]);
      }

      const len = cable.path.getTotalLength();
      if (cable.arrow && len > 20) {
        // An arrowhead at b, turned to follow the end of the line.
        const tip = cable.path.getPointAtLength(len), back = cable.path.getPointAtLength(len - 12);
        const turn = Math.atan2(tip.y - back.y, tip.x - back.x) * 180 / Math.PI;
        cable.arrow.setAttribute("d", "M0,0L-15,-8L-15,8z");
        cable.arrow.setAttribute("transform", `translate(${tip.x},${tip.y}) rotate(${turn})`);
      }
      if (cable.kindLabel) {
        // Two lines of one kind between the same boxes share one word.
        const mid = len > 0 ? cable.path.getPointAtLength(len / 2) : { x: (p1[0] + p2[0]) / 2, y: (p1[1] + p2[1]) / 2 };
        const duplicate = slot > 0 && [...this.cables.values()].some((other) => other !== cable && other.kind === cable.kind && [other.a, other.b].sort().join("\0") === key);
        const text = duplicate ? "" : (cable.label || LINES[cable.kind]);
        cable.kindLabel.textContent = text;
        const nearRight = mid.x > width - 64;
        const lx = stacked ? (nearRight ? mid.x - 10 : mid.x + 12) : Math.max(28, Math.min(width - 28, mid.x));
        cable.kindLabel.setAttribute("x", lx);
        cable.kindLabel.setAttribute("y", mid.y - (stacked ? 0 : 12));
        cable.kindLabel.style.textAnchor = stacked ? (nearRight ? "end" : "start") : "middle";
        maxCableY = Math.max(maxCableY, mid.y + 10);
      }

      if (cable.labelGroup) {
        const mid = len > 0 ? cable.path.getPointAtLength(len / 2) : { x: (p1[0] + p2[0]) / 2, y: (p1[1] + p2[1]) / 2 };
        const text = cable.labelGroup.querySelector("text");
        const rect = cable.labelGroup.querySelector("rect");
        const w = Math.max(44, cable.label.length * 6.8 + 14);
        const h = 18;
        const cx = Math.max(w / 2 + 2, Math.min(width - w / 2 - 2, mid.x));
        rect.setAttribute("x", cx - w / 2);
        rect.setAttribute("y", mid.y - h / 2);
        rect.setAttribute("width", w);
        rect.setAttribute("height", h);
        text.setAttribute("x", cx);
        text.setAttribute("y", mid.y + 0.5);
        maxCableY = Math.max(maxCableY, mid.y + h / 2 + 4);
      }
    }

    // Reserve extra bottom/right space when spanning cables route underneath or
    // along the right edge, so cables never overlap legends or clip on mobile.
    const boxesBottom = Math.max(0, ...[...rects.values()].map((r) => r.bottom));
    const needed = maxCableY > boxesBottom ? Math.ceil(maxCableY - boxesBottom + 16) : 0;
    const minPad = needed > 56 ? `${needed}px` : "";
    if (this.el.style.paddingBottom !== minPad) this.el.style.paddingBottom = minPad;
    const rightPad = spanV > 0 ? `${Math.min(36, 18 + spanV * 6)}px` : "";
    if (this.el.style.paddingRight !== rightPad) this.el.style.paddingRight = rightPad;
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
    this.el.style.paddingRight = "";
    this.seen.clear();
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
