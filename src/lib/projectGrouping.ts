/**
 * Pure grouping helper for the sidebar: partition chat sessions into per-project
 * groups plus the ungrouped (global) remainder. Kept separate from the stores so
 * it's trivially unit-testable.
 */

import type { ProjectItem } from "./projectStore";
import type { ChatSession } from "./quonStore";

export interface ProjectGroup {
  project: ProjectItem;
  chats: ChatSession[];
}

/**
 * Split `sessions` into one group per project plus everything else.
 *
 * - A session whose `projectId` matches a known project joins that group.
 * - A session with no `projectId`, or one referencing an unknown / not-yet-synced
 *   project, falls back to `ungrouped` (shown under "Recents") — never lost.
 * - Every project gets a group even with zero chats, so a freshly-created project
 *   is visible immediately.
 * - Input order is preserved within each bucket (callers pass pre-sorted lists).
 */
export function groupSessionsByProject(
  sessions: ChatSession[],
  projects: ProjectItem[],
): { groups: ProjectGroup[]; ungrouped: ChatSession[] } {
  const known = new Set(projects.map((p) => p.id));
  const byProject = new Map<string, ChatSession[]>();
  const ungrouped: ChatSession[] = [];
  for (const s of sessions) {
    if (s.projectId && known.has(s.projectId)) {
      const list = byProject.get(s.projectId) ?? [];
      list.push(s);
      byProject.set(s.projectId, list);
    } else {
      ungrouped.push(s);
    }
  }
  const groups = projects.map((project) => ({ project, chats: byProject.get(project.id) ?? [] }));
  return { groups, ungrouped };
}
