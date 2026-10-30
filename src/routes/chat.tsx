import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/quon/AppShell";
import { ScreenChat } from "@/components/quon/ScreenChat";

interface ChatSearch {
  /** Active chat session id; absent means a fresh, unsaved chat. */
  c?: string;
  /** Project to bind a *new* chat to; ignored once the chat has an id (`c`). */
  p?: string;
}

export const Route = createFileRoute("/chat")({
  validateSearch: (search: Record<string, unknown>): ChatSearch => ({
    c: typeof search.c === "string" ? search.c : undefined,
    p: typeof search.p === "string" ? search.p : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Chat — QUON" },
      {
        name: "description",
        content:
          "Chat across providers with personal data filtered locally before it leaves your device.",
      },
    ],
  }),
  component: () => (
    <AppShell>
      <ScreenChat />
    </AppShell>
  ),
});
