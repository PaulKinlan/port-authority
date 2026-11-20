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
  // Errors thrown by a browser extension's own scripts say nothing about this site.
  const foreign = (file) => /^(chrome|moz|safari-web|ms-browser)-extension:/.test(file || "");
  addEventListener("error", (event) => foreign(event.filename) || send(event.filename ? event.filename.split("/").pop() + ":" + event.lineno : "page", event.message));
  addEventListener("unhandledrejection", (event) => send("promise", event.reason && event.reason.message || event.reason));
  addEventListener("pa-error", (event) => send(event.detail.where, event.detail.message));
  // The browser's own complaints never reach an error event: a feature it
  // blocked or slowed down, or one it is about to remove. A crash cannot be
  // seen from here at all, so the browser sends those itself, to /lab/reports.
  try {
    new ReportingObserver((reports) => {
      for (const r of reports) send(r.type + (r.body && r.body.sourceFile ? ", " + r.body.sourceFile.split("/").pop() + ":" + r.body.lineNumber : ""), r.body && (r.body.message || r.body.id));
    }, { types: ["intervention", "deprecation"], buffered: true }).observe();
  } catch {}
})();
