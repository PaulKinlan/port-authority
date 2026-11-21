// A MessagePort link that carries messages one way only.
//
// A MessagePort always works in both directions, and there is no setting that
// turns one direction off. oneWay() gets the effect with two channels and a
// valve between them. Whoever holds `send` can post. Whoever holds `receive`
// hears it. Anything posted into `receive` reaches the valve and stops there.
//
//   const link = oneWay();
//   publisher.postMessage({ feed: link.send }, origin, [link.send]);
//   widget.postMessage({ feed: link.receive }, "*", [link.receive]);
//   link.cut();     // later
//
// The valve also refuses, in the forward direction, a message that carries a
// port, a stream or shared memory. Each of those is a way to answer.

const kind = (value) => Object.prototype.toString.call(value).slice(8, -1);

// Shared memory is copied by reference, so both sides could write to it.
function sharesMemory(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  const type = kind(value);
  if (type === "SharedArrayBuffer" || (type === "WebAssembly.Memory" && kind(value.buffer) === "SharedArrayBuffer")) return true;
  if (ArrayBuffer.isView(value)) return kind(value.buffer) === "SharedArrayBuffer";
  if (type === "Map") return [...value].some(([k, v]) => sharesMemory(k, seen) || sharesMemory(v, seen));
  if (type === "Set") return [...value].some((v) => sharesMemory(v, seen));
  if (value instanceof Error) return sharesMemory(value.cause, seen) || (Array.isArray(value.errors) && value.errors.some((e) => sharesMemory(e, seen)));
  if (type === "Array" || type === "Object") return Object.values(value).some((v) => sharesMemory(v, seen));
  return false;
}

export function oneWay({ onPass = () => {}, onDrop = () => {} } = {}) {
  const inlet = new MessageChannel(), outlet = new MessageChannel();
  const counts = { passed: 0, refused: 0, dropped: 0 };

  // Forward. The message is posted again with no transfer list. A port or a
  // stream can only be transferred, never copied, so the browser refuses it.
  inlet.port2.onmessage = (event) => {
    for (const port of event.ports) port.close();
    try {
      if (sharesMemory(event.data)) throw new Error("shared memory would be a way back");
      outlet.port1.postMessage(event.data);
      counts.passed++; onPass(event.data);
    } catch (err) { counts.refused++; onDrop("forward", err); }
  };
  inlet.port2.onmessageerror = () => { counts.refused++; onDrop("forward", new Error("the message could not be read")); };

  // Backward. Nothing goes on. A port that came with it is closed.
  const back = (event) => { for (const port of event.ports || []) port.close(); counts.dropped++; onDrop("back"); };
  outlet.port1.onmessage = back;
  outlet.port1.onmessageerror = back;

  return {
    send: inlet.port1,
    receive: outlet.port2,
    counts,
    cut() { inlet.port2.close(); outlet.port1.close(); },
  };
}
