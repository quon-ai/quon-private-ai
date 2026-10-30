/**
 * UI-language preference — device-level, readable BEFORE unlock.
 *
 * PLAIN localStorage + a mirrored cookie (precedent: bioEnrollment.ts /
 * quon_active_user). It holds no secrets, and the auth/unlock screens render
 * before the Master Key exists, so it cannot live in the encrypted quonStore.
 *
 * Two stores on purpose:
 *  - localStorage `quon_lang_v1` — the client's own read.
 *  - cookie `quon_lang` — so the SSR pass (src/server.ts) can render the correct
 *    <html lang> and initial catalog on the very first paint (no hydration flash).
 *
 * The account is the ultimate source of truth once known (MeResponse.ui_language,
 * adopted on login/me); this device pref is what drives everything before that
 * and what a logged-out visitor / the registration form use.
 */

export type Lang = "de" | "en";

export const DEFAULT_LANG: Lang = "de"; // Standardsprache Deutsch (per product decision)

const LS_KEY = "quon_lang_v1";
const COOKIE = "quon_lang";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // ~1 year

export function isLang(v: unknown): v is Lang {
  return v === "de" || v === "en";
}

/** Parse a `quon_lang` value out of a raw Cookie header (used SSR-side). */
export function langFromCookieHeader(header: string | null | undefined): Lang | null {
  if (!header) return null;
  const m = header.match(/(?:^|;\s*)quon_lang=([^;]+)/);
  const v = m ? decodeURIComponent(m[1]) : null;
  return isLang(v) ? v : null;
}

function readCookie(): Lang | null {
  if (typeof document === "undefined") return null;
  return langFromCookieHeader(document.cookie);
}

function readLocalStorage(): Lang | null {
  try {
    const v = localStorage.getItem(LS_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

/** The device's effective UI language: an explicit choice (cookie → localStorage)
 *  or the product default (German). The browser locale is deliberately NOT used —
 *  "Standardsprache Deutsch" means German by default until the user chooses
 *  otherwise (at registration or in Settings), not auto-detected from the browser. */
export function getLangPref(): Lang {
  return readCookie() ?? readLocalStorage() ?? DEFAULT_LANG;
}

/** Whether the user has explicitly chosen a language on this device (vs. just
 *  falling back to the browser/default). Lets the registration form default to
 *  German without overwriting a real prior choice. */
export function hasExplicitLangPref(): boolean {
  return readCookie() != null || readLocalStorage() != null;
}

/** Persist a language on this device (both stores). Safe under private mode. */
export function setLangPref(lang: Lang): void {
  try {
    localStorage.setItem(LS_KEY, lang);
  } catch {
    /* private mode / quota */
  }
  try {
    if (typeof document !== "undefined") {
      const secure = location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${COOKIE}=${lang}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
    }
  } catch {
    /* ignore */
  }
}
