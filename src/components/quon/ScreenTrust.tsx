import { Link } from "@tanstack/react-router";
import {
  Check,
  Cloud,
  Cpu,
  Eye,
  Lock,
  MonitorSmartphone,
  Scale,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { useQuonHealth } from "@/hooks/useQuonHealth";
import { useT } from "@/lib/i18n/i18n";
import type { MessageKey } from "@/lib/i18n/catalog";

/**
 * /trust — the "wohin deine Daten gehen" page (feedback #50/51/52/56, then the
 * redesign feedback: the old version "read like AI text", buried the PII filter
 * as one of three equal cards, and never named the model).
 *
 * Now the page leads with the thing that matters: an animated data-flow diagram
 * (the "Ameisenstraße") with the QUON filter as its glowing hero, real PII
 * flowing in (amber) and placeholders flowing out (green). Two pledges make the
 * zero-knowledge point unmissable — the server never SEES your stored data; the
 * one read is the momentary filter pass — and the model is named and explained.
 *
 * HONESTY RULE (unchanged): the one step that is not end-to-end encrypted (the
 * scrub transit through server RAM) is stated, not hidden — the amber "Gelesen
 * wird nur zum Schwärzen" pledge is that admission, made in plain words. The
 * live status row below the diagram uses the SAME health probe the pill uses, so
 * this page can never reassure you of something the indicator contradicts.
 */

/** Render a catalog string with lightweight inline emphasis: `*…*` becomes a
 *  bold span (colour via `emph`), and `{model}` is filled from PII_MODEL. Keeps
 *  the copy translatable AND styled without a rich-text runtime. */
function rich(s: string, emph = "font-semibold text-quon-text"): ReactNode[] {
  const filled = s;
  return filled.split(/(\*[^*]+\*)/g).map((part, i) =>
    part.startsWith("*") && part.endsWith("*") ? (
      <strong key={i} className={emph}>
        {part.slice(1, -1)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

export function ScreenTrust() {
  const { t } = useT();
  const { status, health } = useQuonHealth();
  // EU routing (strict): the provider step says where the request is processed.
  const euRouting = health?.region === "eu";

  // Same three-way split the pill and the (removed) status card used: anything
  // that is neither "active" nor "offline" is treated as degraded.
  const pillDot =
    status === "active"
      ? "bg-quon-green glow-green"
      : status === "offline"
        ? "bg-red-500"
        : "bg-quon-yellow";
  const pillLabel: MessageKey =
    status === "active"
      ? "trust.heroPillActive"
      : status === "offline"
        ? "trust.heroPillOffline"
        : "trust.heroPillDegraded";
  const statusColor =
    status === "active"
      ? "text-quon-green"
      : status === "offline"
        ? "text-red-400"
        : "text-quon-yellow";
  const statusText: MessageKey =
    status === "active"
      ? "trust.statusReachable"
      : status === "offline"
        ? "trust.statusOffline"
        : "trust.statusDegraded";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5 md:px-8 md:py-8">
      <div className="mx-auto w-full max-w-4xl">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-quon-border bg-quon-surface px-2.5 py-1 text-[11px] text-quon-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${pillDot}`} />
          {t(pillLabel)}
        </span>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-quon-text">
          {t("trust.heroTitle")}
        </h1>
        <p className="mt-1.5 max-w-[62ch] text-sm leading-relaxed text-quon-muted">
          {rich(t("trust.heroLede"))}
        </p>

        {/* ================= ANT-TRAIL PIPELINE ================= */}
        <div className="qt-flow">
          <span className="qt-flow-cap">{t("trust.flowCap")}</span>
          <div className="qt-stations">
            <div className="qt-node">
              <div className="qt-node-ico">
                <MonitorSmartphone className="h-[18px] w-[18px]" />
              </div>
              <h3>{t("trust.flowDeviceTitle")}</h3>
              <p>{t("trust.flowDeviceBody")}</p>
            </div>

            <div className="qt-node qt-hero">
              <div className="qt-node-ico">
                <ShieldCheck className="h-[22px] w-[22px]" />
              </div>
              <h3>{t("trust.flowFilterTitle")}</h3>
              <p>{t("trust.flowFilterBody")}</p>
              <span className="qt-badge">
                <Check className="h-3 w-3" />
                {t("trust.flowFilterBadge")}
              </span>
              <span className="qt-model">{rich(t("trust.flowFilterModel"))}</span>
            </div>

            <div className="qt-node">
              <div className="qt-node-ico">
                <Sparkles className="h-[18px] w-[18px]" />
              </div>
              <h3>{t("trust.flowProviderTitle")}</h3>
              <p>{t("trust.flowProviderBody")}</p>
              {euRouting && <p data-testid="trust-eu-routing">{t("trust.flowProviderEu")}</p>}
            </div>

            {/* the ant trail: real PII in (amber), placeholders out (green) */}
            <div className="qt-lane">
              <div className="qt-track qt-leg-a" />
              <div className="qt-track qt-leg-b" />
              <div className="qt-pkt qt-real qt-ride-a">
                <span className="qt-lk">🔒</span>Anna Müller
              </div>
              <div className="qt-pkt qt-real qt-ride-a qt-b">
                <span className="qt-lk">🔒</span>DE89 3704…
              </div>
              <div className="qt-pkt qt-safe qt-ride-b">[NAME]</div>
              <div className="qt-pkt qt-safe qt-ride-b qt-b">[IBAN]</div>
              <span className="qt-lane-label qt-lbl-a">{t("trust.flowLaneReal")}</span>
              <span className="qt-lane-label qt-lbl-b">{t("trust.flowLaneSafe")}</span>
            </div>
            <div className="qt-return">
              <div className="qt-rtrack" />
              <span className="qt-rarrow">◀</span>
              <span className="qt-rlabel">{t("trust.flowReturn")}</span>
            </div>
          </div>
        </div>

        {/* ============ ZERO-KNOWLEDGE vs. THE ONE READ ============ */}
        <div className="qt-pledge">
          <div className="qt-pl qt-safe">
            <h4>
              <Lock className="h-4 w-4" />
              {t("trust.pledgeSafeTitle")}
            </h4>
            <p>
              {rich(t("trust.pledgeSafeBody"))}{" "}
              <strong className="font-semibold text-quon-green">
                {t("trust.pledgeSafePunch")}
              </strong>{" "}
              {t("trust.pledgeSafeTail")}
            </p>
          </div>
          <div className="qt-pl qt-honest">
            <h4>
              <Eye className="h-4 w-4" />
              {t("trust.pledgeReadTitle")}
            </h4>
            <p>
              {rich(t("trust.pledgeReadBody"))}{" "}
              <strong className="font-semibold text-quon-yellow">
                {t("trust.pledgeReadPunch")}
              </strong>{" "}
              {t("trust.pledgeReadTail")}
            </p>
          </div>
        </div>

        {/* ================= DETAILS ================= */}
        <div className="qt-cards">
          <div className="qt-card">
            <h4>
              <MonitorSmartphone className="h-4 w-4 text-quon-indigo" />
              {t("trust.cardDeviceTitle")}
            </h4>
            <p>{rich(t("trust.cardDeviceBody1"))}</p>
            <p>{t("trust.cardDeviceBody2")}</p>
          </div>

          <div className="qt-card qt-key">
            <h4>
              <span className="qt-kicker">{t("trust.cardFilterKicker")}</span>
              {t("trust.cardFilterTitle")}
            </h4>
            <p>{rich(t("trust.cardFilterBody"))}</p>
            <div className="qt-swap">
              <span className="text-quon-muted">{t("trust.cardFilterExCall")}</span>
              <span className="text-quon-yellow">Anna Müller</span>
              <span className="text-quon-muted">{t("trust.cardFilterExMid")}</span>
              <span className="text-quon-yellow">DE89 3704…</span>
              <span className="text-quon-muted">{t("trust.cardFilterExEnd")}</span>
              <br />
              <span className="text-quon-muted">→ {t("trust.cardFilterExCall")}</span>
              <span className="text-quon-green">[NAME]</span>
              <span className="text-quon-muted">{t("trust.cardFilterExMid")}</span>
              <span className="text-quon-green">[IBAN]</span>
              <span className="text-quon-muted">{t("trust.cardFilterExEnd")}</span>
            </div>
            <p className="qt-note">
              {rich(t("trust.cardFilterNote"), "font-semibold text-quon-indigo")}
            </p>
          </div>

          <div className="qt-card">
            <h4>
              <Sparkles className="h-4 w-4 text-quon-indigo" />
              {t("trust.cardProviderTitle")}
            </h4>
            <p>{rich(t("trust.cardProviderBody1"))}</p>
            <p>{t("trust.cardProviderBody2")}</p>
          </div>
        </div>

        {/* Live status — the same probe the pill and the chat use. */}
        <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-quon-border bg-quon-surface px-4 py-3 text-xs">
          <span className="flex items-center gap-2 text-quon-muted">
            <Cpu className="h-3.5 w-3.5 shrink-0" />
            <span>
              {t("trust.statusEngine")}:{" "}
              <b className="text-quon-text">{t("trust.statusEngineLocal")}</b> ·{" "}
              <span className={statusColor}>{t(statusText)}</span>
            </span>
          </span>
          <Link
            to="/settings"
            className="font-semibold text-quon-indigo transition hover:text-quon-indigo-hover"
          >
            {t("trust.statusConfigure")} →
          </Link>
        </section>

        <p className="mt-3.5 flex items-center gap-1.5 text-[11.5px] text-quon-muted">
          <Scale className="h-3.5 w-3.5 shrink-0" />
          {t("trust.legalTitle")}:{" "}
          <Link
            to="/privacy"
            className="font-semibold text-quon-indigo hover:text-quon-indigo-hover"
          >
            {t("trust.legalPrivacy")}
          </Link>{" "}
          ·{" "}
          <Link
            to="/imprint"
            className="font-semibold text-quon-indigo hover:text-quon-indigo-hover"
          >
            {t("trust.legalImprint")}
          </Link>
        </p>
      </div>
    </div>
  );
}
