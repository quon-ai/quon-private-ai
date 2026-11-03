import { createFileRoute } from "@tanstack/react-router";

import { ScreenDemo } from "@/components/quon/ScreenDemo";

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "QUON Demo" },
      {
        name: "description",
        content:
          "Paste a text with personal data and see what an AI model would receive: QUON redacts names, e-mail addresses, phone numbers and more before anything leaves your side.",
      },
    ],
  }),
  component: ScreenDemo,
});
