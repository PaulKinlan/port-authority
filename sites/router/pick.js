// The router window: the person chooses which account a site may use.
//
// A site opens this window. Most sites have the router's hidden frame in
// them. This window finds that frame, hands it the grant and closes.
//
// A site that cannot have the frame, for example because its own
// Content-Security-Policy forbids frames from other addresses, passes this
// window a port instead. Then this window does the frame's job (host.js), and
// it has to stay open for as long as the site is to have its model.

import { choices, server, seal, random, me } from "/store.js";
import { PROVIDERS } from "/providers.js";
import { startHost } from "/host.js";
import { accountForm, formInUse } from "/account-form.js";
const main = document.getElementById("main");
const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// The site that opened this window has a hidden router frame in it. Post to
// each of its frames with the router's own address as the target. The
// browser drops the message for every frame that is not a router page, so
// only the router frame gets the port. The site cannot listen in.
async function findFrame() {
  if (!opener) return null;
  let count = 0;
  try { count = opener.length; } catch { return null; }
  if (!count) return null;
  const tries = [];
  for (let i = 0; i < count; i++) {
    tries.push(new Promise((resolve) => {
      const line = new MessageChannel();
      line.port1.onmessage = (event) => { if (event.data && event.data.t === "site" && event.data.site) resolve({ line: line.port1, ...event.data }); };
      try { opener[i].postMessage({ router: "picker" }, location.origin, [line.port2]); } catch { /* not ours */ }
    }));
  }
  tries.push(new Promise((resolve) => setTimeout(() => resolve(null), 2500)));
  return Promise.race(tries);
}

