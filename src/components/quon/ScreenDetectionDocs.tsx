/**
 * The public "how we test the filter" page (/docs/detection): the end-user
 * companion to the /demo page. Same standalone shell as ScreenDemo — not
 * inside AppShell (that renders the sign-in screen for visitors), English by
 * default with its own local language switch that never touches the visitor's
 * app-wide preference.
 *
 * Plain language on purpose. The engineering story lives in the repository
 * (docs/detection-whitepaper.md, docs/detection-experiments.md); this page
 * links the source and the demo, never a dead in-repo path.
 */
import { Link } from "@tanstack/react-router";
import { FileSearch, FlaskConical, Repeat, Scale } from "lucide-react";
import { useState } from "react";

import { useHydrated } from "@/lib/useHydrated";
import type { MessageKey } from "@/lib/i18n/catalog";
import { translate, type Params } from "@/lib/i18n/i18n";
import type { Lang } from "@/lib/langPref";

import { LegalLinks } from "./LegalPage";

const GRADIENT =
  "radial-gradient(ellipse at top, oklch(0.22 0.05 277 / 0.6), transparent 60%), radial-gradient(ellipse at bottom, oklch(0.2 0.04 200 / 0.4), transparent 60%), var(--quon-bg)";
const SOURCE_URL = "https://github.com/quon-ai/quon-private-ai";

const CARDS = [
  { icon: FlaskConical, title: "evaluation.card1Title", text: "evaluation.card1Text" },
  { icon: FileSearch, title: "evaluation.card2Title", text: "evaluation.card2Text" },
  { icon: Scale, title: "evaluation.card3Title", text: "evaluation.card3Text" },
  { icon: Repeat, title: "evaluation.card4Title", text: "evaluation.card4Text" },
] as const satisfies ReadonlyArray<{
  icon: typeof FlaskConical;
  title: MessageKey;
  text: MessageKey;
}>;

export function ScreenDetectionDocs({ initialLang }: { initialLang?: Lang }) {
  const [lang, setLang] = useState<Lang>(initialLang ?? "en");
  // Server-rendered page: the toggle must not swallow a click before React
  // has attached (see useHydrated).
  const hydrated = useHydrated();
  const t = (key: MessageKey, params?: Params) => translate(lang, key, params);

  const langButton = (value: Lang, label: string) => (
    <button
      type="button"
      onClick={() => setLang(value)}
      disabled={!hydrated}
      aria-pressed={lang === value}
      lang={value}
      className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
        lang === value ? "bg-quon-indigo text-white" : "text-quon-muted hover:text-quon-text"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen px-4 py-10" style={{ background: GRADIENT }} lang={lang}>
      <div className="mx-auto w-full max-w-2xl rounded-2xl border border-quon-border bg-quon-bg/80 px-6 py-8 shadow-2xl sm:px-10">
        <div className="flex items-start justify-between gap-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-quon-indigo">QUON</p>
          <div
            role="group"
            aria-label={t("demo.language")}
            className="inline-flex rounded-lg border border-quon-border bg-quon-surface-2 p-0.5"
          >
            {langButton("en", "English")}
            {langButton("de", "Deutsch")}
          </div>
        </div>

        <h1 className="mt-3 text-2xl font-bold text-quon-text sm:text-3xl">
          {t("evaluation.title")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-quon-muted">{t("evaluation.lead")}</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {CARDS.map(({ icon: Icon, title, text }) => (
            <section
              key={title}
              className="rounded-xl border border-quon-border bg-quon-surface-2/60 p-4"
            >
              <Icon aria-hidden className="h-5 w-5 text-quon-indigo" />
              <h2 className="mt-2 text-sm font-semibold text-quon-text">{t(title)}</h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-quon-muted">{t(text)}</p>
            </section>
          ))}
        </div>

        <section className="mt-6 rounded-xl border border-quon-border bg-quon-surface-2/60 p-4">
          <h2 className="text-sm font-semibold text-quon-text">{t("evaluation.limitsTitle")}</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-quon-muted">
            {t("evaluation.limitsText")}
          </p>
        </section>

        <section className="mt-6">
          <h2 className="text-sm font-semibold text-quon-text">{t("evaluation.methodTitle")}</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-quon-muted">
            {t("evaluation.methodText")}
          </p>
        </section>

        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Link
            to="/demo"
            className="font-semibold text-quon-indigo underline-offset-2 hover:underline"
          >
            {t("evaluation.ctaDemo")}
          </Link>
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noreferrer"
            className="text-quon-muted underline-offset-2 hover:text-quon-text hover:underline"
          >
            {t("evaluation.ctaSource")}
          </a>
        </div>

        <LegalLinks className="mt-8" lang={lang} />
      </div>
    </div>
  );
}
