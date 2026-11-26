// The router window: the person chooses which account a site may use, sees
// what the site has used, and can stop it.
//
// A site opens this window. Most sites have the router's hidden frame in
// them. This window finds that frame, hands it the grant and closes. The
// grant is made here and kept there. No server is told.
//
// A site that cannot have the frame, for example because its own
// Content-Security-Policy forbids frames from other addresses, passes this
// window a port instead. Then this window does the frame's job (host.js), and
// it has to stay open for as long as the site is to have its model.

import { choices, random, remember, sighting, stopped } from "/store.js";
import { seal } from "/seal.js";
import { PROVIDERS } from "/providers.js";
import { startHost } from "/host.js";
import "/keep.js";
const main = document.getElementById("main");
// A site opens this window, so this window never takes a key. A key is typed
// in one place only: the router's own page, in a tab the person opened. Then a
// look-alike window that asks for a key gives itself away.
const NEVER = "This window never asks for an API key. A window that looks like this one and asks for a key is not the router.";
const web = (address) => /^https?:\/\//.test(String(address));    // a website's address, not a sandboxed page's or a file's
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
      removeEventListener("message", hear);
      clearTimeout(late);
      // A page with no address of its own has nothing to show the person and nothing to keep a grant under.
      if (!web(event.origin)) { event.ports[0].close(); return resolve({ refused: "no-address" }); }
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
// A sandbox takes this window's own address away. Then it cannot read the
// person's accounts, and cannot name the router's address to find the frame.
const boxed = origin === "null";

const frame = boxed || nested || location.hash === "#window" ? null : await findFrame();
const direct = boxed || nested || frame ? null : await helloFromSite();
const homeless = (frame && !web(frame.site)) || (direct && direct.refused === "no-address");

// The address of the page that sent the person here, when the browser passed
// one on and it is not the router's own. It is only shown, never trusted.
const from = (() => { try { const address = new URL(document.referrer).origin; return web(address) && address !== location.origin ? address : ""; } catch { return ""; } })();

// This window cannot go on. Say which thing stopped it: each is a different thing the browser did.
const stop = (title, heading, ...paragraphs) => {
  document.title = title + " | AI router";
  main.innerHTML = `<h1 tabindex="-1">${heading}</h1>${paragraphs.map((text) => `<p>${text}</p>`).join("")}<div class="actions"><button class="quiet" id="no">Close</button></div>`;
  document.getElementById("no").onclick = () => close();
  main.querySelector("h1").focus();
};

