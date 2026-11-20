// A port bank. Ports cannot be written to IndexedDB, sessionStorage or the
// history state, because they cannot be cloned. But they can be handed to a
// SharedWorker, which outlives any one page of its origin. Deposit a port
// under a key before the page goes away, withdraw it when the page is back.
const vault = new Map();
const waiting = new Map();
onconnect = (event) => {
  const port = event.ports[0];
  port.onmessage = ({ data, ports }) => {
    if (data.deposit && ports[0]) {
      const collect = waiting.get(data.deposit);
      if (collect) { waiting.delete(data.deposit); collect(ports[0]); }
      else vault.set(data.deposit, ports[0]);
    }
    if (data.withdraw) {
      const give = (kept) => port.postMessage({ withdrawn: data.withdraw, found: !!kept }, kept ? [kept] : []);
      const kept = vault.get(data.withdraw);
      vault.delete(data.withdraw);
      if (kept) return give(kept);
      // The deposit from the page that just unloaded can arrive a moment
      // after the new page asks. Wait briefly before saying there is nothing.
      const timer = setTimeout(() => { waiting.delete(data.withdraw); give(null); }, 400);
      waiting.set(data.withdraw, (late) => { clearTimeout(timer); give(late); });
    }
  };
};
