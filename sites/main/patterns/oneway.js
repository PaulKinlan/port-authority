// A port link that carries messages in one direction only, between two real
// sites that are each given one end. Same stage as the other patterns.
import { sites } from "/_sites.js";
import { oneWay } from "/oneway.js";

const actor = (stage, name, site, role, title, color) => {
  const box = stage.box(name, { src: `${sites[site]}/actor.html?role=${role}&title=${encodeURIComponent(title)}&color=${encodeURIComponent(color)}` });
  box.frame.title = title;
  return box;
};

export const oneway = {
  id: "oneway",
  title: "Join two sites with a port that carries messages one way only",
  blurb: "A <code>MessagePort</code> always works in both directions. Whoever you give one to can post into it, and there is no setting that stops them. This page wants the library's site to publish prices to the florist's site, and wants nothing to come back. So it does not give them the two ends of one channel. It makes two channels and stands between them. What the library posts is posted on to the florist. What the florist posts stops at this page and is counted. The florist holds a real port and can call <code>postMessage</code> on it as often as it likes. A message with a port or a stream in it is refused in the forward direction too, because either one would be a way to answer.",
  code: `function oneWay() {
  const inlet = new MessageChannel(), outlet = new MessageChannel();
  <span class="c">// forward: post it again, with no transfer list, so a port cannot ride along</span>
  inlet.port2.onmessage = (e) => { try { outlet.port1.postMessage(e.data); } catch {} };
  <span class="c">// backward: nothing</span>
  outlet.port1.onmessage = () => {};
  return { send: inlet.port1, receive: outlet.port2,
           cut: () => { inlet.port2.close(); outlet.port1.close(); } };
}

const link = oneWay();
library.postMessage({ cmd: "feed" }, libraryOrigin, [link.send]);
florist.postMessage({ cmd: "feed" }, floristOrigin, [link.receive]);`,
  tour: { steps: [
    ["Join them one way", "This page makes two channels. The library gets an end it can post into. The florist gets an end it can hear on."],
    ["Library: publish a price", "The library posts a price. This page posts it on, and the florist hears it."],
    ["Florist: post an order back", "The florist posts into its port. The message reaches this page and goes no further. The library hears nothing."],
    ["Florist: post a port back", "The florist tries to open a way back by posting a port. This page closes that port."],
    ["Library: send a port forward", "The library tries to hand the florist a private line. A port cannot be copied, so posting the message on fails, and the florist gets nothing."],
    ["Cut the link", "This page closes its two ends."],
    ["Library: publish a price", "The library posts again. Nothing is on the other end, and the florist hears nothing."],
  ] },
  async setup(stage, ui) {
    const library = actor(stage, "pub", "library", "publisher", "Library, a real site", "#0e9f8e");
    const box = stage.box("page", { html: `<div class="here"><h4>This page, in between</h4>
      <p class="small" style="margin:0 0 .25rem">Passed on to the florist: <strong data-passed>0</strong></p>
      <p class="small" style="margin:0 0 .25rem">Stopped, coming back: <strong data-dropped>0</strong></p>
      <p class="small" style="margin:0 0 .4rem">Refused, going forward: <strong data-refused>0</strong></p>
      <ul class="log"></ul></div>` });
    const florist = actor(stage, "sub", "florist", "subscriber", "Florist, a real site", "#e0364c");
    const ul = box.node.querySelector("ul");
    const say = (text) => { const li = document.createElement("li"); li.textContent = text; ul.prepend(li); while (ul.children.length > 3) ul.lastChild.remove(); };
    const show = (counts) => { for (const key of ["passed", "dropped", "refused"]) box.node.querySelector(`[data-${key}]`).textContent = counts[key]; };
    await Promise.all([library.whenReady, florist.whenReady]);
    let link = null;
    const buttons = [
      ui.button("Library: publish a price", () => stage.post("pub", { cmd: "publish" }), true),
      ui.button("Florist: post an order back", () => stage.post("sub", { cmd: "answer" }), true),
      ui.button("Florist: post a port back", () => stage.post("sub", { cmd: "smuggle" }), true),
      ui.button("Library: send a port forward", () => stage.post("pub", { cmd: "smuggle" }), true),
    ];
    const cut = ui.button("Cut the link", (btn) => {
      link.cut(); stage.cut("in"); stage.cut("out"); btn.disabled = true;
      say("closed both of my ends");
    }, true);
    ui.button("Join them one way", (btn) => {
      btn.disabled = true;
      link = oneWay({
        onPass() { show(link.counts); stage.pulse("out", "page"); say("passed a message on"); },
        onDrop(direction) {
          show(link.counts);
          say(direction === "back" ? "stopped a message from the florist" : "refused a message from the library: it held something that cannot be copied");
        },
      });
      stage.post("pub", { cmd: "feed" }, [link.send]);
      stage.post("sub", { cmd: "feed" }, [link.receive]);
      stage.cable("in", "pub", "page", "teal");
      stage.cable("out", "page", "sub", "red");
      say("gave each site one end");
      for (const b of buttons) b.disabled = false;
      cut.disabled = false;
    }, false, true);
  },
};
