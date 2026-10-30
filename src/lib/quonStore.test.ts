import { beforeEach, describe, expect, it } from "vitest";

import {
  clearChatHistory,
  getAllSessions,
  getChatSession,
  onSessionDelete,
  resetChatHistory,
  reviveStoredSession,
  saveChatSession,
  setChatProject,
  type StoredChatMessage,
} from "./quonStore";

const msgs: StoredChatMessage[] = [{ id: 1, role: "user", text: "hi" }];

beforeEach(() => clearChatHistory());

describe("chat ↔ project binding", () => {
  it("binds projectId on first save and carries it forward across background saves", () => {
    saveChatSession("c1", msgs, { bump: true, projectId: "p1" });
    expect(getChatSession("c1")?.projectId).toBe("p1");
    // A background streaming save with no projectId must NOT drop the binding.
    const more: StoredChatMessage[] = [...msgs, { id: 2, role: "assistant", text: "yo" }];
    saveChatSession("c1", more, { bump: false });
    expect(getChatSession("c1")?.projectId).toBe("p1");
  });

  it("setChatProject moves a chat between projects and clears with undefined", () => {
    saveChatSession("c1", msgs, { projectId: "p1" });
    setChatProject("c1", "p2");
    expect(getChatSession("c1")?.projectId).toBe("p2");
    setChatProject("c1", undefined);
    expect(getChatSession("c1")?.projectId).toBeUndefined();
  });

  it("reviveStoredSession keeps projectId (the reload regression)", () => {
    // hydrateHistory rebuilds each stored session through this; dropping projectId
    // here is exactly what kicked project chats back into Recents on every reload.
    const revived = reviveStoredSession({
      id: "c1",
      title: "In a project",
      projectId: "p1",
      messages: msgs,
      createdAt: 1,
      updatedAt: 2,
    });
    expect(revived.projectId).toBe("p1");
    expect(reviveStoredSession({ id: "c2", title: "Global" }).projectId).toBeUndefined();
  });

  it("keeps the unfiltered flag through save + revive (resend-without-filter chip survives reload)", () => {
    const withResend: StoredChatMessage[] = [
      { id: 1, role: "user", text: "Wann einnehmen?", scrubbed: "[PERSON_1] einnehmen?" },
      { id: 2, role: "assistant", text: "Hier eine Antwort." },
      {
        id: 3,
        role: "user",
        text: "Wann einnehmen?",
        scrubbed: "Wann einnehmen?",
        entities: [],
        protected: false,
        unfiltered: true,
      },
    ];
    saveChatSession("c1", withResend, { projectId: "p1" });
    const stored = getChatSession("c1")?.messages ?? [];
    expect(stored[2]?.unfiltered).toBe(true);
    // Re-hydrating through reviveStoredSession (what a page reload does) must not drop it.
    const revived = reviveStoredSession({
      id: "c1",
      messages: stored,
      createdAt: 1,
      updatedAt: 2,
    });
    expect(revived.messages[2]?.unfiltered).toBe(true);
    // A normal protected/redacted message must NOT be mistaken for an unfiltered one.
    expect(revived.messages[0]?.unfiltered).toBeUndefined();
  });
});

describe("resetChatHistory (logout / account-switch local wipe)", () => {
  it("clears the local chat history", () => {
    saveChatSession("c1", msgs);
    expect(getAllSessions()).toHaveLength(1);
    resetChatHistory();
    expect(getAllSessions()).toHaveLength(0);
  });

  it("does NOT fire delete listeners — logout must wipe locally, never tombstone the server", () => {
    saveChatSession("c1", msgs);
    const deletes: string[][] = [];
    const off = onSessionDelete((ids) => deletes.push(ids));
    resetChatHistory();
    off();
    expect(deletes).toEqual([]); // a tombstone here would delete the user's chats on the server
  });
});
