// A router for the windows of one app, with three things added to the plain
// one in router-worker.js: it holds messages for a window that has not opened
// yet, it can address every window with a role at once, and it can send a
// request to whichever window offers a tool. Each demo starts its own copy of
// this worker by giving it a different name.
const table = new Map();        // name -> { port, role, tool }
const held = new Map();         // name -> [{ from, text }]
const watchers = new Set();
let last = "";

const report = () => {
  const state = {
    table: [...table].map(([name, w]) => ({ name, role: w.role, tool: w.tool })),
    held: Object.fromEntries([...held].map(([name, list]) => [name, list.length])),
    last,
  };
  for (const port of watchers) port.postMessage({ state });
};
const nameOf = (port) => { for (const [name, w] of table) if (w.port === port) return name; return null; };

onconnect = (event) => {
  const port = event.ports[0];
  port.onmessage = ({ data }) => {
    if (data.watch) { watchers.add(port); return report(); }

    if (data.iam) {
      table.set(data.iam, { port, role: data.role || null, tool: data.tool || null });
      // The window holds a lock for as long as it lives. Getting it means the window has gone.
      if (data.lock && navigator.locks) navigator.locks.request(data.lock, () => { if (table.get(data.iam)?.port === port) { table.delete(data.iam); last = `${data.iam} closed`; } report(); });
      // Anything that was sent before this window opened is handed over now, oldest first.
      const waiting = held.get(data.iam) || [];
      held.delete(data.iam);
      for (const message of waiting) port.postMessage({ ...message, wasHeld: true });
      last = waiting.length ? `${data.iam} opened. Handed over ${waiting.length} held ${waiting.length === 1 ? "message" : "messages"}.` : `${data.iam} opened`;
      return report();
    }

    const from = nameOf(port);

    if (data.to) {
      const target = table.get(data.to);
      if (target) { target.port.postMessage({ from, text: data.text }); last = `${from} → ${data.to}: passed on`; }
      else {
        held.set(data.to, [...(held.get(data.to) || []), { from, text: data.text }]);
        port.postMessage({ held: data.to });
        last = `${from} → ${data.to}: not open, holding it`;
      }
      return report();
    }

    if (data.toRole) {
      const targets = [...table].filter(([, w]) => w.role === data.toRole && w.port !== port);
      for (const [, w] of targets) w.port.postMessage({ from, text: data.text });
      port.postMessage({ reached: targets.map(([name]) => name), role: data.toRole });
      last = `${from} → every ${data.toRole}: ${targets.length} ${targets.length === 1 ? "window" : "windows"}`;
      return report();
    }

    if (data.need) {
      const found = [...table].find(([, w]) => w.tool === data.need);
      if (found) { found[1].port.postMessage({ from, job: data.need, text: data.text }); last = `${from} needs ${data.need}: sent to ${found[0]}`; }
      else { port.postMessage({ nobody: data.need }); last = `${from} needs ${data.need}: no open window offers it`; }
      return report();
    }
  };
};
