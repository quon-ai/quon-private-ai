import { beforeEach, describe, expect, it } from "vitest";

import { getAllDocuments, resetDocuments, upsertDocument } from "./documentStore";
import { getAllMemory, resetMemory, upsertMemoryItem } from "./memoryStore";
import {
  applyRemoteProject,
  applyRemoteProjectDeletion,
  createProjectId,
  deleteProject,
  deleteProjectAndOrphanContent,
  getAllProjects,
  getProject,
  nextProjectColor,
  PROJECT_COLORS,
  projectSyncStore,
  resetProjects,
  upsertProject,
  type ProjectColor,
  type ProjectItem,
} from "./projectStore";
import {
  clearChatHistory,
  getAllSessions,
  saveChatSession,
  type StoredChatMessage,
} from "./quonStore";

const p = (id: string, updatedAt: number, name = id): ProjectItem => ({
  id,
  name,
  createdAt: 0,
  updatedAt,
});

beforeEach(() => {
  resetProjects();
  resetMemory();
  resetDocuments();
  clearChatHistory();
});

describe("projectStore CRUD", () => {
  it("upserts, reads and deletes", () => {
    upsertProject(p("p1", 1, "Tax"));
    expect(getProject("p1")?.name).toBe("Tax");
    expect(getAllProjects()).toHaveLength(1);
    deleteProject("p1");
    expect(getProject("p1")).toBeUndefined();
  });

  it("createProjectId is prefixed", () => {
    expect(createProjectId()).toMatch(/^proj_/);
  });
});

describe("projectStore sync (LWW, no echo)", () => {
  it("applyRemoteProject honors last-write-wins by updatedAt", () => {
    upsertProject(p("p1", 5, "current"));
    applyRemoteProject(p("p1", 3, "stale")); // older -> ignored
    expect(getProject("p1")?.name).toBe("current");
    applyRemoteProject(p("p1", 9, "newer")); // newer -> applied
    expect(getProject("p1")?.name).toBe("newer");
  });

  it("applyRemoteProjectDeletion removes; no-op when absent", () => {
    upsertProject(p("p1", 1));
    applyRemoteProjectDeletion("missing");
    applyRemoteProjectDeletion("p1");
    expect(getProject("p1")).toBeUndefined();
  });

  it("local upsert/delete fire the sync listeners; applyRemote does not echo", () => {
    const changed: string[] = [];
    const deleted: string[][] = [];
    const offC = projectSyncStore.onChange((it) => changed.push(it.id));
    const offD = projectSyncStore.onDelete((ids) => deleted.push(ids));
    upsertProject(p("p1", 1));
    deleteProject("p1");
    applyRemoteProject(p("p2", 1)); // must not fire onChange
    expect(changed).toEqual(["p1"]);
    expect(deleted).toEqual([["p1"]]);
    offC();
    offD();
  });

  it("adapter exposes idOf / updatedAtOf", () => {
    expect(projectSyncStore.idOf(p("p1", 7))).toBe("p1");
    expect(projectSyncStore.updatedAtOf(p("p1", 7))).toBe(7);
  });
});

describe("deleteProjectAndOrphanContent", () => {
  it("moves the project's chats/memory/docs back to global, then removes the project", () => {
    upsertProject(p("p1", 1));
    const msgs: StoredChatMessage[] = [{ id: 1, role: "user", text: "hi" }];
    saveChatSession("c1", msgs, { projectId: "p1" });
    upsertMemoryItem({
      id: "m1",
      kind: "note",
      text: "t",
      tags: [],
      projectId: "p1",
      createdAt: 1,
      updatedAt: 1,
    });
    upsertDocument({
      id: "d1",
      filename: "f.txt",
      mime: "text/plain",
      status: "ready",
      chunks: [],
      projectId: "p1",
      createdAt: 1,
      updatedAt: 1,
    });

    deleteProjectAndOrphanContent("p1");

    expect(getProject("p1")).toBeUndefined();
    expect(getAllSessions().find((s) => s.id === "c1")?.projectId).toBeUndefined();
    expect(getAllMemory().find((m) => m.id === "m1")?.projectId).toBeUndefined();
    expect(getAllDocuments().find((d) => d.id === "d1")?.projectId).toBeUndefined();
  });
});

describe("nextProjectColor", () => {
  const p = (color: ProjectColor) => ({ color });

  it("returns the first palette colour when there are no projects", () => {
    expect(nextProjectColor([])).toBe(PROJECT_COLORS[0]);
  });

  it("picks the next unused colour in palette order", () => {
    expect(nextProjectColor([p("indigo")])).toBe("green");
    expect(nextProjectColor([p("indigo"), p("green")])).toBe("yellow");
  });

  it("avoids a duplicate after a delete-then-create (the reported bug)", () => {
    // Had indigo/green/yellow/sky/rose, deleted 'yellow' -> these four remain.
    // Round-robin by count (len=4) would pick sky again -> collision. Least-used
    // picks 'yellow' (the freed slot) instead.
    const remaining = [p("indigo"), p("green"), p("sky"), p("rose")];
    expect(nextProjectColor(remaining)).toBe("yellow");
  });

  it("only repeats once every colour is in use, and then the least-used one", () => {
    const all = PROJECT_COLORS.map((c) => p(c)); // one of each
    expect(nextProjectColor(all)).toBe(PROJECT_COLORS[0]); // all tied -> first
    expect(nextProjectColor([...all, p("indigo")])).toBe(PROJECT_COLORS[1]); // indigo now 2 -> next
  });

  it("treats an unset colour as indigo", () => {
    expect(nextProjectColor([{}, {}])).toBe("green"); // 2x indigo -> green is least-used
  });
});
