import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft } from "lucide-react";

import type { MessageKey } from "@/lib/i18n/catalog";
import { translate, useT } from "@/lib/i18n/i18n";
import type { Lang } from "@/lib/langPref";
import { TERMS_EFFECTIVE_DATE, TERMS_IS_DRAFT, TERMS_VERSION } from "@/lib/legal";
import { Logo } from "./Logo";

const GRADIENT =
  "radial-gradient(ellipse at top, oklch(0.22 0.05 277 / 0.6), transparent 60%), radial-gradient(ellipse at bottom, oklch(0.2 0.04 200 / 0.4), transparent 60%), var(--quon-bg)";

/** The three legal documents, so each page can cross-link to the other two. */
const LEGAL_PAGES = [
  { to: "/terms", labelKey: "common.legalTerms" },
  { to: "/privacy", labelKey: "common.legalPrivacy" },
  { to: "/imprint", labelKey: "common.legalImprint" },
] as const;

type LegalPath = (typeof LEGAL_PAGES)[number]["to"];

/** Inline row of links to the three legal documents, for app footers (Settings,
 *  auth screen). Opens in a new tab so the user never loses their place in the
 *  app; the standalone legal pages also carry a "Zurück" link of their own. */
/** `lang` pins the labels to a page language; the public demo page is English
 *  whatever the app's language, and its footer should be too. */
export function LegalLinks({ className, lang }: { className?: string; lang?: Lang }) {
  const { t: appT } = useT();
  const t = (key: MessageKey) => (lang ? translate(lang, key) : appT(key));
  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[11px] text-quon-muted ${className ?? ""}`}
    >
      {LEGAL_PAGES.map((p, i) => (
        <span key={p.to} className="flex items-center gap-2.5">
          {i > 0 && <span aria-hidden>·</span>}
          <Link to={p.to} target="_blank" className="hover:text-quon-text">
            {t(p.labelKey)}
          </Link>
        </span>
      ))}
    </div>
  );
}

/** A numbered top-level section. */
export function Section({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-7">
      <h2 className="text-base font-semibold text-quon-text">
        {n}. {title}
      </h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-quon-muted">{children}</div>
    </section>
  );
}

/** A `[...]`-style placeholder the operator/lawyer must fill in before launch. */
export function Todo({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-amber-500/15 px-1 py-0.5 font-medium text-amber-300">
      [{children}]
    </span>
  );
}

/** Shared shell for the legal pages (Nutzungsvereinbarung / Datenschutz / Impressum):
 *  gradient background, card, logo, "Stand · Version" line, the pre-launch draft
 *  banner, the page body, cross-links to the sibling documents and a back link. */
export function LegalShell({
  title,
  current,
  children,
}: {
  title: string;
  current: LegalPath;
  children: React.ReactNode;
}) {
  const { t } = useT();
  return (
    <div className="min-h-screen px-4 py-10" style={{ background: GRADIENT }}>
      <div className="mx-auto w-full max-w-2xl rounded-2xl border border-quon-border bg-quon-bg/80 px-6 py-8 shadow-2xl sm:px-10">
        <div className="flex flex-col items-center text-center">
          <Logo size="lg" />
          <h1 className="mt-4 text-xl font-semibold text-quon-text">{title}</h1>
          <p className="mt-1 text-xs text-quon-muted">
            Stand: {TERMS_EFFECTIVE_DATE} · Version {TERMS_VERSION}
          </p>
        </div>

        {TERMS_IS_DRAFT && (
          <div className="mt-6 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>Entwurf – noch nicht rechtlich geprüft.</strong> Dies ist ein vorläufiger
              Vorschlag. Vor dem öffentlichen Start wird das Dokument anwaltlich geprüft und
              finalisiert. Gelb hinterlegte Angaben in eckigen Klammern müssen noch ergänzt werden.
            </span>
          </div>
        )}

        <div className="mt-4">{children}</div>

        <div className="mt-8 flex flex-wrap justify-center gap-x-4 gap-y-1 border-t border-quon-border pt-5 text-xs">
          {LEGAL_PAGES.filter((p) => p.to !== current).map((p) => (
            <Link key={p.to} to={p.to} className="text-quon-indigo hover:underline">
              {t(p.labelKey)}
            </Link>
          ))}
        </div>
        <div className="mt-3 text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-quon-indigo hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> Zurück zur Anmeldung
          </Link>
        </div>
      </div>
    </div>
  );
}
