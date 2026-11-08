/**
 * The scrub-only demo (/demo): a visitor without an account pastes a text and
 * sees what a model would receive. It calls POST /demo/scrub, which the
 * backend exposes only when DEMO_SCRUB_ENABLED is set (health says so); the
 * text is processed for one request, nothing is stored, no model is called.
 *
 * Standalone page, not inside AppShell: the shell renders the sign-in screen
 * for anyone without a session, and this page is for exactly those visitors.
 * ENGLISH by default whatever the instance's language, with its own switch:
 * the page is written for strangers, and the switch must not touch the
 * visitor's app-wide preference, so it keeps a local language and translates
 * through translate() rather than the LangProvider.
 */
import { Link } from "@tanstack/react-router";
import { Bot, ShieldCheck, Undo2, UserRound } from "lucide-react";
import { useState } from "react";

import { useQuonHealth } from "@/hooks/useQuonHealth";
import { useHydrated } from "@/lib/useHydrated";
import { DEMO_SAMPLE, splitByPlaceholders } from "@/lib/demoScrub";
import type { MessageKey } from "@/lib/i18n/catalog";
import { translate, type Params } from "@/lib/i18n/i18n";
import type { Lang } from "@/lib/langPref";
import { demoScrub, QuonError, type ScrubResult } from "@/lib/quonApi";
import { entityStyle } from "@/lib/quonEntityStyles";

import { LegalLinks } from "./LegalPage";

const GRADIENT =
  "radial-gradient(ellipse at top, oklch(0.22 0.05 277 / 0.6), transparent 60%), radial-gradient(ellipse at bottom, oklch(0.2 0.04 200 / 0.4), transparent 60%), var(--quon-bg)";
const SOURCE_URL = "https://github.com/quon-ai/quon-private-ai";
/** Until /health has answered, the page assumes the backend's default cap. */
const FALLBACK_MAX_CHARS = 2000;
const STEPS = [
  { icon: UserRound, title: "demo.how1Title", text: "demo.how1Text" },
  { icon: ShieldCheck, title: "demo.how2Title", text: "demo.how2Text" },
  { icon: Bot, title: "demo.how3Title", text: "demo.how3Text" },
  { icon: Undo2, title: "demo.how4Title", text: "demo.how4Text" },
] as const satisfies ReadonlyArray<{
  icon: typeof UserRound;
  title: MessageKey;
  text: MessageKey;
}>;

