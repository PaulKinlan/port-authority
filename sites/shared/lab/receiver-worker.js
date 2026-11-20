// The lab's receiver, as a dedicated worker or a shared worker.
importScripts("kinds.js");
if (typeof SharedWorkerGlobalScope !== "undefined") {
  onconnect = (event) => labReceive(event.ports[0], "shared worker");
} else {
  onmessage = (event) => {
    if (!event.data || !event.data.ctl) return;
    // With a broadcast name, values arrive on the BroadcastChannel and only answers use the port.
    if (event.data.broadcast) labReceive(event.ports[0], "broadcast", new BroadcastChannel(event.data.broadcast));
    else labReceive(event.ports[0], "worker");
  };
}
