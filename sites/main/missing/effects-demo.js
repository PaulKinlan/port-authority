// The webcam effects demo on /missing/. One frame on another origin provides
// the effects. This page sends it the same pictures two ways at once:
//
//   as a VideoFrame, which is what the design wants, and
//   as an ImageBitmap, which is what crosses origins today.
//
// Each way has a channel of its own and one picture in flight at a time.

const { sites } = await import("/_sites.js");
const OTHER = sites.florist;
const W = 320, H = 180;

export async function mount(root) {
  root.innerHTML = `
    <div class="fx-grid">
      <figure><canvas width="${W}" height="${H}" data-source aria-label="The picture this page is sending"></canvas><figcaption><b>This page</b><span data-source-note>A drawing made by this page. No camera is in use.</span></figcaption></figure>
      <figure><iframe title="The effects service, on another origin" data-frame></iframe><figcaption><b>The effects service</b><span data-url></span></figcaption></figure>
      <figure><canvas width="${W}" height="${H}" data-out="bitmap" aria-label="What came back when the pictures were sent as ImageBitmap"></canvas><figcaption><b>Sent as ImageBitmap</b><span data-note="bitmap">Not started.</span></figcaption></figure>
      <figure><canvas width="${W}" height="${H}" data-out="frame" aria-label="What came back when the pictures were sent as VideoFrame"></canvas><figcaption><b>Sent as VideoFrame</b><span data-note="frame">Not started.</span></figcaption></figure>
    </div>
    <p class="controls"><button data-start>Start</button> <button class="quiet" data-camera>Use my camera</button> <button class="quiet" data-effect disabled>Next effect</button></p>`;
  const $ = (s) => root.querySelector(s);
  const source = $("[data-source]"), sctx = source.getContext("2d");
  const iframe = $("[data-frame]");
  $("[data-url]").textContent = OTHER + "/effects.html";

  // What the page sends: its own drawing, or the camera once the person allows it.
  let video = null;
  const paint = (t) => {
    if (video && video.readyState >= 2) { sctx.drawImage(video, 0, 0, W, H); return; }
    sctx.fillStyle = "#0f1c3f"; sctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 6; i++) {
      sctx.fillStyle = ["#f5b700", "#e0364c", "#0e9f8e"][i % 3];
      sctx.beginPath(); sctx.arc(W / 2 + Math.cos(t / 600 + i) * W * 0.34, H / 2 + Math.sin(t / 450 + i * 2) * H * 0.3, 14 + i * 4, 0, 7); sctx.fill();
    }
    sctx.fillStyle = "#fff"; sctx.font = "700 20px system-ui"; sctx.fillText((t / 1000).toFixed(1) + " s", 12, 28);
  };
  $("[data-camera]").addEventListener("click", async (event) => {
    event.target.disabled = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: W, height: H } });
      video = Object.assign(document.createElement("video"), { srcObject: stream, muted: true, playsInline: true });
      await video.play();
      $("[data-source-note]").textContent = "Your camera, opened by this page. The effects service is not given the camera, only pictures from it.";
    } catch (err) { $("[data-source-note]").textContent = `The camera could not be opened (${err.name}). Still sending the drawing.`; }
  });

  const effects = ["mosaic", "invert", "mirror"];
  let effect = 0;
  $("[data-effect]").addEventListener("click", () => { effect = (effect + 1) % effects.length; });

  // One lane for each way of sending.
  const lane = (kind, make) => ({
    kind, make, port: null, waiting: false, stopped: "", sent: 0, back: 0, makeMs: 0, tripMs: 0, sentAt: 0, timer: 0, stamp: null,
    note: $(`[data-note="${kind}"]`), ctx: $(`[data-out="${kind}"]`).getContext("2d"),
  });
  const lanes = [
    lane("bitmap", async (t) => ({ bitmap: await createImageBitmap(source) })),
    lane("frame", async (t) => ({ frame: new VideoFrame(source, { timestamp: Math.round(t * 1000) }) })),
  ];
  const stop = (l, why) => { l.stopped = why; l.waiting = false; clearTimeout(l.timer); l.note.textContent = why; l.note.dataset.state = "gap"; };
  const describe = (l) => {
    const each = (l.tripMs / l.back).toFixed(1), made = (l.makeMs / l.back).toFixed(2);
    l.note.dataset.state = "works";
    l.note.textContent = l.kind === "frame"
      ? `${l.back} frames back. ${each} ms for each round trip, ${made} ms of it making the frame. Each came back with the timestamp it left with.`
      : `${l.back} pictures back. ${each} ms for each round trip, ${made} ms of it making the bitmap. A bitmap has no timestamp, so the page has to keep its own.`;
  };
  const connect = (l) => {
    const { port1, port2 } = new MessageChannel();
    l.port = port1;
    port1.onmessage = ({ data }) => {
      if (data.ready) return;
      if (data.unreadable) return stop(l, `Failed on the first ${l.kind === "frame" ? "frame" : "picture"}. postMessage did not throw. The effects service got a messageerror event and no ${l.kind === "frame" ? "VideoFrame" : "ImageBitmap"}, and this page was only told because the service wrote back to say so.`);
      const picture = data.frame || data.bitmap;
      clearTimeout(l.timer);
      l.ctx.drawImage(picture, 0, 0, W, H); picture.close();
      l.back++; l.tripMs += performance.now() - l.sentAt; l.waiting = false;
      if (l.back % 5 === 0 || l.back === 1) describe(l);
    };
    // Coming back, a picture can fail to be rebuilt here too.
    port1.onmessageerror = () => stop(l, "The effects service sent a result back and this page could not rebuild it.");
    iframe.contentWindow.postMessage({ effects: true }, OTHER, [port2]);
  };
  const send = async (l, t) => {
    l.waiting = true;
    const started = performance.now();
    let message;
    try { message = await l.make(t); }
    catch (err) { return stop(l, `This browser could not make one to send (${err.name}).`); }
    l.makeMs += performance.now() - started;
    const picture = message.frame || message.bitmap;
    try { l.port.postMessage({ ...message, id: ++l.sent, effect: effects[effect] }, [picture]); }
    catch (err) { picture.close(); return stop(l, `postMessage threw ${err.name}: this browser refuses to send it to another origin.`); }
    l.sentAt = performance.now();
    l.timer = setTimeout(() => stop(l, "Nothing came back in 3 seconds."), 3000);
  };

  let running = false;
  const loop = (t) => {
    if (!root.isConnected) return;
    paint(t);
    if (running) for (const l of lanes) if (!l.waiting && !l.stopped && l.port) send(l, t);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the effects frame never loaded")), 8000);
    addEventListener("message", function on(event) {
      if (event.source !== iframe.contentWindow || event.data?.effects !== "ready") return;
      clearTimeout(timer); removeEventListener("message", on); resolve();
    });
  });
  iframe.src = OTHER + "/effects.html";
  $("[data-start]").addEventListener("click", async (event) => {
    event.target.disabled = true;
    try { await ready; } catch (err) { for (const l of lanes) stop(l, `The demo could not start: ${err.message}.`); return; }
    for (const l of lanes) { l.note.textContent = "Sending."; connect(l); }
    $("[data-effect]").disabled = false;
    running = true;
  });
  return { lanes };
}
