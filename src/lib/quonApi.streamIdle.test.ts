import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { provideHttp } from "@/lib/platform";

import { chatStream, STREAM_IDLE_MS, StreamIdleError } from "./quonApi";
import { isTransportFailure } from "./streamResume";

/**
 * „Bleibt einfach hängen bei Antwort wird erstellt": a stream that stays open
 * but delivers nothing must be cut after three missed server heartbeats and
 * handed to the resume path, not wait forever.
 */
afterEach(() => {
  vi.useRealTimers();
  provideHttp({ unrestricted: false, fetch: (...a) => globalThis.fetch(...a) });
});
beforeEach(() => vi.useFakeTimers());

function silentStream(prefix: string, cancelled: { value: boolean }): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (prefix) controller.enqueue(new TextEncoder().encode(prefix));
      // ...and then nothing, ever.
    },
    cancel() {
      cancelled.value = true;
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("chatStream: idle watchdog", () => {
  it("cuts a silent leg after STREAM_IDLE_MS as a transport failure (resumable), keeping the offset", async () => {
    const cancelled = { value: false };
    provideHttp({
      unrestricted: false,
      fetch: async () =>
        silentStream(`data: {"job":"j85"}\n\ndata: {"delta":"Hal"}\n\n`, cancelled),
    });
    let jobId: string | null = null;
    let applied = 0;
    const deltas: string[] = [];
    const run = chatStream(
      [{ role: "user", content: "Gewichtsdecke?" }],
      "~google/gemini-flash-latest",
      true,
      (d) => deltas.push(d),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        onJob: (j) => {
          jobId = j;
        },
        onEvent: (n) => {
          applied = n;
        },
      },
    );
    const settled = run.then(
      () => "resolved",
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(STREAM_IDLE_MS - 1);
    expect(cancelled.value).toBe(false); // patience until the third missed heartbeat
    await vi.advanceTimersByTimeAsync(2);
    const err = await settled;
    expect(err).toBeInstanceOf(StreamIdleError);
    expect(isTransportFailure(err, false)).toBe(true); // => resume at `applied`
    expect(cancelled.value).toBe(true);
    expect(jobId).toBe("j85");
    expect(applied).toBe(1);
    expect(deltas).toEqual(["Hal"]);
  });

  it("a heartbeat comment counts as life: the clock restarts on any bytes", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        c.enqueue(new TextEncoder().encode(`data: {"job":"j"}\n\n`));
      },
    });
    provideHttp({
      unrestricted: false,
      fetch: async () =>
        new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    });
    const run = chatStream([{ role: "user", content: "x" }], "m", true, () => {});
    const settled = run.then(
      (r) => r,
      (e: unknown) => e,
    );
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(STREAM_IDLE_MS - 5_000);
      controller.enqueue(new TextEncoder().encode(": ping\n\n"));
      await vi.advanceTimersByTimeAsync(0);
    }
    controller.enqueue(new TextEncoder().encode(`data: {"done":true}\n\n`));
    controller.close();
    const result = await settled;
    expect(result).toEqual({ terminal: true }); // 4 x 55 s of silence, never cut
  });
});
