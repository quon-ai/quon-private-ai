import { describe, expect, it } from "vitest";

import { groupSessionsByProject } from "./projectGrouping";
import type { ProjectItem } from "./projectStore";
import type { ChatSession } from "./quonStore";

const proj = (id: string): ProjectItem => ({ id, name: id, createdAt: 0, updatedAt: 0 });
const chat = (id: string, projectId?: string): ChatSession => ({
  id,
  title: id,
  createdAt: 0,
  updatedAt: 0,
  messages: [],
  projectId,
});

describe("groupSessionsByProject", () => {
  it("partitions chats into their project groups and the global remainder", () => {
    const { groups, ungrouped } = groupSessionsByProject(
      [chat("a", "p1"), chat("b"), chat("c", "p2"), chat("d", "p1")],
      [proj("p1"), proj("p2")],
    );
    expect(groups.map((g) => g.project.id)).toEqual(["p1", "p2"]);
    expect(groups[0].chats.map((c) => c.id)).toEqual(["a", "d"]);
    expect(groups[1].chats.map((c) => c.id)).toEqual(["c"]);
    expect(ungrouped.map((c) => c.id)).toEqual(["b"]);
  });

  it("sends chats referencing an unknown / not-yet-synced project to ungrouped", () => {
    const { groups, ungrouped } = groupSessionsByProject([chat("a", "ghost")], [proj("p1")]);
    expect(groups[0].chats).toEqual([]);
    expect(ungrouped.map((c) => c.id)).toEqual(["a"]);
  });

  it("keeps an empty project as a group with no chats", () => {
    const { groups } = groupSessionsByProject([], [proj("p1")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].chats).toEqual([]);
  });

  it("preserves input order within each bucket", () => {
    const { groups, ungrouped } = groupSessionsByProject(
      [chat("a", "p1"), chat("b", "p1"), chat("c")],
      [proj("p1")],
    );
    expect(groups[0].chats.map((c) => c.id)).toEqual(["a", "b"]);
    expect(ungrouped.map((c) => c.id)).toEqual(["c"]);
  });
});
