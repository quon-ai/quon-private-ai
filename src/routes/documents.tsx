import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/quon/AppShell";
import { ScreenDocuments } from "@/components/quon/ScreenDocuments";

export const Route = createFileRoute("/documents")({
  head: () => ({
    meta: [
      { title: "Documents — QUON" },
      {
        name: "description",
        content: "Encrypted document archive — chat with your files privately.",
      },
    ],
  }),
  component: () => (
    <AppShell>
      <ScreenDocuments />
    </AppShell>
  ),
});
