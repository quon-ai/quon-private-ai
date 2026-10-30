import { afterEach, describe, expect, it } from "vitest";

import { provideStreamHttpPlugin, streamFetch, type StreamHttpPlugin } from "./streamHttp";

/**
 * A fake of the native StreamHttp plugin: records calls, lets a test emit the
 * events the Java side would, in the order it would.
 */
function fakePlugin() {
  const listeners: Record<string, Array<(d: Record<string, unknown>) => void>> = {};
  const calls: { start: unknown[]; cancel: unknown[] } = { start: [], cancel: [] };
  const removed: string[] = [];
  // streamFetch registers its listeners (several awaits) BEFORE it calls
  // start(), so a test must wait for the call itself, not for a tick.
  let startResolve!: (o: { id: string }) => void;
  const started = new Promise<{ id: string }>((r) => {
    startResolve = r;
  });
  const plugin: StreamHttpPlugin = {
    async start(opts) {
      calls.start.push(opts);
      startResolve(opts);
      return { id: opts.id };
    },
    async cancel(opts) {
      calls.cancel.push(opts);
    },
    addListener(event, cb) {
      (listeners[event] ??= []).push(cb);
      return {
        remove() {
          removed.push(event);
          listeners[event] = (listeners[event] ?? []).filter((x) => x !== cb);
        },
      };
    },
  };
  const emit = (event: string, data: Record<string, unknown>) => {
    for (const cb of listeners[event] ?? []) cb(data);
  };
  return { plugin, calls, emit, removed, listeners, started };
}

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));

afterEach(() => provideStreamHttpPlugin(null));

describe("streamFetch (Capacitor shell)", () => {
  it("passes method, headers, body and its own id to the native start", async () => {
    const f = fakePlugin();
    provideStreamHttpPlugin(f.plugin);
    const pending = streamFetch("https://api.test/chat/stream", {
      method: "post",
      headers: { "content-type": "application/json", "X-QUON-CSRF": "tok" },
      body: '{"a":1}',
    });
    await f.started;
    const started = f.calls.start[0] as {
      id: string;
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: string;
    };
    expect(started.url).toBe("https://api.test/chat/stream");
    expect(started.method).toBe("POST");
    expect(started.headers).toEqual({ "content-type": "application/json", "x-quon-csrf": "tok" });
    expect(started.body).toBe('{"a":1}');
    expect(started.id).toMatch(/\S/);
    f.emit("head", {
      id: started.id,
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
  });

  it("streams chunks as they arrive and reassembles a UTF-8 char split across two chunks", async () => {
    const f = fakePlugin();
    provideStreamHttpPlugin(f.plugin);
    const pending = streamFetch("https://api.test/s");
    const { id } = await f.started;
    f.emit("head", { id, status: 200, headers: {} });
    const res = await pending;
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    const out: string[] = [];

    // "ä" is 0xC3 0xA4 — split it across the transport boundary.
    f.emit("chunk", { id, data: b64([0x64, 0x61, 0x74, 0x61, 0x3a, 0x20, 0xc3]) });
    f.emit("chunk", { id, data: b64([0xa4, 0x0a, 0x0a]) });
    f.emit("end", { id });

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.push(dec.decode(value, { stream: true }));
    }
    expect(out.join("")).toBe("data: ä\n\n");
    expect(out.length).toBe(2); // two chunks, delivered as two reads — not buffered
    // Listeners are released once the stream ends.
    expect(f.removed.length).toBeGreaterThanOrEqual(4);
  });

  it("ignores events for another stream's id", async () => {
    const f = fakePlugin();
    provideStreamHttpPlugin(f.plugin);
    const pending = streamFetch("https://api.test/s");
    const { id } = await f.started;
    f.emit("head", { id: "someone-else", status: 500, headers: {} });
    f.emit("head", { id, status: 200, headers: {} });
    const res = await pending;
    expect(res.status).toBe(200);
  });

  it("a transport failure before the head rejects like fetch does (TypeError)", async () => {
    const f = fakePlugin();
    provideStreamHttpPlugin(f.plugin);
    const pending = streamFetch("https://api.test/s");
    const { id } = await f.started;
    f.emit("error", { id, message: "SocketTimeoutException: read timed out" });
    await expect(pending).rejects.toBeInstanceOf(TypeError);
  });

  it("a transport failure mid-body errors the stream, so the reader sees it", async () => {
    const f = fakePlugin();
    provideStreamHttpPlugin(f.plugin);
    const pending = streamFetch("https://api.test/s");
    const { id } = await f.started;
    f.emit("head", { id, status: 200, headers: {} });
    const res = await pending;
    const reader = res.body!.getReader();
    f.emit("chunk", { id, data: b64([0x61]) });
    f.emit("error", { id, message: "IOException: unexpected end of stream" });
    expect((await reader.read()).value).toEqual(new Uint8Array([0x61]));
    await expect(reader.read()).rejects.toBeInstanceOf(TypeError);
  });

  it("aborting cancels the native request and surfaces an AbortError", async () => {
    const f = fakePlugin();
    provideStreamHttpPlugin(f.plugin);
    const ac = new AbortController();
    const pending = streamFetch("https://api.test/s", { signal: ac.signal });
    const { id } = await f.started;
    ac.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(f.calls.cancel).toEqual([{ id }]);
  });

  it("an already-aborted signal never starts a native request", async () => {
    const f = fakePlugin();
    provideStreamHttpPlugin(f.plugin);
    const ac = new AbortController();
    ac.abort();
    await expect(streamFetch("https://api.test/s", { signal: ac.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(f.calls.start).toHaveLength(0);
  });
});
