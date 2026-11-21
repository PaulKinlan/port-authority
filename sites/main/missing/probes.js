// The checks behind /missing/. Each one tries the thing the page says is
// missing, in the browser that is reading the page, and says what happened.
//
// Values are made and used by the lab's own table (/lab/kinds.js), which also
// loads in every receiver, so a check here and a cell in the lab mean the same
// thing. Each check gets a receiver of its own, because one of them can kill
// its receiver.

const { sites } = await import("/_sites.js");
await new Promise((resolve, reject) => { const s = document.createElement("script"); s.src = "/lab/kinds.js"; s.onload = resolve; s.onerror = reject; document.head.append(s); });
const KINDS = new Map(globalThis.LAB_KINDS.map((k) => [k.name, k]));
export const OTHER = sites.florist;
export const otherHost = new URL(OTHER).host;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const heard = (port, test, ms) => new Promise((resolve) => {
  const timer = setTimeout(() => { port.removeEventListener("message", on); resolve(null); }, ms);
  const on = (event) => { if (!test(event)) return; clearTimeout(timer); port.removeEventListener("message", on); resolve(event); };
  port.addEventListener("message", on); port.start();
});

const frame = (attrs) => new Promise((resolve, reject) => {
  const el = Object.assign(document.createElement("iframe"), { hidden: true });
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  const timer = setTimeout(() => { el.remove(); reject(new Error("the frame never loaded")); }, 8000);
  addEventListener("message", function on(event) {
    if (event.source !== el.contentWindow || event.data?.lab !== "frame-ready") return;
    clearTimeout(timer); removeEventListener("message", on); resolve(el);
  });
  document.body.append(el);
});

// Each place gives back a port whose far end runs the lab's receiver, and the
// first message that came out of it.
const PLACES = {
  async other() {
    const el = await frame({ src: OTHER + "/lab/frame.html" });
    const { port1, port2 } = new MessageChannel();
    const hello = heard(port1, (e) => e.data?.hello, 6000);
    el.contentWindow.postMessage({ ctl: true }, "*", [port2]);
    return { port: port1, hello: await hello, close: () => { port1.close(); el.remove(); } };
  },
  async sandbox() {
    const el = await frame({ sandbox: "allow-scripts", srcdoc: `<script src="${location.origin}/lab/kinds.js"><\/script><script>addEventListener("message", (e) => e.data && e.data.ctl && labReceive(e.ports[0], "sandbox")); parent.postMessage({ lab: "frame-ready" }, "*");<\/script>` });
    const { port1, port2 } = new MessageChannel();
    const hello = heard(port1, (e) => e.data?.hello, 6000);
    el.contentWindow.postMessage({ ctl: true }, "*", [port2]);
    return { port: port1, hello: await hello, close: () => { port1.close(); el.remove(); } };
  },
  async worker() {
    const w = new Worker("/lab/receiver-worker.js");
    const { port1, port2 } = new MessageChannel();
    const hello = heard(port1, (e) => e.data?.hello, 6000);
    w.postMessage({ ctl: true }, [port2]);
    return { port: port1, hello: await hello, close: () => { port1.close(); w.terminate(); } };
  },
  async shared() {
    const w = new SharedWorker("/lab/receiver-worker.js");
    return { port: w.port, hello: await heard(w.port, (e) => e.data?.hello, 6000), close: () => w.port.close() };
  },
};

// Send one kind of object to one place. The outcomes are the lab's:
// works, arrives-broken, unreadable (messageerror on the far side), refused
// (postMessage threw here), no-answer, died, cannot-make, no-destination.
export async function send(place, name) {
  const kind = KINDS.get(name);
  let value;
  try { value = await kind.make(); } catch (err) { return { outcome: "cannot-make", note: String(err.message || err) }; }
  let link;
  try { link = await PLACES[place](); if (!link.hello) throw new Error("the receiver never answered"); }
  catch (err) { globalThis.labRelease(value); return { outcome: "no-destination", note: String(err.message || err) }; }
  try {
    const answer = heard(link.port, (e) => e.data?.seq === 1 && e.data.outcome, 2500);
    try {
      link.port.postMessage({ next: 1 });
      link.port.postMessage({ test: name, value }, kind.how === "move" ? [value] : []);
    } catch (err) { return { outcome: "refused", note: err.name }; }
    finally { globalThis.labRelease(value); }
    const event = await answer;
    if (event) return { outcome: event.data.outcome, note: event.data.note };
    const pong = heard(link.port, (e) => e.data?.pong, 1200);
    link.port.postMessage({ ping: true });
    return (await pong) ? { outcome: "no-answer", note: "" } : { outcome: "died", note: "" };
  } finally { link.close(); }
}