// A site with no router frame passes this window a port itself. This window
// says it is ready, and the site answers with the port. event.origin comes
// from the browser, so the site cannot claim to be another site.
function helloFromSite() {
  if (!opener) return Promise.resolve(null);
  return new Promise((resolve) => {
    const late = setTimeout(() => resolve(null), 3000);
    addEventListener("message", function hear(event) {
      if (event.source !== opener || !event.data || event.data.router !== "hello" || !event.ports[0]) return;
      if (!/^https?:\/\//.test(event.origin)) return;    // a page with no address of its own has nothing to keep a grant under
      removeEventListener("message", hear);
      clearTimeout(late);
      resolve({ site: event.origin, port: event.ports[0] });
    });
    try { opener.postMessage({ router: "picker-ready" }, "*"); } catch { resolve(null); }   // carries nothing, so any page may read it
  });
}

// The page that asks has to be the page in its tab, not a page inside another
// page. Then the address this window shows is the one in that tab's address
// bar, and a hostile page cannot show a trusted site inside itself and have
// you approve it by the trusted name.
const nested = (() => { try { return !!opener && opener !== opener.top; } catch { return false; } })();

// The site says "#window" when it knows it has no frame, to save the search.
// It is only a hint: which site this is always comes from the browser.
const frame = nested || location.hash === "#window" ? null : await findFrame();
const direct = nested || frame ? null : await helloFromSite();

if (nested) {
  document.title = "Open the site in a tab of its own | AI router";
  main.innerHTML = `<h1 tabindex="-1">Open the site in a tab of its own</h1><p>The page that opened this window is inside another page. This window only answers the page whose address is in the tab's address bar, so that you can always see who is asking.</p><div class="actions"><button class="quiet" id="no">Close</button></div>`;
  document.getElementById("no").onclick = () => close();
  main.querySelector("h1").focus();
} else if (!frame && !direct) {
  document.title = "Open from a site | AI router";
  main.innerHTML = `<h1 tabindex="-1">This window is opened by a site</h1><p>A site that wants to use an AI model opens this window so that you can choose one. Nothing opened it this time.</p><p><a class="button" href="/">Go to your router</a></p>`;
  main.querySelector("h1").focus();
} else {
  const site = frame ? frame.site : direct.site;
  // With no frame in the site, this window serves the site itself.
  const host = direct ? startHost(site, direct.port) : null;
  const tellSite = (message) => { try { opener.postMessage(message, site); } catch { /* the site has gone */ } };
  let busy = false;
  let view = "";      // "choose" or "connected"
  let prefer = "";    // the choice to tick: an account that was added in this window a moment ago
  // An account saved in this window is offered at once, and ticked.
  const added = (account) => { prefer = account.id + "|" + account.models[0]; draw(); };
  let last = null;    // what the worker last told the site about its grant

  // Hand the grant over: to the frame inside the site, or to this window's own worker.
  const deliver = (grant, info) => {
    if (host) { host.setGrant(grant, info); return Promise.resolve(true); }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(watch);
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), 5000);
      const watch = setInterval(() => { if (!opener || opener.closed) finish(false); }, 300);
      frame.line.onmessage = (event) => { if (event.data && event.data.t === "stored") finish(true); };
      frame.line.postMessage({ t: "grant", info, grant });
    });
  };

  const cancel = () => {
    if (busy) return;
    // A site that already has a model through this window keeps it.
    if (host && host.current()) { tellSite({ router: "picked", ok: false }); return connected(); }
    if (frame) { try { frame.line.close(); } catch { /* closed */ } }
    close();
  };
  addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !busy && view === "choose") {
      event.preventDefault();
      cancel();
    }
  });

  // This window is the site's way through. Say so, and stay open.
  const showLeft = () => {
    const el = document.getElementById("left");
    if (el) el.textContent = last && last.ready && last.left != null ? `${last.left} ${last.left === 1 ? "request" : "requests"} left.` : "";
  };
  const connected = () => {
    view = "connected";
    const now = host.current();
    document.title = "Connected, keep this window open | AI router";
    main.innerHTML = `
      <p class="origin">${esc(site)}</p>
      <h1 tabindex="-1">Keep this window open</h1>
      <p>This site is using <strong class="model-name">${esc(now.model)}</strong>, from your account <strong>${esc(now.label)}</strong>, through this window. <span id="left" role="status"></span></p>
      <p class="note small">Most sites hold the router in a hidden frame, and this window closes once you have chosen. This site is not using that frame, so its prompts come through this window. Closing it disconnects the site. Your choice is kept, so the site can open this window again without asking you to choose.</p>
      <div class="actions"><button class="quiet" id="again">Choose a different model</button><button class="quiet" id="bye">Disconnect</button></div>
      <p class="small muted">You can see what this site has used, and stop it, at <a href="/" target="_blank" rel="noopener">your router</a>.</p>`;
    document.getElementById("again").onclick = () => draw();
    document.getElementById("bye").onclick = () => close();
    showLeft();
  };

  const draw = async () => {
    view = "choose";
    const list = await choices();
    if (view !== "choose") return;
    const current = frame ? frame.current : host.current();
    // Nothing to choose from: say so, and say where to add an account. The
    // window draws again as soon as one is saved.
    if (!list.length) {
      document.title = "Add an account first | AI router";
      main.innerHTML = `
        <p class="origin">${esc(site)}</p>
        <h1 tabindex="-1">This site wants to use an AI model</h1>
        <p>You have no account for it to use yet. Add one here. It is kept in this browser, at the router's address, and the site never sees it.</p>
        <form class="fields" id="form" novalidate></form>
        <div class="actions"><button class="quiet" id="no">Close</button></div>
        <p class="small muted">You can see and remove your accounts at <a href="/" target="_blank" rel="noopener">your router</a>.</p>`;
      accountForm(document.getElementById("form"), added);
      document.getElementById("no").onclick = cancel;
      return;
    }
    const currentIndex = current ? list.findIndex((c) => c.label === current.label && c.model === current.model) : -1;
    // An account has the name you gave it. A model has the name its provider gave it.
    // They are shown apart: each account is a group, and its models are the choices in it.
    // Two accounts can offer the same model, so the end of the key is shown to tell them apart.
    const groups = [];
    list.forEach((choice, index) => {
      const id = choice.key.split("|")[0];
      let group = groups.at(-1);
      if (!group || group.id !== id) {
        const about = choice.note || choice.providerName + (choice.secretKey ? ", key ends " + choice.secretKey.slice(-4) : "");
        groups.push(group = { id, label: choice.label, about, items: [] });
      }
      group.items.push({ ...choice, index });
    });
    const using = currentIndex >= 0 ? list[currentIndex] : null;
    const usesNow = !current ? "" : using && using.provider === "builtin" ? "It uses this browser's built-in model now."
      : `It uses <strong class="model-name">${esc(current.model)}</strong> from your account <strong>${esc(current.label)}</strong> now.`;
    const preferIndex = prefer ? list.findIndex((c) => c.key === prefer) : -1;
    const selectedIndex = preferIndex >= 0 ? preferIndex : currentIndex >= 0 ? currentIndex : 0;
    document.title = `Choose a model | AI router`;
    main.innerHTML = `
      <p class="origin">${esc(site)}</p>
      <h1 tabindex="-1">This site wants to use an AI model</h1>
      <p>Choose which of your accounts it may use. The site can send prompts and read the answers. It cannot see your API key.</p>
      ${current ? `<p class="note small">${usesNow} Choosing again replaces that.</p>` : ""}
      ${host ? `<p class="note small">This site is not holding the router in a hidden frame. This window will stay open after you choose, and the site's prompts will come through it.</p>` : ""}
      <fieldset class="choices" id="choices">
        <legend class="small muted">Choose a model from one of your accounts</legend>
        ${groups.map((group, n) => `
          <div class="account" role="group" aria-labelledby="account-${n}">
            <p class="account-name" id="account-${n}"><strong>${esc(group.label)}</strong><span class="muted small">${esc(group.about)}</span></p>
            ${group.items.map((c) => `<label><input type="radio" name="choice" value="${esc(c.key)}" ${c.index === selectedIndex ? "checked" : ""}><span>${esc(c.model)}</span></label>`).join("")}
          </div>`).join("")}
      </fieldset>
      <details id="add"><summary class="button quiet tiny">Add an account</summary><form class="fields" id="form" novalidate></form></details>
      <p class="note small" id="lock" aria-live="polite"></p>
      <div class="limits">
        <div><label for="requests">Stop after</label><select id="requests"><option value="5">5 requests</option><option value="20" selected>20 requests</option><option value="100">100 requests</option><option value="1000">1,000 requests</option></select></div>
        <div><label for="days">Or after</label><select id="days"><option value="1">1 day</option><option value="7" selected>7 days</option><option value="30">30 days</option></select></div>
      </div>
      <p class="error" id="error" role="alert" hidden></p>
      <div class="actions"><button class="accent" id="yes">Allow</button><button class="quiet" id="no">${host && current ? "Keep what it has" : "Don't allow"}</button></div>
      <p class="small muted">You can see what this site has used, and stop it, at <a href="/" target="_blank" rel="noopener">your router</a>.</p>`;
    // Say where the prompts can go with the choice that is ticked.
    const lock = () => {
      const ticked = document.querySelector("input[name=choice]:checked");
      const picked = list.find((c) => c.key === (ticked && ticked.value)) || list[0];
      const address = PROVIDERS[picked.provider] && PROVIDERS[picked.provider].baseUrl;
      document.getElementById("lock").textContent = address
        ? `With this choice the router sends this site's prompts to ${new URL(address).host}. Your browser lets the router connect there and to the router's own server, and nowhere else.`
        : "With this choice your prompts stay on this device.";
    };
    document.getElementById("choices").addEventListener("change", lock);
    lock();
    accountForm(document.getElementById("form"), added);
    document.getElementById("no").onclick = cancel;
    document.getElementById("yes").onclick = async () => {
      if (busy) return;
      const yes = document.getElementById("yes");
      const box = document.getElementById("error");
      busy = true;
      yes.disabled = true;
      yes.textContent = "Allowing...";
      box.hidden = true;
      box.textContent = "";
      const selected = document.querySelector("input[name=choice]:checked");
      const choice = list.find((c) => c.key === selected?.value) || list[0];
      const secret = random(24);
      try {
        const made = await server("grant", { site, secret, label: choice.label, provider: choice.provider, model: choice.model, requests: document.getElementById("requests").value, days: document.getElementById("days").value });
        if (!made.ok) throw new Error(made.why || "The router server refused the grant.");
        const sealed = choice.secretKey ? await seal(made.wrap, choice.secretKey) : null;
        const confirmed = await deliver({ person: me().id, id: made.id, secret, site, provider: choice.provider, providerName: choice.providerName, model: choice.model, label: choice.label, sealed }, made.grant);
        if (!confirmed) throw new Error("The opening site closed or did not confirm the grant. You can close this window or try again.");
        if (!host) return close();
        busy = false;
        tellSite({ router: "picked", ok: true });
        connected();
      } catch (error) {
        busy = false;
        box.hidden = false;
        box.textContent = "That did not work: " + error.message;
        yes.disabled = false;
        yes.textContent = "Allow";
      }
    };
  };

  if (!host) draw();
  else {
    // The worker says whether a grant kept from an earlier visit is still good.
    // If it is, the site is connected at once, with nothing to choose.
    host.onstate = (state) => {
      const before = last;
      last = state;
      if (!before) { if (state.ready) { tellSite({ router: "picked", ok: true }); connected(); } else draw(); }
      else showLeft();
    };
    // The grant was stopped or used up, or the site asked to forget it. The
    // window has nothing left to carry. Wait a moment so the site hears why.
    host.onforget = () => { if (view === "connected") setTimeout(() => close(), 400); };
    addEventListener("message", (event) => {
      if (event.origin !== site || !event.data) return;
      // The site's page is going away. By the time this arrives the page may
      // be gone, and then the browser no longer says which window sent it, so
      // only the address is checked. All it can do is close this window.
      if (event.data.router === "bye") close();
      else if (event.data.router === "choose" && event.source === opener && view === "connected") draw();   // the site asks the person to choose again
    });
    setInterval(() => { if (!opener || opener.closed) close(); }, 500);
    addEventListener("pagehide", () => tellSite({ router: "closing" }));
  }
  // An account added in another tab shows up here without a reload.
  addEventListener("storage", () => { if (!busy && view === "choose" && !formInUse(document.getElementById("form"))) draw(); });
}
