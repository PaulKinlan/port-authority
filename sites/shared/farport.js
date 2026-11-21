// A MessagePort whose other end is on another device.
//
// Both devices open a WebSocket to /meet/<code>. The server tells them when
// both are there and passes along the handful of messages WebRTC needs. After
// that the two talk over a data channel, directly, and each side is handed an
// ordinary MessagePort that stands for it. Whatever is posted into the port
// comes out of the port on the other device.
//
// portwire.js does the carrying. Data, bytes, ports and streams can all be
// posted into the port. A port or a stream is rebuilt on the other device and
// joined to the one that was sent.
import { bridge } from "/portwire.js";

const HIGH = 1 << 20;     // stop handing the channel more when it holds this much unsent

// A data channel as the pipe portwire.js wants: bytes in order, and a send
// that waits while the channel is full.
function pipeOver(dc) {
  dc.binaryType = "arraybuffer";
  dc.bufferedAmountLowThreshold = HIGH / 4;
  const pipe = {
    send(bytes) {
      if (dc.readyState !== "open") throw new Error("the connection closed");
      dc.send(bytes);
      if (dc.bufferedAmount < HIGH) return;
      return new Promise((resolve) => {
        const done = () => { dc.removeEventListener("bufferedamountlow", done); dc.removeEventListener("close", done); resolve(); };
        dc.addEventListener("bufferedamountlow", done); dc.addEventListener("close", done);
      });
    },
    close() { try { dc.close(); } catch {} },
    onmessage: null, onclose: null,
  };
  dc.onmessage = (event) => pipe.onmessage?.(event.data);
  dc.onclose = () => pipe.onclose?.();
  return pipe;
}

export function far({ code, host = false, onPort, onState = () => {}, onError = () => {} }) {
  const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/meet/${code}?role=${host ? "host" : "guest"}`);
  let pc = null, chain = Promise.resolve(), link = null;
  const signal = (data) => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: "signal", data })); };

  const wire = (dc, mine) => {
    const ready = () => {
      link = bridge(pipeOver(dc), { onerror: onError, onclose: () => { mine.close(); onState("gone"); } });
      onState("direct");
      onPort(link.port);
    };
    dc.readyState === "open" ? ready() : (dc.onopen = ready);
  };

  const start = () => {
    pc?.close();
    const mine = pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] });
    chain = Promise.resolve();
    mine.onicecandidate = (event) => event.candidate && signal({ candidate: event.candidate });
    mine.onconnectionstatechange = () => { if (mine === pc && mine.connectionState === "failed" && !link) onState("failed"); };
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

  return {
    close() { try { ws.close(); } catch {} link?.close(); pc?.close(); },
    // Ports and streams riding on the connection, and bytes so far.
    get counts() { return link ? link.counts : { ports: 0, streams: 0, sent: 0, received: 0 }; },
    // How the two ended up connected: on one network, or across the internet.
    async route() {
      if (!pc) return "";
      const stats = await pc.getStats();
      for (const report of stats.values()) {
        if (report.type !== "candidate-pair" || !report.nominated || report.state !== "succeeded") continue;
        const local = stats.get(report.localCandidateId), remote = stats.get(report.remoteCandidateId);
        const types = [local?.candidateType, remote?.candidateType];
        if (types.includes("relay")) return "through a relay";
        return types.every((t) => t === "host") ? "on the same network" : "across the internet, with no relay";
      }
      return "";
    },
  };
}
