// The picker window: the person chooses which account a site may use.

import { choices, server, seal, random, me } from "/store.js";
import { PROVIDERS } from "/providers.js";
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

const found = await findFrame();
if (!found) {
  document.title = "Open from a site | AI router";
  main.innerHTML = `<h1 tabindex="-1">This window is opened by a site</h1><p>A site that wants to use an AI model opens this window so that you can choose one. Nothing opened it this time.</p><p><a class="button" href="/">Go to your router</a></p>`;
  main.querySelector("h1").focus();
} else {
  const { line, site, current } = found;
  let busy = false;
  const cancel = () => {
    if (busy) return;
    try { line.close(); } catch {}
    close();
  };
  addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !busy) {
      event.preventDefault();
      cancel();
    }
  });

  const draw = async () => {
    const list = await choices();
    const real = list.some((c) => c.secretKey);
    const currentIndex = current ? list.findIndex((c) => c.label === current.label && c.model === current.model) : -1;
    const selectedIndex = currentIndex >= 0 ? currentIndex : 0;
    document.title = `Choose a model | AI router`;
    main.innerHTML = `
      <p class="origin">${esc(site)}</p>
      <h1 tabindex="-1">This site wants to use an AI model</h1>
      <p>Choose which of your accounts it may use. The site can send prompts and read the answers. It cannot see your API key.</p>
      ${current ? `<p class="note small">It uses ${esc(current.label)} · ${esc(current.model)} now. Choosing again replaces that.</p>` : ""}
      <fieldset class="choices" id="choices">
        <legend class="small muted">Choose an account and model</legend>
        ${list.map((c, i) => `<label><input type="radio" name="choice" value="${esc(c.key)}" ${i === selectedIndex ? "checked" : ""}><span><strong>${esc(c.label)} · ${esc(c.model)}</strong><span class="muted small">${esc(c.note || c.providerName)}</span></span></label>`).join("")}
      </fieldset>
      <p class="note small" id="lock" aria-live="polite"></p>
      ${real ? "" : `<p class="small muted">You have not added an account with a key yet. <a href="/" target="_blank" rel="noopener">Add one in your router</a>, then come back to this window.</p>`}
      <div class="limits">
        <div><label for="requests">Stop after</label><select id="requests"><option value="5">5 requests</option><option value="20" selected>20 requests</option><option value="100">100 requests</option><option value="1000">1,000 requests</option></select></div>
        <div><label for="days">Or after</label><select id="days"><option value="1">1 day</option><option value="7" selected>7 days</option><option value="30">30 days</option></select></div>
      </div>
      <p class="error" id="error" role="alert" hidden></p>
      <div class="actions"><button class="accent" id="yes">Allow</button><button class="quiet" id="no">Don't allow</button></div>
      <p class="small muted">You can see what this site has used, and stop it, at <a href="/" target="_blank" rel="noopener">your router</a>.</p>`;
    // Say where the prompts can go with the choice that is ticked.
    const lock = () => {
      const ticked = document.querySelector("input[name=choice]:checked");
      const picked = list.find((c) => c.key === (ticked && ticked.value)) || list[0];
      const address = PROVIDERS[picked.provider] && PROVIDERS[picked.provider].baseUrl;
      document.getElementById("lock").textContent = address
        ? `With this choice the router sends this site's prompts to ${new URL(address).host}. Your browser lets the router connect there and to the router's own server, and nowhere else.`
        : "With this choice your prompts are not sent anywhere.";
    };
    document.getElementById("choices").addEventListener("change", lock);
    lock();
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
        const confirmed = await new Promise((resolve) => {
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
          line.onmessage = (event) => { if (event.data && event.data.t === "stored") finish(true); };
          line.postMessage({ t: "grant", info: made.grant, grant: { person: me().id, id: made.id, secret, site, provider: choice.provider, providerName: choice.providerName, model: choice.model, label: choice.label, sealed } });
        });
        if (confirmed) return close();
        throw new Error("The opening site closed or did not confirm the grant. You can close this window or try again.");
      } catch (error) {
        busy = false;
        box.hidden = false;
        box.textContent = "That did not work: " + error.message;
        yes.disabled = false;
        yes.textContent = "Allow";
      }
    };
  };
  draw();
  // An account added in another tab shows up here without a reload.
  addEventListener("storage", () => { if (!busy) draw(); });
}
