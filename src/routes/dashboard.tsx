import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/quon/AppShell";
import { ScreenDashboard } from "@/components/quon/ScreenDashboard";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — QUON" },
      {
        name: "description",
        content: "Your QUON dashboard: protection level, active model, and recent activity.",
      },
    ],
  }),
  component: () => (
    <AppShell>
      <ScreenDashboard />
    </AppShell>
  ),
});
