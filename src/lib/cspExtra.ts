/**
 * User-chosen extra CSP `connect-src` origin (the "my own Paperless on the
 * hosted app" feature, user decision 2026-07-30).
 *
 * A hosted user's private network connector (Paperless) lives on an origin the
 * operator cannot know in advance, so the per-request CSP (src/server.ts) can't
 * allowlist it statically. The client stores the connector's ORIGIN in a plain
 * cookie; the SSR entry validates it against a strict shape and appends exactly
 * ONE origin to connect-src.
 *
 * Costs, stated honestly (threat model):
 * - the frontend server (operator) learns the user's connector hostname — the
 *   cookie rides every request. The connector itself stays browser-direct; no
 *   content ever passes the server.
 * - for an attacker who ALREADY has XSS in the session, connect-src gains one
 *   user-chosen exfiltration origin. The shape rules below keep it a single
 *   https host (or loopback), never a wildcard, never a path.
 *
 * Isomorphic + dependency-free: the validator runs in the Node SSR entry, the
 * setter in the browser; unit tests cover the shape rules.
 */

export const CSP_EXTRA_COOKIE = "quon_csp_extra";

/** Exactly one origin: https://host[:port], or plain-http LOOPBACK (a local
 *  Paperless next to the browser — mixed-content-exempt, so CSP is the only
 *  gate). Lowercase host chars, no path/query/fragment, no wildcard, bounded
 *  length. Anything else → null (the CSP simply stays unchanged). */
export function isAllowedCspExtraOrigin(value: string): boolean {
  if (value.length === 0 || value.length > 100) return false;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(value)) return true;
  return /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/.test(
    value,
  );
}

/** The validated extra origin from a Cookie header, or null. Malformed values
 *  are dropped silently — a bad cookie must never break page delivery. */
export function cspExtraFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${CSP_EXTRA_COOKIE}=([^;]*)`));
  if (!match) return null;
  let raw: string;
  try {
    raw = decodeURIComponent(match[1]).trim().toLowerCase();
  } catch {
    return null;
  }
  return isAllowedCspExtraOrigin(raw) ? raw : null;
}

/** Browser-side: persist (or clear, with null) the extra origin. Plain cookie
 *  on purpose — the SSR entry must read it BEFORE any app code runs. */
export function setCspExtraCookie(origin: string | null): void {
  if (typeof document === "undefined") return;
  if (origin && !isAllowedCspExtraOrigin(origin.toLowerCase())) return;
  const secure =
    typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = origin
    ? `${CSP_EXTRA_COOKIE}=${encodeURIComponent(origin.toLowerCase())}; path=/; max-age=31536000; SameSite=Lax${secure}`
    : `${CSP_EXTRA_COOKIE}=; path=/; max-age=0; SameSite=Lax${secure}`;
}
