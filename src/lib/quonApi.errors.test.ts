import { afterEach, describe, expect, it } from "vitest";

import { provideHttp } from "@/lib/platform";

import { QuonError, setOpenRouterKey } from "./quonApi";

/**
 * When the backend refuses a pasted key with a worded reason, the settings
 * card must show that reason, not "/settings/openrouter-key responded 400":
 * the client keeps the body's `detail`, not just path + status.
 */
afterEach(() => {
  provideHttp({ unrestricted: false, fetch: (...a) => globalThis.fetch(...a) });
});

describe("quonApi request errors", () => {
  it("carries the backend's detail as the message, with the status", async () => {
    provideHttp({
      unrestricted: false,
      fetch: async () =>
        new Response(JSON.stringify({ detail: "That is not an OpenRouter key — nope." }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    });
    const err = await setOpenRouterKey("sk-ant-x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuonError);
    expect((err as QuonError).message).toBe("That is not an OpenRouter key — nope.");
    expect((err as QuonError).status).toBe(400);
  });

  it("falls back to path + status when there is no detail", async () => {
    provideHttp({
      unrestricted: false,
      fetch: async () => new Response("<html>bad gateway</html>", { status: 502 }),
    });
    const err = await setOpenRouterKey("sk-or-v1-x").catch((e: unknown) => e);
    expect((err as QuonError).message).toBe("/settings/openrouter-key responded 502");
    expect((err as QuonError).status).toBe(502);
  });
});
