// One subscription for every tab on this origin. This worker holds the only
// WebSocket to the price feed and passes each price to every tab's port.
// It is also the only place that knows how to reconnect. Tabs never do.
let socket = null;
let opened = 0;         // sockets this worker has ever opened
let attempt = 0;        // failed tries since the last good connection
let retryAt = 0;
let last = null;
let n = 0;
const tabs = new Map();       // port -> name
const watchers = new Set();
const everyone = () => [...tabs.keys(), ...watchers];

const report = () => {
  const state = { tabs: [...tabs.values()], opened, open: !!socket && socket.readyState === 1, retryIn: retryAt ? Math.max(0, retryAt - Date.now()) : 0, attempt };
  for (const port of everyone()) port.postMessage({ state });
};

function connect() {
  if (socket || !tabs.size) return;
  opened++; retryAt = 0;
  socket = new WebSocket(self.location.origin.replace(/^http/, "ws") + "/ticker");
  socket.onopen = () => { attempt = 0; report(); };
  socket.onmessage = (event) => { last = JSON.parse(event.data); for (const port of tabs.keys()) port.postMessage({ price: last }); };
  socket.onclose = () => {
    socket = null;
    if (!tabs.size) return report();
    // Wait longer after each failure: half a second, one, two, four, and no more than eight.
    const wait = Math.min(8000, 500 * 2 ** attempt++);
    retryAt = Date.now() + wait;
    setTimeout(connect, wait);
    report();
  };
  report();
}

function leave(port) {
  if (!tabs.delete(port)) return;
  if (!tabs.size && socket) socket.close();
  report();
}

onconnect = (event) => {
  const port = event.ports[0];
  port.onmessage = ({ data }) => {
    if (data.watch) { watchers.add(port); return report(); }
    if (data.join) {
      tabs.set(port, "tab " + ++n);
      if (last) port.postMessage({ price: last });
      if (data.lock && navigator.locks) navigator.locks.request(data.lock, () => leave(port));
      connect();
      return report();
    }
    if (data.leave) return leave(port);
    // Ask the server to hang up, to show what happens next.
    if (data.drop && socket && socket.readyState === 1) socket.send("drop");
  };
};
