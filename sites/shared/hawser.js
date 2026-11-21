// Hawser (working name): remote objects over a MessagePort.
//
// A reworking of Comlink's idea for the platform as it is now. One file, no
// build step, no dependencies. See /comlink/ for the reasoning behind each
// choice, and test/hawser.unit.mjs for the behaviour, case by case.
//
//   // one side
//   expose({ add: (a, b) => a + b }, port);
//   // the other
//   const api = wrap(port);
//   await api.add(1, 2);
//
// What differs from Comlink:
//   - calls reject when the other side goes away, or on a timeout or an abort.
//     Three things notice a departure: a goodbye sent on close and on
//     pagehide, the port's `close` event where the browser has one, and an
//     optional heartbeat for a side that crashed without a word
//   - functions, class instances and async iterators cross by reference
//     without being marked, all on the one port, and are released by the
//     garbage collector, by `using`, or when the link closes
//   - an AbortSignal passed as an argument arrives as a working AbortSignal
//   - a chain such as api.login(u).profile.name() is one round trip
//   - the exposed object cannot be walked into its prototype, and can be
//     narrowed to a list of paths; a narrowed, revocable port can be minted
//     for a third party with port()
//   - errors arrive as real errors, with their name and cause

const TAG = "@hawser";
const DISPOSE = Symbol.dispose ?? Symbol.for("Symbol.dispose");
const ASYNC_DISPOSE = Symbol.asyncDispose ?? Symbol.for("Symbol.asyncDispose");
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

export class LinkClosedError extends Error {
  constructor(message = "The other side of this link has gone", options) { super(message, options); this.name = "LinkClosedError"; }
}

const proxyInfo = new WeakMap(); // proxy -> { link, id, path, state }
const shared = new WeakSet(); // objects to pass by reference
const given = new WeakSet(); // shared objects the other side owns: disposed when it lets go
const moved = new WeakSet(); // objects to transfer and not copy
const userClass = new WeakMap(); // prototype -> boolean

/** Pass this object by reference: the other side gets a proxy, not a copy. */
export function share(object) { shared.add(object); return object; }

/**
 * Pass this object by reference and hand over its lifetime: when the other
 * side lets go of it (by `using`, by garbage collection, or by going away) its
 * Symbol.dispose or Symbol.asyncDispose method is called here.
 */
export function give(object) { shared.add(object); given.add(object); return object; }

/** Move this object (an ArrayBuffer, an ImageBitmap...) and do not copy it. */
export function transfer(object) { moved.add(object); return object; }

const hasOwn = Object.prototype.hasOwnProperty;
const isPlain = (v) => { const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null; };
const mustMove = (v) => ["MessagePort", "ReadableStream", "WritableStream", "TransformStream", "OffscreenCanvas", "RTCDataChannel", "MediaSourceHandle"]
  .some((name) => typeof globalThis[name] === "function" && v instanceof globalThis[name]);

// An instance of a class somebody wrote. Structured clone would strip its
// methods, so it is far more useful by reference.
function isUserClassInstance(value) {
  const proto = Object.getPrototypeOf(value);
  if (!proto || proto === Object.prototype) return false;
  let answer = userClass.get(proto);
  if (answer === undefined) {
    const ctor = hasOwn.call(proto, "constructor") ? proto.constructor : null;
    answer = typeof ctor === "function" && !/\{\s*\[native code\]\s*\}\s*$/.test(Function.prototype.toString.call(ctor));
    userClass.set(proto, answer);
  }
  return answer;
}

// Read one step of a path without leaving the object's own surface. Own
// properties and class methods are reachable. Object.prototype and
// Function.prototype are not, so there is no way to `constructor`, `call`,
// `bind` or `__proto__`.
function step(object, key) {
  if (typeof key !== "string" || FORBIDDEN.has(key)) throw new TypeError(`"${String(key)}" cannot be reached over a link`);
  if (object === null || (typeof object !== "object" && typeof object !== "function")) throw new TypeError(`Cannot read "${key}" of ${object === null ? "null" : typeof object}`);
  if (proxyInfo.has(object)) return object[key]; // a remote object being passed on
  for (let o = object; o && o !== Object.prototype && o !== Function.prototype; o = Object.getPrototypeOf(o)) {
    if (hasOwn.call(o, key)) return object[key];
  }
  return undefined;
}

