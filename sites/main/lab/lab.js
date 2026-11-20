// The lab: send every kind of object to every place a message can go, see
// what really happens in this browser, and report it.
//
// Kinds live in /lab/kinds.js, which also loads in every receiver. This file
// is the sender, the table, and the report.

import { OUTCOMES, PLACES } from "/lab/names.js";

const ISOLATED = location.pathname.startsWith("/isolated/");
const BASE = ISOLATED ? "/isolated/lab/" : "/lab/";
await new Promise((resolve, reject) => { const s = document.createElement("script"); s.src = BASE + "kinds.js"; s.onload = resolve; s.onerror = reject; document.head.append(s); });
const { sites } = await import("/_sites.js");
const KINDS = globalThis.LAB_KINDS;
const OTHER = sites.florist; // a real second origin that serves the same receiver files



// ---------------------------------------------------------------- destinations

const waitHello = (port, ms = 6000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("the receiver never said hello")), ms);
  const on = (event) => { if (event.data?.hello) { clearTimeout(timer); port.removeEventListener("message", on); resolve(); } };
  port.addEventListener("message", on); port.start();
});
// Most destinations end up as one port whose far end runs labReceive().
const viaPort = async (give, cleanup = () => {}) => {
  const { port1, port2 } = new MessageChannel();
  const hello = waitHello(port1);
  await give(port2);
  await hello;
  return { answers: port1, send: (message, transfer) => port1.postMessage(message, transfer), close: () => { port1.close(); cleanup(); } };
};
const frame = (src, { sandbox, srcdoc } = {}) => new Promise((resolve, reject) => {
  const el = document.createElement("iframe");
  el.hidden = true;
  if (sandbox) el.sandbox = sandbox;
  if (srcdoc) el.srcdoc = srcdoc; else el.src = src;
  const timer = setTimeout(() => { el.remove(); reject(new Error("the frame never loaded")); }, 8000);
  const on = (event) => { if (event.source === el.contentWindow && event.data?.lab === "frame-ready") { clearTimeout(timer); removeEventListener("message", on); resolve(el); } };
  addEventListener("message", on);
  document.body.append(el);
});
const viaFrame = async (src, options) => {
  const el = await frame(src, options);
  return viaPort((port) => el.contentWindow.postMessage({ ctl: true }, "*", [port]), () => el.remove());
};
const inPage = (carry) => async () => ({
  // No receiver: the value is put through something in this page and used here.
  direct: async (kind, value) => {
    let back;
    try { back = await carry(value, kind); } catch (err) { return { outcome: "refused", note: `${err.name}: ${err.message}`.slice(0, 200) }; }
    try { return { outcome: "works", note: String(await kind.use(back)) }; }
    catch (err) { return { outcome: "arrives-broken", note: String(err.message || err).slice(0, 160) }; }
    finally { globalThis.labRelease(back); }
  },
  close() {},
});

