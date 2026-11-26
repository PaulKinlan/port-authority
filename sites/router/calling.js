// The one piece of the router that talks to a model provider, and the only
// place an API key is ever in the clear.
//
// It is run by whichever of two things the browser can hold to a policy that
// names one provider: a worker (call-worker.js), or a hidden page (call.js).
// Either way the browser will not let it connect anywhere but that provider.
//
// It speaks the same few messages as the rest of the router: a request in on
// a port, with a port for the answer, and pieces of text out. There is no
// message that gives the key back.

import { generate, PROVIDERS } from "/providers.js";
import { unseal } from "/seal.js";

// port:     requests arrive on it, each with a port for its answer
// provider: the one provider this may call, from the address it was loaded at
export function serveCalls(port, provider) {
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
      // From a site's grant the key arrives encrypted, with the key that opens it. It is opened here and nowhere else.
      const key = account.sealed ? await unseal(account.opens, account.sealed) : account.key || "";
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
