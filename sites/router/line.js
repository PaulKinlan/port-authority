// Ask over a port that speaks the router's few messages, and yield the answer.
//
// The request goes in with a new port for the reply. The reply port then
// carries { t: "text", text } for each piece, and ends with { t: "done", usage }
// or { t: "error", code, message }. Posting { t: "cancel" } on it stops the work.
// Works in a page and in a worker.
export async function* askOver(port, request, signal) {
  const line = new MessageChannel();
  const queue = [];
  let wake = null, finished = false, failure = null, usage = null;
  line.port1.onmessage = (event) => {
    const m = event.data || {};
    if (m.t === "text") queue.push(m.text);
    else if (m.t === "done") { finished = true; usage = m.usage || null; }
    else if (m.t === "error") { finished = true; failure = Object.assign(new Error(m.message), { code: m.code }); }
    wake?.(); wake = null;
  };
  signal?.addEventListener("abort", () => line.port1.postMessage({ t: "cancel" }), { once: true });
  port.postMessage(request, [line.port2]);
  try {
    for (;;) {
      while (queue.length) yield queue.shift();
      if (failure) throw failure;
      if (finished) return usage || { tokensIn: 0, tokensOut: 0 };
      await new Promise((resolve) => { wake = resolve; });
    }
  } finally { line.port1.close(); }
}