const segments = (allow) => allow.map((a) => (Array.isArray(a) ? a : a === "" ? [] : String(a).split(".")));
const startsWith = (path, prefix) => prefix.length <= path.length && prefix.every((s, i) => s === path[i]);
// Every list must permit the path. A list permits a path under any of its entries.
const permitted = (lists, path) => lists.every((list) => list.some((entry) => startsWith(path, entry)));
// What a list still restricts once you are standing at `path`. undefined means nothing.
function rebase(list, path) {
  if (list.some((entry) => startsWith(path, entry))) return undefined;
  return list.filter((entry) => startsWith(entry, path)).map((entry) => entry.slice(path.length));
}

// Links that are open in this realm. A page that is going away says goodbye
// on each of them, so the other side does not have to work it out.
const openLinks = new Set();
if (typeof globalThis.addEventListener === "function" && typeof globalThis.document === "object") {
  globalThis.addEventListener("pagehide", (event) => { if (!event.persisted) for (const link of [...openLinks]) link.close(); });
}

class Link {
  constructor(endpoint, { root, hasRoot = false, allows = [], timeout = 0, heartbeat = 0, signal, onclose } = {}) {
    this.endpoint = endpoint;
    this.timeout = timeout;
    this.exports = new Map(); // id -> { target, allows, count }
    this.exportIds = new WeakMap(); // target -> id
    this.imports = new Map(); // id -> { ref: WeakRef, count }
    this.pending = new Map(); // call id -> { resolve, reject, done }
    this.signalsIn = new Map(); // signal id -> AbortController
    this.signalsOut = new WeakMap(); // AbortSignal -> signal id
    this.children = new Set();
    this.outbox = [];
    this.ids = 1;
    this.isClosed = false;
    this.reason = undefined;
    this.closed = new Promise((resolve) => (this.resolveClosed = resolve));
    if (onclose) this.closed.then(onclose);
    if (hasRoot) this.exports.set(0, { target: root, allows, count: Infinity });

    this.registry = new FinalizationRegistry((id) => {
      const entry = this.imports.get(id);
      if (!entry || entry.ref.deref()) return;
      this.imports.delete(id);
      // Nobody holds anything of the other side, and it holds nothing of ours.
      if (id === 0) { if (!this.imports.size && !this.exports.size) this.close(); return; }
      this.post({ t: "drop", id, n: entry.count });
    });
    this.signalRegistry = new FinalizationRegistry((sid) => this.post({ t: "forget", sid }));

    this.onmessage = (event) => { this.missed = 0; this.receive(event.data, undefined); };
    this.onclose = () => this.close(new LinkClosedError());
    endpoint.addEventListener("message", this.onmessage);
    endpoint.addEventListener("close", this.onclose);
    endpoint.start?.();
    openLinks.add(this);

    if (heartbeat > 0) {
      // Counted in beats and not in milliseconds, because a background tab's
      // timers run late and a late timer is not a dead peer.
      this.missed = 0;
      this.beat = setInterval(() => {
        if (this.missed >= 2) return this.close(new LinkClosedError("The other side of this link stopped answering"));
        this.missed++;
        this.post({ t: "ping" });
      }, heartbeat);
      this.beat.unref?.();
    }
    if (signal) {
      if (signal.aborted) this.close(signal.reason);
      else signal.addEventListener("abort", () => this.close(signal.reason), { once: true });
    }
  }

  // ---------------------------------------------------------------- sending

  post(message, transfers) {
    if (this.isClosed) return;
    if (!this.outbox.length) queueMicrotask(() => this.flush());
    this.outbox.push({ message, transfers });
  }

  // Everything queued in one microtask goes as one message. That is what makes
  // a pipelined chain a single hop.
  flush() {
    const batch = this.outbox;
    this.outbox = [];
    if (this.isClosed || !batch.length) return;
    const transfers = (items) => [...new Set(items.flatMap((item) => (item.transfers ? [...item.transfers] : [])))];
    try {
      if (batch.length === 1) this.endpoint.postMessage(batch[0].message, transfers(batch));
      else this.endpoint.postMessage({ t: "batch", m: batch.map((item) => item.message) }, transfers(batch));
    } catch (error) {
      if (batch.length === 1) return this.unsendable(batch[0].message, error);
      // Something in there cannot be cloned. Send each chain of calls on its
      // own, so one bad argument only fails the calls that depend on it.
      const family = new Map(), groups = new Map();
      for (const item of batch) {
        const m = item.message;
        const key = m.t === "call" ? (m.on.pipe !== undefined ? family.get(m.on.pipe) : m.id) : item;
        if (m.t === "call") family.set(m.id, key);
        groups.set(key, [...(groups.get(key) ?? []), item]);
      }
      for (const group of groups.values()) {
        try { this.endpoint.postMessage(group.length === 1 ? group[0].message : { t: "batch", m: group.map((item) => item.message) }, transfers(group)); }
        catch (inner) { for (const item of group) this.unsendable(item.message, inner); }
      }
    }
  }

