// Names shared by the lab and its results page.

export const OUTCOMES = {
  "works": { mark: "●", label: "Works", text: "Arrived and still worked there." },
  "arrives-broken": { mark: "◐", label: "Arrives broken", text: "Arrived, but could not be used." },
  "unreadable": { mark: "◌", label: "Unreadable", text: "Sent, but the receiver could not rebuild it." },
  "refused": { mark: "×", label: "Refused", text: "The browser refused to send it." },
  "no-answer": { mark: "?", label: "No answer", text: "Sent, and nothing came back." },
  "cannot-make": { mark: "–", label: "Not here", text: "This browser, or this page, cannot make one." },
  "no-destination": { mark: " ", label: "No such place", text: "This destination could not be set up." },
};

// Every place the lab sends to, in table order.
export const PLACES = {
  "clone": { id: "clone", label: "structuredClone()", group: "This page" },
  "channel": { id: "channel", label: "Message Channel", group: "This page" },
  "worker": { id: "worker", label: "Worker", group: "Threads" },
  "shared": { id: "shared", label: "SharedWorker", group: "Threads" },
  "sw": { id: "sw", label: "Service worker", group: "Threads" },
  "audio": { id: "audio", label: "Audio worklet", group: "Threads" },
  "frame": { id: "frame", label: "Frame, same origin", group: "Frames" },
  "frame-other": { id: "frame-other", label: "Frame, another origin", group: "Frames" },
  "frame-other-worker": { id: "frame-other-worker", label: "Worker inside that frame", group: "Frames" },
  "frame-sandbox": { id: "frame-sandbox", label: "Sandboxed frame, no origin", group: "Frames" },
  "broadcast": { id: "broadcast", label: "BroadcastChannel", group: "No transfer list" },
  "idb": { id: "idb", label: "IndexedDB", group: "No transfer list" },
  "history": { id: "history", label: "history.state", group: "No transfer list" },
  "popup-other": { id: "popup-other", label: "Popup, another origin", group: "Windows" },
};
