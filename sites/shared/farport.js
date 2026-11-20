// A MessagePort whose other end is on another device.
//
// Both devices open a WebSocket to /meet/<code>. The server tells them when
// both are there and passes along the handful of messages WebRTC needs. After
// that the two talk over a data channel, directly, and each side is handed an
// ordinary MessagePort that stands for it. Whatever is posted into the port
// comes out of the port on the other device.
//
// The far side is JSON only: a port cannot carry a port to another machine.

export function far({ code, host = false, onPort, onState = () => {} }) {
  const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/meet/${code}?role=${host ? "host" : "guest"}`);
  let pc = null, chain = Promise.resolve();
  const signal = (data) => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: "signal", data })); };

  const wire = (dc, mine) => {
    const { port1, port2 } = new MessageChannel();
    dc.onmessage = (event) => { try { port1.postMessage(JSON.parse(event.data)); } catch {} };
    port1.onmessage = (event) => { if (dc.readyState === "open") dc.send(JSON.stringify(event.data)); };
    dc.onclose = () => { port1.close(); mine.close(); onState("gone"); };
    const ready = () => { onState("direct"); onPort(port2); };
    dc.readyState === "open" ? ready() : (dc.onopen = ready);
  };

  const start = () => {
    pc?.close();
    const mine = pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] });
    chain = Promise.resolve();
    mine.onicecandidate = (event) => event.candidate && signal({ candidate: event.candidate });
    if (host) {
      wire(mine.createDataChannel("port"), mine);
      mine.setLocalDescription().then(() => signal({ description: mine.localDescription }), () => onState("failed"));
    } else mine.ondatachannel = (event) => wire(event.channel, mine);
  };

  ws.onopen = () => onState("waiting");
  ws.onerror = () => onState("failed");
  ws.onmessage = (event) => {
    let msg; try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.t === "both") { onState("found"); start(); }
    if (msg.t === "signal" && pc) {
      const mine = pc;
      chain = chain.then(async () => {
        const { description, candidate } = msg.data || {};
        if (description) {
          await mine.setRemoteDescription(description);
          if (description.type === "offer") { await mine.setLocalDescription(); signal({ description: mine.localDescription }); }
        } else if (candidate) await mine.addIceCandidate(candidate);
      }).catch(() => {});
    }
  };
  return { close() { try { ws.close(); } catch {} pc?.close(); } };
}
