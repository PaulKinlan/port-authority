// The running demos on /missing/, one for each gap that can be shown. Each
// tries the design the page asks for, and beside it the nearest thing that
// works today, and says what happened to both.
//
// The other party in each demo is a real frame on another origin
// (/missing-peer.html, with its part named in the address).

const { sites } = await import("/_sites.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const host = (origin) => new URL(origin).host;

// A frame on another origin playing `role`, holding the far end of the port returned.
const peer = (iframe, role, origin = sites.florist) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("the frame never loaded")), 8000);
  addEventListener("message", function on(event) {
    if (event.source !== iframe.contentWindow || event.data?.missing !== "ready") return;
    removeEventListener("message", on);
    const { port1, port2 } = new MessageChannel();
    port1.addEventListener("message", function first(e) { if (!e.data?.ready) return; port1.removeEventListener("message", first); clearTimeout(timer); resolve({ port: port1, first: e }); });
    port1.start();
    iframe.contentWindow.postMessage({ missing: true }, origin, [port2]);
  });
  iframe.src = `${origin}/missing-peer.html?role=${role}`;
});
const next = (port, test, ms = 2500) => new Promise((resolve) => {
  const timer = setTimeout(() => { port.removeEventListener("message", on); resolve(null); }, ms);
  const on = (e) => { if (!test(e.data)) return; clearTimeout(timer); port.removeEventListener("message", on); resolve(e.data); };
  port.addEventListener("message", on);
});

const fig = (title, inner, note = "") => `<figure>${inner}<figcaption><b>${title}</b><span data-note>${note}</span></figcaption></figure>`;
const frameFig = (title, role, origin = sites.florist) => fig(title, `<iframe title="${title}" data-role="${role}"></iframe>`, `${origin}/missing-peer.html?role=${role}`);
const build = (root, figures, buttons) => {
  root.innerHTML = `<div class="fx-grid">${figures.join("")}</div><ul class="lanes"></ul><p class="controls">${buttons.map(([id, label], i) => `<button data-do="${id}"${i ? ' class="quiet"' : ""}>${label}</button>`).join(" ")}</p>`;
  const lanes = root.querySelector(".lanes");
  // One line of result for each way of doing the job.
  const lane = (label) => {
    const li = document.createElement("li");
    li.innerHTML = `<b>${label}</b> <span>Not started.</span>`;
    lanes.append(li);
    const span = li.querySelector("span");
    return { set: (text, state) => { span.textContent = text; if (state) li.dataset.state = state; else delete li.dataset.state; }, li };
  };
  const on = (id, fn) => root.querySelector(`[data-do="${id}"]`).addEventListener("click", async (event) => { event.target.disabled = true; try { await fn(event.target); } catch (err) { lane("The demo").set(`could not run: ${err.message || err}.`, "gap"); } });
  return { lane, on, $: (s) => root.querySelector(s), frames: [...root.querySelectorAll("iframe")] };
};
const refused = (err) => `postMessage threw ${err.name}.`;
const UNREADABLE = "postMessage did not throw. The frame got a messageerror event and nothing else.";