  unsendable(message, error) {
    if (message.t === "call") this.settle(message.id, false, error);
    else if (message.t === "ret") {
      const problem = new TypeError("The result could not be sent: " + error.message);
      try { this.endpoint.postMessage({ t: "ret", id: message.id, err: { [TAG]: "error", e: problem, name: "TypeError" } }); } catch {}
    }
  }

  // Turn a value into something structured clone will carry, swapping the
  // parts it cannot carry (functions, signals, live objects) for references.
  marshal(value, ctx, seen) {
    if (typeof value === "function") return this.reference(value);
    if (value === null || typeof value !== "object") return value;
    if (moved.has(value)) { ctx.transfers.add(ArrayBuffer.isView(value) ? value.buffer : value); return value; }
    if (mustMove(value)) { ctx.transfers.add(value); return value; }
    if (shared.has(value)) return this.reference(value);
    if (typeof AbortSignal === "function" && value instanceof AbortSignal) return this.sendSignal(value, ctx);
    if (value instanceof Error) return { [TAG]: "error", e: value, name: value.name };
    if (typeof value[Symbol.asyncIterator] === "function") return this.sendIterator(value);
    const array = Array.isArray(value);
    if (array || isPlain(value)) {
      seen ??= new Set();
      if (seen.has(value)) return value; // a cycle: leave it to structured clone
      seen.add(value);
      let out = value;
      for (const key of Object.keys(value)) {
        const before = value[key];
        const after = this.marshal(before, ctx, seen);
        if (after !== before) { if (out === value) out = array ? [...value] : { ...value }; out[key] = after; }
      }
      seen.delete(value);
      return !array && hasOwn.call(out, TAG) ? { [TAG]: "esc", v: out } : out;
    }
    if (isUserClassInstance(value)) return this.reference(value);
    return value;
  }

  reference(target, allows = []) {
    const info = proxyInfo.get(target);
    if (info?.state.released) throw new ReferenceError("This remote object has been released");
    if (info && info.link === this) return { [TAG]: "back", id: info.id, path: info.path };
    let id = allows.length ? undefined : this.exportIds.get(target);
    if (id === undefined) {
      id = this.ids++;
      this.exports.set(id, { target, allows, count: 0 });
      if (!allows.length) this.exportIds.set(target, id);
    }
    this.exports.get(id).count++;
    return { [TAG]: "ref", id };
  }

  sendIterator(iterable) {
    let iterator;
    const get = () => (iterator ??= iterable[Symbol.asyncIterator]());
    const facade = {
      next: (value) => get().next(value),
      return: (value) => get().return?.(value) ?? { done: true, value },
      throw: (error) => get().throw?.(error) ?? Promise.reject(error),
      // Runs when the reader lets go for any reason, including being collected
      // or the link closing, so a generator's `finally` always gets its turn.
      [DISPOSE]: () => { iterator?.return?.(); },
    };
    given.add(facade);
    return { [TAG]: "iter", id: this.reference(facade).id };
  }

  sendSignal(signal, ctx) {
    ctx.signals.push(signal);
    let sid = this.signalsOut.get(signal);
    if (sid !== undefined) return { [TAG]: "signal", sid };
    sid = this.ids++;
    this.signalsOut.set(signal, sid);
    if (signal.aborted) return { [TAG]: "signal", sid, aborted: true, reason: this.safeReason(signal.reason) };
    // The listener must not hold the signal, or it could never be collected.
    const link = this;
    signal.addEventListener("abort", function () { link.post({ t: "abort", sid, reason: link.safeReason(this.reason) }); }, { once: true });
    this.signalRegistry.register(signal, sid);
    return { [TAG]: "signal", sid };
  }

  safeReason(reason) {
    return reason instanceof Error ? { [TAG]: "error", e: reason, name: reason.name } : reason;
  }

  // -------------------------------------------------------------- receiving

