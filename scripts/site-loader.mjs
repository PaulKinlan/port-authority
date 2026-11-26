// Lets Node import the site's own modules, so that pages can be written out
// ahead of time from the same data the browser uses.
//
// The site imports by absolute path ("/patterns/demos.js", "/wire.js"). The
// Worker answers those from the site's own folder first and then the shared
// one, and this does the same. "/_sites.js" is made by the Worker for each
// request, so here it is a stand-in whose addresses end in ".invalid": a page
// that is written out must not contain one, and the generator checks.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITES = fileURLToPath(new URL("../sites/", import.meta.url));
const NAMES = ["main", "hub", "florist", "library", "planner", "router"];
const STAND_IN = "export const sites = " + JSON.stringify(Object.fromEntries(NAMES.map((name) => [name, `https://${name}.site.invalid`]))) + ';\nexport const site = "main";\n';

export async function resolve(specifier, context, next) {
  if (specifier === "/_sites.js") return { url: "data:text/javascript," + encodeURIComponent(STAND_IN), shortCircuit: true };
  if (specifier.startsWith("/") && !specifier.startsWith(SITES)) {
    for (const site of ["main", "shared"]) {
      const file = SITES + site + specifier;
      if (existsSync(file)) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
