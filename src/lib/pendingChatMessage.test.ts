/** The dashboard→chat handoff. The one-shot property is the whole point: if a
 *  take() left the message behind, every later visit to /chat would re-send it
 *  (and re-spend the user's AI budget). */
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearPendingChatMessage,
  setPendingChatMessage,
  takePendingChatMessage,
} from "./pendingChatMessage";

describe("pendingChatMessage", () => {
  beforeEach(() => clearPendingChatMessage());

  it("is empty until something is set", () => {
    expect(takePendingChatMessage()).toBeNull();
  });

  it("hands the message over exactly once", () => {
    setPendingChatMessage("Wie funktioniert eine Wärmepumpe?");
    expect(takePendingChatMessage()).toBe("Wie funktioniert eine Wärmepumpe?");
    // The second visit to /chat must NOT re-send it.
    expect(takePendingChatMessage()).toBeNull();
  });

  it("trims, and treats blank input as nothing pending", () => {
    setPendingChatMessage("  hallo  ");
    expect(takePendingChatMessage()).toBe("hallo");
    setPendingChatMessage("   \n  ");
    expect(takePendingChatMessage()).toBeNull();
  });

  it("keeps only the latest message when set twice before a take", () => {
    setPendingChatMessage("erste");
    setPendingChatMessage("zweite");
    expect(takePendingChatMessage()).toBe("zweite");
  });

  it("clear() drops a message that was never sent", () => {
    setPendingChatMessage("nie gesendet");
    clearPendingChatMessage();
    expect(takePendingChatMessage()).toBeNull();
  });
});
