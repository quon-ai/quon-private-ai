/**
 * Small runtime polyfills for WebKit/older mobile browsers, loaded BEFORE heavy
 * libs that assume them. Imported on the main thread (via `extract.ts`) AND inside
 * the pdf.js worker (via `pdfWorker.ts`), because each is a separate global scope.
 *
 * 1. `ReadableStream` async iteration — Safari, INCLUDING current iOS/macOS, does
 *    not implement `ReadableStream.prototype[Symbol.asyncIterator]`. pdf.js v6 does
 *    `for await (const value of readableStream)` while parsing, so PDF upload throws
 *    "undefined is not a function (near '...value of readableStream...')" on Safari.
 *    (Confirmed via safaridriver against real Safari 26.) This is the actual iOS bug.
 * 2. `Promise.withResolvers` — missing on Safari/iOS < 17.4. Kept for old devices.
 *
 * Every guard makes the patch a no-op where the feature already exists.
 */

// --- 1. ReadableStream async iteration (Safari lacks it) -------------------
type StreamReader = {
  read: () => Promise<{ done: boolean; value: unknown }>;
  cancel: (reason?: unknown) => Promise<void>;
  releaseLock: () => void;
};
type StreamProto = {
  getReader: () => StreamReader;
  values?: unknown;
  [Symbol.asyncIterator]?: unknown;
};

const streamProto = (globalThis as { ReadableStream?: { prototype: StreamProto } }).ReadableStream
  ?.prototype;

if (streamProto && typeof streamProto[Symbol.asyncIterator] !== "function") {
  function asyncIterator(this: StreamProto, options?: { preventCancel?: boolean }) {
    const reader = this.getReader();
    const preventCancel = !!options?.preventCancel;
    return {
      next() {
        return reader.read();
      },
      async return(value: unknown) {
        if (!preventCancel) {
          const cancelled = reader.cancel(value);
          reader.releaseLock();
          await cancelled;
        } else {
          reader.releaseLock();
        }
        return { done: true, value };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }
  streamProto[Symbol.asyncIterator] = asyncIterator;
  // Some callers use the explicit `.values()` method instead of `for await`.
  if (typeof streamProto.values !== "function") streamProto.values = asyncIterator;
}

// --- 2. Promise.withResolvers (Safari/iOS < 17.4) --------------------------
type Resolvers<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

const P = Promise as unknown as { withResolvers?: <T>() => Resolvers<T> };

if (typeof P.withResolvers !== "function") {
  P.withResolvers = function withResolvers<T>(): Resolvers<T> {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

export {};
