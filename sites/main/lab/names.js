// Names shared by the lab and its results page.

export const OUTCOMES = {
  "works": { mark: "●", label: "Works", text: "Arrived and still worked there." },
  "arrives-broken": { mark: "◐", label: "Arrives broken", text: "Arrived, but could not be used.", said: "The error when it was used there:" },
  "unreadable": { mark: "◌", label: "Unreadable", text: "Sent, but the receiver could not rebuild it.", said: "All the browser told the receiver:",
    why: "The sender's postMessage() did not throw, so the browser took it. At the other end it could not rebuild it, and fired a messageerror event in place of a message event. That event has no error in it. A browser gives no reason for this, to this page or to any other, so there is no more to show. There are two usual reasons. The thing is tied to the process it was made in, and the receiver runs in another. Or the receiver is a kind of place that has no such thing at all, as an audio worklet has no Blob. The list below shows where the same thing did arrive." },
  "refused": { mark: "×", label: "Refused", text: "The browser refused to send it.", said: "The error the browser gave:" },
  "no-answer": { mark: "?", label: "No answer", text: "Sent, and nothing came back.", said: "What happened:" },
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