  revive(value, seen = new WeakSet()) {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      if (seen.has(value)) return value;
      seen.add(value);
      for (let i = 0; i < value.length; i++) value[i] = this.revive(value[i], seen);
      return value;
    }
    if (!isPlain(value)) return value;
    const kind = value[TAG];
    if (kind === undefined) {
      if (seen.has(value)) return value;
      seen.add(value);
      for (const key of Object.keys(value)) value[key] = this.revive(value[key], seen);
      return value;
    }
    switch (kind) {
      case "ref": return this.importRef(value.id);
      case "back": {
        const entry = this.exports.get(value.id);
        if (!entry) throw new ReferenceError("That object is no longer held on this side");
        if (!Array.isArray(value.path)) throw new TypeError("Malformed reference");
        if (!permitted(entry.allows, value.path)) throw new DOMException(`"${value.path.join(".")}" is not available on this link`, "NotAllowedError");
        return value.path.reduce((object, key) => step(object, key), entry.target);
      }
      case "iter": return remoteIterator(this.importRef(value.id));
      case "signal": {
        let controller = this.signalsIn.get(value.sid);
        if (!controller) this.signalsIn.set(value.sid, (controller = new AbortController()));
        if (value.aborted) { controller.abort(this.revive(value.reason, seen)); this.signalsIn.delete(value.sid); }
        return controller.signal;
      }
      case "error": {
        const error = value.e;
        if (error instanceof Error && value.name && error.name !== value.name) Object.defineProperty(error, "name", { value: value.name, configurable: true, writable: true });
        return error;
      }
      case "esc": {
        const inner = value.v;
        if (inner && typeof inner === "object" && !seen.has(inner)) {
          seen.add(inner);
          for (const key of Object.keys(inner)) if (key !== TAG) inner[key] = this.revive(inner[key], seen);
        }
        return inner;
      }
      default: return value;
    }
  }

  importRef(id) {
    const entry = this.imports.get(id);
    const live = entry?.ref.deref();
    if (live) { entry.count++; return live; }
    const proxy = remoteProxy(this, id);
    this.imports.set(id, { ref: new WeakRef(proxy), count: (entry?.count ?? 0) + 1 });
    this.registry.register(proxy, id, proxy);
    return proxy;
  }

  // Let go of a remote object now, without waiting for the collector.
  release(state, proxy) {
    if (state.released) return;
    state.released = true;
    if (state.id === 0) return this.close(new LinkClosedError("This link was closed from this side"));
    const entry = this.imports.get(state.id);
    if (entry?.ref.deref() === proxy) {
      this.imports.delete(state.id);
      this.registry.unregister(proxy);
      this.post({ t: "drop", id: state.id, n: entry.count });
    }
  }

  receive(message, scope) {
    if (this.isClosed || !message || typeof message !== "object") return;
    switch (message.t) {
      case "batch": { const calls = new Map(); for (const m of message.m) this.receive(m, calls); return; }
      case "call": return this.answer(message, scope);
      case "ret": {
        let ok = !("err" in message), value;
        try { value = this.revive(ok ? message.v : message.err); } catch (error) { ok = false; value = error; }
        return this.settle(message.id, ok, value);
      }
      case "drop": {
        const entry = this.exports.get(message.id);
        if (entry && (entry.count -= message.n) <= 0) this.unexport(message.id, entry);
        return;
      }
      case "abort": {
        const controller = this.signalsIn.get(message.sid);
        this.signalsIn.delete(message.sid);
        return controller?.abort(this.revive(message.reason));
      }
      case "forget": return void this.signalsIn.delete(message.sid);
      case "ping": return this.post({ t: "pong" });
      case "bye": return this.close(new LinkClosedError("The other side closed this link"), true);
    }
  }

  unexport(id, entry) {
    this.exports.delete(id);
    if (this.exportIds.get(entry.target) === id) this.exportIds.delete(entry.target);
    if (id === 0) return;
    if (!given.has(entry.target)) return;
    try {
      const dispose = entry.target[ASYNC_DISPOSE] ?? entry.target[DISPOSE];
      if (typeof dispose === "function") Promise.resolve(dispose.call(entry.target)).catch(() => {});
    } catch {}
  }

  answer(message, scope) {
    const { id, on, path, op } = message;
    const result = (async () => {
      let target, allows = [];
      const args = this.revive(message.args ?? []);
      if (on.pipe !== undefined) {
        if (!scope?.has(on.pipe)) throw new ReferenceError("A chained call arrived without the call it chains from");
        target = await scope.get(on.pipe);
      } else {
        const entry = this.exports.get(on.ref);
        if (!entry) throw new ReferenceError(on.ref === 0 ? "Nothing is exposed on this side of the link" : "That object has been released");
        ({ target, allows } = entry);
      }
      return this.invoke(target, allows, path, op, args);
    })();
    scope?.set(id, result);
    result.then(
      (value) => { const ctx = { transfers: new Set(), signals: [] }; this.post({ t: "ret", id, v: this.marshal(value, ctx) }, ctx.transfers); },
      (error) => { const ctx = { transfers: new Set(), signals: [] }; this.post({ t: "ret", id, err: this.marshal(error, ctx) }, ctx.transfers); },
    ).catch((error) => this.post({ t: "ret", id, err: { [TAG]: "error", e: new TypeError("The result could not be prepared: " + error.message), name: "TypeError" } }));
  }

  invoke(target, allows, path, op, args) {
    if (!Array.isArray(path)) throw new TypeError("Malformed call");
    const reachable = op === "port" ? allows.every((list) => { const rest = rebase(list, path); return !rest || rest.length; }) : permitted(allows, path);
    if (!reachable) throw new DOMException(`"${path.join(".")}" is not available on this link`, "NotAllowedError");
    const parent = path.slice(0, -1).reduce((object, key) => step(object, key), target);
    const value = path.length ? step(parent, path[path.length - 1]) : target;
    const name = path.join(".") || "The exposed value";
    switch (op) {
      case "get": return value;
      case "apply":
        if (typeof value !== "function") throw new TypeError(`${name} is not a function`);
        return Reflect.apply(value, path.length ? parent : undefined, args);
      case "new":
        if (typeof value !== "function") throw new TypeError(`${name} is not a constructor`);
        return give(Reflect.construct(value, args)); // made for this caller, so theirs to dispose
      case "port": {
        if (value === null || (typeof value !== "object" && typeof value !== "function")) throw new TypeError(`${name} cannot be given a port of its own`);
        const { only, signal } = args[0] ?? {};
        const lists = allows.map((list) => rebase(list, path)).filter(Boolean);
        if (only) lists.push(segments(only));
        const channel = new MessageChannel();
        const child = new Link(channel.port1, { root: value, hasRoot: true, allows: lists, signal });
        this.children.add(child);
        child.closed.then(() => this.children.delete(child));
        return channel.port2;
      }
      default: throw new TypeError("Unknown operation");
    }
  }

  // ------------------------------------------------------------------ calls

  call(on, path, op, args = []) {
    if (this.isClosed) return Promise.reject(this.reason);
    const id = this.ids++;
    const ctx = { transfers: new Set(), signals: [] };
    let wire;
    try { wire = args.map((arg) => this.marshal(arg, ctx)); } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const record = { resolve, reject, undo: [] };
      this.pending.set(id, record);
      for (const signal of ctx.signals) {
        if (signal.aborted) { this.settle(id, false, signal.reason); break; }
        const onabort = () => this.settle(id, false, signal.reason);
        signal.addEventListener("abort", onabort, { once: true });
        record.undo.push(() => signal.removeEventListener("abort", onabort));
      }
      if (this.timeout > 0) {
        const timer = setTimeout(() => this.settle(id, false, new DOMException(`No answer within ${this.timeout} ms`, "TimeoutError")), this.timeout);
        record.undo.push(() => clearTimeout(timer));
      }
      this.post({ t: "call", id, on, path, op, args: wire }, ctx.transfers);
    });
  }

  settle(id, ok, value) {
    const record = this.pending.get(id);
    if (!record) return;
    this.pending.delete(id);
    for (const undo of record.undo) undo();
    (ok ? record.resolve : record.reject)(value);
  }

  // A call whose result can be used before it has arrived.
  chain(on, path, op, args) {
    const id = this.ids; // the id call() is about to take
    const promise = this.call(on, path, op, args);
    return chainProxy(this, promise, id, this.outbox, []);
  }

  // ---------------------------------------------------------------- closing

  close(reason = new LinkClosedError("This link was closed from this side"), heardGoodbye = false) {
    if (this.isClosed) return;
    // Say goodbye, unless that is what we are answering: on an endpoint that
    // outlives the link, such as a Worker, an echo would close the next link.
    try { this.flush(); if (!heardGoodbye) this.endpoint.postMessage({ t: "bye" }); } catch {}
    this.isClosed = true;
    openLinks.delete(this);
    this.reason = reason instanceof Error ? reason : new LinkClosedError(String(reason));
    clearInterval(this.beat);
    this.endpoint.removeEventListener("message", this.onmessage);
    this.endpoint.removeEventListener("close", this.onclose);
    for (const id of [...this.pending.keys()]) this.settle(id, false, this.reason);
    // Work that was running for a caller who is gone gets told to stop.
    for (const controller of this.signalsIn.values()) controller.abort(this.reason);
    this.signalsIn.clear();
    for (const [id, entry] of [...this.exports]) this.unexport(id, entry);
    this.imports.clear();
    if (typeof MessagePort === "function" && this.endpoint instanceof MessagePort) this.endpoint.close();
    this.resolveClosed(this.reason);
  }

  /** Close this link and every port that was minted through it. */
  revoke(reason) {
    for (const child of [...this.children]) child.revoke(reason);
    this.close(reason);
  }
}

