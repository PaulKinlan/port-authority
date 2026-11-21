// Knowing whether the other side of a MessagePort is still there.
//
// A port does not say when its other end has gone. Posting into a port whose
// other end was destroyed does not throw, and no event fires. Everything here
// runs on a second port that is used for nothing else, so the port that
// carries your data needs no message types for it.
//
//   Ping and answer. One side asks, the other answers.
//     watch(port, { onState })     the side that wants to know
//     answer(port)                 the side being watched
//
//   Beats. One side sends on a timer and never listens. The other only listens.
//     beat(port)                   the side being watched
//     listen(port, { onState })    the side that wants to know
//
//   A Web Lock. Same origin only. The browser releases it when the holder dies.
//     const name = await holdLock()        the side being watched
//     await whenReleased(name)             the side that wants to know
//
// States given to onState(state, why):
//   "waiting"  nothing heard yet
//   "alive"    heard from it in time
//   "late"     one answer or beat is overdue
//   "silent"   several are overdue. It may be dead, stuck, or held up. It can come back.
//   "paused"   it said it is being frozen or put in the back/forward cache. A page
//              in that cache can be thrown away later without another word, so
//              after `pausedFor` (ten minutes unless set) this becomes "silent".
//   "closed"   it said goodbye, or the browser said the port closed. This one is final.

const now = () => performance.now();
const isWindow = typeof document !== "undefined";

function tracker(onState, pausedFor) {
  let state = "waiting", since = now();
  return {
    get state() { return state; },
    set(next, why = "") { if (next === state) return; state = next; since = now(); onState(next, why); },
    // True while paused, until the pause has gone on too long.
    paused() {
      if (state !== "paused") return false;
      if (now() - since < pausedFor) return true;
      this.set("silent", "paused for too long. It may have been thrown away");
      return true;
    },
  };
}

// The far side tells what it knows about its own life, where the platform
// tells it anything. A page hears pagehide, freeze and resume. A worker hears
// nothing. Returns a function that stops listening.
export function announce(port) {
  if (!isWindow) return () => {};
  const hide = (event) => port.postMessage(event.persisted ? { paused: "back/forward cache" } : { bye: "the page is going away" });
  const show = (event) => { if (event.persisted) port.postMessage({ resumed: true }); };
  const freeze = () => port.postMessage({ paused: "frozen by the browser" });
  const resume = () => port.postMessage({ resumed: true });
  addEventListener("pagehide", hide); addEventListener("pageshow", show);
  document.addEventListener("freeze", freeze); document.addEventListener("resume", resume);
  return () => {
    removeEventListener("pagehide", hide); removeEventListener("pageshow", show);
    document.removeEventListener("freeze", freeze); document.removeEventListener("resume", resume);
  };
}

// What both kinds of watcher do with a message that is about the far side's life.
function life(data, track, stop) {
  if (data.bye) { stop(); track.set("closed", data.bye === true ? "it said goodbye" : data.bye); return true; }
  if (data.paused) { track.set("paused", data.paused); return true; }
  if (data.resumed) { track.set("alive", "it resumed"); return true; }
  return false;
}

// Chromium has had a `close` event on ports behind a flag. It was taken out of
// the HTML standard in October 2026 and no browser has it switched on. Where it
// does exist, it is the quickest signal there is, so it is used.
export const hasCloseEvent = typeof MessagePort !== "undefined" && "onclose" in MessagePort.prototype;

// ---- Ping and answer

// closeEvent: false ignores the port close event where a browser has one, to time pings alone.
// An answer says whether the page that sent it is hidden. Chrome can hold a
// hidden page to running timers once a minute (measured from 1 to 6 minutes in),
// and its answers slow down too, so a hidden far side is allowed `hiddenEvery`
// between answers instead of `every`.
export function watch(port, { every = 1000, misses = 3, hiddenEvery = 60000, pausedFor = 600000, closeEvent = true, onState = () => {}, onPing = () => {}, onPong = () => {} } = {}) {
  const track = tracker(onState, pausedFor);
  let sent = 0, heard = 0, missed = 0, last = now(), heardAt = now(), hidden = false, timer = 0;
  const stop = () => { clearInterval(timer); timer = 0; };
  port.onmessage = ({ data }) => {
    if (!data || track.state === "closed") return;
    if (life(data, track, stop)) { missed = 0; heard = sent; return; }
    if (data.pong) { heard = Math.max(heard, data.pong); heardAt = now(); hidden = !!data.hidden; missed = 0; onPong(data.pong); track.set("alive"); }
  };
  if (hasCloseEvent && closeEvent) port.addEventListener("close", () => { stop(); track.set("closed", "the browser said the port closed"); });
  const tick = () => {
    const t = now(), heldUp = t - last > every * 2;
    last = t;
    if (track.paused()) return;
    // If this side's own timer ran late, this side was the one not listening.
    // That says nothing about the other side, so the count starts again.
    if (heldUp) { missed = 0; heardAt = t; }
    else if (hidden && sent > heard) {
      const quiet = t - heardAt;
      if (quiet > hiddenEvery * (misses + 0.5)) track.set("silent", `a hidden page, nothing for ${Math.round(quiet / 1000)} s`);
      else if (quiet > hiddenEvery * 1.5) track.set("late", "a hidden page, answering slowly");
    }
    else if (sent > heard) { missed++; track.set(missed >= misses ? "silent" : "late", `${missed} ping${missed === 1 ? "" : "s"} not answered`); }
    port.postMessage({ ping: ++sent });
    onPing(sent);
  };
  timer = setInterval(tick, every);
  tick();
  return { get state() { return track.state; }, stop() { stop(); port.onmessage = null; } };
}

