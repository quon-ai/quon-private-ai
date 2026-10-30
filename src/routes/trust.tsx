import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/quon/AppShell";
import { ScreenTrust } from "@/components/quon/ScreenTrust";

export const Route = createFileRoute("/trust")({
  head: () => ({
    meta: [
      { title: "Datenflüsse — QUON" },
      {
        name: "description",
        content: "Was auf deinem Gerät läuft, was auf dem QUON-Server, was beim KI-Anbieter.",
      },
    ],
  }),
  component: () => (
    <AppShell>
      <ScreenTrust />
    </AppShell>
  ),
});
