// Opens the page that calls one model provider, and returns a port to it.
// Used by the router frame and by the router's home page. See call.js.
export function openCaller(provider) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.title = "The call to the model provider";
    frame.src = "/call/" + encodeURIComponent(provider);
    frame.addEventListener("load", () => {
      const line = new MessageChannel();
      frame.contentWindow.postMessage({ router: "caller" }, location.origin, [line.port2]);
      resolve({ port: line.port1, close() { line.port1.close(); frame.remove(); } });
    }, { once: true });
    frame.addEventListener("error", () => reject(new Error("The page that calls the provider did not load.")), { once: true });
    (document.body || document.documentElement).append(frame);
  });
}
