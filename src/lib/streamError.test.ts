import { describe, expect, it } from "vitest";

import { classifyStreamError, STREAM_INTERRUPTED_NOTE } from "./streamError";

describe("classifyStreamError", () => {
  it("keeps the partial answer and adds a trailing note when tokens already arrived", () => {
    const decision = classifyStreamError({
      partialLen: 42,
      unauthorized: false,
      detail: "network error",
    });
    expect(decision).toEqual({ keepPartial: true, note: STREAM_INTERRUPTED_NOTE });
  });

  it("becomes a full error bubble when no tokens arrived yet", () => {
    const decision = classifyStreamError({
      partialLen: 0,
      unauthorized: false,
      detail: "rate limited",
    });
    expect(decision).toEqual({
      keepPartial: false,
      errorText: "⚠️ Model provider error — rate limited",
    });
  });

  it("always becomes a session-expired error bubble on a 401, even with partial text", () => {
    const decision = classifyStreamError({
      partialLen: 42,
      unauthorized: true,
      detail: "/chat/stream responded 401",
    });
    expect(decision).toEqual({
      keepPartial: false,
      errorText: "Session expired — sign in to continue.",
    });
  });

  it("becomes a session-expired error bubble on a 401 with no partial text", () => {
    const decision = classifyStreamError({
      partialLen: 0,
      unauthorized: true,
      detail: "/chat/stream responded 401",
    });
    expect(decision).toEqual({
      keepPartial: false,
      errorText: "Session expired — sign in to continue.",
    });
  });
});
