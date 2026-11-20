// The lab's receiver, as a service worker. It handles no fetches.
importScripts("kinds.js");
addEventListener("install", () => skipWaiting());
addEventListener("message", (event) => { if (event.data && event.data.ctl) labReceive(event.ports[0], "service worker"); });
