import { createFileRoute } from "@tanstack/react-router";

import { ScreenWhitepaper } from "@/components/quon/ScreenWhitepaper";

export const Route = createFileRoute("/docs/detection-whitepaper")({
  head: () => ({
    meta: [
      { title: "PII Detection in QUON — Whitepaper" },
      {
        name: "description",
        content:
          "Architecture selection and quality evidence for QUON's privacy filter: the evaluated options, the measurement instruments, the numbers, and the decisions taken on them.",
      },
    ],
  }),
  component: ScreenWhitepaper,
});
