// One WebSocket for every tab on this origin. Tabs do not open sockets: each
// holds a port to this worker, and the worker holds the only connection.
// An answer goes back down the port of the tab that asked.
let socket = null;
let opened = 0;     // how many sockets this worker has ever opened
let n = 0;
const tabs = new Map();     // port -> name
const watchers = new Set();
const asked = [];           // ports waiting for an answer, in order
const queue = [];           // messages waiting for the socket to open

const report = (traffic) => {
  const state = { tabs: [...tabs.values()], opened, open: !!socket && socket.readyState === 1, traffic };
  for (const port of [...tabs.keys(), ...watchers]) port.postMessage({ state });
};

function connect() {
  if (socket && socket.readyState <= 1) return;
  opened++;
  socket = new WebSocket(self.location.origin.replace(/^http/, "ws") + "/echo");
  socket.onopen = () => { for (const text of queue.splice(0)) socket.send(text); report(); };
  socket.onmessage = (event) => { const port = asked.shift(); if (port) port.postMessage({ answer: event.data }); report("down"); };
  socket.onclose = () => { socket = null; asked.length = 0; report(); };
}

function leave(port) {
  if (!tabs.delete(port)) return;
  // Nobody left: hang up. The next tab to arrive opens a new one.
  if (!tabs.size && socket) socket.close();
  report();
}

onconnect = (event) => {
  const port = event.ports[0];
  port.onmessage = ({ data }) => {
    if (data.watch) { watchers.add(port); return report(); }
    if (data.join) {
      const name = "tab " + ++n;
      tabs.set(port, name);
      port.postMessage({ name });
      connect();
      // The tab holds a lock named after itself. When we can take it, the tab has gone.
      if (data.lock && navigator.locks) navigator.locks.request(data.lock, () => leave(port));
      return report();
    }
    if (data.leave) return leave(port);
    if (data.say && tabs.has(port)) {
      connect();
      const text = tabs.get(port) + " says " + String(data.say).slice(0, 80);
      asked.push(port);
      socket.readyState === 1 ? socket.send(text) : queue.push(text);
      report("up");
    }
  };
};
