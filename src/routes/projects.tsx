import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/quon/AppShell";
import { ScreenProjects } from "@/components/quon/ScreenProjects";

interface ProjectsSearch {
  /** Selected project id; absent shows the project list. */
  id?: string;
}

export const Route = createFileRoute("/projects")({
  validateSearch: (search: Record<string, unknown>): ProjectsSearch => ({
    id: typeof search.id === "string" ? search.id : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Projects — QUON" },
      {
        name: "description",
        content: "Group chats by topic with their own memory, documents and instructions.",
      },
    ],
  }),
  component: () => (
    <AppShell>
      <ScreenProjects />
    </AppShell>
  ),
});
