import { describe, expect, it, vi } from "vitest";

import { applyProjectChatSeed, resolveProjectChatSeed } from "./projectChatDefaults";
import type { ChatModel } from "./quonApi";

const models: ChatModel[] = [
  { label: "Auto", id: "openrouter/auto" },
  { label: "Claude Sonnet", id: "anthropic/claude-sonnet-4.5" },
  { label: "Local", id: "local", disabled: true },
];

describe("resolveProjectChatSeed", () => {
  it("returns an empty seed for a missing project (not synced yet)", () => {
    expect(resolveProjectChatSeed(undefined, models)).toEqual({});
  });

  it("returns an empty seed when no defaults are set (pre-defaults items)", () => {
    expect(resolveProjectChatSeed({}, models)).toEqual({});
  });

  it("passes protection and reasoning effort through unchanged", () => {
    expect(
      resolveProjectChatSeed(
        { defaultProtection: "review", defaultReasoningEffort: "high" },
        models,
      ),
    ).toEqual({ protection: "review", reasoningEffort: "high" });
  });

  it("seeds the model when it is an enabled option", () => {
    expect(
      resolveProjectChatSeed({ defaultModelId: "anthropic/claude-sonnet-4.5" }, models),
    ).toEqual({ modelId: "anthropic/claude-sonnet-4.5" });
  });

  it("defers an unknown model id (list may still be loading)", () => {
    expect(resolveProjectChatSeed({ defaultModelId: "byok::gpt-4.1" }, models)).toEqual({
      pendingModelId: "byok::gpt-4.1",
    });
  });

  it("defers a disabled model instead of selecting it", () => {
    expect(resolveProjectChatSeed({ defaultModelId: "local" }, models)).toEqual({
      pendingModelId: "local",
    });
  });

  it("combines all three defaults", () => {
    expect(
      resolveProjectChatSeed(
        {
          defaultModelId: "openrouter/auto",
          defaultProtection: "none",
          defaultReasoningEffort: "low",
        },
        models,
      ),
    ).toEqual({ modelId: "openrouter/auto", protection: "none", reasoningEffort: "low" });
  });
});

// Regression coverage for report #3 (2026-07-15 UX walkthrough): project chat
// defaults used to call quon.setProtectionLevel/quon.setActiveModel directly —
// GLOBAL store writes — so opening one chat in a "None"-default project flipped
// filtering off app-wide. applyProjectChatSeed's signature only accepts
// chat-local override setters, so there is no global setter it *could* call;
// these tests lock in that it only ever calls exactly the given override setters.
describe("applyProjectChatSeed", () => {
  function spySetters() {
    return {
      setProtectionOverride: vi.fn(),
      setModelOverride: vi.fn(),
      setReasoningOverride: vi.fn(),
      setDisabledEntityTypesOverride: vi.fn(),
    };
  }

  it("calls nothing for an empty seed (no global store access, nothing to leak)", () => {
    const setters = spySetters();
    applyProjectChatSeed({}, setters);
    expect(setters.setProtectionOverride).not.toHaveBeenCalled();
    expect(setters.setModelOverride).not.toHaveBeenCalled();
    expect(setters.setReasoningOverride).not.toHaveBeenCalled();
  });

  it("routes every field to its own LOCAL override setter", () => {
    const setters = spySetters();
    applyProjectChatSeed(
      {
        protection: "review",
        modelId: "anthropic/claude-sonnet-4.5",
        reasoningEffort: "high",
        disabledEntityTypes: ["FINANCIAL_AMOUNT", "DATE"],
      },
      setters,
    );
    expect(setters.setProtectionOverride).toHaveBeenCalledExactlyOnceWith("review");
    expect(setters.setModelOverride).toHaveBeenCalledExactlyOnceWith("anthropic/claude-sonnet-4.5");
    expect(setters.setReasoningOverride).toHaveBeenCalledExactlyOnceWith("high");
    expect(setters.setDisabledEntityTypesOverride).toHaveBeenCalledExactlyOnceWith([
      "FINANCIAL_AMOUNT",
      "DATE",
    ]);
  });

  it("never calls setModelOverride for a pendingModelId (caller retries that separately)", () => {
    const setters = spySetters();
    applyProjectChatSeed({ pendingModelId: "byok::gpt-4.1" }, setters);
    expect(setters.setModelOverride).not.toHaveBeenCalled();
  });

  it("only calls the setters for fields present in the seed", () => {
    const setters = spySetters();
    applyProjectChatSeed({ protection: "local" }, setters);
    expect(setters.setProtectionOverride).toHaveBeenCalledExactlyOnceWith("local");
    expect(setters.setModelOverride).not.toHaveBeenCalled();
    expect(setters.setReasoningOverride).not.toHaveBeenCalled();
  });
});
