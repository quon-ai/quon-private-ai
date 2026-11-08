import { createFileRoute } from "@tanstack/react-router";

import { ScreenDetectionDocs } from "@/components/quon/ScreenDetectionDocs";

/** `?lang=de|en` lets the demo page hand its chosen language over, so a German
 *  reader does not land on an English page. Anything else falls back to the
 *  page default (English — written for strangers, like /demo). */
type DocsSearch = { lang?: "de" | "en" };

export const Route = createFileRoute("/docs/detection")({
  validateSearch: (search: Record<string, unknown>): DocsSearch =>
    search.lang === "de" || search.lang === "en" ? { lang: search.lang } : {},
  head: () => ({
    meta: [
      { title: "How we test the filter — QUON" },
      {
        name: "description",
        content:
          "How QUON's privacy filter is measured: generated test messages, salted real-world layouts, a public benchmark, and every reviewed mistake pinned as a permanent test.",
      },
    ],
  }),
  component: DocsDetectionPage,
});

function DocsDetectionPage() {
  const { lang } = Route.useSearch();
  return <ScreenDetectionDocs initialLang={lang} />;
}