export const DESTINATIONS = [
  { ...PLACES["clone"], open: inPage((value, kind) => structuredClone(value, kind.how === "move" ? { transfer: [value] } : undefined)) },
  { ...PLACES["channel"], open: () => viaPort((port) => globalThis.labReceive(port, "page")) },
  { ...PLACES["worker"], open: () => { const w = new Worker(BASE + "receiver-worker.js"); return viaPort((port) => w.postMessage({ ctl: true }, [port]), () => w.terminate()); } },
  { ...PLACES["shared"], open: async () => {
    const w = new SharedWorker(BASE + "receiver-worker.js");
    const hello = waitHello(w.port);
    await hello;
    return { answers: w.port, send: (message, transfer) => w.port.postMessage(message, transfer), close: () => w.port.close() };
  } },
  { ...PLACES["sw"], open: async () => {
    const reg = await navigator.serviceWorker.register(BASE + "sw.js", { scope: BASE + "sw-scope/" });
    const sw = reg.active || await new Promise((resolve, reject) => {
      const w = reg.installing || reg.waiting;
      w.addEventListener("statechange", () => w.state === "activated" && resolve(w));
      setTimeout(() => reject(new Error("the service worker never activated")), 8000);
    });
    return viaPort((port) => sw.postMessage({ ctl: true }, [port]));
  } },
  { ...PLACES["audio"], open: async () => {
    const audio = new AudioContext();
    await audio.audioWorklet.addModule(BASE + "audio.js");
    const node = new AudioWorkletNode(audio, "lab-receiver");
    const hello = waitHello(node.port);
    await hello;
    return { answers: node.port, send: (message, transfer) => node.port.postMessage(message, transfer), close: () => audio.close() };
  } },
  { ...PLACES["frame"], open: () => viaFrame(BASE + "frame.html") },
  { ...PLACES["frame-other"], open: () => viaFrame(OTHER + BASE + "frame.html") },
  { ...PLACES["frame-other-worker"], open: () => viaFrame(OTHER + BASE + "frame.html?via=worker") },
  { ...PLACES["frame-sandbox"], open: () => viaFrame(null, {
    sandbox: "allow-scripts",
    srcdoc: `<script src="${location.origin}${BASE}kinds.js"><\/script><script>addEventListener("message", (e) => e.data && e.data.ctl && labReceive(e.ports[0], "sandbox")); parent.postMessage({ lab: "frame-ready" }, "*");<\/script>`,
  }) },
  { ...PLACES["broadcast"], open: async () => {
    const name = "lab-" + Math.random().toString(36).slice(2);
    const w = new Worker(BASE + "receiver-worker.js");
    const { port1, port2 } = new MessageChannel();
    const hello = waitHello(port1);
    w.postMessage({ ctl: true, broadcast: name }, [port2]);
    await hello;
    const channel = new BroadcastChannel(name);
    // There is no transfer list here, so everything is offered as a copy.
    return { answers: port1, send: (message) => channel.postMessage(message), close: () => { channel.close(); w.terminate(); } };
  } },
  { ...PLACES["idb"], open: async () => {
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open("pa-lab", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("s");
      open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
    });
    const done = (request) => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    return { ...(await inPage(async (value) => { await done(db.transaction("s", "readwrite").objectStore("s").put(value, "k")); return done(db.transaction("s").objectStore("s").get("k")); })()), close: () => db.close() };
  } },
  { ...PLACES["history"], open: inPage((value) => { const before = history.state; try { history.replaceState(value, ""); return history.state; } finally { history.replaceState(before, ""); } }) },
];

// A popup needs a click, so it is not part of the automatic run.
export const POPUP = { ...PLACES["popup-other"], open: async () => {
  const win = window.open(OTHER + BASE + "frame.html", "pa_lab", "popup,width=320,height=200");
  if (!win) throw new Error("the popup was blocked");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the popup never loaded")), 8000);
    addEventListener("message", function on(event) { if (event.source === win && event.data?.lab === "frame-ready") { clearTimeout(timer); removeEventListener("message", on); resolve(); } });
  });
  return viaPort((port) => win.postMessage({ ctl: true }, "*", [port]), () => win.close());
} };

// ------------------------------------------------------------------- running

const errors = [];
const errorListeners = new Set();
export const onError = (fn) => { errorListeners.add(fn); for (const e of errors) fn(e); };
// What was being sent where, at this moment. Tests to different places run at
// once, so an error on the page is listed with everything that was in flight.
const inFlight = new Map();
const noteError = (where, message, during) => {
  if (errors.length >= 40) return;
  const error = { where, message: String(message).slice(0, 300), during: during ?? [...inFlight.values()].slice(0, 6).join("; ") };
  errors.push(error);
  for (const fn of errorListeners) fn(error);
};
addEventListener("error", (event) => noteError(event.filename ? `page, ${event.filename.split("/").pop()}:${event.lineno}` : "page", event.message));
addEventListener("unhandledrejection", (event) => noteError("an unhandled promise", event.reason?.message || event.reason));

// If the tab dies part-way, the next visit finds this note and reports it.
const JOURNAL = "pa-lab-pending";
export const diedLastTime = (() => { try { const v = JSON.parse(localStorage.getItem(JOURNAL)); localStorage.removeItem(JOURNAL); return v; } catch { return null; } })();

const cannotMake = new Map();
async function one(dest, link, kind, seq) {
  if (cannotMake.has(kind.name)) return { outcome: "cannot-make", note: cannotMake.get(kind.name) };
  let value;
  try { value = await kind.make(); } catch (err) { const note = String(err.message || err).slice(0, 160); cannotMake.set(kind.name, note); return { outcome: "cannot-make", note }; }
  try { localStorage.setItem(JOURNAL, JSON.stringify({ kind: kind.name, dest: dest.id, at: Date.now() })); } catch {}
  if (link.direct) {
    return Promise.race([link.direct(kind, value), new Promise((r) => setTimeout(() => r({ outcome: "no-answer", note: "never finished" }), 2500))]).finally(() => globalThis.labRelease(value));
  }
  const answer = new Promise((resolve) => {
    const timer = setTimeout(() => { link.answers.removeEventListener("message", on); resolve({ outcome: "no-answer", note: "nothing came back in 2.5 s" }); }, 2500);
    const on = (event) => { if (event.data?.seq !== seq) return; clearTimeout(timer); link.answers.removeEventListener("message", on); resolve({ outcome: event.data.outcome, note: event.data.note, type: event.data.type }); };
    link.answers.addEventListener("message", on);
  });
  try {
    link.send({ next: seq });
    link.send({ test: kind.name, value }, kind.how === "move" ? [value] : []);
  } catch (err) { return { outcome: "refused", note: `${err.name}: ${err.message}`.slice(0, 200) }; }
  // A copy leaves the original here, and a refusal leaves it unsent. Either way it is ours to close.
  finally { globalThis.labRelease(value); }
  return answer;
}