function remoteProxy(link, id) {
  const state = { id, released: false, root: null };
  const check = () => {
    if (state.released) throw new ReferenceError("This remote object has been released");
    if (link.isClosed) throw link.reason;
  };
  const make = (path) => {
    const proxy = new Proxy(function () {}, {
      get(_, key) {
        if (key === DISPOSE || key === ASYNC_DISPOSE) return path.length ? undefined : () => (link.release(state, state.root), key === ASYNC_DISPOSE ? Promise.resolve() : undefined);
        if (key === Symbol.toPrimitive) return () => `[remote ${path.join(".") || "object"}]`;
        if (typeof key === "symbol") return undefined;
        if (key === "then") {
          if (!path.length) return undefined; // a remote object is not a promise
          const promise = link.call({ ref: id }, path, "get");
          return promise.then.bind(promise);
        }
        return make([...path, key]);
      },
      apply(_, __, args) { try { check(); } catch (error) { return Promise.reject(error); } return link.chain({ ref: id }, path, "apply", args); },
      construct(_, args) { try { check(); } catch (error) { return Promise.reject(error); } return link.chain({ ref: id }, path, "new", args); },
      set() { throw new TypeError("A remote property cannot be assigned. Call a method instead."); },
    });
    proxyInfo.set(proxy, { link, id, path, state });
    return proxy;
  };
  return (state.root = make([]));
}

