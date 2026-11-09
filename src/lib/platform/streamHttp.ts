/**
 * A `fetch` whose response body STREAMS in the Capacitor Android shell.
 *
 * CapacitorHttp replaces `fetch` with a native request whose Response is built
 * from the complete text/json/blob - it cannot stream. For the chat answer
 * that meant two things on the phone: no token-by-token rendering, and the
 * server's leading `{job}` SSE event (what makes a cut stream resumable) never
 * arrived before a failure, so backgrounding surfaced an error instead of a
 * resume. The native side is android/app/src/main/java/com/quon/app/StreamHttp.java;
 * this wraps its events into a standard Response with a ReadableStream body,
 * so quonApi's SSE reader needs no other path.
 *
 * Bytes cross the bridge base64-encoded and are decoded here as raw bytes -
 * never as text - so a multi-byte UTF-8 character split across two chunks is
 * reassembled by the caller's streaming TextDecoder exactly as with a browser
 * fetch.
 */

interface ListenerHandle {
  remove(): Promise<void> | void;
}

/** The subset of a Capacitor plugin proxy this file uses. */
export interface StreamHttpPlugin {
  start(opts: {
    id: string;
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<{ id: string }>;
  cancel(opts: { id: string }): Promise<void>;
  addListener(
    event: "head" | "chunk" | "end" | "error",
    cb: (data: Record<string, unknown>) => void,
  ): Promise<ListenerHandle> | ListenerHandle;
}

let pluginImpl: StreamHttpPlugin | null = null;

/** Install a plugin implementation explicitly (tests). */
export function provideStreamHttpPlugin(impl: StreamHttpPlugin | null): void {
  pluginImpl = impl;
  pluginPromise = null;
}

/**
 * The plugin proxy. The bridge the WebView injects (`window.Capacitor`) is only
 * the low-level transport; `registerPlugin` and the proxies that turn native
 * events into `addListener` callbacks are `@capacitor/core`'s runtime, which
 * has to be imported - without it the device warns "plugin unavailable" and
 * every send fails before a request leaves. Dynamic import: this module is
 * itself only loaded in the Capacitor branch of the seam, so the web bundle
 * still carries nothing Capacitor.
 */
// The proxy must never be a promise's resolved value: it answers every
// property with a native call, so promise resolution probes `.then` on it and
// gets "StreamHttp.then() is not implemented on android" (seen on the device).
// Hence a promise that resolves to nothing and sets the module variable.
let pluginPromise: Promise<void> | null = null;
function loadPlugin(): Promise<void> {
  if (pluginImpl) return Promise.resolve();
  pluginPromise ??= import("@capacitor/core").then((m) => {
    pluginImpl = m.registerPlugin<StreamHttpPlugin>("StreamHttp");
  });
  return pluginPromise;
}

function mintId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  return c?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function headersToRecord(init?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init) return out;
  new Headers(init).forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

/**
 * Same signature as `fetch`; resolves once the response head arrived, with a
 * body that streams. A rejected promise before the head is a transport failure
 * (TypeError, like fetch); an abort via `signal` cancels the native request and
 * rejects/errors with an AbortError, like fetch.
 */
export async function streamFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  await loadPlugin();
  const p = pluginImpl!;
  const signal = init.signal ?? undefined;
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");

  const body = init.body == null ? undefined : String(init.body);
  // Minted here, not by the native side: the listeners must know which events
  // are theirs before the native thread can emit the first one, and `start()`
  // resolving is not ordered against that thread.
  const id = mintId();
  console.info(
    `StreamHttp: start ${init.method ?? "GET"} ${url.replace(/\?.*$/, "")} id=${id.slice(0, 8)}`,
  );
  let settled = false; // head resolved or rejected
  const handles: ListenerHandle[] = [];
  const cleanup = () => {
    for (const h of handles.splice(0)) void h.remove();
    signal?.removeEventListener("abort", onAbort);
  };
  const abortError = () => new DOMException("The operation was aborted.", "AbortError");

  // Body events are queued and handed to the stream on PULL, in order. Calling
  // controller.error() directly would discard chunks still queued behind a
  // slow reader - a browser fetch delivers every byte it received before the
  // failure, and the SSE reader's resume offset depends on that.
  type Item = Uint8Array | { end: true } | { error: unknown };
  const queue: Item[] = [];
  let wake: (() => void) | null = null;
  const push = (item: Item) => {
    queue.push(item);
    const w = wake;
    wake = null;
    w?.();
  };

  let resolveHead!: (r: Response) => void;
  let rejectHead!: (e: unknown) => void;
  const head = new Promise<Response>((res, rej) => {
    resolveHead = res;
    rejectHead = rej;
  });

  const fail = (err: unknown) => {
    if (!settled) {
      settled = true;
      rejectHead(err);
    } else {
      push({ error: err });
    }
    cleanup();
  };
  let aborted = false;
  const onAbort = () => {
    if (aborted) return; // the signal, the post-start check and the stream's cancel all funnel here
    aborted = true;
    void p.cancel({ id });
    fail(abortError());
  };

  const mine = (d: Record<string, unknown>) => d.id === id;
  handles.push(
    await p.addListener("head", (d) => {
      if (!mine(d) || settled) return;
      settled = true;
      console.info(`StreamHttp: head ${d.status} id=${id.slice(0, 8)}`);
      const stream = new ReadableStream<Uint8Array>({
        async pull(c) {
          while (queue.length === 0) {
            await new Promise<void>((r) => {
              wake = r;
            });
          }
          const item = queue.shift()!;
          if (item instanceof Uint8Array) c.enqueue(item);
          else if ("end" in item) c.close();
          else c.error(item.error);
        },
        cancel() {
          onAbort();
        },
      });
      resolveHead(
        new Response(stream, {
          status: Number(d.status),
          headers: (d.headers as Record<string, string>) ?? {},
        }),
      );
    }),
    await p.addListener("chunk", (d) => {
      if (!mine(d)) return;
      push(decodeBase64(String(d.data)));
    }),
    await p.addListener("end", (d) => {
      if (!mine(d)) return;
      console.info(`StreamHttp: end id=${id.slice(0, 8)}`);
      push({ end: true });
      cleanup();
    }),
    await p.addListener("error", (d) => {
      if (!mine(d)) return;
      console.warn(`StreamHttp: error id=${id.slice(0, 8)} ${String(d.message ?? "")}`);
      fail(signal?.aborted ? abortError() : new TypeError(String(d.message ?? "stream failed")));
    }),
  );
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    await p.start({
      id,
      url,
      method: (init.method ?? "GET").toUpperCase(),
      headers: headersToRecord(init.headers),
      body,
    });
  } catch (err) {
    fail(new TypeError(err instanceof Error ? err.message : "stream start failed"));
  }
  if (signal?.aborted) onAbort();
  return head;
}
