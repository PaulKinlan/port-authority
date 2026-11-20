// A router for windows that have never met. Each window says what it is
// called. To reach another, a window names it. This worker looks the name up
// and passes the message on. No window ever holds anything of another's.
const table = new Map();        // name -> port
const watchers = new Set();
let routed = 0, undelivered = 0;

const report = (last) => { for (const port of watchers) port.postMessage({ state: { table: [...table.keys()], routed, undelivered, last } }); };
const nameOf = (port) => { for (const [name, p] of table) if (p === port) return name; return null; };

onconnect = (event) => {
  const port = event.ports[0];
  port.onmessage = ({ data }) => {
    if (data.watch) { watchers.add(port); return report(); }
    if (data.iam) {
      table.set(data.iam, port);
      // The window holds a lock for as long as it lives. Getting it means the window has gone.
      if (data.lock && navigator.locks) navigator.locks.request(data.lock, () => { if (table.get(data.iam) === port) table.delete(data.iam); report(); });
      return report();
    }
    if (data.to) {
      const from = nameOf(port), target = table.get(data.to);
      if (!target) { undelivered++; port.postMessage({ undelivered: data.to }); return report({ from, to: data.to, ok: false }); }
      routed++;
      target.postMessage({ from, text: data.text });
      report({ from, to: data.to, ok: true });
    }
  };
};
