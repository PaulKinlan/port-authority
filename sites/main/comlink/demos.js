// The three demos on /comlink/. Each one does real work: a fractal drawn by
// two workers, a third-party widget on another origin reading a note you can
// edit, and a journal kept in a locked file.
import { sites } from "/_sites.js";
import { wrap, expose, offer, closed, LinkClosedError } from "/hawser.js";
import * as Comlink from "/vendor/comlink.mjs";

const DISPOSE = Symbol.dispose ?? Symbol.for("Symbol.dispose");
const $ = (selector, root = document) => root.querySelector(selector);
const ms = (n) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`);

// ---------------------------------------------------------------- explorer

const HOME = { cx: -0.6, cy: 0, scale: 3.4, level: 0 };
const TARGET = { cx: -0.743643887037151, cy: 0.13182590420533 }; // seahorse valley
const withLimit = (view) => ({ ...view, limit: 400 + 110 * view.level });

function explorer(section) {
  const panes = {};
  for (const lib of ["hawser", "comlink"]) {
    const el = $(`.pane[data-lib="${lib}"]`, section);
    const canvas = $("canvas", el);
    panes[lib] = {
      el, canvas, ctx: canvas.getContext("2d"),
      set(name, value) { $(`[data-stat="${name}"]`, el).textContent = value; },
      status(text, bad = false, { announce = true } = {}) {
        const s = $(".status", el);
        s.setAttribute("aria-live", announce ? "polite" : "off");
        s.textContent = text;
        s.classList.toggle("bad", bad);
      },
    };
  }
  const W = panes.hawser.canvas.width, H = panes.hawser.canvas.height;
  let view = HOME;

  // Hawser: rows arrive as they are made, and a new view aborts the old one.
  const h = { asked: 0, cancelled: 0, wasted: 0, controller: null, worker: null, api: null, died: 0, note: "" };
  function startHawser() {
    h.worker = new Worker("/comlink/render-worker.js", { type: "module", name: "hawser" });
    h.api = wrap(h.worker, { heartbeat: 300 });
    const mine = h.api;
    closed(mine).then(() => {
      if (h.api !== mine || !section.isConnected) return;
      h.note = `The worker died. Noticed after ${ms(performance.now() - h.died)} and replaced. `;
      panes.hawser.status(h.note, true);
      panes.hawser.el.dataset.recovered = "true";
      startHawser();
      drawHawser();
    });
  }
  async function drawHawser() {
    if (h.controller && !h.controller.signal.aborted) { h.controller.abort(); h.cancelled++; }
    const controller = (h.controller = new AbortController());
    const { signal } = controller, api = h.api, pane = panes.hawser;
    pane.set("asked", ++h.asked); pane.set("cancelled", h.cancelled);
    const started = performance.now();
    try {
      for await (const band of api.rows(withLimit(view), W, H, signal)) {
        if (signal.aborted) { h.wasted += band.ms; break; } // one band at most
        pane.ctx.putImageData(new ImageData(band.pixels, W), 0, band.y);
      }
      if (signal.aborted) return;
      h.controller = null;
      pane.status(`${h.note || ""}Zoom ${2 ** view.level}x drawn in ${ms(performance.now() - started)}`);
      h.note = "";
      pane.el.dataset.drawn = view.level;
    } catch (error) {
      if (!(error instanceof LinkClosedError)) pane.status(`${error.name}: ${error.message}`, true);
    } finally {
      pane.set("wasted", ms(h.wasted)); pane.set("cancelled", h.cancelled);
    }
  }

  // Comlink: a frame is asked for and awaited whole. There is nothing to
  // cancel with, so frames queue up inside the worker.
  const c = { asked: 0, waiting: 0, wasted: 0, latest: 0, since: 0, worker: null, api: null, gen: 0, announcedStuck: false };
  function startComlink() {
    c.gen++;
    c.worker = new Worker("/comlink/render-worker.js", { type: "module", name: "comlink" });
    c.api = Comlink.wrap(c.worker);
    c.waiting = 0;
    c.announcedStuck = false;
    delete panes.comlink.el.dataset.crashed;
  }
  async function drawComlink() {
    const pane = panes.comlink, id = ++c.latest, level = view.level, gen = c.gen;
    pane.set("asked", ++c.asked); pane.set("waiting", ++c.waiting);
    if (c.waiting === 1) c.since = performance.now();
    const frame = await c.api.frame(withLimit(view), W, H);
    if (gen !== c.gen) return;
    pane.set("waiting", --c.waiting);
    c.since = performance.now();
    c.announcedStuck = false;
    pane.ctx.putImageData(new ImageData(frame.pixels, W), 0, 0);
    if (id !== c.latest) {
      c.wasted += frame.ms;
      pane.set("wasted", ms(c.wasted));
      pane.status(`Showing zoom ${2 ** level}x, which you have already left`, false, { announce: false });
    } else {
      pane.status(`Zoom ${2 ** level}x drawn`, false, { announce: true });
      pane.el.dataset.drawn = level;
    }
  }
  const stuck = setInterval(() => {
    if (!section.isConnected) return clearInterval(stuck);
    if (c.waiting && performance.now() - c.since > 1500) {
      const announce = !c.announcedStuck;
      c.announcedStuck = true;
      panes.comlink.status(`Waiting. No answer for ${Math.round((performance.now() - c.since) / 1000)} s`, true, { announce });
    }
  }, 500);

  const go = (next) => { view = next; drawHawser(); drawComlink(); };
  const zoomCenter = () => {
    if (view.level >= 36) return;
    go({ ...view, scale: view.scale / 2, level: view.level + 1 });
  };
  for (const pane of Object.values(panes)) {
    pane.canvas.addEventListener("click", (event) => {
      if (view.level >= 36) return;
      const box = pane.canvas.getBoundingClientRect(), step = view.scale / W;
      const x = ((event.clientX - box.left) / box.width) * W, y = ((event.clientY - box.top) / box.height) * H;
      go({ cx: view.cx + (x - W / 2) * step, cy: view.cy + (y - H / 2) * step, scale: view.scale / 2, level: view.level + 1 });
    });
    pane.canvas.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        zoomCenter();
      }
    });
  }
  let diving;
  const diveBtn = $("#dive", section);
  diveBtn.onclick = () => {
    // Fourteen zoom steps, a new one every 100 ms: someone holding a zoom key.
    diveBtn.disabled = true;
    let steps = 0;
    diving = setInterval(() => {
      if (++steps > 14 || !section.isConnected) { clearInterval(diving); diving = null; diveBtn.disabled = false; return; }
      const level = view.level + 1 > 30 ? 1 : view.level + 1;
      go({ ...TARGET, scale: HOME.scale / 2 ** level, level });
    }, 100);
  };
  $("#in", section).onclick = zoomCenter;
  $("#out", section).onclick = () => { if (view.level > 0) go({ ...view, scale: view.scale * 2, level: view.level - 1 }); };
  $("#home", section).onclick = () => go(HOME);
  $("#crash", section).onclick = () => {
    // terminate() is what a crash looks like from outside: no event, no error, no goodbye.
    h.died = performance.now();
    h.worker.terminate(); c.worker.terminate();
    panes.comlink.el.dataset.crashed = "true";
    go({ ...view }); // and the page carries on asking, as it would
  };
  $("#restart", section).onclick = () => {
    if (diving) { clearInterval(diving); diving = null; diveBtn.disabled = false; }
    if (h.controller) { h.controller.abort(); h.controller = null; }
    // Detach current Hawser api before terminating so closed() doesn't treat manual restart as a crash.
    h.api = null;
    try { h.worker?.terminate(); } catch {}
    try { c.worker?.terminate(); } catch {}
    h.asked = h.cancelled = h.wasted = 0; h.note = "";
    c.asked = c.waiting = c.wasted = 0;
    panes.hawser.set("asked", 0); panes.hawser.set("cancelled", 0); panes.hawser.set("wasted", "0 ms");
    panes.comlink.set("asked", 0); panes.comlink.set("waiting", 0); panes.comlink.set("wasted", "0 ms");
    panes.hawser.status("Restarted");
    panes.comlink.status("Restarted");
    startHawser();
    startComlink();
    go(HOME);
  };

  startHawser();
  startComlink();
  go(HOME);
}

// ------------------------------------------------------------------ widget

function widget(section) {
  const note = $("#note", section);
  const saved = (() => { try { return localStorage.getItem("pa-comlink-note"); } catch { return null; } })();
  const ORIGINAL = note.value;
  if (saved) note.value = saved;
  note.addEventListener("input", () => { try { localStorage.setItem("pa-comlink-note", note.value); } catch {} });
  $("#restore", section).onclick = () => { note.value = ORIGINAL; note.dispatchEvent(new Event("input")); };

  // Embed the widget from another origin and hand it a port once it is listening.
  const embed = (lib, connect, onFail) => {
    const holder = $(`.widget[data-lib="${lib}"]`, section);
    holder.querySelector("iframe")?.remove();
    holder.querySelector(".widget-error")?.remove();
    delete holder.dataset.ready;
    const frame = document.createElement("iframe");
    frame.title = `Word count widget, connected with ${lib}`;
    const timer = setTimeout(() => {
      removeEventListener("message", listener);
      frame.remove();
      const err = document.createElement("p");
      err.className = "status bad widget-error";
      err.setAttribute("role", "alert");
      err.textContent = `Could not load the cross-origin widget from ${sites.library}.`;
      holder.append(err);
      onFail?.();
    }, 8000);
    const listener = (event) => {
      if (event.source !== frame.contentWindow || event.origin !== sites.library || event.data?.widget !== "ready") return;
      clearTimeout(timer);
      removeEventListener("message", listener);
      connect(offer(frame.contentWindow, sites.library, { lib }));
      holder.dataset.ready = "true";
    };
    addEventListener("message", listener);
    frame.src = `${sites.library}/comlink/widget.html`;
    holder.append(frame);
  };

  // What the page is willing to share with Comlink: a facade with only the
  // safe methods on it. This is the careful way to use Comlink.
  embed("comlink", (port) => {
    Comlink.expose({
      read: () => note.value,
      subscribe(callback) { note.addEventListener("input", () => callback(note.value)); },
    }, port);
  });

  // With Hawser the real object is exposed, and the link says what is reachable.
  const model = {
    read: () => note.value,
    write(text) { note.value = text; note.dispatchEvent(new Event("input")); },
    async *changes() {
      let wake, dirty = false;
      const changed = () => { dirty = true; wake?.(); };
      note.addEventListener("input", changed);
      try { for (;;) { yield note.value; if (!dirty) await new Promise((resolve) => (wake = resolve)); dirty = false; } }
      finally { note.removeEventListener("input", changed); }
    },
  };
  let revoke;
  const grant = () => embed("hawser", (port) => {
    revoke = new AbortController();
    expose(model, port, { only: ["read", "changes"], signal: revoke.signal });
    $("#revoke", section).disabled = false; $("#regrant", section).disabled = true;
  }, () => {
    $("#revoke", section).disabled = true; $("#regrant", section).disabled = false;
  });
  $("#revoke", section).onclick = (event) => { revoke?.abort(); event.target.disabled = true; $("#regrant", section).disabled = false; };
  $("#regrant", section).onclick = grant;
  grant();
}

// ----------------------------------------------------------------- journal

function journal(section) {
  const worker = new Worker("/comlink/journal-worker.js", { type: "module" });
  let api = wrap(worker);
  const kept = []; // handles this page forgot to let go of
  const list = $("#entries", section), status = $("#journal-status", section), input = $("#entry", section);
  const submitBtn = $("#journal-form button", section), closeBtn = $("#journal-close", section), clearBtn = $("#journal-clear", section);
  let busy = false;
  const setBusy = (on) => {
    busy = on;
    submitBtn.disabled = closeBtn.disabled = clearBtn.disabled = on;
  };
  const render = (lines) => {
    list.replaceChildren(...lines.slice(-6).reverse().map((line) => Object.assign(document.createElement("li"), { textContent: line })));
    if (!lines.length) list.innerHTML = `<li class="muted">Nothing written yet.</li>`;
  };
  const report = async (text, bad = false) => {
    status.textContent = text; status.classList.toggle("bad", bad);
    $("#handles", section).textContent = await api.handlesOpen().catch(() => "?");
  };
  // Open the file, do something, and let go of it the way the checkbox says.
  // Dispose BEFORE querying handlesOpen() so the count never flashes 1 -> 0.
  const withFile = async (work, done) => {
    if (busy) return;
    setBusy(true);
    const careful = $("#careful", section).checked;
    let file, msg = "", bad = false;
    try {
      file = await api.open("journal.txt");
      const lines = await work(file);
      render(lines);
      msg = careful
        ? `${done} The file was closed when the scope ended.`
        : `${done} The handle was kept by mistake, so the file is still locked.`;
    } catch (error) {
      msg = `${error.name}: ${error.message}`;
      bad = true;
    } finally {
      // This is all `using file = await api.open(...)` does at the end of a block.
      if (file) careful ? file[DISPOSE]() : kept.push(file);
    }
    try {
      await report(msg, bad);
    } finally {
      setBusy(false);
    }
  };
  $("#journal-form", section).onsubmit = (event) => {
    event.preventDefault();
    if (busy) return;
    const text = input.value.trim() || "Looked at the Comlink page";
    input.value = "";
    withFile(async (file) => { await file.append(`${new Date().toLocaleTimeString()}  ${text}`); return file.read(); }, "Written.");
  };
  clearBtn.onclick = () => withFile(async (file) => { await file.clear(); return []; }, "Emptied.");
  closeBtn.onclick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Closing the link disposes of everything it was holding on the other side.
      api[DISPOSE]();
      kept.length = 0;
      api = wrap(worker);
      await report("Closed the link and opened a new one. Every handle it held was closed with it.");
    } finally {
      setBusy(false);
    }
  };
  withFile((file) => file.read(), "Read the journal from last time.");
}

const DEMOS = { explorer, widget, journal };
export function mountAll() {
  for (const section of document.querySelectorAll("section[data-demo]")) {
    new IntersectionObserver((entries, io) => {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      DEMOS[section.dataset.demo](section);
      section.dataset.mounted = "true";
    }, { rootMargin: "300px" }).observe(section);
  }
}
