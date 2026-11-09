import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/quon/AppShell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "QUON — Your AI. Your Rules. Your Data." },
      {
        name: "description",
        content:
          "QUON is a personal AI gateway. Switch between Claude, GPT-4o, Mistral and local models — with privacy built-in.",
      },
      { property: "og:title", content: "QUON — Your AI. Your Rules. Your Data." },
      { property: "og:description", content: "A personal AI gateway with privacy at its core." },
    ],
  }),
  component: Index,
});

function Index() {
  // AppShell gates on auth: shows sign-in/unlock when needed, and once the
  // session is ready it redirects "/" -> /dashboard.
  return (
    <AppShell>
      <div />
    </AppShell>
  );
}