if (boxed) {
  stop("This window is in a sandbox", "This window is in a sandbox", "The page that opened this window is sandboxed, and the browser put this window in the same sandbox. In here the router cannot read your accounts, and it cannot tell which site is asking. So it will not go on.", "Nothing was shared with the page.");
} else if (nested) {
  stop("Open the site in a tab of its own", "Open the site in a tab of its own", "The page that opened this window is inside another page. This window only answers the page whose address is in the tab's address bar, so that you can always see who is asking.");
} else if (homeless) {
  stop("This page has no address of its own", "This page has no address of its own", "The page that opened this window is sandboxed, or it is a file and not a website. The browser gives a page like that no address. The router shows you the address of the site that is asking, and keeps what you allow under it. With no address, it will not go on.", "Nothing was shared with the page.");
  try { opener.postMessage({ router: "refused", why: "no-address" }, "*"); } catch { /* the page has gone */ }   // carries nothing, and a page with no address cannot be named as the target
} else if (!opener && from) {
  stop("This window cannot reach the site", "This window cannot reach the site that opened it", `<strong>${esc(from)}</strong> opened this window, and then the browser cut the link between the two.`, "The site's own settings do that. The usual one is a header called <code>Cross-Origin-Opener-Policy</code>, set to <code>same-origin</code>. Without the link, this window cannot find the site's page, so the router cannot work on that site.", "Nothing was shared with the site.");
} else if (!opener) {
  document.title = "Open from a site | AI router";
  main.innerHTML = `<h1 tabindex="-1">This window is opened by a site</h1><p>A site that wants to use an AI model opens this window so that you can choose one. Nothing opened it this time.</p><p>If you did come here from a site, that site cuts its link to the windows it opens, and the router cannot work on it.</p><p><a class="button" href="/">Go to your router</a></p>`;
  main.querySelector("h1").focus();
} else if (!frame && !direct) {
  stop("The page did not answer", "The page that opened this window did not answer", "A site opens this window, and then tells it where the model's answers should go. This page said nothing. Close this window and try again from the site.");
} else {
  const site = frame ? frame.site : direct.site;
  // With no frame in the site, this window serves the site itself.
  const host = direct ? startHost(site, direct.port) : null;
  const tellSite = (message) => { try { opener.postMessage(message, site); } catch { /* the site has gone */ } };
  let busy = false;
  let view = "";      // "choose" or "connected"
  let last = null;    // what the worker last told the site about its grant

  // Hand the grant over: to the frame inside the site, or to this window's own worker.
  const deliver = (grant) => {
    if (host) return host.setGrant(grant);
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
      frame.line.onmessage = (event) => { if (event.data && event.data.t === "stored") finish(true); else if (event.data && event.data.t === "failed") finish(false); };
      frame.line.postMessage({ t: "grant", grant });
    });
  };

  // What the site has now: the account, the model, the limits and what is used. The frame said so when it was found.
  const currently = async () => (frame ? frame.current : host.current());
  const day = (ms) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const usedSoFar = (now) => `${now.used} of ${now.requests} ${now.requests === 1 ? "request" : "requests"} used${now.tokensIn + now.tokensOut ? `, ${now.tokensIn} tokens in and ${now.tokensOut} out` : ""}. It stops on ${day(now.expires)}.`;

  const cancel = async () => {
    if (busy) return;
    // A site that already has a model through this window keeps it.
    if (host && await host.current()) { tellSite({ router: "picked", ok: false }); return connected(); }
    if (frame) { try { frame.line.close(); } catch { /* closed */ } }
    close();
  };
  // Stop: the site's grant is deleted where it is kept, with the key that opens your API key.
  const stopSite = async () => {
    if (busy) return;
    busy = true;
    stopping = true;
    if (host) await host.stop();
    else {
      await new Promise((resolve) => {
        const late = setTimeout(resolve, 3000);
        frame.line.onmessage = (event) => { if (event.data && event.data.t === "stopped") { clearTimeout(late); resolve(); } };
        frame.line.postMessage({ t: "stop" });
      });
      frame.current = null;
    }
    stopped(site);
    busy = false;
    stopping = false;
    wasStopped = true;
    draw();
  };
  let wasStopped = false;   // the person pressed Stop in this window, and has not allowed the site again
  let stopping = false;
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
  const connected = async () => {
    const now = await host.current();
    if (!now) return draw();
    view = "connected";
    document.title = "Connected, keep this window open | AI router";
    main.innerHTML = `
      <p class="origin">${esc(site)}</p>
      <h1 tabindex="-1">Keep this window open</h1>
      <p>This site is using <strong class="model-name">${esc(now.model)}</strong>, from your account <strong>${esc(now.label)}</strong>, through this window. <span id="left" role="status"></span></p>
      <p class="note small">Most sites hold the router in a hidden frame, and this window closes once you have chosen. This site is not using that frame, so its prompts come through this window. Closing it disconnects the site. Your choice is kept, so the site can open this window again without asking you to choose.</p>
      <p class="small" id="used">${esc(usedSoFar(now))}</p>
      <div class="actions"><button class="quiet" id="again">Choose a different model</button><button class="quiet" id="bye">Disconnect</button><button class="quiet" id="stop">Stop this site</button></div>
      <p class="small muted">Disconnect closes this window and keeps your choice. Stop deletes it, so the site has to ask you again.</p>`;
    document.getElementById("again").onclick = () => draw();
    document.getElementById("bye").onclick = () => close();
    document.getElementById("stop").onclick = stopSite;
    showLeft();
  };

  const draw = async () => {
    view = "choose";
    const [list, current] = await Promise.all([choices(), currently()]);
    if (view !== "choose") return;
    sighting(site, current);    // note what this site has used, for the list at the router's own page
    // Nothing to choose from: say so, and say where to add an account. The
    // window draws again as soon as one is saved.
    if (!list.length) {
      document.title = "Add an account first | AI router";
      main.innerHTML = `
        <p class="origin">${esc(site)}</p>
        <h1 tabindex="-1">This site wants to use an AI model</h1>
        <p>You have no account for it to use yet. Accounts are added at <strong>${esc(location.host)}</strong> itself, in a tab of its own. This window will show a new account as soon as it is saved.</p>
        <div class="actions"><a class="button accent" href="/#add" target="_blank" rel="noopener">Add an account at ${esc(location.host)}</a><button class="quiet" id="no">Close</button></div>
        <p class="small muted">${NEVER}</p>`;
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
    const selectedIndex = currentIndex >= 0 ? currentIndex : 0;
    document.title = `Choose a model | AI router`;
    main.innerHTML = `
      <p class="origin">${esc(site)}</p>
      <h1 tabindex="-1">This site wants to use an AI model</h1>
      <p>Choose which of your accounts it may use. The site can send prompts and read the answers. It cannot see your API key.</p>
      ${current ? `<p class="note small" id="now">${usesNow} ${esc(usedSoFar(current))} Choosing again replaces that.</p>` : ""}
      ${wasStopped && !current ? `<p class="note small" id="stopped" role="status">Stopped. This site can no longer use your account. You can close this window, or allow it again below.</p>` : ""}
      ${host ? `<p class="note small">This site is not holding the router in a hidden frame. This window will stay open after you choose, and the site's prompts will come through it.</p>` : ""}
      <fieldset class="choices" id="choices">
        <legend class="small muted">Choose a model from one of your accounts</legend>
        ${groups.map((group, n) => `
          <div class="account" role="group" aria-labelledby="account-${n}">
            <p class="account-name" id="account-${n}"><strong>${esc(group.label)}</strong><span class="muted small">${esc(group.about)}</span></p>
            ${group.items.map((c) => `<label><input type="radio" name="choice" value="${esc(c.key)}" ${c.index === selectedIndex ? "checked" : ""}><span>${esc(c.model)}</span></label>`).join("")}
          </div>`).join("")}
      </fieldset>
      <p class="small"><a href="/#add" target="_blank" rel="noopener">Add an account at ${esc(location.host)}</a>. It will show up here as soon as it is saved.</p>
      <p class="note small" id="lock" aria-live="polite"></p>
      <div class="limits">
        <div><label for="requests">Stop after</label><select id="requests"><option value="5">5 requests</option><option value="20" selected>20 requests</option><option value="100">100 requests</option><option value="1000">1,000 requests</option></select></div>
        <div><label for="days">Or after</label><select id="days"><option value="1">1 day</option><option value="7" selected>7 days</option><option value="30">30 days</option></select></div>
      </div>
      <p class="error" id="error" role="alert" hidden></p>
      <div class="actions"><button class="accent" id="yes">Allow</button><button class="quiet" id="no">${current ? "Keep what it has" : wasStopped ? "Close" : "Don't allow"}</button>${current ? `<button class="quiet" id="stop">Stop this site</button>` : ""}</div>
      <p class="small muted">What you allow is kept in this browser, inside that site, and stops by itself at the limit you set. To see what a site has used, or to stop it sooner, open this window from the site again. ${NEVER}</p>`;
    // Say where the prompts can go with the choice that is ticked.
    const lock = () => {
      const ticked = document.querySelector("input[name=choice]:checked");
      const picked = list.find((c) => c.key === (ticked && ticked.value)) || list[0];
      const address = PROVIDERS[picked.provider] && PROVIDERS[picked.provider].baseUrl;
      document.getElementById("lock").textContent = address
        ? `With this choice the router sends this site's prompts to ${new URL(address).host}. Your browser lets the router connect there, and nowhere else.`
        : "With this choice your prompts stay on this device.";
    };
    document.getElementById("choices").addEventListener("change", lock);
    lock();
    document.getElementById("no").onclick = cancel;
    if (current) document.getElementById("stop").onclick = stopSite;
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
      const within = (value, low, high, otherwise) => Math.min(high, Math.max(low, Math.round(Number(value)) || otherwise));
      const made = Date.now();
      try {
        // The API key is encrypted here, to a key pair made by the page that will keep it:
        // the frame inside the site, or this window's own worker. Only that page can open it.
        const sealed = choice.secretKey ? await seal(host ? await host.offer() : frame.pub, choice.secretKey) : null;
        const grant = {
          id: random(9), site, provider: choice.provider, providerName: choice.providerName, model: choice.model, label: choice.label,
          requests: within(document.getElementById("requests").value, 1, 100000, 20), expires: made + within(document.getElementById("days").value, 1, 365, 7) * 86400000,
          used: 0, tokensIn: 0, tokensOut: 0, made, last: 0, sealed,
        };
        const confirmed = await deliver(grant);
        if (!confirmed) throw new Error("The opening site closed or did not confirm the grant. You can close this window or try again.");
        remember(grant, host ? "window" : "frame");
        wasStopped = false;
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
    host.onforget = () => { if (view === "connected" && !stopping) setTimeout(() => close(), 400); };
    addEventListener("message", (event) => {
      if (event.origin !== site || !event.data) return;
      // The site's page is going away. By the time this arrives the page may
      // be gone, and then the browser no longer says which window sent it, so
      // only the address is checked. All it can do is close this window.
      if (event.data.router === "bye") close();
      else if (event.data.router === "choose" && event.source === opener && view === "connected") draw();   // the site asks the person to choose again
    });
    // Keep the count on show up to date while the site uses the model through this window.
    setInterval(async () => { const el = document.getElementById("used"); const now = view === "connected" && await host.current(); if (el && now) el.textContent = usedSoFar(now); }, 1000);
    setInterval(() => { if (!opener || opener.closed) close(); }, 500);
    addEventListener("pagehide", () => tellSite({ router: "closing" }));
  }
  // An account added in another tab shows up here without a reload.
  addEventListener("storage", () => { if (!busy && view === "choose") draw(); });
}
