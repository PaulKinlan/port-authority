// The frame on another origin that the demos on /missing/ talk to. It is
// handed one port and plays the part named in its address (?role=).
// It has no access to the page that embeds it.
(() => {
  const role = new URLSearchParams(location.search).get("role") || "census";
  const $ = (id) => document.getElementById(id);
  const say = (text) => { $("said").textContent = text; };
  $("where").textContent = location.host;
  const tag = (v) => Object.prototype.toString.call(v).slice(8, -1);

  const ROLES = {
    // Says what arrived, or that something arrived that could not be rebuilt.
    census(port) {
      $("title").textContent = "A receiver";
      let n = 0;
      port.onmessage = ({ data }) => {
        if (data.ping) return port.postMessage({ pong: true });
        n++; say(`${n} values have arrived. The last was a ${tag(data.value)}.`);
        const v = data.value;
        try { if (v && typeof v.close === "function" && /^(VideoFrame|AudioData|ImageBitmap)$/.test(tag(v))) v.close(); } catch (e) {}
        port.postMessage({ census: data.census, type: tag(v) });
      };
      port.onmessageerror = () => port.postMessage({ unreadable: true });
    },

    // A text editor. It is sent either a file handle, or the text of the file.
    editor(port) {
      $("title").textContent = "An editor";
      $("ui").innerHTML = '<textarea aria-label="The file, in the editor" disabled></textarea><button disabled>Save</button>';
      const area = document.querySelector("textarea"), save = document.querySelector("button");
      let handle = null;
      port.onmessage = async ({ data }) => {
        if (data.handle) {
          handle = data.handle;
          area.value = await (await handle.getFile()).text(); area.disabled = save.disabled = false;
          say("I was given the file itself. I can read it and save it in place.");
          port.postMessage({ opened: "handle" });
        } else if (typeof data.text === "string") {
          area.value = data.text; area.disabled = save.disabled = false;
          say("I was given a copy of the text. To save, I have to send text back and trust the page to write it.");
          port.postMessage({ opened: "text" });
        } else if (data.type) { area.value += data.type; if (data.save) save.click(); }
      };
      port.onmessageerror = () => { say("Something arrived that I could not read."); port.postMessage({ unreadable: true }); };
      save.onclick = async () => {
        if (handle) { const w = await handle.createWritable(); await w.write(area.value); await w.close(); port.postMessage({ saved: "in place" }); }
        else port.postMessage({ save: area.value });
      };
    },

    // Paints. It is sent a canvas to draw on, or asked to send finished pictures.
    painter(port) {
      $("title").textContent = "A painter";
      const draw = (ctx, w, h, t) => {
        ctx.fillStyle = "#0f1c3f"; ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 5; i++) { ctx.fillStyle = ["#f5b700", "#e0364c", "#0e9f8e"][i % 3]; ctx.fillRect(w / 2 + Math.cos(t / 500 + i) * w * 0.3 - 12, h / 2 + Math.sin(t / 380 + i * 2) * h * 0.3 - 12, 24, 24); }
        ctx.fillStyle = "#fff"; ctx.font = "700 16px system-ui"; ctx.fillText("painted on " + location.host, 10, 22);
      };
      let frames = 0;
      port.onmessage = ({ data }) => {
        if (data.ping) return port.postMessage({ pong: true });
        if (data.canvas) {
          const ctx = data.canvas.getContext("2d");
          say("I was given the canvas. I am drawing straight onto the page.");
          // On a timer and not on animation frames: a frame that is off screen gets none.
          const tick = () => { draw(ctx, data.canvas.width, data.canvas.height, performance.now()); if (++frames % 20 === 1) port.postMessage({ drew: frames }); };
          tick(); setInterval(tick, 33);
        } else if (data.pictures) {
          const c = new OffscreenCanvas(data.width, data.height), ctx = c.getContext("2d");
          say("I am sending finished pictures. The page draws them.");
          const tick = () => { draw(ctx, c.width, c.height, performance.now()); const bitmap = c.transferToImageBitmap(); port.postMessage({ bitmap }, [bitmap]); };
          tick(); setInterval(tick, 33);
        }
      };
      port.onmessageerror = () => { say("Something arrived that I could not read."); port.postMessage({ unreadable: true }); };
    },

    // A plug-in that wants to talk on one network connection. It is sent a
    // data channel, or a port that the page has joined to one.
    plugin(port) {
      $("title").textContent = "A plug-in";
      let n = 0;
      const talk = (line, what) => {
        say(`I was given ${what}. I am sending on it.`);
        const send = () => { try { line.send ? line.send("plug-in message " + ++n) : line.postMessage("plug-in message " + ++n); } catch (e) { say("The line was closed."); clearInterval(timer); } };
        const timer = setInterval(send, 400); send();
      };
      port.onmessage = ({ data, ports }) => {
        if (data.channel) { talk(data.channel, "the data channel itself"); port.postMessage({ got: "channel" }); }
        else if (data.line && ports[0]) { talk(ports[0], "a port joined to the connection"); port.postMessage({ got: "port" }); }
      };
      port.onmessageerror = () => { say("Something arrived that I could not read."); port.postMessage({ unreadable: true }); };
    },

    // Says hello on the port, and nothing else. Used to show what a receiver can learn about a sender.
    hello(port) {
      $("title").textContent = "A sender";
      say("I posted one message into the port I was given.");
      port.postMessage({ hello: true });
    },
  };

  addEventListener("message", (event) => {
    if (!event.data || !event.data.missing || !event.ports[0]) return;
    ROLES[role](event.ports[0]);
    event.ports[0].postMessage({ ready: role });
  });
  parent.postMessage({ missing: "ready", role }, "*");
})();
