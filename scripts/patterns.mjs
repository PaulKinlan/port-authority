#!/usr/bin/env node
// Writes the pattern pages out as HTML, so that everything there is to read
// is in the page before any script runs. The scripts then only start demos.
//
//   node scripts/patterns.mjs           write sites/main/patterns/<id>/index.html, the lists in /patterns/index.html,
//                                       and the demo cards in /guide/ and /missing/
//   node scripts/patterns.mjs --verify  exit 1 if any of them is out of date
//
// The words come from the same modules the demos do (all.js, deep.js,
// usage.js, built.js, demos.js), so a change there is a change here: run this
// after editing them. `npm test` runs the --verify form.
import { register } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, rmdirSync } from "node:fs";

register("./site-loader.mjs", import.meta.url);

// The modules also hold the demos' code, which names browser things when it
// is loaded. None of it is run here, so these only have to exist.
const nothing = () => new Proxy(function () {}, { get: (_, key) => (key === Symbol.toPrimitive ? () => "" : nothing()), apply: () => nothing(), construct: () => nothing(), set: () => true });
for (const name of ["document", "navigator", "localStorage", "sessionStorage"]) { try { globalThis[name] ??= nothing(); } catch {} }
globalThis.location ??= new URL("https://main.site.invalid/patterns/");
globalThis.window ??= globalThis;
globalThis.self ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });

const { all, groups, plain } = await import("/patterns/all.js");
const { deep } = await import("/patterns/deep.js");
const { usage } = await import("/patterns/usage.js");
const { built, shown } = await import("/patterns/built.js");
const { TOURS } = await import("/patterns/demos.js");
const { bites } = await import("/patterns/bites.js");
const { legend } = await import("/wire.js");

