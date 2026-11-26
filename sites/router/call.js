// The one router page that talks to a model provider.
//
// A router page puts this page in a hidden iframe, with the provider in the
// address: /call/anthropic. The server sends this page with a
// Content-Security-Policy whose connect-src is that one provider. So the API
// key is unlocked here, in a page the browser will not let connect anywhere
// else. The frame and the worker around it cannot reach any provider at all.
//
// It speaks the same few messages as the rest of the router: a request in on
// a port, with a port for the answer, and pieces of text out.

import { generate, PROVIDERS } from "/providers.js";
import { unseal } from "/seal.js";

const named = /^\/call\/([^/]+)$/.exec(location.pathname);
const provider = named ? decodeURIComponent(named[1]) : null;

function serve(port) {
  port.onmessage = async (event) => {
    const reply = event.ports[0];
    if (!reply) return;
    const { account, ask } = event.data || {};
    const stop = new AbortController();
    reply.onmessage = (m) => { if (m.data && m.data.t === "cancel") stop.abort(new DOMException("cancelled", "AbortError")); };
    try {
      // The browser would block a call to any other provider. Say so plainly instead.
      if (!account || account.provider !== provider || !PROVIDERS[provider] || !PROVIDERS[provider].kind) {
        throw Object.assign(new Error("This page can only call the provider named in its address."), { code: "provider" });
      }
      const key = account.sealed ? await unseal(account.wrap, account.sealed) : account.key || "";
      const pieces = generate({ provider, model: account.model, key }, ask, stop.signal);
      for (;;) {
        const { value, done } = await pieces.next();
        if (done) { reply.postMessage({ t: "done", usage: value }); break; }
        reply.postMessage(typeof value === "string" ? { t: "text", text: value } : { t: "tool", tool: value.tool });
      }
    } catch (error) {
      reply.postMessage({ t: "error", code: error.name === "AbortError" ? "cancelled" : error.code || "provider", message: String(error.message || error) });
    }
    reply.close();
  };
}

// Only the router page that this page is inside can hand it a port.
addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.source !== parent || parent === window) return;
  if (event.data && event.data.router === "caller" && event.ports[0]) serve(event.ports[0]);
});
