// Holds one shopping list for every open tab of this site, and tells them all when it changes.
// Nothing here talks to a server.
const ports = new Set();
let list = [];
const stock = ["tulips", "peonies", "roses", "string", "brown paper", "ribbon"];
let n = 0;
const tell = () => { for (const port of ports) port.postMessage({ list }); };

onconnect = (event) => {
  const port = event.ports[0];
  ports.add(port);
  port.onmessage = ({ data }) => {
    if (data.add) { list.push({ id: ++n, text: data.text || stock[(n - 1) % stock.length], done: false }); if (list.length > 5) list.shift(); }
    if (data.tick) { const item = data.id ? list.find((i) => i.id === data.id) : list.find((i) => !i.done); if (item) item.done = !item.done; }
    if (data.clear) list = [];
    if (data.bye) return void ports.delete(port);
    tell();
  };
  port.postMessage({ list });
};
