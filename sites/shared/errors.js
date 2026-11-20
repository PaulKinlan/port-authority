// Tell the site when a page breaks, so that a browser where something does
// not work shows up in the lab's results. Sends the message, the page, and
// the browser's name. No address and no identifier is kept.
(() => {
  let sent = 0;
  const send = (where, message) => {
    if (sent++ >= 8 || !message) return;
    const brands = (navigator.userAgentData && navigator.userAgentData.brands || []).filter((b) => !/not.?a.?brand/i.test(b.brand));
    const brand = brands.find((b) => b.brand !== "Chromium") || brands[0];
    const body = JSON.stringify({ page: location.pathname + location.hash, where, message: String(message).slice(0, 300), ua: navigator.userAgent, browser: brand ? brand.brand : "", version: brand ? brand.version : "" });
    try { navigator.sendBeacon("/lab/error", new Blob([body], { type: "text/plain" })); } catch {}
  };
  addEventListener("error", (event) => send(event.filename ? event.filename.split("/").pop() + ":" + event.lineno : "page", event.message));
  addEventListener("unhandledrejection", (event) => send("promise", event.reason && event.reason.message || event.reason));
  addEventListener("pa-error", (event) => send(event.detail.where, event.detail.message));
})();
