// Opens what calls one model provider, and returns a port to it.
// Used by the router frame, the router window and the router's home page.
//
// It is a worker where the browser holds a worker to the policy on its own
// script (call-worker.js), and a hidden page where it does not (call.js).
// Both are sent with a policy that names the one provider, and both do the
// same job (calling.js). The worker is tried first, because it is the
// stronger of the two: it has no document to carry a key out with.
// Resolves to { port, kind: "worker" or "page", close() }.
import { quiet } from "/keep.js";

export async function openCaller(provider) {
  // The call worker has to be under the service worker that does nothing, so that the service worker
  // which keeps the router's files is never shown its requests. If that one is not in place while the
  // other is, the page is used: a page's requests to other addresses are kept from a service worker.
  const hidden = (await quiet) || !navigator.serviceWorker || !navigator.serviceWorker.controller;
  return (hidden && await callWorker(provider)) || callPage(provider);
}

// Resolves to null when there is no worker to be had, or the worker says it is not held to its policy.
// The worker's script is not in the copy the service worker keeps, so there is none to be had when the
// router's address cannot be reached. The call page is in the copy, and is used then.
function callWorker(provider) {
  return new Promise((resolve) => {
    let worker;
    try { worker = new Worker("/call-worker/" + encodeURIComponent(provider) + ".js", { type: "module" }); } catch { return resolve(null); }
    const no = () => { clearTimeout(late); worker.terminate(); resolve(null); };
    const late = setTimeout(no, 3000);
    worker.onerror = no;
    worker.onmessage = (event) => {
      if (!event.data || event.data.t !== "fit") return no();
      clearTimeout(late);
      worker.onmessage = null;
      worker.onerror = null;
      const line = new MessageChannel();
      worker.postMessage({ router: "caller" }, [line.port2]);
      resolve({ port: line.port1, kind: "worker", close() { line.port1.close(); worker.terminate(); } });
    };
  });
}

function callPage(provider) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.title = "The call to the model provider";
    frame.src = "/call/" + encodeURIComponent(provider);
    frame.addEventListener("load", () => {
      const line = new MessageChannel();
      frame.contentWindow.postMessage({ router: "caller" }, location.origin, [line.port2]);
      resolve({ port: line.port1, kind: "page", close() { line.port1.close(); frame.remove(); } });
    }, { once: true });
    frame.addEventListener("error", () => reject(new Error("The page that calls the provider did not load.")), { once: true });
    (document.body || document.documentElement).append(frame);
  });
}
