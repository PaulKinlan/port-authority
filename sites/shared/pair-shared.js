// A shared worker that every tab of its site connects to, and that can hold a
// port to the shared worker of another site. Served on every demo site.
//
// Two of these, on two origins, are joined once: one tab of each site carries
// the port across. After that every tab of either site reaches every tab of
// the other through the two workers, and the tabs that carried the port can
// close. A shared worker runs for as long as at least one of its own tabs is
// open, so the link lasts that long, with no time limits and no rejoining.

const SITE = location.hostname.split(".")[0].replace(/^pa-/, "");
const tabs = new Map();   // port -> the tab's name
let peer = null, peerName = null, notes = 0;

function state(note) {
  const s = { site: SITE, tabs: [...tabs.values()], peer: !!peer, peerName, notes };
  for (const port of tabs.keys()) port.postMessage({ state: s, note });
}
function toTabs(message) { for (const port of tabs.keys()) port.postMessage(message); }

function adopt(port, name) {
  peer?.close();
  peer = port; peerName = name;
  port.onmessage = ({ data }) => {
    if (data.note) { notes++; toTabs({ note: data.note, from: data.from, site: data.site, via: "link" }); state(`passed a note from a ${data.site} tab to ${tabs.size === 1 ? "my one tab" : `my ${tabs.size} tabs`}`); }
  };
}

onconnect = ({ ports: [port] }) => {
  port.onmessage = ({ data, ports }) => {
    if (data.hello) { tabs.set(port, data.hello); return state(`${data.hello} connected. ${tabs.size === 1 ? "I have one tab" : `I have ${tabs.size} tabs`}`); }
    if (data.bye) { tabs.delete(port); port.close(); return state(`${data.bye} closed. ${tabs.size === 1 ? "I have one tab" : `I have ${tabs.size} tabs`}`); }
    if (data.join) {
      const { port1, port2 } = new MessageChannel();
      adopt(port1, data.to);
      port.postMessage({ carry: true }, [port2]);
      return state(`made a channel, kept one port and gave the other to ${tabs.get(port)} to carry to the ${data.to}`);
    }
    if (data.peer && ports[0]) { adopt(ports[0], data.peer); return state(`${tabs.get(port)} gave me a port whose other end is the ${data.peer}'s shared worker`); }
    if (data.note) {
      notes++;
      const from = tabs.get(port);
      toTabs({ note: data.note, from, site: SITE, via: "here" });
      peer?.postMessage({ note: data.note, from, site: SITE });
      return state(peer ? `sent a note from ${from} to my tabs and over the link` : `sent a note from ${from} to my tabs. I have no link`);
    }
  };
};
