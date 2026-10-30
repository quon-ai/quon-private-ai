import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/quon/AppShell";
import { ScreenAdmin } from "@/components/quon/ScreenAdmin";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — QUON" },
      { name: "description", content: "Instance administration (accounts, invites)." },
    ],
  }),
  component: () => (
    <AppShell>
      <ScreenAdmin />
    </AppShell>
  ),
});