const dir = new URL("../sites/main/patterns/", import.meta.url);
const attr = (text) => String(text).replace(/"/g, "&quot;");
const list = (items, tag = "ul") => `<${tag}>\n${items.map((item) => `          <li>${item}</li>`).join("\n")}\n        </${tag}>`;
const paras = (items) => `<div class="stack paras">\n${items.map((p) => `          <p>${p}</p>`).join("\n")}\n        </div>`;
const stepList = (steps) => list(steps.map(([label, text]) => `<strong>${label}.</strong> ${text}`), "ol");
const NAV = `<nav aria-label="Primary"><a href="/">Experiments</a><a href="/guide/">The guide</a><a href="/patterns/" aria-current="page">Port patterns</a><a href="/comlink/">Comlink today</a><a href="/ai-router/">AI router</a><a href="/lab/">The lab</a><a href="/missing/">What is missing</a><a href="/reading/">Further reading</a><a href="/hub/">Your hub</a></nav>`;
const NO_SCRIPT = `<noscript><p class="small muted">The demo that runs here needs JavaScript. Everything else on this page reads the same without it.</p></noscript>`;

function page(demo, index) {
  const id = demo.id, more = deep[id] || {}, used = usage[id];
  const title = `${plain(demo.title)} | Port Authority`;
  const desc = attr(plain(demo.blurb).slice(0, 180));
  const steps = (demo.tour || TOURS[id] || { steps: [] }).steps;
  // A demo built for another pattern can also be what an idea on this page asks for.
  const mine = built.filter((b) => b.pattern === id || b.also?.[id]).map((b) => (b.pattern === id ? b : { ...b, use: b.also[id] }));
  const parts = [];
  parts.push(`<section id="what">\n        <h2>What you are looking at</h2>\n        <p>${demo.blurb}</p>\n      </section>`);
  // The code that is new, then the same code being used, then a real case for it.
  parts.push(`<section id="code">\n        <h2>The code</h2>\n        <pre>${demo.code}</pre>${used ? `\n        <h3 id="using">Using it</h3>\n        <pre>${used.code}</pre>\n        <h3 id="case">Where you would use it</h3>\n        <p>${used.when}</p>` : ""}\n      </section>`);
  if (more.how) parts.push(`<section id="how">\n        <h2>How it works</h2>\n        ${more.diagram || ""}${paras(more.how)}\n      </section>`);
  if (steps.length) parts.push(`<section id="steps">\n        <h2>Step by step</h2>\n        <p>What each press of Next does in the demo at the top.</p>\n        ${stepList(steps)}\n      </section>`);
  if (more.uses) {
    const covered = new Set(mine.flatMap((b) => b.use));
    const seen = more.uses.map((text, i) => [text, shown[`${id}:${i}`]]).filter(([, where], i) => where && !covered.has(i));
    const todo = more.uses.filter((_, i) => !covered.has(i) && !shown[`${id}:${i}`]);
    const articles = mine.map((b) => `<article class="built" id="${b.id}">
          <h3>${b.title}</h3>
          <p class="small muted idea">The idea: ${b.use.map((i) => more.uses[i]).join(" ")}</p>
          <div class="demo"></div>
          <h4>What you are looking at</h4>
          <p>${b.blurb}</p>
          <h4>The code</h4>
          <pre>${b.code}</pre>${b.how ? `\n          <h4>How it works</h4>\n          ${paras(b.how)}` : ""}${b.tour?.steps.length ? `\n          <h4>Step by step</h4>\n          <p>What each press of Next does in this demo.</p>\n          ${stepList(b.tour.steps)}` : ""}
        </article>`);
    parts.push(`<section id="uses">\n        <h2>What you could build with it</h2>${mine.length ? `\n        <p>${mine.length === 1 ? "This one is built and running below." : "These are built and running below."}</p>` : ""}${articles.map((a) => "\n        " + a).join("")}${seen.length ? `\n        <h3 class="todo">Already running</h3>\n        ${list(seen.map(([text, [href, label]]) => `${text} <a href="${href}">See ${label}.</a>`))}` : ""}${todo.length ? `\n        <h3 class="todo">Not built yet</h3>\n        ${list(todo)}` : ""}\n      </section>`);
  }
  if (more.tryIt) parts.push(`<section id="try">\n        <h2>Things to try</h2>\n        ${list(more.tryIt)}\n      </section>`);
  if (more.traps) parts.push(`<section id="traps">\n        <h2>Common mistakes</h2>\n        ${list(more.traps)}\n      </section>`);
  if (more.measured) parts.push(`<section id="measured">\n        <h2>Measured</h2>\n        <p class="measured">${more.measured} Other browsers are being filled in from <a href="/lab/results/">the lab's results</a>.</p>\n      </section>`);
  const related = (more.related || []).map((other) => all.find((d) => d.id === other)).filter(Boolean);
  if (related.length) parts.push(`<section id="related">\n        <h2>Read next</h2>\n        <ul class="cards">\n${related.map((d) => `          <li><a href="/patterns/${d.id}/"><strong>${d.title}</strong><span>${plain(d.blurb).split(". ")[0]}.</span></a></li>`).join("\n")}\n        </ul>\n      </section>`);
  const prev = all[index - 1], next = all[index + 1];
  const pager = `${prev ? `<a href="/patterns/${prev.id}/"><small>\u2039 Before this</small>${prev.title}</a>` : "<span></span>"}<a class="pager-all" href="/patterns/">All patterns</a>${next ? `<a class="pager-next" href="/patterns/${next.id}/"><small>After this \u203a</small>${next.title}</a>` : "<span></span>"}`;

  return `<!doctype html>
<!-- Written by scripts/patterns.mjs from the modules in /patterns/. Edit those, then run it. -->
<html lang="en" data-pattern="${id}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${desc}">
  <meta property="og:title" content="${attr(title)}">
  <meta property="og:description" content="${desc}">
  <meta property="og:type" content="article">
  <meta name="twitter:card" content="summary">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/base.css">
  <script src="/nav.js"></script>
  <link rel="stylesheet" href="/patterns/patterns.css">
  <link rel="stylesheet" href="/patterns/page.css">
  <script src="/errors.js"></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="wrap">
    <header class="site-bar">
      <a class="wordmark" href="/">Port Authority</a>
      ${NAV}
    </header>
    <main id="main">
      <div class="stack page-head">
        <p class="crumb"><a href="/patterns/">Port patterns</a> / <span id="group"><a href="/patterns/#${id}">${demo.group.title}</a></span></p>
        <h1 id="title">${demo.title}</h1>
      </div>
      <section class="pattern" id="demo"><div class="demo">${NO_SCRIPT}</div></section>
      <div class="deep" id="deep">
      ${parts.join("\n      ")}
      </div>
      <nav class="pager" id="pager" aria-label="More patterns">${pager}</nav>
    </main>
    <footer class="small muted" style="padding-block:2rem 4rem">Port Authority, by <a href="https://paul.kinlan.me">Paul Kinlan</a>. <a href="/about/">About this site</a>.</footer>
  </div>
  <script type="module" src="/patterns/page.js"></script>
  <script type="module" src="/refs.js"></script>
</body>
</html>
`;
}

// The index page is written by hand, apart from the parts between markers.
function fillIndex(html) {
  const fill = (name, body) => {
    const open = `<!-- made:${name} -->`, close = `<!-- /made:${name} -->`;
    const from = html.indexOf(open), to = html.indexOf(close);
    if (from < 0 || to < from) throw new Error(`patterns/index.html has no ${open} ... ${close}`);
    html = html.slice(0, from + open.length) + "\n" + body + "\n        " + html.slice(to);
  };
  fill("legend", "        " + legend());
  fill("contents", [
    ...groups.map((group) => `        <div><h3>${group.title}</h3><ol>${group.demos.map((d) => `<li><a href="/patterns/${d.id}/">${d.title}</a></li>`).join("")}</ol></div>`),
    `        <div><h3>Also on this page</h3><ol><li><a href="#sync">Block on a port: a synchronous call with no await</a></li><li><a href="#census">What will go down a port in your browser</a></li></ol></div>`,
  ].join("\n"));
  for (const group of groups) {
    fill(group.id, group.demos.map((demo) => `        <section class="pattern" id="${demo.id}">
          <h3><a href="/patterns/${demo.id}/">${demo.title}</a></h3>
          <div class="demo"></div>
          <div class="text">
            <p>${demo.blurb}</p>
            <pre>${demo.code}</pre>
            <p class="more"><a class="button quiet" href="/patterns/${demo.id}/">The full page on this: how it works, what to build, common mistakes \u203a</a></p>
          </div>
        </section>`).join("\n"));
  }
  return html;
}

// The guide and the page on what is missing show demos from here beside their own words. Each is a card:
// what it is called and what it shows, written out here, and an empty box that the page's script fills.
const anyDemo = (id) => all.find((d) => d.id === id) || built.find((d) => d.id === id) || bites.find((d) => d.id === id);
const CARDS = {
  "../guide/index.html": (demo, href) => `<article class="live" id="live-${demo.id}"><h4>${demo.title}</h4><p>${demo.blurb}</p><div class="demo" hidden></div><div class="live-actions"><button type="button" class="tiny accent run-demo" hidden>Run demo</button>${href ? `<a class="small" href="${href}">Open full page &rsaquo;</a>` : ""}</div></article>`,
  "../missing/index.html": (demo, href) => `<article class="live" id="live-${demo.id}"><h4>Running: ${demo.title}</h4><div class="demo"></div><p>${demo.blurb}</p>${href ? `<p class="small"><a href="${href}">The code, and how it works \u203a</a></p>` : ""}</article>`,
};
function fillCards(name, html) {
  let sets = 0;
  html = html.replace(/(<div class="live-set" data-demos="([^"]+)">(?:<h3>[^<]*<\/h3>)?)(?:\s*<!-- made:live -->[\s\S]*?<!-- \/made:live -->\s*)?<\/div>/g, (_, open, ids) => {
    sets++;
    const cards = ids.split(" ").map((id) => {
      const demo = anyDemo(id);
      if (!demo) throw new Error(`${name} asks for a demo called "${id}", and there is none`);
      return "          " + CARDS[name](demo, demo.bite ? "" : demo.pattern ? `/patterns/${demo.pattern}/#${demo.id}` : `/patterns/${demo.id}/`);
    });
    return `${open}\n          <!-- made:live -->\n${cards.join("\n")}\n          <!-- /made:live -->\n        </div>`;
  });
  if (!sets) throw new Error(`${name} has no live sets to fill`);
  // The key to the diagrams, where the page has one.
  html = html.replace(/(<div data-legend>)[\s\S]*?(<\/div>)/, (_, open, close) => `${open}${legend()}${close}`);
  return html;
}

