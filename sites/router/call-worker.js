// The call worker: a worker that calls one model provider.
//
// A router page starts it with the provider in the address: /call-worker/anthropic.js.
// The server sends this script with a Content-Security-Policy whose connect-src
// is that one provider's address for prompts. A worker is held to the policy on
// its own script, not to the policy of the page that started it. So the API key
// is opened here, in a worker the browser will not let connect anywhere else.
//
// A worker is a better place for this than a page. It has no document. It
// cannot go to another address, send a form, or load an image, a style sheet
// or a frame, so none of those can carry a key out. Nothing can post to it but
// the page that started it, and it has no message that gives the key back.
//
// Not every browser holds a worker to its own policy. So before it will take a
// key, this worker checks that it is held to the policy it expects. If it is
// not, it says so, and the page that started it uses the call page instead
// (call.js). What it does once it is fit is in calling.js.

import { serveCalls } from "/calling.js";
import { callWorkerPolicy } from "/providers.js";

const named = /^\/call-worker\/([^/]+)\.js$/.exec(location.pathname);
const provider = named ? decodeURIComponent(named[1]) : null;

// Ask for something no policy here allows, and read which policy stopped it.
// The browser names the policy in the report. If nothing stops it, there is
// no policy on this worker at all.
const heldTo = () => new Promise((resolve) => {
  const late = setTimeout(() => resolve(null), 1500);
  addEventListener("securitypolicyviolation", (event) => { clearTimeout(late); resolve(event.originalPolicy); }, { once: true });
  fetch("/favicon.svg").then(() => { clearTimeout(late); resolve(null); }, () => {});
});

const expected = provider ? callWorkerPolicy(provider) : null;     // the policy the server sends this script with, for this provider
const found = await heldTo();
const same = (a, b) => !!a && !!b && a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

if (same(found, expected)) {
  onmessage = (event) => { if (event.data && event.data.router === "caller" && event.ports[0]) serveCalls(event.ports[0], provider); };
  postMessage({ t: "fit" });
} else {
  postMessage({ t: "unfit", why: found ? "This worker is held to another policy than its own." : "This worker is held to no policy." });
}