export function ScreenDemo() {
  const [lang, setLang] = useState<Lang>("en");
  const t = (key: MessageKey, params?: Params) => translate(lang, key, params);
  const { health } = useQuonHealth();
  const max = health?.demo_scrub_max_chars || FALLBACK_MAX_CHARS;
  // Unknown until health arrives: render the form rather than a false "off".
  const enabled = health ? Boolean(health.demo_scrub_enabled) : true;
  const contactUrl = health?.demo_contact_url || "";
  const contactEmail = health?.demo_contact_email || "";

  const [text, setText] = useState("");
  // The page is server-rendered: its controls exist before React takes over,
  // and a click or keystroke in that window is lost (the language click in
  // Chromium, the filled text in WebKit, on the e2e runner). Until hydration
  // the textarea is read-only and the buttons disabled, so nothing can be
  // lost; Playwright's auto-wait and a human's patience both cover ~300 ms.
  const hydrated = useHydrated();
  const [result, setResult] = useState<ScrubResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A placeholder carries one word per type ([AMOUNT_1]); the entity list
  // carries the type name (FINANCIAL_AMOUNT) the styles are keyed by.
  const typeByPlaceholder = new Map((result?.entities ?? []).map((e) => [e.placeholder, e.type]));

  async function run() {
    if (busy || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await demoScrub(text, lang));
    } catch (err) {
      const status = err instanceof QuonError ? err.status : undefined;
      setResult(null);
      setError(
        status === 413
          ? t("demo.errTooLong", { max })
          : status === 429
            ? t("demo.errRate")
            : status === 503
              ? t("demo.errBusy")
              : status === 404
                ? t("demo.disabled")
                : t("demo.errGeneric"),
      );
    } finally {
      setBusy(false);
    }
  }

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
        <h1 className="mt-1 text-2xl font-semibold text-quon-text">{t("demo.title")}</h1>
        <p className="mt-3 text-sm leading-relaxed text-quon-muted">{t("demo.lead")}</p>

        <section className="mt-6" aria-label={t("demo.howTitle")}>
          <h2 className="text-sm font-semibold text-quon-text">{t("demo.howTitle")}</h2>
          <ol className="mt-3 grid gap-3 sm:grid-cols-4" data-testid="demo-how">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <li
                  key={step.title}
                  className="relative rounded-xl border border-quon-border bg-quon-bg px-3 py-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-quon-indigo/15 text-quon-indigo">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-quon-muted">
                      {i + 1}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-quon-text">{t(step.title)}</p>
                  <p className="mt-1 text-xs leading-relaxed text-quon-muted">{t(step.text)}</p>
                  {i < STEPS.length - 1 && (
                    <span
                      aria-hidden
                      className="absolute top-1/2 -right-3 hidden -translate-y-1/2 text-quon-muted sm:block"
                    >
                      →
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        {!enabled ? (
          <p className="mt-6 rounded-xl border border-quon-border bg-quon-bg px-4 py-3 text-sm text-quon-muted">
            {t("demo.disabled")}
          </p>
        ) : (
          <>
            <label className="mt-6 block">
              <span className="sr-only">{t("demo.textareaLabel")}</span>
              <textarea
                readOnly={!hydrated}
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, max))}
                maxLength={max}
                rows={6}
                placeholder={t("demo.textareaPlaceholder")}
                aria-label={t("demo.textareaLabel")}
                className="w-full resize-y rounded-xl border border-quon-border bg-quon-bg px-3 py-2 text-sm text-quon-text outline-none focus:border-quon-indigo"
              />
            </label>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-quon-muted">
              <span>{t("demo.counter", { n: text.length, max })}</span>
              <button
                type="button"
                onClick={() => setText(DEMO_SAMPLE[lang].slice(0, max))}
                disabled={!hydrated}
                className="underline-offset-2 hover:text-quon-text hover:underline"
              >
                {t("demo.sample")}
              </button>
            </div>
            <button
              type="button"
              onClick={() => void run()}
              disabled={!hydrated || busy || !text.trim()}
              className="mt-4 w-full rounded-xl bg-quon-indigo px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? t("demo.running") : t("demo.run")}
            </button>
            {error && (
              <p role="alert" className="mt-3 text-sm text-quon-yellow">
                {error}
              </p>
            )}

            {result && (
              <section className="mt-6 space-y-5">
                <div>
                  <h2 className="text-sm font-semibold text-quon-text">{t("demo.resultTitle")}</h2>
                  <p
                    data-testid="demo-result"
                    className="mt-2 whitespace-pre-wrap rounded-xl border border-quon-border bg-quon-bg px-3 py-2 text-sm leading-relaxed text-quon-text"
                  >
                    {splitByPlaceholders(result.scrubbed).map((s, i) =>
                      s.kind === "text" ? (
                        <span key={i}>{s.text}</span>
                      ) : (
                        <span
                          key={i}
                          className={`rounded px-1 font-mono text-[12px] ${entityStyle(typeByPlaceholder.get(s.text) ?? s.type, lang).chip}`}
                        >
                          {s.text}
                        </span>
                      ),
                    )}
                  </p>
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-quon-text">{t("demo.foundTitle")}</h2>
                  {result.entities.length === 0 ? (
                    <p className="mt-2 text-sm text-quon-muted">{t("demo.nothingFound")}</p>
                  ) : (
                    <ul data-testid="demo-found" className="mt-2 space-y-1.5 text-sm">
                      {result.entities.map((e, i) => {
                        const style = entityStyle(e.type, lang);
                        return (
                          <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className={`inline-block h-2 w-2 rounded-full ${style.dot}`} />
                            <span className="text-quon-muted">{style.label}</span>
                            <span className="text-quon-text line-through decoration-quon-muted/70">
                              {e.value}
                            </span>
                            <span aria-hidden className="text-quon-muted">
                              →
                            </span>
                            <code className={`rounded px-1 font-mono text-[12px] ${style.chip}`}>
                              {e.placeholder}
                            </code>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>
            )}
          </>
        )}

        <p className="mt-6 text-[11px] leading-relaxed text-quon-muted">{t("demo.privacy")}</p>

        <section
          className="mt-6 rounded-xl border border-quon-border bg-quon-bg px-4 py-3"
          data-testid="demo-cta"
        >
          <h2 className="text-sm font-semibold text-quon-text">{t("demo.ctaTitle")}</h2>
          <p className="mt-1 text-sm text-quon-muted">{t("demo.ctaText")}</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
            {contactUrl && (
              <a
                href={contactUrl}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-quon-indigo underline-offset-2 hover:underline"
              >
                {t("demo.ctaWaitlist")}
              </a>
            )}
            {contactEmail && (
              <a
                href={`mailto:${contactEmail}?subject=${encodeURIComponent("QUON Beta")}`}
                className="font-semibold text-quon-indigo underline-offset-2 hover:underline"
              >
                {t("demo.ctaMail", { email: contactEmail })}
              </a>
            )}
            {!contactUrl && !contactEmail && (
              <Link
                to="/"
                className="font-semibold text-quon-indigo underline-offset-2 hover:underline"
              >
                {t("demo.ctaSignIn")}
              </Link>
            )}
            <Link
              to="/docs/detection"
              search={{ lang }}
              className="text-quon-muted underline-offset-2 hover:text-quon-text hover:underline"
            >
              {t("demo.ctaHowTested")}
            </Link>
            <a
              href={SOURCE_URL}
              target="_blank"
              rel="noreferrer"
              className="text-quon-muted underline-offset-2 hover:text-quon-text hover:underline"
            >
              {t("demo.ctaSource")}
            </a>
          </div>
        </section>

        <LegalLinks className="mt-8" lang={lang} />
      </div>
    </div>
  );
}