const files = new Map(all.map((demo, index) => [`${demo.id}/index.html`, page(demo, index)]));
files.set("index.html", fillIndex(readFileSync(new URL("index.html", dir), "utf8")));
for (const name of Object.keys(CARDS)) files.set(name, fillCards(name, readFileSync(new URL(name, dir), "utf8")));

// Nothing written out may name a site's address: those differ between here and the deployed sites.
for (const [name, html] of files) if (html.includes(".site.invalid")) { console.error(`${name} would contain a site address, which cannot be written ahead of time.`); process.exit(1); }

// A pattern that has been removed or renamed must not leave its page behind.
const made = "<!-- Written by scripts/patterns.mjs";
const stale = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !files.has(`${e.name}/index.html`) && existsSync(new URL(`${e.name}/index.html`, dir)) && readFileSync(new URL(`${e.name}/index.html`, dir), "utf8").includes(made)).map((e) => e.name);

if (process.argv.includes("--verify")) {
  const wrong = [...files].filter(([name, html]) => !existsSync(new URL(name, dir)) || readFileSync(new URL(name, dir), "utf8") !== html).map(([name]) => name);
  if (wrong.length || stale.length) {
    console.error(`Out of date: ${[...wrong, ...stale.map((name) => name + "/ (no such pattern now)")].join(", ")}.\nRun: node scripts/patterns.mjs`);
    process.exit(1);
  }
  console.log(`${all.length} pattern pages, the patterns index, and the demo cards in the guide and in what is missing are up to date.`);
} else {
  let changed = 0;
  for (const [name, html] of files) {
    const url = new URL(name, dir);
    if (existsSync(url) && readFileSync(url, "utf8") === html) continue;
    mkdirSync(new URL(".", url), { recursive: true });
    writeFileSync(url, html);
    changed++;
  }
  // Only the page this script wrote is removed, and its folder if that leaves it empty.
  for (const name of stale) { rmSync(new URL(name + "/index.html", dir)); try { rmdirSync(new URL(name + "/", dir)); } catch {} }
  console.log(`${all.length} pattern pages, the patterns index, the guide and what is missing: ${changed} written${stale.length ? `, ${stale.length} removed` : ""}.`);
}
// The modules that were loaded may have left timers or handles open.
process.exit(0);