function chainProxy(link, promise, callId, batch, path) {
  const derive = (op, args) => {
    promise.catch(() => {}); // the caller is watching the end of the chain
    // Still in the same tick: send the next call along with the first.
    if (callId !== null && link.outbox === batch && !link.isClosed) return link.chain({ pipe: callId }, path, op, args);
    // Too late to chain on the wire. Wait, then carry on from the real value.
    const later = promise.then((value) => {
      const parent = path.slice(0, -1).reduce((object, key) => object[key], value);
      const target = path.length ? parent[path[path.length - 1]] : value;
      if (op === "get") return target;
      if (op === "new") return new target(...args);
      return path.length ? parent[path[path.length - 1]](...args) : value(...args);
    });
    return chainProxy(link, later, null, null, []);
  };
  const settled = () => (path.length ? derive("get") : promise);
  return new Proxy(function () {}, {
    get(_, key) {
      if (key === "then" || key === "catch" || key === "finally") { const p = settled(); return p[key].bind(p); }
      if (key === Symbol.asyncIterator) {
        return () => {
          const source = Promise.resolve(settled()).then((value) => (value[Symbol.asyncIterator] ?? value[Symbol.iterator]).call(value));
          return {
            next: async (value) => (await source).next(value),
            return: async (value) => (await (await source).return?.(value)) ?? { done: true, value },
            throw: async (error) => { const it = await source; if (it.throw) return it.throw(error); throw error; },
            [Symbol.asyncIterator]() { return this; },
          };
        };
      }
      if (key === Symbol.toStringTag) return "Promise";
      if (key === Symbol.toPrimitive) return () => "[remote call]";
      if (typeof key === "symbol") return undefined;
      return chainProxy(link, promise, callId, batch, [...path, key]);
    },
    apply(_, __, args) { return derive("apply", args); },
    construct(_, args) { return derive("new", args); },
  });
}

