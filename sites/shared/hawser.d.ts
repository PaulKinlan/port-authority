// Types for hawser.js. The shapes follow what crosses a link:
// functions, class instances and anything share()d arrive as Remote<T>,
// async iterables arrive as async iterators, everything else is copied.

export type Endpoint = {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
  start?(): void;
};

declare const sharedBrand: unique symbol;
/** Marks a type as crossing by reference. Returned by share() and give(). */
export type Shared<T> = T & { [sharedBrand]?: true };

type ByReference = Function | { [sharedBrand]?: true };

/** What a value of type T looks like after crossing a link. */
export type Crossed<T> =
  T extends AsyncIterable<infer U> ? AsyncIterableIterator<Crossed<U>> :
  T extends ByReference ? Remote<T> :
  T;

/** The result of a remote call: awaitable, and usable before it arrives. */
export type Chain<T> = PromiseLike<Crossed<T>> & RemoteMembers<T> &
  (T extends AsyncIterable<infer U> ? AsyncIterable<Crossed<U>> : unknown) & {
    catch<R = never>(onrejected?: (reason: unknown) => R | PromiseLike<R>): Promise<Crossed<T> | R>;
    finally(onfinally?: () => void): Promise<Crossed<T>>;
  };

type RemoteMembers<T> = {
  [K in keyof T as K extends string ? K : never]:
    T[K] extends (...args: infer A) => infer R ? (...args: A) => Chain<Awaited<R>> :
    T[K] extends new (...args: infer A) => infer I ? new (...args: A) => Chain<Shared<I>> :
    T[K] extends object ? Remote<T[K]> & PromiseLike<Crossed<T[K]>> :
    PromiseLike<T[K]>;
};

/** A proxy for an object that lives on the other side of a link. */
export type Remote<T> = RemoteMembers<T> &
  (T extends (...args: infer A) => infer R ? (...args: A) => Chain<Awaited<R>> : unknown) &
  (T extends new (...args: infer A) => infer I ? new (...args: A) => Chain<Shared<I>> : unknown) &
  Disposable & AsyncDisposable;

export class LinkClosedError extends Error {}

export interface LinkOptions {
  /** Send a ping this often (ms) and close the link if the other side stops answering. */
  heartbeat?: number;
  /** Reject any call that has not been answered after this many ms. */
  timeout?: number;
  /** Close the link when this aborts. */
  signal?: AbortSignal;
  onclose?(reason: Error): void;
}
export interface ExposeOptions extends LinkOptions {
  /** The only dotted paths that may be reached, such as ["read", "admin.stats"]. */
  only?: string[];
}
export interface LinkHandle<R = unknown> extends Disposable {
  remote: Remote<R>;
  closed: Promise<Error>;
  close(): void;
  /** Close this link and every port minted through it. */
  revoke(): void;
}

export function expose<R = unknown>(target: unknown, endpoint: Endpoint, options?: ExposeOptions): LinkHandle<R>;
export function connect<R = unknown>(target: unknown, endpoint: Endpoint, options?: ExposeOptions): LinkHandle<R>;
export function wrap<T>(endpoint: Endpoint, options?: LinkOptions): Remote<T>;
export function port(remote: Remote<any>, options?: { only?: string[]; signal?: AbortSignal }): Promise<MessagePort>;
export function closed(remote: Remote<any>): Promise<Error>;
export function isRemote(value: unknown): boolean;
export function share<T extends object>(object: T): Shared<T>;
export function give<T extends object>(object: T): Shared<T>;
export function transfer<T extends object>(object: T): T;
export function offer(target: Window, origin: string, hello?: unknown): MessagePort;
export function accept(origins: string | string[], callback: (port: MessagePort, from: { origin: string; source: MessageEventSource | null; hello: any }) => void, scope?: EventTarget): () => void;
