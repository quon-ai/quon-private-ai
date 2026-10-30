import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ShieldAlert, ShieldCheck } from "lucide-react";

import { useT } from "@/lib/i18n/i18n";
import { quon, useQuonState } from "@/lib/quonStore";

const AUTOSAVE_MS = 500;

function toTerms(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    ),
  );
}

/**
 * A textarea list that persists reliably on mobile. `onBlur` alone is flaky on
 * touch devices — a keyboard dismiss or app-switch may never fire it — so we also
 * debounce-save while typing and flush on unmount (leaving Settings) and on
 * tab-hide / pagehide (backgrounding the browser).
 */
function useAutosavedList(initial: string, persist: (terms: string[]) => void) {
  const [text, setText] = useState(initial);
  // Keep the newest text + persist fn in refs so the flush handlers are stable
  // yet always act on the current value.
  const latest = useRef(text);
  latest.current = text;
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRun = useRef(true);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    persistRef.current(toTerms(latest.current));
  }, []);

  // Debounced auto-save as the user types (skip the initial mount value).
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => persistRef.current(toTerms(latest.current)), AUTOSAVE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [text]);

  // Flush pending edits when the page is backgrounded or the card unmounts, so a
  // value typed right before leaving isn't lost even if blur never fires.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  return { text, setText, flush };
}

export function RedactionListsCard() {
  const { t, plural } = useT();
  const { alwaysRedact, neverRedact } = useQuonState();

  const redact = useAutosavedList(alwaysRedact.join("\n"), quon.setAlwaysRedact);
  const redactText = redact.text;
  const redactCount = toTerms(redactText).length;

  const never = useAutosavedList(neverRedact.join("\n"), quon.setNeverRedact);
  const neverText = never.text;
  const neverCount = toTerms(neverText).length;

  return (
    <div className="space-y-5">
      {/* Always redact on this device */}
      <section className="rounded-xl border border-quon-border bg-quon-surface p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-fuchsia-400/20 text-fuchsia-400">
            <ShieldAlert className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-quon-text">
              {t("settings.alwaysRedactTitle")}
            </div>
            <div className="text-[10px] text-quon-muted">
              {redactCount > 0
                ? plural(redactCount, {
                    one: "settings.termCountOne",
                    other: "settings.termCountOther",
                  })
                : t("settings.nothingYet")}
            </div>
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-quon-muted">
          {t("settings.alwaysRedactDescPre")}{" "}
          <span className="text-quon-text">{t("settings.alwaysRedactDescAlways")}</span>{" "}
          {t("settings.alwaysRedactDescPost")}
        </p>

        <textarea
          aria-label={t("settings.alwaysRedactTitle")}
          value={redactText}
          onChange={(e) => redact.setText(e.target.value)}
          onBlur={redact.flush}
          rows={4}
          spellCheck={false}
          placeholder={t("settings.alwaysRedactPlaceholder")}
          className="mt-3 w-full resize-y rounded-lg border border-quon-border bg-quon-surface-2 px-3 py-2 text-xs text-quon-text placeholder:text-quon-muted/60 focus:border-quon-indigo focus:outline-none"
        />
        <p className="mt-1.5 text-[10px] text-quon-muted">
          {t("settings.savedAutoCaseInsensitive")}
        </p>
        {/* Feedback #53 asked the sharp question: "wie gehst du selber mit den
            Daten bei Immer-schwärzen um?" — these are BY DEFINITION the user's
            most sensitive terms, so the honest mechanics belong right here, not
            in a doc nobody reads while doubting. */}
        <p className="mt-2 text-[10px] leading-snug text-quon-muted">
          {t("settings.redactListsHonesty")}{" "}
          <Link to="/trust" className="font-semibold text-quon-indigo hover:text-quon-indigo-hover">
            {t("settings.redactListsHonestyLink")}
          </Link>
        </p>
      </section>

      {/* Never redact (allow-list) */}
      <section className="rounded-xl border border-quon-border bg-quon-surface p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-quon-green/20 text-quon-green">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-quon-text">
              {t("settings.neverRedactTitle")}
            </div>
            <div className="text-[10px] text-quon-muted">
              {neverCount > 0
                ? plural(neverCount, {
                    one: "settings.termCountOne",
                    other: "settings.termCountOther",
                  })
                : t("settings.nothingYet")}
            </div>
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-quon-muted">
          {t("settings.neverRedactDescPre")}{" "}
          <span className="text-quon-text">{t("settings.neverRedactDescLooks")}</span>{" "}
          {t("settings.neverRedactDescMid1")}{" "}
          <span className="text-quon-text">{t("settings.neverRedactDescExample")}</span>
          {t("settings.neverRedactDescMid2")}{" "}
          <span className="text-quon-text">{t("settings.neverRedactDescNever")}</span>{" "}
          {t("settings.neverRedactDescPost")}
        </p>

        <textarea
          aria-label={t("settings.neverRedactTitle")}
          value={neverText}
          onChange={(e) => never.setText(e.target.value)}
          onBlur={never.flush}
          rows={3}
          spellCheck={false}
          placeholder={t("settings.neverRedactPlaceholder")}
          className="mt-3 w-full resize-y rounded-lg border border-quon-border bg-quon-surface-2 px-3 py-2 text-xs text-quon-text placeholder:text-quon-muted/60 focus:border-quon-indigo focus:outline-none"
        />
        <p className="mt-1.5 text-[10px] text-quon-muted">
          {t("settings.neverRedactHelperPre")}{" "}
          <span className="text-quon-text">{t("settings.neverRedactHelperDo")}</span>{" "}
          {t("settings.neverRedactHelperPost")}
        </p>
      </section>
    </div>
  );
}
