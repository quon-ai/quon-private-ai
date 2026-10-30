import { describe, expect, it } from "vitest";

import { correctedModelId } from "./modelSelection";

const CATALOG = [
  { id: "openrouter::openrouter/auto" },
  { id: "openrouter::openai/gpt-4o" },
  { id: "local", disabled: true },
];

describe("correctedModelId", () => {
  it("does NOT reset before the real catalog has loaded (the reload-clobber bug)", () => {
    // On reload `models` is the bundled placeholder whose ids differ from the
    // saved connection-scoped id. Judging against it must be a no-op.
    const placeholder = [{ id: "openai/gpt-4o" }, { id: "openrouter/auto" }];
    expect(correctedModelId(false, placeholder, "openrouter::openai/gpt-4o")).toBeNull();
  });

  it("keeps a valid, enabled selection once the catalog is loaded", () => {
    expect(correctedModelId(true, CATALOG, "openrouter::openai/gpt-4o")).toBeNull();
  });

  it("corrects an id that isn't in the loaded catalog to the first enabled model", () => {
    expect(correctedModelId(true, CATALOG, "openrouter/auto")).toBe("openrouter::openrouter/auto");
  });

  it("skips disabled models when falling back", () => {
    const models = [{ id: "a", disabled: true }, { id: "b" }];
    expect(correctedModelId(true, models, "gone")).toBe("b");
  });

  it("returns null for an empty catalog (nothing to switch to)", () => {
    expect(correctedModelId(true, [], "anything")).toBeNull();
  });

  it("returns null when the current selection is already the first enabled model", () => {
    expect(correctedModelId(true, CATALOG, "openrouter::openrouter/auto")).toBeNull();
  });
});
