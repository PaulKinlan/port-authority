// SharedWorker for the switchboard pattern. It never relays a chat message.
// All it does is introduce: every new peer gets a direct channel to every
// peer that is already here.
const peers = new Map();
const observers = new Set();
let introductions = 0;
let n = 0;
const report = () => { for (const o of observers) o.postMessage({ peers: [...peers.values()].map((p) => p.name), introductions }); };

onconnect = (event) => {
  const port = event.ports[0];
  port.onmessage = ({ data }) => {
    if (data.type === "observe") { observers.add(port); return report(); }
    if (data.type === "join") {
      const me = { id: ++n, name: data.name, port };
      for (const other of peers.values()) {
        const { port1, port2 } = new MessageChannel();
        me.port.postMessage({ type: "meet", name: other.name }, [port1]);
        other.port.postMessage({ type: "meet", name: me.name }, [port2]);
        introductions++;
      }
      peers.set(me.id, me);
      port.myId = me.id;
      // The tab holds a lock named after itself. When we can take it, the tab is gone.
      if (data.lock) navigator.locks?.request(data.lock, () => { peers.delete(me.id); report(); });
      report();
    }
    if (data.type === "leave") { peers.delete(port.myId); report(); }
  };
};
