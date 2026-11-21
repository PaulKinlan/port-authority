// Links the things a page mentions to where they are documented.
//
// The first time a section names a web platform feature (MessagePort,
// postMessage, a shared worker...) the name becomes a link to its page on MDN.
// At the foot of the page a "References" list gives every feature the page
// mentioned, with its MDN page and the specification that defines it, and the
// projects the page draws on.
//
// A page opts in with <script type="module" src="/refs.js"></script>.
// To add a feature, add a row to `refs` and run `node scripts/check-refs.mjs`,
// which checks that every address answers and every spec anchor exists.

const MDN = "https://developer.mozilla.org/en-US/docs/";
const API = MDN + "Web/API/";
const JS = MDN + "Web/JavaScript/Reference/Global_Objects/";
const HTML = "https://html.spec.whatwg.org/multipage/";
const STREAMS = "https://streams.spec.whatwg.org/";
const ES = "https://tc39.es/ecma262/multipage/";

// name: how the list at the foot of the page shows it.
// what: one or two plain sentences saying what it is, shown in that list.
// text: words that are linked wherever they appear in prose or in <code>.
// code: words that are only linked inside <code>, because in a sentence they
//       could mean something else.
// loose: phrases matched in any letter case, with an optional plural "s".
// mdn, spec: where it is documented and where it is defined or described.
// url, by: for a project or a document that is not a platform feature.
export const refs = [
  // Channel messaging
  { name: "MessagePort", what: "One end of a message channel. Whatever is posted into it comes out of the other end, and it can be sent to another page, frame or worker.", text: ["MessagePort"], loose: ["message port"], mdn: API + "MessagePort", spec: [HTML + "web-messaging.html#message-ports", "HTML Standard"] },
  { name: "MessageChannel", what: "Makes a new pair of joined ports, port1 and port2.", text: ["MessageChannel"], loose: ["message channel"], mdn: API + "MessageChannel", spec: [HTML + "web-messaging.html#message-channels", "HTML Standard"] },
  { name: "Window.postMessage()", what: "Sends a message to another window or frame, which can be on a different origin. The receiver has to check who sent it.", text: ["window.postMessage", "parent.postMessage", "opener.postMessage"], mdn: API + "Window/postMessage", spec: [HTML + "web-messaging.html#posting-messages", "HTML Standard"] },
  { name: "Worker.postMessage()", what: "Sends a message from a page to a worker it started.", text: ["worker.postMessage"], mdn: API + "Worker/postMessage" },
  { name: "Client.postMessage()", what: "Sends a message from a service worker to one of the pages it controls.", text: ["client.postMessage"], mdn: API + "Client/postMessage", spec: ["https://w3c.github.io/ServiceWorker/#client-postmessage", "Service Workers"] },
  { name: "ServiceWorker.postMessage()", what: "Sends a message from a page to a service worker.", text: ["serviceWorker.postMessage"], mdn: API + "ServiceWorker/postMessage", spec: ["https://w3c.github.io/ServiceWorker/#service-worker-postmessage", "Service Workers"] },
  { name: "MessagePort.postMessage()", what: "Sends a message through a port. A second argument lists the objects to move instead of copy.", text: ["port.postMessage", "postMessage"], mdn: API + "MessagePort/postMessage", spec: [HTML + "web-messaging.html#dom-messageport-postmessage", "HTML Standard"] },
  { name: "MessagePort.start()", what: "Starts delivery of the messages queued on a port. It is needed when you listen with addEventListener, and not when you set onmessage.", text: ["port.start()"], code: ["start()"], mdn: API + "MessagePort/start", spec: [HTML + "web-messaging.html#dom-messageport-start", "HTML Standard"] },
  { name: "MessagePort close event", what: "An event fired on a port when its other end is closed or its owner goes away. It was added to the HTML Standard in 2024 and removed in October 2026. Chromium has it behind a flag.", text: ["MessagePortCloseEvent"], spec: [HTML + "web-messaging.html#disentangle", "HTML Standard"] },
  { name: "MessageEvent.ports", what: "The ports that arrived with a message, as an array on the event.", text: ["event.ports"], mdn: API + "MessageEvent/ports", spec: [HTML + "comms.html#dom-messageevent-ports", "HTML Standard"] },
  { name: "MessageEvent.origin", what: "The origin of the page that sent a message.", text: ["event.origin"], mdn: API + "MessageEvent/origin", spec: [HTML + "comms.html#dom-messageevent-origin", "HTML Standard"] },
  { name: "MessageEvent.source", what: "The window, port or worker that sent a message.", text: ["event.source"], mdn: API + "MessageEvent/source", spec: [HTML + "comms.html#dom-messageevent-source", "HTML Standard"] },
  { name: "messageerror event", what: "An event fired when a message arrives but cannot be rebuilt on the receiving side.", code: ["messageerror", "onmessageerror"], mdn: API + "MessagePort/messageerror_event", spec: [HTML + "indices.html#event-messageerror", "HTML Standard"] },
  { name: "BroadcastChannel", what: "A named channel that every page and worker on the same origin can join. A message goes to all of them. It cannot carry ports or other transferable objects.", text: ["BroadcastChannel"], mdn: API + "BroadcastChannel", spec: [HTML + "web-messaging.html#broadcasting-to-other-browsing-contexts", "HTML Standard"] },

  // Cloning and transferring
  { name: "Transferable objects", what: "Objects that can be moved to another page or worker instead of copied. After the move the sender can no longer use them. The transfer list is the argument to postMessage that names them.", text: ["transferables"], loose: ["transferable object", "transfer list"], mdn: API + "Web_Workers_API/Transferable_objects", spec: [HTML + "structured-data.html#transferable-objects", "HTML Standard"] },
  { name: "The structured clone algorithm", what: "The rules the browser follows to copy a value when it is posted. Most data is copied. Functions and DOM nodes are refused.", loose: ["structured clone algorithm", "structured clone", "structured cloning"], mdn: API + "Web_Workers_API/Structured_clone_algorithm", spec: [HTML + "structured-data.html#safe-passing-of-structured-data", "HTML Standard"] },
  { name: "structuredClone()", what: "Copies a value using the same rules as postMessage, without sending it anywhere.", text: ["structuredClone"], mdn: API + "Window/structuredClone", spec: [HTML + "structured-data.html#dom-structuredclone", "HTML Standard"] },
  { name: "DataCloneError", what: "The error thrown when something that cannot be copied or moved is posted.", text: ["DataCloneError"], mdn: API + "DOMException#datacloneerror", spec: ["https://webidl.spec.whatwg.org/#datacloneerror", "Web IDL"] },
  { name: "ArrayBuffer", what: "A block of raw bytes. It can be moved to another thread without copying.", text: ["ArrayBuffer"], mdn: JS + "ArrayBuffer", spec: [ES + "structured-data.html#sec-arraybuffer-objects", "ECMAScript"] },
  { name: "SharedArrayBuffer", what: "A block of raw bytes that several threads can read and write at the same time. Posting it shares it instead of copying it.", text: ["SharedArrayBuffer"], mdn: JS + "SharedArrayBuffer", spec: [ES + "structured-data.html#sec-sharedarraybuffer-objects", "ECMAScript"] },
  { name: "Atomics", what: "Functions for reading, writing and waiting on shared memory safely from several threads.", text: ["Atomics"], mdn: JS + "Atomics", spec: [ES + "structured-data.html#sec-atomics-object", "ECMAScript"] },
  { name: "Cross-origin isolation", what: "A state a page enters by sending two headers. It keeps other origins out of the page's process, and the browser then allows shared memory.", text: ["crossOriginIsolated"], loose: ["cross-origin isolated", "cross-origin isolation"], mdn: API + "Window/crossOriginIsolated", spec: [HTML + "webappapis.html#dom-crossoriginisolated", "HTML Standard"] },

  // Workers
  { name: "SharedWorker", what: "A worker that every page on the same origin can connect to. Each page that connects gets a port to it.", text: ["SharedWorker"], loose: ["shared worker"], mdn: API + "SharedWorker", spec: [HTML + "workers.html#shared-workers-and-the-sharedworker-interface", "HTML Standard"] },
  { name: "SharedWorker extendedLifetime", what: "An option in Chrome that keeps a shared worker running for a short time after its last page has closed.", code: ["extendedLifetime"], spec: ["https://developer.chrome.com/blog/extended-lifetime-shared-workers-origin-trial", "Chrome for Developers"] },
  { name: "Service workers", what: "A worker the browser starts for an origin to handle its network requests and events, even when no page is open. The browser stops it when it is idle.", loose: ["service worker"], mdn: API + "Service_Worker_API", spec: ["https://w3c.github.io/ServiceWorker/", "Service Workers"] },
  { name: "Clients.get()", what: "Looks up one page that a service worker controls, by its id.", code: ["clients.get"], mdn: API + "Clients/get", spec: ["https://w3c.github.io/ServiceWorker/#clients-get", "Service Workers"] },
  { name: "Web Workers", what: "Scripts that run on their own thread, away from the page.", loose: ["web worker", "dedicated worker"], mdn: API + "Web_Workers_API", spec: [HTML + "workers.html#dedicated-workers-and-the-worker-interface", "HTML Standard"] },
  { name: "AudioWorklet", what: "Code that processes audio on the browser's audio thread. Each node has a port for talking to the page.", text: ["AudioWorklet", "AudioWorkletProcessor", "audioWorkletNode.port"], mdn: API + "AudioWorklet", spec: ["https://webaudio.github.io/web-audio-api/#AudioWorklet", "Web Audio API"] },

  // Streams
  { name: "ReadableStream", what: "A source of data that is read a piece at a time. It can be moved to another page or worker.", text: ["ReadableStream"], mdn: API + "ReadableStream", spec: [STREAMS + "#rs-class", "Streams Standard"] },
  { name: "WritableStream", what: "A destination that data is written to a piece at a time. It can be moved to another page or worker.", text: ["WritableStream"], mdn: API + "WritableStream", spec: [STREAMS + "#ws-class", "Streams Standard"] },
  { name: "TransformStream", what: "A pair of streams: what is written to one side comes out of the other, changed.", text: ["TransformStream"], mdn: API + "TransformStream", spec: [STREAMS + "#ts-class", "Streams Standard"] },
  { name: "ReadableStream.pipeThrough()", what: "Sends a readable stream through a transform and returns the result as a new readable stream.", code: ["pipeThrough"], mdn: API + "ReadableStream/pipeThrough", spec: [STREAMS + "#rs-pipe-through", "Streams Standard"] },
  { name: "ReadableStream.tee()", what: "Splits one readable stream into two that carry the same data.", code: ["tee()"], mdn: API + "ReadableStream/tee", spec: [STREAMS + "#rs-tee", "Streams Standard"] },
  { name: "WebSocketStream", what: "A WebSocket whose messages are read and written as streams, so a slow reader slows the sender. Chromium only at the time of writing.", text: ["WebSocketStream"], mdn: API + "WebSocketStream" },
  { name: "WebSocket", what: "A two-way connection between a page and a server that stays open.", text: ["WebSocket"], mdn: API + "WebSocket", spec: ["https://websockets.spec.whatwg.org/", "WebSockets Standard"] },
  { name: "WebTransport", what: "A connection to a server over HTTP/3 that carries several streams and unordered datagrams.", text: ["WebTransport"], mdn: API + "WebTransport", spec: ["https://w3c.github.io/webtransport/", "WebTransport"] },

  // Other things that can be sent
  { name: "OffscreenCanvas", what: "A canvas that is not attached to the page, so a worker can draw to it.", text: ["OffscreenCanvas"], mdn: API + "OffscreenCanvas", spec: [HTML + "canvas.html#the-offscreencanvas-interface", "HTML Standard"] },
  { name: "transferControlToOffscreen()", what: "Hands the drawing of a canvas on the page to an OffscreenCanvas, which can then be sent to a worker.", code: ["transferControlToOffscreen"], mdn: API + "HTMLCanvasElement/transferControlToOffscreen", spec: [HTML + "canvas.html#dom-canvas-transfercontroltooffscreen", "HTML Standard"] },
  { name: "ImageBitmap", what: "A decoded image that is ready to draw. It can be moved to another thread without copying the pixels.", text: ["ImageBitmap"], mdn: API + "ImageBitmap", spec: [HTML + "imagebitmap-and-animations.html#imagebitmap", "HTML Standard"] },
  { name: "VideoFrame", what: "One frame of video. It can be moved between threads without copying the pixels.", text: ["VideoFrame"], mdn: API + "VideoFrame", spec: ["https://w3c.github.io/webcodecs/#videoframe-interface", "WebCodecs"] },
  { name: "AudioData", what: "A block of decoded audio samples.", text: ["AudioData"], mdn: API + "AudioData", spec: ["https://w3c.github.io/webcodecs/#audiodata-interface", "WebCodecs"] },
  { name: "MediaStreamTrack", what: "One live track of audio or video, for example from a camera.", text: ["MediaStreamTrack"], mdn: API + "MediaStreamTrack", spec: ["https://www.w3.org/TR/mediacapture-streams/#mediastreamtrack", "Media Capture and Streams"] },
  { name: "MediaSourceHandle", what: "A handle to a MediaSource that lives in a worker. The page gives it to a video element to play what the worker feeds in.", text: ["MediaSourceHandle"], mdn: API + "MediaSourceHandle", spec: ["https://w3c.github.io/media-source/#mediasourcehandle", "Media Source Extensions"] },
  { name: "RTCDataChannel", what: "A channel for data between two browsers over a WebRTC connection.", text: ["RTCDataChannel"], mdn: API + "RTCDataChannel", spec: ["https://www.w3.org/TR/webrtc/#rtcdatachannel", "WebRTC"] },
  { name: "WebRTC", what: "The browser's APIs for direct connections between two browsers, carrying audio, video or data.", text: ["WebRTC"], mdn: API + "WebRTC_API", spec: ["https://w3c.github.io/webrtc-pc/", "WebRTC"] },
  { name: "CryptoKey", what: "A key made by the Web Crypto API. It is an opaque object: code can use it to sign or encrypt, but a key marked as not extractable can never be read out, even after it is posted to another page.", text: ["CryptoKey"], mdn: API + "CryptoKey", spec: ["https://w3c.github.io/webcrypto/#cryptokey-interface", "Web Cryptography"] },
  { name: "WebAssembly.Module", what: "Compiled WebAssembly code. It can be posted to a worker so that it is not compiled twice.", text: ["WebAssembly.Module"], mdn: MDN + "WebAssembly/Reference/JavaScript_interface/Module", spec: ["https://webassembly.github.io/spec/js-api/#modules", "WebAssembly JavaScript Interface"] },
  { name: "WebAssembly.Memory", what: "The block of memory a WebAssembly program runs in. It can be created as shared.", text: ["WebAssembly.Memory"], mdn: MDN + "WebAssembly/Reference/JavaScript_interface/Memory", spec: ["https://webassembly.github.io/spec/js-api/#memories", "WebAssembly JavaScript Interface"] },

  // Lifetime
  { name: "pagehide event", what: "An event fired when a page is being left: closed, navigated away from, or put in the back/forward cache.", text: ["pagehide"], mdn: API + "Window/pagehide_event", spec: [HTML + "indices.html#event-pagehide", "HTML Standard"] },
  { name: "AbortSignal", what: "An object that tells running work to stop. It is passed in when the work starts.", text: ["AbortSignal"], mdn: API + "AbortSignal", spec: ["https://dom.spec.whatwg.org/#interface-AbortSignal", "DOM Standard"] },
  { name: "WeakRef", what: "A reference to an object that does not stop it from being garbage collected.", text: ["WeakRef"], mdn: JS + "WeakRef", spec: [ES + "managing-memory.html#sec-weak-ref-objects", "ECMAScript"] },
  { name: "FinalizationRegistry", what: "Runs a callback some time after an object has been garbage collected.", text: ["FinalizationRegistry"], mdn: JS + "FinalizationRegistry", spec: [ES + "managing-memory.html#sec-finalization-registry-objects", "ECMAScript"] },
  { name: "Symbol.dispose", what: "The method the using keyword calls to clean up an object when it goes out of scope.", text: ["Symbol.dispose"], mdn: JS + "Symbol/dispose" },
  { name: "Proxy", what: "An object that stands in for another and intercepts what is done to it, such as reading a property or calling it.", code: ["Proxy"], mdn: JS + "Proxy", spec: [ES + "reflection.html#sec-proxy-objects", "ECMAScript"] },

  // Storage and security
  { name: "Origin private file system", what: "Storage for files that belongs to one origin and that the person never sees in their own folders. A worker can open a file in it for fast, exclusive access.", text: ["OPFS"], loose: ["origin private file system"], mdn: API + "File_System_API/Origin_private_file_system", spec: ["https://fs.spec.whatwg.org/#sandboxed-filesystem", "File System Standard"] },
  { name: "Web Locks", what: "Lets pages and workers on one origin take a named lock, so that only one of them does a piece of work at a time.", loose: ["web locks"], code: ["navigator.locks"], mdn: API + "Web_Locks_API", spec: ["https://w3c.github.io/web-locks/", "Web Locks"] },
  { name: "Content Security Policy", what: "A header that limits what a page may load and where it may connect.", text: ["CSP"], loose: ["content security policy"], mdn: MDN + "Web/HTTP/Guides/CSP", spec: ["https://w3c.github.io/webappsec-csp/", "Content Security Policy"] },
  { name: "Storage Access API", what: "Lets an embedded frame ask for the storage it would have as a top-level page.", text: ["requestStorageAccess"], mdn: API + "Storage_Access_API", spec: ["https://privacycg.github.io/storage-access/", "Storage Access API"] },

  // Other platform features the pages name
  { name: "<iframe>", what: "An element that shows another page inside this one. The inner page can be on a different origin, and the two can only talk by posting messages.", text: ["iframe"], mdn: MDN + "Web/HTML/Reference/Elements/iframe", spec: [HTML + "iframe-embed-object.html#the-iframe-element", "HTML Standard"] },
  { name: "IndexedDB", what: "A database in the browser that belongs to one origin. It can store most things that can be posted, including a CryptoKey.", text: ["IndexedDB"], mdn: API + "IndexedDB_API", spec: ["https://w3c.github.io/IndexedDB/", "Indexed Database API"] },
  { name: "Web Crypto API", what: "The browser's built-in functions for making keys, signing, encrypting and hashing.", text: ["WebCrypto", "Web Crypto", "crypto.subtle"], mdn: API + "Web_Crypto_API", spec: ["https://w3c.github.io/webcrypto/", "Web Cryptography"] },
  { name: "sessionStorage", what: "A small store of strings that belongs to one tab and one origin, and is emptied when the tab closes.", text: ["sessionStorage"], mdn: API + "Window/sessionStorage", spec: [HTML + "webstorage.html#dom-sessionstorage", "HTML Standard"] },
  { name: "localStorage", what: "A small store of strings that belongs to one origin and is kept between visits.", text: ["localStorage"], mdn: API + "Window/localStorage", spec: [HTML + "webstorage.html#dom-localstorage", "HTML Standard"] },
  { name: "WebAssembly", what: "A compact binary format for code that browsers run at close to native speed.", text: ["WebAssembly"], mdn: MDN + "WebAssembly", spec: ["https://webassembly.github.io/spec/js-api/", "WebAssembly JavaScript Interface"] },
  { name: "RTCPeerConnection", what: "A WebRTC connection between this browser and another one.", text: ["RTCPeerConnection"], mdn: API + "RTCPeerConnection", spec: ["https://www.w3.org/TR/webrtc/#rtcpeerconnection-interface", "WebRTC"] },
  { name: "RTCCertificate", what: "The certificate a WebRTC connection uses to prove which browser it is talking to.", text: ["RTCCertificate"], mdn: API + "RTCCertificate", spec: ["https://www.w3.org/TR/webrtc/#dom-rtccertificate", "WebRTC"] },
  { name: "MediaStream", what: "A set of live audio and video tracks, for example what a camera and microphone are capturing.", text: ["MediaStream"], mdn: API + "MediaStream", spec: ["https://www.w3.org/TR/mediacapture-streams/#mediastream", "Media Capture and Streams"] },
  { name: "EncodedVideoChunk", what: "One piece of compressed video, before it is decoded into a frame.", text: ["EncodedVideoChunk"], mdn: API + "EncodedVideoChunk", spec: ["https://w3c.github.io/webcodecs/#encodedvideochunk-interface", "WebCodecs"] },
  { name: "ImageData", what: "The raw pixels of an area of a canvas.", text: ["ImageData"], mdn: API + "ImageData", spec: [HTML + "imagebitmap-and-animations.html#imagedata", "HTML Standard"] },
  { name: "Blob", what: "A fixed piece of binary data, such as the contents of a file. It is copied when posted, and the copy points at the same bytes.", text: ["Blob"], mdn: API + "Blob", spec: ["https://w3c.github.io/FileAPI/#blob-section", "File API"] },
  { name: "CropTarget", what: "A token for an element on a page. A screen capture can be cropped to that element, and the token can be posted to the frame doing the capture.", text: ["CropTarget"], mdn: API + "CropTarget", spec: ["https://w3c.github.io/mediacapture-region/", "Region Capture"] },
  { name: "Back/forward cache", what: "The browser keeps a page it has left, whole and paused, so that Back shows it at once. A page in the cache receives no messages.", text: ["bfcache"], loose: ["back/forward cache"], mdn: MDN + "Glossary/bfcache", spec: [HTML + "browsing-the-web.html#note-bfcache", "HTML Standard"] },

  // Projects and documents this site draws on
  { name: "Comlink", text: ["Comlink"], url: "https://github.com/GoogleChromeLabs/comlink", by: "Surma and the Chrome Labs team" },
  { name: "WebMCP", text: ["WebMCP"], url: "https://webmachinelearning.github.io/webmcp/", by: "the W3C Web Machine Learning Community Group" },
  { name: "Model Context Protocol", text: ["Model Context Protocol", "MCP"], url: "https://modelcontextprotocol.io/", by: "the Model Context Protocol project" },
  { name: "Agent Client Protocol", text: ["Agent Client Protocol", "ACP"], url: "https://agentclientprotocol.com/", by: "the Agent Client Protocol project" },
  { name: "Web Intents", text: ["Web Intents"], url: "https://www.w3.org/TR/web-intents/", by: "the W3C Web Intents Task Force, a Working Group Note from 2013" },
];

