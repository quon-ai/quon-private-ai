/**
 * The CSRF token, readable in both shells.
 *
 * The server issues `quon_csrf` as a non-httpOnly cookie and expects it echoed
 * in `X-QUON-CSRF` on unsafe requests (double-submit, bound to the session).
 * In the browser that is a one-liner: read `document.cookie`.
 *
 * The native shell breaks that assumption. Requests go through the Tauri host,
 * whose cookie jar lives in Rust — the session cookie is stored and re-sent
 * correctly, but it is invisible to `document.cookie`, so the token would be
 * empty and every write would 403. Found while fixing the macOS app's first
 * connection (2026-08-05): the same jar that makes native auth work at all is
 * what hides the token.
 *
 * The fix keeps the server untouched: the Tauri fetch deliberately exposes
 * `set-cookie` on the response (browsers treat it as a forbidden response
 * header, the plugin re-attaches it), so we capture the token from the
 * response that sets it. The double-submit property is unchanged — the token
 * is still a per-session secret that must be echoed back and is still verified
 * server-side.
 */

import { isNative } from "@/lib/platform";

const COOKIE = "quon_csrf";
/**
 * Where the captured token survives an app restart.
 *
 * The server sets `quon_csrf` only when it issues a session (login / verify /
 * recover). A browser keeps that cookie itself, so a returning tab still has
 * the token. In the native shell the SESSION cookie is persisted by the host's
 * jar while a token held only in memory is not — so after a restart the app is
 * authenticated but every write would 403. Storing it here restores the
 * browser's own property. It is not a secret in the browser either (the server
 * deliberately sets it non-httpOnly so JS can echo it); its security value is
 * that an attacker on another origin cannot READ it, which holds equally in
 * localStorage.
 */
const STORE_KEY = "quon_csrf_native";

/** Captured from `set-cookie` in the native shell. Never used on the web. */
let nativeToken = "";

/**
 * Remember the CSRF token if this response set one. A no-op on the web, where
 * `document.cookie` is authoritative and always fresher than anything we could
 * cache.
 */
export function captureCsrf(res: Response): void {
  if (!isNative()) return;
  let raw: string | null = null;
  try {
    // getSetCookie() splits multiple headers correctly where available; the
    // plugin supports it, but a plain get() is a fine fallback.
    const all = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
    raw = all?.length ? all.join("\n") : res.headers.get("set-cookie");
  } catch {
    return;
  }
  if (!raw) return;
  // Several cookies may share one joined header; match ours specifically.
  const m = new RegExp(`(?:^|[,;\\s])${COOKIE}=([^;,\\s]+)`).exec(raw);
  if (m?.[1]) {
    nativeToken = decodeURIComponent(m[1]);
    try {
      globalThis.localStorage?.setItem(STORE_KEY, nativeToken);
    } catch {
      /* private mode / storage full — the in-memory copy still serves this run */
    }
  }
}

/** The token to echo in `X-QUON-CSRF`, or "" when there is no session yet. */
export function csrfToken(): string {
  if (typeof document !== "undefined") {
    const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
    if (m) return decodeURIComponent(m[1]);
  }
  if (!nativeToken && isNative()) {
    try {
      nativeToken = globalThis.localStorage?.getItem(STORE_KEY) ?? "";
    } catch {
      /* ignore */
    }
  }
  return nativeToken;
}

/** Drop the captured token (sign-out). The next sign-in captures a fresh one. */
export function clearCsrf(): void {
  nativeToken = "";
  try {
    globalThis.localStorage?.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}