export async function run(destinations, onCell) {
  const results = {};
  await Promise.all(destinations.map(async (dest) => {
    results[dest.id] = {};
    let link = null;
    try { link = await dest.open(); } catch (err) { noteError(dest.label, "could not be set up: " + err.message, ""); }
    let seq = 0, lastHeard = "the start", dead = "", restarts = 0;
    const alive = () => new Promise((resolve) => {
      const timer = setTimeout(() => { link.answers.removeEventListener("message", on); resolve(false); }, 1200);
      const on = (event) => { if (event.data?.pong) { clearTimeout(timer); link.answers.removeEventListener("message", on); resolve(true); } };
      link.answers.addEventListener("message", on);
      try { link.send({ ping: true }); } catch { resolve(false); }
    });
    for (const kind of KINDS) {
      inFlight.set(dest.id, `${kind.name} to ${dest.label}`);
      const result = dead ? { outcome: "no-answer", note: dead }
        : link ? await one(dest, link, kind, ++seq).catch((err) => ({ outcome: "no-answer", note: String(err.message || err) })) : { outcome: "no-destination", note: "could not be set up" };
      // A silence may mean this value killed the receiver. Ask it. If it is
      // gone, say which value did it, and start a new receiver for the rest.
      if (result.outcome === "no-answer" && !dead && link?.answers && !(await alive())) {
        result.note = "the receiver died, or stopped answering for good";
        noteError(dest.label, `the receiver died on ${kind.name} (last answer: ${lastHeard})`, kind.name);
        try { link.close(); } catch {}
        try { if (++restarts > 3) throw new Error("too many restarts"); link = await dest.open(); seq = 0; }
        catch (err) { dead = `the receiver died on ${kind.name} and could not be started again`; }
      } else if (result.outcome !== "no-answer" && result.outcome !== "cannot-make" && result.outcome !== "refused") lastHeard = kind.name;
      results[dest.id][kind.name] = result;
      onCell(dest, kind, result);
    }
    inFlight.delete(dest.id);
    try { link?.close(); } catch {}
  }));
  try { localStorage.removeItem(JOURNAL); } catch {}
  return results;
}

// ---------------------------------------------------------------- reporting

export async function environment() {
  const ua = navigator.userAgent;
  let name = "Unknown", version = "";
  const brands = navigator.userAgentData?.brands?.filter((b) => !/not.?a.?brand/i.test(b.brand)) || [];
  const brand = brands.find((b) => b.brand !== "Chromium") || brands[0];
  if (brand) { name = brand.brand; version = brand.version; }
  else {
    const m = ua.match(/(Firefox|FxiOS|Edg|OPR|CriOS|Chrome)\/([\d.]+)/) || ua.match(/Version\/([\d.]+).*(Safari)/);
    if (m) [name, version] = m[2] === "Safari" ? ["Safari", m[1]] : [m[1], m[2]];
  }
  let detail = {};
  try { detail = await navigator.userAgentData.getHighEntropyValues(["fullVersionList", "platformVersion"]); } catch {}
  const full = detail.fullVersionList?.find((b) => b.brand === name)?.version;
  return {
    browser: name, version: String(full || version), platform: navigator.userAgentData?.platform || navigator.platform || "",
    platformVersion: detail.platformVersion || "", mobile: !!navigator.userAgentData?.mobile, ua,
    isolated: !!self.crossOriginIsolated, secure: isSecureContext, lab: globalThis.LAB_VERSION,
  };
}

export async function report(results, extra = {}) {
  const cells = [];
  for (const [dest, row] of Object.entries(results)) for (const [kind, r] of Object.entries(row)) cells.push([kind, dest, r.outcome, r.note || ""]);
  const body = JSON.stringify({ env: await environment(), cells, errors, died: diedLastTime, ...extra });
  const res = await fetch("/lab/report", { method: "POST", headers: { "content-type": "application/json" }, body });
  if (!res.ok) throw new Error("the server said " + res.status);
  return res.json();
}

export { KINDS, ISOLATED, OUTCOMES };
