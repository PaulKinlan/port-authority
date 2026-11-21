#!/usr/bin/env node
// Builds sites/main/reading/index.html from sites/main/reading/links.json.
//   node scripts/reading.mjs           write the page
//   node scripts/reading.mjs --verify  exit 1 if the page is out of date
//   node scripts/reading.mjs --check   fetch every link and report the ones that fail
import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";

const dir = new URL("../sites/main/reading/", import.meta.url);
const data = JSON.parse(readFileSync(new URL("links.json", dir), "utf8"));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const count = data.groups.reduce((n, g) => n + g.items.length, 0);

// A note may contain a link to another page on this site, written as <a href="/...">. Nothing else is let through.
const note = (s) => esc(s).replace(/&lt;a href=&quot;(\/[a-z0-9\/-]*)&quot;&gt;(.*?)&lt;\/a&gt;/g, '<a href="$1">$2</a>');

const item = (i) => `          <li>
            <a href="${esc(i.u)}">${esc(i.t)}</a>
            <span class="src">${esc(i.by)}${i.y ? ", " + esc(i.y) : ""}</span>
            <span class="note">${note(i.n)}</span>
          </li>`;

const group = (g) => `      <section id="${esc(g.id)}">
        <h2>${esc(g.title)}</h2>${g.intro ? `\n        <p>${esc(g.intro)}</p>` : ""}
        <ul class="links">
${g.items.map(item).join("\n")}
        </ul>
      </section>`;

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Further reading on message ports | Port Authority</title>
  <meta name="description" content="${count} links on MessageChannel, MessagePort, postMessage, transferable objects and SharedWorker: reference pages, specifications, articles, libraries, talks and research papers, each with a one-line note.">
  <link rel="stylesheet" href="/base.css">
  <script src="/errors.js"></script>
  <style>
    main { display: grid; gap: clamp(2rem, 5vw, 3.2rem); padding-block: 1rem 4rem; }
    main section { display: grid; gap: .9rem; border-top: 2px solid var(--ink); padding-top: clamp(1.2rem, 3vw, 2rem); grid-template-columns: minmax(0, 1fr); }
    main h2 { font-size: var(--step-2); max-width: 28ch; }
    main section > p { margin: 0; max-width: 66ch; }
    .toc { columns: 2 16rem; padding: 0; margin: 0; list-style: none; }
    .toc li { margin-bottom: .4rem; break-inside: avoid; }
    .links { list-style: none; margin: 0; padding: 0; display: grid; }
    .links li { display: grid; gap: .15rem; padding: .7rem 0; border-top: 1px solid var(--line); max-width: 76ch; }
    .links li:first-child { border-top: 0; }
    .links a { font-weight: 600; overflow-wrap: anywhere; }
    .links .src { font-size: var(--step--1); color: var(--muted); }
    .links .note { max-width: 70ch; }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="site-bar">
      <a class="wordmark" href="/">Port Authority</a>
      <nav><a href="/">Experiments</a><a href="/guide/">The guide</a><a href="/patterns/">Port patterns</a><a href="/lab/">The lab</a><a href="/missing/">What is missing</a><a href="/reading/" aria-current="page">Further reading</a><a href="/hub/">Your hub</a></nav>
    </header>
    <div class="stack" style="padding-block:2.5rem 1.5rem; --gap:1.1rem">
      <h1 style="font-size:var(--step-3)">Further reading on message ports</h1>
      <p>This site is built on other people's work. This page lists ${count} places to read more about <code>MessageChannel</code>, <code>MessagePort</code>, <code>postMessage</code>, transferable objects and <code>SharedWorker</code>: the reference pages, the specifications, articles, libraries, talks and research papers. Each link has one line on what it covers.</p>
      <p>Not much has been written about message ports on their own. Most of the writing and nearly all of the research is about <code>window.postMessage</code> and workers, so those are here too.</p>
      <p class="small muted">The links were last checked on ${esc(data.checked)}. If one is broken, or something good is missing, please <a href="https://github.com/PaulKinlan/port-authority/issues">open an issue</a>.</p>
      <ul class="toc">
${data.groups.map((g) => `        <li><a href="#${esc(g.id)}">${esc(g.title)}</a> <span class="muted small">${g.items.length}</span></li>`).join("\n")}
      </ul>
    </div>
    <main>
${data.groups.map(group).join("\n")}
    </main>
    <footer class="small muted" style="padding-block:2rem 4rem">Port Authority is a working name. By <a href="https://paul.kinlan.me">Paul Kinlan</a>. The list on this page is also available as <a href="/reading/links.json">links.json</a>.</footer>
  </div>
</body>
</html>
`;

const out = new URL("index.html", dir);
const mode = process.argv[2];
if (mode === "--verify") {
  let current = "";
  try { current = readFileSync(out, "utf8"); } catch {}
  if (current !== html) { console.error("sites/main/reading/index.html is out of date. Run: node scripts/reading.mjs"); process.exit(1); }
  console.log(`ok   reading page matches links.json (${count} links in ${data.groups.length} groups)`);
} else if (mode === "--check") {
  // curl is used so that the HTTPS_PROXY and CA settings of the machine apply.
  const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
  const curl = (u, ua) => new Promise((done) => execFile("curl", ["-sS", "-L", "--max-time", "30", "-o", "/dev/null", "-w", "%{http_code}", ...(ua ? ["-A", ua] : []), u], (e, so) => done(so.trim() || "000")));
  const urls = [...new Set(data.groups.flatMap((g) => g.items.map((i) => i.u)))];
  let bad = 0, next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < urls.length) {
      const u = urls[next++];
      let code = await curl(u, UA);
      if (code !== "200") code = await curl(u); // some sites refuse a browser-like agent from a script and accept curl's own
      if (code !== "200") { bad++; console.log(`${code}  ${u}`); }
    }
  }));
  console.log(`${urls.length - bad} of ${urls.length} links answered 200`);
  process.exit(bad ? 1 : 0);
} else {
  writeFileSync(out, html);
  console.log(`wrote sites/main/reading/index.html (${count} links in ${data.groups.length} groups)`);
}
