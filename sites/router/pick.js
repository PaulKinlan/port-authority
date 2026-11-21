// The picker window: the person chooses which account a site may use.

import { choices, server, seal, random, me } from "/store.js";
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
  main.innerHTML = `<h1>This window is opened by a site</h1><p>A site that wants to use an AI model opens this window so that you can choose one. Nothing opened it this time.</p><p><a class="button" href="/">Go to your router</a></p>`;
} else {
  const { line, site, current } = found;
  const draw = async () => {
    const list = await choices();
    const real = list.some((c) => c.secretKey);
    main.innerHTML = `
      <p class="origin">${esc(site)}</p>
      <h1>This site wants to use an AI model</h1>
      <p>Choose which of your accounts it may use. The site can send prompts and read the answers. It cannot see your API key.</p>
      ${current ? `<p class="note small">It uses ${esc(current.label)} · ${esc(current.model)} now. Choosing again replaces that.</p>` : ""}
      <fieldset class="choices" id="choices">
        ${list.map((c, i) => `<label><input type="radio" name="choice" value="${esc(c.key)}" ${i === 0 ? "checked" : ""}><span><strong>${esc(c.label)} · ${esc(c.model)}</strong><span class="muted small">${esc(c.note || c.providerName)}</span></span></label>`).join("")}
      </fieldset>
      ${real ? "" : `<p class="small muted">You have not added an account with a key yet. <a href="/" target="_blank">Add one in your router</a>, then come back to this window.</p>`}
      <div class="limits">
        <div><label for="requests">Stop after</label><select id="requests"><option value="5">5 requests</option><option value="20" selected>20 requests</option><option value="100">100 requests</option><option value="1000">1,000 requests</option></select></div>
        <div><label for="days">Or after</label><select id="days"><option value="1">1 day</option><option value="7" selected>7 days</option><option value="30">30 days</option></select></div>
      </div>
      <p class="error" id="error" hidden></p>
      <div class="actions"><button class="accent" id="yes">Allow</button><button class="quiet" id="no">Don't allow</button></div>
      <p class="small muted">You can see what this site has used, and stop it, at <a href="/" target="_blank">your router</a>.</p>`;
    document.getElementById("no").onclick = () => { line.close(); close(); };
    document.getElementById("yes").onclick = async () => {
      const yes = document.getElementById("yes");
      yes.disabled = true;
      const choice = list.find((c) => c.key === document.querySelector("input[name=choice]:checked").value);
      const secret = random(24);
      try {
        const made = await server("grant", { site, secret, label: choice.label, provider: choice.provider, model: choice.model, requests: document.getElementById("requests").value, days: document.getElementById("days").value });
        if (!made.ok) throw new Error(made.why);
        const sealed = choice.secretKey ? await seal(made.wrap, choice.secretKey) : null;
        line.onmessage = (event) => { if (event.data && event.data.t === "stored") close(); };
        line.postMessage({ t: "grant", info: made.grant, grant: { person: me().id, id: made.id, secret, site, provider: choice.provider, providerName: choice.providerName, model: choice.model, label: choice.label, sealed } });
      } catch (error) {
        const box = document.getElementById("error");
        box.hidden = false; box.textContent = "That did not work: " + error.message;
        yes.disabled = false;
      }
    };
  };
  draw();
  // An account added in another tab shows up here without a reload.
  addEventListener("storage", draw);
}
