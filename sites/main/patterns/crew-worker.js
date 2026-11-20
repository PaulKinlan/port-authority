// Keeps a list of this site's open tabs and picks one of them as the leader.
// When the leader goes, the tab that has been here longest takes over.
const tabs = new Map();   // port -> name, in the order they arrived
let leader = null;
let n = 0;

const report = () => {
  const state = { tabs: [...tabs.values()], leader: leader ? tabs.get(leader) : null };
  for (const port of tabs.keys()) port.postMessage({ ...state, you: tabs.get(port), lead: port === leader });
};
const leave = (port) => {
  if (!tabs.delete(port)) return;
  if (leader === port) leader = tabs.keys().next().value || null;
  report();
};

onconnect = (event) => {
  const port = event.ports[0];
  port.onmessage = ({ data }) => {
    if (data.join) {
      tabs.set(port, "tab " + ++n);
      if (!leader) leader = port;
      // The tab holds a lock for as long as it lives. Getting it means the tab has gone.
      if (data.lock && navigator.locks) navigator.locks.request(data.lock, () => leave(port));
      report();
    }
    if (data.leave) leave(port);
  };
};
