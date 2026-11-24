// On a narrow screen the main menu folds away behind a Menu button.
//
// A page opts in with <script src="/nav.js"></script> in its head. It is
// loaded there, and not deferred, so that the class below is set before the
// page is drawn and the links never flash open and shut. The styles are in
// /base.css. Without script nothing is hidden: the links wrap onto more lines.
document.documentElement.classList.add("has-menu");

addEventListener("DOMContentLoaded", () => {
  const bar = document.querySelector(".site-bar");
  const nav = bar && bar.querySelector("nav");
  if (!nav) return;
  if (!nav.id) nav.id = "site-nav";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "menu-toggle quiet tiny";
  button.textContent = "Menu";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", nav.id);
  nav.before(button);

  const isOpen = () => bar.classList.contains("menu-open");
  const set = (open) => {
    bar.classList.toggle("menu-open", open);
    button.setAttribute("aria-expanded", String(open));
  };
  button.addEventListener("click", () => set(!isOpen()));
  // Escape shuts the menu and puts you back on the button that opened it.
  addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !isOpen()) return;
    set(false);
    button.focus();
  });
});
