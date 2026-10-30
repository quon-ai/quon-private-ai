import { describe, expect, it } from "vitest";

import { chatModelDisplay, modelDisplay, showProviderTag } from "./modelDisplay";

describe("modelDisplay", () => {
  it("prettifies common vendor slugs", () => {
    expect(modelDisplay("anthropic/claude-sonnet-4.5")).toEqual({
      name: "Claude Sonnet 4.5",
      provider: "Anthropic",
    });
    expect(modelDisplay("google/gemini-2.5-flash")).toEqual({
      name: "Gemini 2.5 Flash",
      provider: "Google",
    });
    expect(modelDisplay("google/gemini-2.5-pro")).toEqual({
      name: "Gemini 2.5 Pro",
      provider: "Google",
    });
  });

  it("applies exact-slug overrides", () => {
    expect(modelDisplay("openai/gpt-4o").name).toBe("GPT-4o");
    expect(modelDisplay("openai/gpt-4o-mini").name).toBe("GPT-4o mini");
  });

  it("strips the ~latest alias prefix (vendor still resolves)", () => {
    expect(modelDisplay("~anthropic/claude-sonnet-latest")).toEqual({
      name: "Claude Sonnet",
      provider: "Anthropic",
    });
    expect(modelDisplay("~google/gemini-flash-latest")).toEqual({
      name: "Gemini Flash",
      provider: "Google",
    });
    expect(modelDisplay("~openai/gpt-latest")).toEqual({ name: "GPT", provider: "OpenAI" });
  });

  it("treats openrouter/auto as a router with no provider tag", () => {
    expect(modelDisplay("openrouter/auto")).toEqual({ name: "Auto", provider: "" });
  });

  it("strips size, instruct and date-stamp noise", () => {
    expect(modelDisplay("mistralai/mistral-small-3.2-24b-instruct").name).toBe("Mistral Small 3.2");
    expect(modelDisplay("google/gemini-2.5-flash-preview-09-2025").name).toBe("Gemini 2.5 Flash");
    expect(modelDisplay("meta-llama/llama-3.3-70b-instruct")).toEqual({
      name: "Llama 3.3",
      provider: "Meta",
    });
  });

  it("normalizes vendor casing when the name repeats the vendor", () => {
    expect(modelDisplay("deepseek/deepseek-chat-v3")).toEqual({
      name: "DeepSeek Chat v3",
      provider: "DeepSeek",
    });
    expect(modelDisplay("qwen/qwen3-235b-a22b")).toEqual({
      name: "Qwen3",
      provider: "Qwen",
    });
  });

  it("falls back gracefully for unknown vendors and bare slugs", () => {
    expect(modelDisplay("acme/super-model-1")).toEqual({ name: "Super Model 1", provider: "Acme" });
    expect(modelDisplay("local")).toEqual({ name: "Local", provider: "" });
    expect(modelDisplay("")).toEqual({ name: "", provider: "" });
  });

  it("never returns an empty name when filters would eat everything", () => {
    // all-noise part → falls back to the raw tokens
    const d = modelDisplay("qwen/qwen-72b-instruct");
    expect(d.name.length).toBeGreaterThan(0);
  });
});

describe("chatModelDisplay", () => {
  it("uses the provider-local slug from a composite catalog id", () => {
    expect(
      chatModelDisplay({
        id: "openrouter::anthropic/claude-sonnet-4.5",
        label: "anthropic/claude-sonnet-4.5",
        model: "anthropic/claude-sonnet-4.5",
        connection_id: "openrouter",
      }),
    ).toEqual({ name: "Claude Sonnet 4.5", provider: "Anthropic" });
  });

  it("keeps the connection label as the provider for custom connections", () => {
    expect(
      chatModelDisplay({
        id: "mybox::llama-3.3-70b-instruct",
        label: "llama-3.3-70b-instruct · My LM Studio",
        model: "llama-3.3-70b-instruct",
        connection_id: "mybox",
      }),
    ).toEqual({ name: "Llama 3.3", provider: "My LM Studio" });
  });

  it("handles bundled models that only carry a plain id", () => {
    expect(chatModelDisplay({ id: "openrouter/auto", label: "Auto" })).toEqual({
      name: "Auto",
      provider: "",
    });
  });
});

describe("showProviderTag", () => {
  it("shows a distinct provider and hides a redundant one", () => {
    expect(showProviderTag({ name: "Gemini 2.5 Flash", provider: "Google" })).toBe(true);
    expect(showProviderTag({ name: "Mistral Small 3.2", provider: "Mistral" })).toBe(false);
    expect(showProviderTag({ name: "Auto", provider: "" })).toBe(false);
  });
});

describe("image models (#79)", () => {
  it("keeps 'Image' in the name — it is the capability, not noise", () => {
    expect(
      chatModelDisplay({
        id: "openrouter::google/gemini-2.5-flash-image",
        label: "google/gemini-2.5-flash-image",
        model: "google/gemini-2.5-flash-image",
      }).name,
    ).toMatch(/Gemini 2\.5 Flash Image/);
    expect(
      chatModelDisplay({
        id: "openrouter::openai/gpt-5-image-mini",
        label: "openai/gpt-5-image-mini",
        model: "openai/gpt-5-image-mini",
      }).name,
    ).toMatch(/GPT.*5.*Image.*Mini/i);
  });
});