export const DEMOS = {
  // ------------------------------------------------------------ a file, to an editor on another origin
  async editor(root) {
    const ui = build(root, [
      fig("This page's file", `<pre data-file aria-label="The contents of the file"></pre>`, "note.txt, in this origin's private file system."),
      frameFig("An editor, given the file", "editor"),
      frameFig("An editor, given a copy of the text", "editor"),
    ], [["start", "Open the file in both editors"], ["type", "Type in both editors and save"]]);
    const shown = ui.$("[data-file]");
    const dir = await navigator.storage.getDirectory();
    const handle = await dir.getFileHandle("note.txt", { create: true });
    const write = async (text) => { const w = await handle.createWritable(); await w.write(text); await w.close(); };
    const show = async () => { shown.textContent = await (await handle.getFile()).text(); };
    await write("Buy tulips for Thursday."); await show();
    const A = ui.lane("Send the file handle:"), B = ui.lane("Send a copy of the text:");
    ui.$('[data-do="type"]').disabled = true;
    let a, b, aOpen = false;
    ui.on("start", async () => {
      [a, b] = await Promise.all([peer(ui.frames[0], "editor"), peer(ui.frames[1], "editor")]);
      const opened = next(a.port, (d) => d.opened || d.unreadable);
      try { a.port.postMessage({ handle }); const got = await opened; aOpen = !!got?.opened; A.set(aOpen ? "The editor opened the file itself." : UNREADABLE + " The editor has no file.", aOpen ? "works" : "gap"); }
      catch (err) { A.set(refused(err), "gap"); }
      a.port.addEventListener("message", async ({ data }) => { if (data.saved) { await show(); A.set("The editor saved the file in place. This page did nothing.", "works"); } });
      b.port.addEventListener("message", async ({ data }) => { if (typeof data.save === "string") { await write(data.save); await show(); B.set("The editor sent the new text back and this page wrote it to the file. It works, and the editor can only ever replace the whole text through code this page had to write.", "works"); } });
      b.port.postMessage({ text: await (await handle.getFile()).text() });
      B.set("The editor has a copy of the text. It cannot save by itself.", "works");
      ui.$('[data-do="type"]').disabled = false;
    });
    ui.on("type", async () => { if (aOpen) a.port.postMessage({ type: " And a card.", save: true }); b.port.postMessage({ type: " And a card.", save: true }); });
  },

  // ------------------------------------------------------------ one network connection, to a plug-in
  async plugin(root) {
    const ui = build(root, [
      fig("The far end of the connection", `<pre data-far aria-label="Messages arriving at the far end"></pre>`, "A WebRTC connection this page opened. In this demo both ends are in this page."),
      frameFig("A plug-in, given the data channel", "plugin"),
      frameFig("A plug-in, given a port joined to it", "plugin"),
    ], [["start", "Give each plug-in the connection"], ["close", "Close the connection"]]);
    const far = ui.$("[data-far]");
    const A = ui.lane("Send the RTCDataChannel:"), B = ui.lane("Send a port, and copy every message across in this page:");
    ui.$('[data-do="close"]').disabled = true;
    let pc1, pc2;
    ui.on("start", async () => {
      pc1 = new RTCPeerConnection(); pc2 = new RTCPeerConnection();
      pc1.onicecandidate = (e) => e.candidate && pc2.addIceCandidate(e.candidate);
      pc2.onicecandidate = (e) => e.candidate && pc1.addIceCandidate(e.candidate);
      const counts = {};
      pc2.ondatachannel = ({ channel }) => { channel.onmessage = () => { counts[channel.label] = (counts[channel.label] || 0) + 1; far.textContent = Object.entries(counts).map(([k, n]) => `${n} messages on "${k}"`).join("\n"); if (channel.label === "by port") B.set(`${counts[channel.label]} messages from the plug-in have reached the far end. Each one passed through this page, which has to stay open.`, "works"); else A.set(`${counts[channel.label]} messages from the plug-in have reached the far end, with nothing passing through this page.`, "works"); }; };
      const direct = pc1.createDataChannel("direct"), bridged = pc1.createDataChannel("by port");
      const [a, b] = await Promise.all([peer(ui.frames[0], "plugin"), peer(ui.frames[1], "plugin")]);
      // The channel has to be sent before it is used, so it goes first.
      const heard = next(a.port, (d) => d.got || d.unreadable);
      try { a.port.postMessage({ channel: direct }, [direct]); const got = await heard; if (!got?.got) A.set(UNREADABLE + " The plug-in has no connection.", "gap"); }
      catch (err) { A.set(refused(err) + " The plug-in has no connection.", "gap"); }
      await pc1.setLocalDescription(await pc1.createOffer()); await pc2.setRemoteDescription(pc1.localDescription);
      await pc2.setLocalDescription(await pc2.createAnswer()); await pc1.setRemoteDescription(pc2.localDescription);
      await new Promise((r) => { if (bridged.readyState === "open") r(); else bridged.onopen = r; });
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = ({ data }) => { if (bridged.readyState === "open") bridged.send(data); };
      b.port.postMessage({ line: true }, [port2]);
      B.set("The plug-in has a port.", "works");
      ui.$('[data-do="close"]').disabled = false;
    });
    ui.on("close", async () => { pc1.close(); pc2.close(); B.set(B.li.querySelector("span").textContent + " Closed: the plug-in can send no more.", "works"); });
  },

  // ------------------------------------------------------------ a canvas, to a painter on another origin
  async painter(root) {
    const ui = build(root, [
      fig("Pictures sent back", `<canvas width="320" height="180" data-a aria-label="Drawn by this page from pictures the painter sent"></canvas>`, "The painter sends finished pictures and this page draws them."),
      frameFig("A painter, sending pictures", "painter"),
      fig("The canvas given away", `<canvas width="320" height="180" data-b aria-label="A canvas whose drawing surface was given to the painter"></canvas>`, "The painter draws on this canvas directly."),
      frameFig("A painter, given the canvas", "painter"),
    ], [["start", "Ask for pictures"], ["give", "Give the canvas away"]]);
    const A = ui.lane("Painter sends ImageBitmap pictures:"), B = ui.lane("Painter is given the canvas:");
    B.set("Not started. In Chrome this ends the painter's frame, and the other painter with it.");
    let a, pictures = 0;
    ui.on("start", async () => {
      a = await peer(ui.frames[0], "painter");
      const ctx = ui.$("[data-a]").getContext("2d");
      a.port.addEventListener("message", ({ data }) => { if (!data.bitmap) return; ctx.drawImage(data.bitmap, 0, 0); data.bitmap.close(); if (++pictures % 15 === 1) A.set(`${pictures} pictures drawn. Each one crosses twice: painted there, then drawn again here.`, "works"); });
      a.port.postMessage({ pictures: true, width: 320, height: 180 });
    });
    ui.on("give", async () => {
      const b = await peer(ui.frames[1], "painter");
      const offscreen = ui.$("[data-b]").transferControlToOffscreen();
      try { b.port.postMessage({ canvas: offscreen }, [offscreen]); } catch (err) { return B.set(refused(err), "gap"); }
      const first = await next(b.port, (d) => d.drew || d.unreadable, 2000);
      if (first?.unreadable) return B.set(UNREADABLE, "gap");
      await wait(1500);
      const pong = next(b.port, (d) => d.pong, 1200);
      b.port.postMessage({ ping: true });
      if (await pong) return first?.drew ? B.set("The painter is drawing straight onto this page's canvas, and is still answering.", "works") : B.set("The painter is still answering, and has not said that it drew anything.", "gap");
      const before = pictures; await wait(600);
      B.set(`The painter's frame stopped answering after it was given the canvas, and has not answered a ping since.${a && pictures === before ? " The other painter, a separate frame from the same site, has stopped too." : ""}`, "gap");
    });
  },

  // ------------------------------------------------------------ a camera track, to a worker
  async track(root) {
    const ui = build(root, [
      fig("This page's video", `<canvas width="320" height="180" data-source aria-label="The video this page is making"></canvas>`, "A drawing, captured as a video track. No camera is in use."),
    ], [["start", "Hand the track to a worker"]]);
    const source = ui.$("[data-source]"), ctx = source.getContext("2d");
    const paint = (t) => { if (!root.isConnected) return; ctx.fillStyle = "#0f1c3f"; ctx.fillRect(0, 0, 320, 180); ctx.fillStyle = "#f5b700"; ctx.beginPath(); ctx.arc(160 + Math.cos(t / 500) * 110, 90 + Math.sin(t / 380) * 55, 22, 0, 7); ctx.fill(); requestAnimationFrame(paint); };
    requestAnimationFrame(paint);
    const A = ui.lane("Send the MediaStreamTrack to a worker:"), B = ui.lane("Cut the track into frames here, and send the stream of frames:");
    ui.on("start", async () => {
      const worker = new Worker("/missing/track-worker.js");
      const track = source.captureStream(30).getVideoTracks()[0];
      const heard = new Promise((r) => worker.addEventListener("message", ({ data }) => (data.got || data.unreadable) && r(data)));
      try { worker.postMessage({ track }, [track]); const got = await Promise.race([heard, wait(2000)]); A.set(got?.got ? "The worker has the track." : "postMessage did not throw, and the worker got no track.", got?.got ? "works" : "gap"); }
      catch (err) { A.set(refused(err) + " The worker has no track.", "gap"); }
      if (!("MediaStreamTrackProcessor" in self)) return B.set("This browser has no MediaStreamTrackProcessor on a page, so there is no way to do this here.", "gap");
      const live = track.readyState === "live" ? track : source.captureStream(30).getVideoTracks()[0];
      const frames = new MediaStreamTrackProcessor({ track: live }).readable;
      worker.addEventListener("message", ({ data }) => { if (data.frames) B.set(`The worker has read ${data.frames} frames. It works inside one origin, with an API only Chromium has on a page. The frames still pass through this page's thread.`, "works"); });
      worker.postMessage({ frames }, [frames]);
      B.set("Sent.", "works");
    });
  },

  // ------------------------------------------------------------ who sent this?
  async identity(root) {
    const ui = build(root, [frameFig("A sender on one origin", "hello", sites.florist), frameFig("A sender on another origin", "hello", sites.library)], [["start", "Give each a port and listen"]]);
    const A = ui.lane("First message:"), B = ui.lane("Second message:"), C = ui.lane("What I can tell:");
    ui.on("start", async () => {
      const got = await Promise.all([peer(ui.frames[0], "hello", sites.florist), peer(ui.frames[1], "hello", sites.library)]);
      const facts = got.map(({ first }) => `event.origin is ${JSON.stringify(first.origin)}, event.source is ${first.source === null ? "null" : "set"}.`);
      A.set(facts[0], "gap"); B.set(facts[1], "gap");
      C.set(`One came from ${host(sites.florist)} and the other from ${host(sites.library)}. I only know which because I made both ports myself and remember who I gave them to. If either had passed its port on, I would not know.`, "gap");
    });
  },

  // ------------------------------------------------------------ cancelling work somewhere else
  async abort(root) {
    const ui = build(root, [], [["start", "Start two long jobs and cancel both"]]);
    const A = ui.lane("Cancel with an AbortSignal:"), B = ui.lane("Cancel with a port made for the purpose:");
    const body = `onmessage = ({ data, ports }) => { let stop = false, n = 0; if (ports[0]) ports[0].onmessage = () => { stop = true; }; if (data.signal) data.signal.onabort = () => { stop = true; }; const work = () => { if (stop) return postMessage({ stopped: n }); for (let i = 0; i < 2e5; i++) n++; setTimeout(work); }; work(); };`;
    const url = URL.createObjectURL(new Blob([body], { type: "text/javascript" }));
    ui.on("start", async () => {
      const w1 = new Worker(url), w2 = new Worker(url);
      const controller = new AbortController();
      try { w1.postMessage({ signal: controller.signal }); await wait(300); const t = performance.now(); const done = new Promise((r) => { w1.onmessage = r; }); controller.abort(); await done; A.set(`The worker stopped ${Math.round(performance.now() - t)} ms after abort().`, "works"); }
      catch (err) { A.set(refused(err) + " The job was never started, because the signal is part of the request.", "gap"); }
      const { port1, port2 } = new MessageChannel();
      w2.postMessage({}, [port2]); await wait(300);
      const t = performance.now(); const done = new Promise((r) => { w2.onmessage = r; });
      port1.postMessage("stop"); await done;
      B.set(`The worker stopped ${Math.round(performance.now() - t)} ms after the message. It works, and it is a protocol every library invents for itself.`, "works");
      w1.terminate(); w2.terminate();
    });
  },
};

// Set each demo up when it is about to be seen.
export function mountAll(scope = document) {
  for (const el of scope.querySelectorAll("[data-missing-demo]")) {
    new IntersectionObserver((entries, io) => {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      DEMOS[el.dataset.missingDemo](el).catch((err) => { el.textContent = `This demo could not start: ${err.message || err}.`; });
    }, { rootMargin: "400px" }).observe(el);
  }
}
