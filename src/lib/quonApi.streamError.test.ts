import { afterEach, describe, expect, it } from "vitest";

import { provideHttp } from "@/lib/platform";

import { chatStream, StreamPayloadError } from "./quonApi";
import { isTransportFailure } from "./streamResume";

/**
 * Feedback #84: OpenRouter answered 401 to the real chat call; the server
 * forwarded it as an `{error}` event inside a 200 stream. That event must
 * surface as the provider's answer — not be mistaken for a dropped socket and
 * resumed into "Verbindung verloren".
 */
function sse(events: object[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

afterEach(() => {
  provideHttp({ unrestricted: false, fetch: (...a) => globalThis.fetch(...a) });
});

describe("chatStream — an {error} event in the stream", () => {
  it("throws a StreamPayloadError carrying the provider's message, which is never resumed", async () => {
    const detail =
      "The AI provider rejected this account's API key. If you added your own key, check it under Settings → Providers.";
    provideHttp({
      unrestricted: false,
      fetch: async () => sse([{ job: "j84" }, { error: detail }]),
    });
    let jobId: string | null = null;
    let applied = 0;
    const run = chatStream(
      [{ role: "user", content: "wetter" }],
      "anthropic/claude-sonnet-4.5",
      false,
      () => {},
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
    await expect(run).rejects.toBeInstanceOf(StreamPayloadError);
    await expect(run).rejects.toThrow(detail);
    // The job id and offset WERE known — exactly the state in which the old
    // classifier chose to resume instead of surfacing the error.
    expect(jobId).toBe("j84");
    expect(applied).toBe(1);
    const err = await run.catch((e: unknown) => e);
    expect(isTransportFailure(err, false)).toBe(false);
  });
});
