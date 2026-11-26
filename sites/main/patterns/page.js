// Starts the demos on a pattern's own page.
//
// Everything there is to read on that page is already in its HTML, written
// out by scripts/patterns.mjs. This only fills the empty demo boxes.
import { mount, TOURS } from "/patterns/demos.js";
import { all } from "/patterns/all.js";
import { built } from "/patterns/built.js";

const id = document.documentElement.dataset.pattern;
const demo = all.find((d) => d.id === id);
const box = document.querySelector("#demo .demo");
if (demo && box) mount(box, demo, TOURS, { autoplay: true });

// The built ideas are demos too. Each is set up when any part of its article is about to be seen.
for (const article of document.querySelectorAll("article.built[id]")) {
  const idea = built.find((b) => b.id === article.id);
  const el = article.querySelector(".demo");
  if (!idea || !el) continue;
  new IntersectionObserver((entries, io) => { if (entries[0].isIntersecting) { io.disconnect(); mount(el, idea); } }, { rootMargin: "300px" }).observe(article);
}
