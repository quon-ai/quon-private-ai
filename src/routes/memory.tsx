import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/quon/AppShell";
import { ScreenMemory } from "@/components/quon/ScreenMemory";

export const Route = createFileRoute("/memory")({
  head: () => ({
    meta: [
      { title: "Memory — QUON" },
      { name: "description", content: "Your on-device memory — what QUON recalls about you." },
    ],
  }),
  component: () => (
    <AppShell>
      <ScreenMemory />
    </AppShell>
  ),
});
