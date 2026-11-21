// One WebSocket for every tab on this origin. Tabs do not open sockets: each
// holds a port to this worker, and the worker holds the only connection.
// Every question goes out with a number. The answer carries the same number,
// and goes back down the port of the tab that asked. A question that was not
// answered when the connection dropped is sent again on the next one.
let socket = null;
let opened = 0;     // how many sockets this worker has ever opened
let n = 0, ids = 0;
const tabs = new Map();     // port -> name
const watchers = new Set();
const pending = new Map();  // id -> { port, text }, questions with no answer yet

const report = (traffic) => {
  const state = { tabs: [...tabs.values()], opened, open: !!socket && socket.readyState === 1, waiting: pending.size, traffic };
  for (const port of [...tabs.keys(), ...watchers]) port.postMessage({ state });
};

const ask = (id) => socket.send(JSON.stringify({ id, text: pending.get(id).text }));

function connect() {
  if (socket && socket.readyState <= 1) return;
  opened++;
  const mine = socket = new WebSocket(self.location.origin.replace(/^http/, "ws") + "/echo");
  // Anything still waiting for an answer is asked again on the new connection.
  mine.onopen = () => { for (const id of pending.keys()) ask(id); report(); };
  mine.onmessage = (event) => {
    // The echo server answers "the server heard: " and then exactly what it was sent.
    let heard; try { heard = JSON.parse(event.data.slice(event.data.indexOf("{"))); } catch { return; }
    const waiting = pending.get(heard.id);
    if (!waiting) return;
    pending.delete(heard.id);
    waiting.port.postMessage({ answer: "the server heard: " + heard.text });
    report("down");
  };
  mine.onclose = () => {
    if (socket !== mine) return;
    socket = null;
    report();
    // Tabs are still here, so connect again. They are not told and do nothing.
    if (tabs.size) setTimeout(connect, 300);
  };
}

function leave(port) {
  if (!tabs.delete(port)) return;
  for (const [id, waiting] of pending) if (waiting.port === port) pending.delete(id);
  // Nobody left: hang up. The next tab to arrive opens a new one.
  if (!tabs.size && socket) socket.close();
  report();
}

onconnect = (event) => {
  const port = event.ports[0];
  port.onmessage = ({ data }) => {
    if (data.watch) { watchers.add(port); return report(); }
    // Close the socket from this end, as a failed network would. The close
    // event can be slow to arrive, or never arrive, when the server does not
    // answer the closing handshake. So give the socket up now and connect again.
    if (data.drop) {
      if (!socket) return;
      const old = socket;
      socket = null;
      old.close();
      report();
      if (tabs.size) setTimeout(connect, 300);
      return;
    }
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
      const id = ++ids;
      pending.set(id, { port, text: tabs.get(port) + " says " + String(data.say).slice(0, 80) });
      connect();
      if (socket.readyState === 1) ask(id);
      report("up");
    }
  };
};
