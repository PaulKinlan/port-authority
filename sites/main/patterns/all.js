// Every pattern on the site, in reading order, for the index and for the
// page each one has to itself.
import { demos } from "/patterns/demos.js";
import { more } from "/patterns/more.js";
import { threads } from "/patterns/threads.js";
import { origins } from "/patterns/origins.js";
import { places } from "/patterns/places.js";
import { oneway } from "/patterns/oneway.js";
import { router } from "/patterns/router.js";

export const groups = [
  { id: "patterns", title: "The six basic patterns", demos },
  { id: "more", title: "More things a port can carry", demos: [...more, router] },
  { id: "threads", title: "Across threads", demos: threads },
  { id: "origins", title: "Between real sites", demos: [...origins, oneway] },
  { id: "places", title: "Other devices, service workers, sockets and audio", demos: places },
];
export const all = groups.flatMap((group) => group.demos.map((demo) => ({ ...demo, group })));
export const plain = (html) => html.replace(/<[^>]+>/g, "");
