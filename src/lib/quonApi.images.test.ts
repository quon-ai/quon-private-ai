import { afterEach, describe, expect, it } from "vitest";

import { provideHttp } from "@/lib/platform";

import { chatStream } from "./quonApi";

/**
 * Image generation over the chat stream (#79): the request carries
 * `image_output` only when asked, and an `{image}` SSE event reaches the
 * caller's `onImage` as the data URL — separate from text deltas.
 */
function sse(events: object[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

afterEach(() => {
  provideHttp({ unrestricted: false, fetch: (...a) => globalThis.fetch(...a) });
});

describe("chatStream — generated images", () => {
  it("asks for an image only when told, and hands the data URL to onImage", async () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const bodies: string[] = [];
    provideHttp({
      unrestricted: false,
      fetch: async (_url, init) => {
        bodies.push(String(init?.body ?? ""));
        return sse([{ job: "j1" }, { delta: "Here: " }, { image: png }, { done: true }]);
      },
    });
    const deltas: string[] = [];
    const images: string[] = [];
    const leg = await chatStream(
      [{ role: "user", content: "a cabin in the snow" }],
      "google/gemini-2.5-flash-image",
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
      undefined,
      { output: true, onImage: (u) => images.push(u) },
    );
    expect(leg.terminal).toBe(true);
    expect(deltas).toEqual(["Here: "]);
    expect(images).toEqual([png]);
    expect(JSON.parse(bodies[0]).image_output).toBe(true);
  });

  it("a text send carries no image_output at all (nothing rides on every request)", async () => {
    const bodies: string[] = [];
    provideHttp({
      unrestricted: false,
      fetch: async (_url, init) => {
        bodies.push(String(init?.body ?? ""));
        return sse([{ delta: "hi" }, { done: true }]);
      },
    });
    await chatStream([{ role: "user", content: "hi" }], "m", true, () => {});
    expect("image_output" in JSON.parse(bodies[0])).toBe(false);
  });
});
