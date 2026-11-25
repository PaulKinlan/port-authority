// Step through a diagram one action at a time.
//
// A figure marked data-flow has numbered arrows in it, each in a group with
// class "hop" and data-step. The words for each step are list items with the
// same data-step, in the element the figure names in data-steps.
//
// Until someone presses the button, the diagram shows every arrow. Nothing
// moves by itself. In step mode one arrow stands out, the ones before it are
// faint, and the ones after it are nearly gone. A part with data-from appears
// at that step. A part with data-until fades after that step.

for (const figure of document.querySelectorAll("figure[data-flow]")) {
  const list = document.getElementById(figure.dataset.steps);
  const steps = list ? [...list.querySelectorAll("li[data-step]")] : [];
  const button = (name) => figure.querySelector(`[data-go="${name}"]`);
  const now = figure.querySelector(".flow-now");
  if (!steps.length || !button("start") || !now) continue;
  const last = steps.length;
  let at = 0;   // 0 is the whole picture

  const draw = () => {
    if (at) figure.dataset.at = String(at); else delete figure.dataset.at;
    for (const hop of figure.querySelectorAll(".hop")) {
      const n = Number(hop.dataset.step);
      hop.classList.toggle("done", at > n);
      hop.classList.toggle("now", at === n);
    }
    for (const part of figure.querySelectorAll("[data-from]")) part.classList.toggle("later", at > 0 && at < Number(part.dataset.from));
    for (const part of figure.querySelectorAll("[data-until]")) part.classList.toggle("over", at > Number(part.dataset.until));
    for (const li of steps) li.classList.toggle("now", Number(li.dataset.step) === at);
    button("start").hidden = at > 0;
    for (const name of ["back", "next", "all"]) button(name).hidden = at === 0;
    button("back").disabled = at <= 1;
    button("next").disabled = at >= last;
    now.textContent = at ? `Step ${at} of ${last}. ${steps[at - 1].textContent.trim()}` : "";
    // On a narrow screen the diagram scrolls sideways. Bring the arrow for this step into view.
    const art = figure.querySelector(".flow-art");
    const mark = figure.querySelector(".hop.now .num");
    if (art && mark && art.scrollWidth > art.clientWidth) {
      const box = mark.getBoundingClientRect(), frame = art.getBoundingClientRect();
      if (box.left < frame.left + 24 || box.right > frame.right - 24) {
        const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
        art.scrollTo({ left: art.scrollLeft + box.left - frame.left - art.clientWidth / 2, behavior: calm ? "auto" : "smooth" });
      }
    }
  };
  const go = (to, focus) => { at = Math.min(Math.max(to, 0), last); draw(); if (focus) button(focus).focus(); };

  button("start").addEventListener("click", () => go(1, "next"));
  button("next").addEventListener("click", () => go(at + 1, at + 1 >= last ? "back" : null));
  button("back").addEventListener("click", () => go(at - 1, at - 1 <= 1 ? "next" : null));
  button("all").addEventListener("click", () => go(0, "start"));
  draw();
}