// announce: false leaves out the goodbye on pagehide, for when another port carries it.
export function answer(port, { onPing = () => {}, announce: tellLife = true } = {}) {
  port.onmessage = ({ data }) => { if (data && data.ping) { port.postMessage({ pong: data.ping, hidden: isWindow && document.hidden }); onPing(data.ping); } };
  const quiet = tellLife ? announce(port) : () => {};
  return { bye() { port.postMessage({ bye: true }); }, stop() { quiet(); port.onmessage = null; } };
}

// ---- Beats

// Each beat says how often beats are meant to come and whether the page is
// hidden, because a hidden page's timers are slowed by the browser. No extra
// beat is sent when the page becomes hidden: a page being removed becomes
// hidden too, and that last beat would ask the listener to wait a minute.
export function beat(port, { every = 1000, onBeat = () => {}, announce: tellLife = true } = {}) {
  let n = 0;
  const send = () => { port.postMessage({ beat: ++n, every, hidden: isWindow && document.hidden }); onBeat(n); };
  const timer = setInterval(send, every);
  const quiet = tellLife ? announce(port) : () => {};
  send();
  return { bye() { port.postMessage({ bye: true }); }, stop() { clearInterval(timer); quiet(); } };
}

// hiddenEvery: how long to allow between beats from a page that said it is
// hidden. Chrome can hold a hidden page's timers to one run a minute.
export function listen(port, { misses = 3, hiddenEvery = 60000, pausedFor = 600000, closeEvent = true, onState = () => {}, onBeat = () => {} } = {}) {
  const track = tracker(onState, pausedFor);
  let every = 1000, hidden = false, heardAt = now(), last = now(), timer = 0;
  const step = 250;
  const stop = () => { clearInterval(timer); timer = 0; };
  port.onmessage = ({ data }) => {
    if (!data || track.state === "closed") return;
    heardAt = now();
    if (life(data, track, stop)) return;
    if (data.beat) { every = data.every || every; hidden = !!data.hidden; onBeat(data.beat); track.set("alive"); }
  };
  if (hasCloseEvent && closeEvent) port.addEventListener("close", () => { stop(); track.set("closed", "the browser said the port closed"); });
  timer = setInterval(() => {
    const t = now(), heldUp = t - last > Math.max(step * 4, 1500);
    last = t;
    if (heldUp) heardAt = t;   // this side was not listening. Give the other side a fresh start.
    if (track.state === "waiting" || track.paused()) return;
    const allow = hidden ? Math.max(every, hiddenEvery) : every;
    const quiet = t - heardAt;
    if (quiet > allow * (misses + 0.5)) track.set("silent", `nothing for ${Math.round(quiet / 100) / 10} s`);
    else if (quiet > allow * 1.5) track.set("late", "a beat is overdue");
  }, step);
  return { get state() { return track.state; }, stop() { stop(); port.onmessage = null; } };
}

// ---- A Web Lock

// Resolves with the lock's name once the lock is held. The lock is never
// released by this code. The browser releases it when this page or worker is
// destroyed, including when its process crashes.
export function holdLock(name = "alive-" + crypto.randomUUID()) {
  return new Promise((held, failed) => {
    navigator.locks.request(name, () => { held(name); return new Promise(() => {}); }).catch(failed);
  });
}

// Resolves when the lock with that name is free, which means its holder is
// gone. Only works where both sides share an origin and a storage partition.
export function whenReleased(name, { signal } = {}) {
  return navigator.locks.request(name, { signal }, () => {});
}
