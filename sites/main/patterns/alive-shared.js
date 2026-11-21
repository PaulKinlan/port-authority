// A shared worker that watches the tabs that connect to it, for measuring
// what a tab looks like from outside while it is hidden, frozen or in the
// back/forward cache. Each tab gives it a port it beats on and a port it
// answers pings on. Ask it for "log" to read what it saw.
import { listen, watch } from "/alive.js";
const log = [];
const t = () => Math.round(performance.now());
onconnect = ({ ports: [port] }) => {
  port.onmessage = ({ data, ports }) => {
    if (data.watch) {
      listen(ports[0], { onState: (state, why) => log.push(`${t()} ${data.watch} beats: ${state} ${why}`) });
      watch(ports[1], { every: 1000, onState: (state, why) => log.push(`${t()} ${data.watch} pings: ${state} ${why}`) });
      log.push(`${t()} ${data.watch} connected`);
    }
    if (data.log) port.postMessage(log.splice(0));
  };
};