// A project is linked once on a page. A platform feature is linked once in
// each section, because readers arrive at sections from other pages.
const perPage = (ref) => !!ref.by;
export const href = (ref) => ref.mdn || ref.url || ref.spec[0];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const longest = (a, b) => b.length - a.length;
function matcher(key, flags, plural) {
  const words = new Map();
  for (const ref of refs) for (const word of ref[key] || []) words.set(flags.includes("i") ? word.toLowerCase() : word, ref);
  if (!words.size) return null;
  // Not in the middle of a longer name, a property path, or a file name.
  const re = new RegExp(`(?<![\\w.$/-])(${[...words.keys()].sort(longest).map(escape).join("|")})${plural ? "s?" : ""}(?![\\w])`, flags);
  return { re, find: (hit) => words.get(flags.includes("i") ? hit.toLowerCase() : hit) };
}
const TEXT = matcher("text", "g", true);
const LOOSE = matcher("loose", "gi", true);
const CODE = matcher("code", "g", false);

// Every place in a string that names something, in order, with no overlaps.
export function mentions(string, inCode = false) {
  const found = [];
  for (const m of [TEXT, LOOSE, inCode ? CODE : null]) {
    if (!m) continue;
    m.re.lastIndex = 0;
    for (let hit; (hit = m.re.exec(string)); ) found.push({ at: hit.index, end: hit.index + hit[0].length, ref: m.find(hit[1]) });
  }
  found.sort((a, b) => a.at - b.at || b.end - a.end);
  const kept = [];
  for (const f of found) if (!kept.length || f.at >= kept.at(-1).end) kept.push(f);
  return kept;
}