function remoteIterator(ref) {
  let finished = false;
  const finish = () => { if (!finished) { finished = true; ref[DISPOSE](); } };
  const guard = async (work) => {
    try { const result = await work(); if (result.done) finish(); return result; }
    catch (error) { finish(); throw error; }
  };
  return {
    next: (value) => (finished ? Promise.resolve({ done: true, value: undefined }) : guard(() => ref.next(value))),
    return: (value) => (finished ? Promise.resolve({ done: true, value }) : guard(async () => ({ ...(await ref.return(value)), done: true }))),
    throw: (error) => (finished ? Promise.reject(error) : guard(() => ref.throw(error))),
    [Symbol.asyncIterator]() { return this; },
    [ASYNC_DISPOSE]() { return this.return(); },
  };
}

// ------------------------------------------------------------------ public

/**
 * Make `target` callable from the other end of `endpoint`.
 * @param {object|Function} target
 * @param {MessagePort|Worker|{postMessage:Function,addEventListener:Function}} endpoint
 * @param {{ only?: string[], heartbeat?: number, timeout?: number, signal?: AbortSignal, onclose?: (reason: Error) => void }} [options]
 *   `only` lists the dotted paths that may be reached; anything else is refused.
 * @returns {{ closed: Promise<Error>, close(): void, revoke(): void, remote: any }}
 */
export function expose(target, endpoint, options = {}) {
  return handle(new Link(endpoint, { ...options, root: target, hasRoot: true, allows: options.only ? [segments(options.only)] : [] }));
}

/**
 * A proxy for whatever the other end exposed. Disposing it closes the link.
 * @template T
 * @param {MessagePort|Worker|{postMessage:Function,addEventListener:Function}} endpoint
 * @param {{ heartbeat?: number, timeout?: number, signal?: AbortSignal, onclose?: (reason: Error) => void }} [options]
 * @returns {import("./hawser.d.ts").Remote<T>}
 */
export function wrap(endpoint, options = {}) {
  return new Link(endpoint, options).importRef(0);
}

/** Both at once: expose `target` and get a proxy for what the other end exposed. */
export const connect = expose;

function handle(link) {
  return {
    remote: link.importRef(0),
    closed: link.closed,
    close: () => link.close(),
    revoke: () => link.revoke(),
    [DISPOSE]: () => link.close(),
  };
}

/**
 * Ask the owner of a remote object for a new port that reaches only that
 * object, optionally only some of its paths, and that dies when `signal`
 * aborts. Post the port to anyone: they can wrap() it and talk to the owner
 * directly, and you can step away.
 * @returns {Promise<MessagePort>}
 */
export function port(proxy, { only, signal } = {}) {
  const info = proxyInfo.get(proxy);
  if (!info) throw new TypeError("port() needs a remote object");
  return info.link.call({ ref: info.id }, info.path, "port", [{ only, signal }]);
}

/** A promise for the reason a remote object's link closed. */
export function closed(proxy) {
  const info = proxyInfo.get(proxy);
  if (!info) throw new TypeError("closed() needs a remote object");
  return info.link.closed;
}

/** True for a proxy made by this library. */
export const isRemote = (value) => proxyInfo.has(value);

/**
 * Give a window one end of a new channel. The origin is required: a port sent
 * to "*" can be collected by whoever has navigated that window.
 * @returns {MessagePort}
 */
export function offer(targetWindow, origin, hello = {}) {
  if (!origin || origin === "*") throw new TypeError("offer() needs the exact origin of the window it is talking to");
  const channel = new MessageChannel();
  targetWindow.postMessage({ [TAG]: "offer", hello }, origin, [channel.port2]);
  return channel.port1;
}

/**
 * Wait for offers from the listed origins. Messages from anywhere else are
 * ignored. Returns a function that stops listening.
 * @param {string|string[]} origins
 * @param {(port: MessagePort, from: { origin: string, source: MessageEventSource, hello: any }) => void} callback
 */
export function accept(origins, callback, scope = globalThis) {
  const list = [origins].flat();
  if (!list.length || list.includes("*")) throw new TypeError("accept() needs the exact origins it will take a port from");
  const listener = (event) => {
    if (event.data?.[TAG] !== "offer" || !event.ports?.[0] || !list.includes(event.origin)) return;
    callback(event.ports[0], { origin: event.origin, source: event.source, hello: event.data.hello });
  };
  scope.addEventListener("message", listener);
  return () => scope.removeEventListener("message", listener);
}