const WHERE = {
  other: `a frame on ${otherHost}`, sandbox: "a sandboxed frame", worker: "a worker", shared: "a shared worker",
};
// One sentence for an outcome. `gap` is true when the thing did not get through.
const say = (place, name, r) => {
  const to = WHERE[place];
  switch (r.outcome) {
    case "works": return { gap: false, text: `It arrived in ${to} and worked there (${r.note}).` };
    case "unreadable": return { gap: true, text: `postMessage did not throw. ${to[0].toUpperCase() + to.slice(1)} got a messageerror event and no ${name}.` };
    case "refused": return { gap: true, text: `postMessage threw ${r.note} when I tried to send it to ${to}.` };
    case "arrives-broken": return { gap: true, text: `Something arrived in ${to} and could not be used: ${r.note}.` };
    case "died": return { gap: true, text: `${to[0].toUpperCase() + to.slice(1)} stopped answering for good after I sent it.` };
    case "no-answer": return { gap: true, text: `Nothing came back from ${to} in 2.5 seconds, and it is still answering pings.` };
    case "cannot-make": return { gap: null, text: `This browser could not make one to send (${r.note}).` };
    default: return { gap: null, text: `The check could not run: ${r.note}.` };
  }
};
const sending = (place, name) => async () => { const r = await send(place, name); return { ...say(place, name, r), outcome: r.outcome }; };

export const PROBES = {
  "videoframe-other": sending("other", "VideoFrame"),
  "videoframe-sandbox": sending("sandbox", "VideoFrame"),
  "videoframe-shared": sending("shared", "VideoFrame"),
  "audiodata-other": sending("other", "AudioData"),
  "chunk-other": sending("other", "EncodedVideoChunk"),
  "imagebitmap-other": sending("other", "ImageBitmap"),
  "datachannel-other": sending("other", "RTCDataChannel"),
  "mediasource-other": sending("other", "MediaSourceHandle"),
  "filehandle-other": sending("other", "FileSystemFileHandle"),
  "stream-other": sending("other", "ReadableStream"),
  "track-worker": sending("worker", "MediaStreamTrack"),
  "abortsignal-worker": sending("worker", "AbortSignal"),
  "response-worker": sending("worker", "Response"),
  // Run on a click, and last: Chrome ends the process of the frame it is sent to.
  "canvas-other": sending("other", "OffscreenCanvas (from a canvas element)"),

  // Give a worker one end of a channel, end the worker, and listen on the other end.
  async "close-event"() {
    const has = "onclose" in MessagePort.prototype;
    const w = new Worker(URL.createObjectURL(new Blob(["onmessage = (e) => { self.kept = e.ports[0]; postMessage('holding'); };"], { type: "text/javascript" })));
    const { port1, port2 } = new MessageChannel();
    const holding = new Promise((r) => { w.onmessage = r; });
    w.postMessage(null, [port2]);
    await holding;
    const started = performance.now();
    const fired = new Promise((r) => { port1.addEventListener("close", () => r(Math.round(performance.now() - started))); port1.start(); });
    w.terminate();
    const ms = await Promise.race([fired, wait(1500).then(() => null)]);
    port1.close();
    if (ms !== null) return { gap: false, text: `I gave a worker one end of a channel and ended the worker. A close event fired on my end ${ms} ms later.` };
    return { gap: true, text: `I gave a worker one end of a channel and ended the worker. Nothing fired on my end in 1.5 seconds. ${has ? "MessagePort has an onclose property here." : "MessagePort has no onclose property here."}` };
  },

  // What a receiver can learn about who posted into a port.
  async "port-origin"() {
    const link = await PLACES.other();
    try {
      if (!link.hello) return { gap: null, text: "The check could not run: the frame never answered." };
      const { origin, source } = link.hello;
      const empty = origin === "" && source === null;
      return { gap: empty, text: `A frame on ${otherHost} posted into a port I hold. On the message, event.origin is ${JSON.stringify(origin)} and event.source is ${source === null ? "null" : "set"}.` };
    } finally { link.close(); }
  },
};

// Fill every element that names a check. The canvas check waits for its button.
export async function runAll(root = document) {
  const targets = [...root.querySelectorAll("[data-probe]")].filter((el) => !el.dataset.manual);
  const cache = new Map();
  await Promise.all(targets.map(async (el) => {
    const id = el.dataset.probe;
    if (!PROBES[id]) return;
    if (!cache.has(id)) cache.set(id, PROBES[id]().catch((err) => ({ gap: null, text: `The check could not run: ${err.message || err}.` })));
    show(el, await cache.get(id));
  }));
  return Object.fromEntries(await Promise.all([...cache].map(async ([id, p]) => [id, await p])));
}

export function show(el, result) {
  el.dataset.state = result.gap === true ? "gap" : result.gap === false ? "works" : "unknown";
  const short = el.dataset.short !== undefined;
  el.textContent = short ? (result.gap === true ? "No" : result.gap === false ? "Yes" : "Could not check") : result.text;
  if (short) el.title = result.text;
}