// Places where a name is not turned into a link: links and controls, code
// listings, headings, the site's own navigation, and the running demos.
const SKIP = "a, pre, button, nav, header, footer, h1, h2, h3, h4, summary, label, select, option, textarea, input, script, style, svg, dialog, [contenteditable], .demo, .no-refs, .refs";

function run(root) {
  const doc = root.ownerDocument;
  const linked = new Map(); // scope element -> refs already linked in it
  const mentioned = new Set(); // every ref the page names, in order
  const done = new WeakSet();

  const scopeOf = (node, ref, near) => (perPage(ref) && !near ? root : node.parentElement.closest("section") || root);
  const take = (node, ref, near) => {
    mentioned.add(ref);
    const scope = scopeOf(node, ref, near);
    if (!linked.has(scope)) linked.set(scope, new Set());
    if (linked.get(scope).has(ref) || (scope !== root && perPage(ref) && linked.get(root)?.has(ref))) return false;
    linked.get(scope).add(ref);
    return true;
  };
  const anchor = (ref) => {
    const a = doc.createElement("a");
    a.className = "ref";
    a.href = href(ref);
    a.title = ref.by ? `${ref.name}, by ${ref.by}` : `${ref.what} (${ref.mdn ? "MDN" : ref.spec[1]})`;
    return a;
  };

  function sweep() {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        if (node.matches(SKIP)) {
          // A link the page already made to the same place counts as the link
          // for the section it is in.
          if (node.matches("a[href]:not(.ref)")) for (const ref of refs) if (node.href === href(ref) && node.parentElement) take(node, ref, true);
          return NodeFilter.FILTER_REJECT;
        }
        return node.localName === "code" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (done.has(node) || !node.isConnected) continue;
      done.add(node);
      if (node.nodeType === Node.ELEMENT_NODE) {
        // A short piece of inline code becomes one link, whole.
        for (const child of node.childNodes) done.add(child);
        const text = node.textContent;
        if (text.length > 70 || node.children.length) continue;
        const [first] = mentions(text, true);
        if (first && take(node, first.ref)) {
          const a = anchor(first.ref);
          node.replaceWith(a);
          a.append(node);
        }
        continue;
      }
      if (node.parentElement?.closest("code")) continue;
      const found = mentions(node.data);
      if (!found.length) continue;
      const parts = [];
      let from = 0;
      for (const { at, end, ref } of found) {
        if (!take(node, ref)) continue;
        const a = anchor(ref);
        a.textContent = node.data.slice(at, end);
        parts.push(node.data.slice(from, at), a);
        from = end;
      }
      if (!parts.length) continue;
      parts.push(node.data.slice(from));
      for (const part of parts) if (typeof part !== "string") done.add(part);
      node.replaceWith(...parts);
    }
    list();
  }

  // The list at the foot of the page.
  let box = null, shown = "";
  function list() {
    const all = [...mentioned];
    const key = all.map((r) => r.name).join("|");
    if (!all.length || key === shown) return;
    shown = key;
    if (!box) {
      box = doc.createElement("section");
      box.className = "refs";
      box.setAttribute("aria-labelledby", "refs-title");
      const wrap = doc.querySelector(".wrap") || doc.body;
      const footer = [...wrap.children].filter((el) => el.localName === "footer").pop();
      footer ? footer.before(box) : wrap.append(box);
    }
    const esc = (text) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    const link = (url, text, label) => `<a href="${url}"${label ? ` aria-label="${esc(label)}"` : ""}>${esc(text)}</a>`;
    const features = all.filter((r) => !r.by).map((r) => `<div><dt>${esc(r.name)}</dt><dd>${esc(r.what)} <span class="refs-links">${r.mdn ? link(r.mdn, "MDN", `${r.name} on MDN`) : ""}${r.spec ? link(r.spec[0], r.spec[1], `${r.name}, ${r.spec[1]}`) : ""}</span></dd></div>`);
    const projects = all.filter((r) => r.by).map((r) => `<li>${link(r.url, r.name)}, by ${esc(r.by)}.</li>`);
    box.innerHTML = `<h2 id="refs-title">References</h2>
      ${features.length ? `<p>The web platform features this page mentions, with what each one is, its documentation on <a href="https://developer.mozilla.org/">MDN</a> and the specification that defines it.</p><dl class="refs-features">${features.join("")}</dl>` : ""}
      ${projects.length ? `<p>Projects and documents this page draws on.</p><ul class="refs-projects">${projects.join("")}</ul>` : ""}
      ${location.pathname.startsWith("/reading/") ? "" : `<p class="refs-more">For more, see <a href="/reading/">Further reading</a>: articles, talks, papers, libraries and <a href="/reading/#specs">the specifications</a>, collected in one place.</p>`}`;
  }

  sweep();
  // Most of these pages write their text from a script, some of it late.
  let timer = 0;
  const watch = new MutationObserver((records) => {
    if (records.every((r) => r.target.nodeType === Node.ELEMENT_NODE && r.target.closest(".demo, .refs, svg"))) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      watch.disconnect();
      try { sweep(); } finally { watch.observe(root, { childList: true, subtree: true }); }
    }, 150);
  });
  watch.observe(root, { childList: true, subtree: true });
}

if (typeof document !== "undefined") {
  const start = () => run(document.body);
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", start) : start();
}
