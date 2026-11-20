// Every pattern on the site, in reading order, for the index and for the
// page each one has to itself.
import { demos } from "/patterns/demos.js";
import { more } from "/patterns/more.js";
import { threads } from "/patterns/threads.js";
import { origins } from "/patterns/origins.js";
import { places } from "/patterns/places.js";

export const groups = [
  { id: "patterns", title: "Six moves with a port", demos },
  { id: "more", title: "Further out", demos: more },
  { id: "threads", title: "Across threads", demos: threads },
  { id: "origins", title: "Between real sites", demos: origins },
  { id: "places", title: "Further than this page", demos: places },
];
export const all = groups.flatMap((group) => group.demos.map((demo) => ({ ...demo, group })));
export const plain = (html) => html.replace(/<[^>]+>/g, "");
