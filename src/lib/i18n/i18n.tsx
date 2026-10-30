/**
 * Tiny, dependency-free i18n for QUON (DE/EN). A typed catalog lookup with
 * `{param}` interpolation and a one/other plural helper — no ICU, no library,
 * consistent with the codebase's hand-rolled utilities. Two languages only.
 *
 * The active language is provided by LangProvider, seeded server-side from the
 * `quon_lang` cookie (src/server.ts → router → __root) so SSR and the first
 * client paint agree. `setLang` switches at runtime (Settings / registration)
 * and persists via langPref.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { getLangPref, setLangPref, type Lang } from "@/lib/langPref";
import { DE, EN, type MessageKey } from "./catalog";

type Params = Record<string, string | number>;

const CATALOGS: Record<Lang, Record<MessageKey, string>> = { en: EN, de: DE };

function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    k in params ? String(params[k]) : `{${k}}`,
  );
}

/** Look up + interpolate. Falls back to the EN string, then the raw key, so a
 *  missing translation is visible rather than blank (typing prevents this at
 *  build time, but runtime data-driven keys stay safe). */
export function translate(lang: Lang, key: MessageKey, params?: Params): string {
  const template = CATALOGS[lang][key] ?? EN[key] ?? key;
  return interpolate(template, params);
}

export interface I18n {
  lang: Lang;
  /** Translate a key with optional `{param}` interpolation. */
  t: (key: MessageKey, params?: Params) => string;
  /** one/other plural: picks `one` when count === 1, else `other`; both keys get
   *  `{count}` injected automatically alongside any extra params. */
  plural: (count: number, keys: { one: MessageKey; other: MessageKey }, params?: Params) => string;
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18n | null>(null);

// Client-only bridge so non-React code (authStore, when it adopts the account's
// stored language on login/me) can switch the live UI language. Registered by
// the mounted provider; never invoked during SSR (no login happens there), so
// module-level state here is safe — it's only ever touched in the browser.
let liveSetLang: ((lang: Lang) => void) | null = null;

/** Adopt a language from outside React (e.g. authStore after login/me). Persists
 *  and, if a provider is mounted, switches the live UI immediately. */
export function adoptLang(lang: Lang): void {
  setLangPref(lang);
  liveSetLang?.(lang);
}

export function LangProvider({
  initialLang,
  children,
}: {
  initialLang: Lang;
  children: ReactNode;
}) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((next: Lang) => {
    setLangPref(next); // persist (cookie + localStorage) before the re-render
    setLangState(next);
    if (typeof document !== "undefined") document.documentElement.lang = next;
  }, []);

  // Register the live switcher for non-React callers while mounted.
  useEffect(() => {
    liveSetLang = setLang;
    return () => {
      if (liveSetLang === setLang) liveSetLang = null;
    };
  }, [setLang]);

  const value = useMemo<I18n>(
    () => ({
      lang,
      t: (key, params) => translate(lang, key, params),
      plural: (count, keys, params) =>
        translate(lang, count === 1 ? keys.one : keys.other, { count, ...params }),
      setLang,
    }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Access translation + language controls. Throws if used outside LangProvider
 *  so a missing provider surfaces immediately in dev. */
export function useT(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used within <LangProvider>");
  return ctx;
}

/** The language to seed the provider with on the CLIENT (before any provider
 *  exists). SSR passes its cookie-derived value explicitly instead. */
export function clientInitialLang(): Lang {
  return getLangPref();
}

/** Translate outside React, using the device's current language. For module-
 *  level code that has no hook access (validation helpers, background runners,
 *  the OCR engine). Reads the same pref the provider does, so it tracks the live
 *  language on the client; on the server it resolves to the default. */
export function tr(key: MessageKey, params?: Params): string {
  return translate(getLangPref(), key, params);
}

/** Isomorphic initial language for the root render: on the SERVER, the
 *  cookie-derived value handed over by src/server.ts (globalThis handshake,
 *  same pattern as the CSP nonce); on the CLIENT, the device pref (which reads
 *  the same cookie), so SSR and hydration agree — no flash, no mismatch. */
export function resolveInitialLang(): Lang {
  const ssr = (globalThis as { __quonLang?: () => Lang | undefined }).__quonLang?.();
  return ssr ?? clientInitialLang();
}
