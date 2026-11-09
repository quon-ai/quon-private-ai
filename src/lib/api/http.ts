/**
 * Shared fetch helper for the authenticated QUON API.
 *
 * Sends the session cookie (`credentials: "include"`) and, on unsafe methods,
 * the CSRF token from the readable `quon_csrf` cookie in the `X-QUON-CSRF`
 * header (double-submit, validated server-side against the session).
 */

import { QUON_API_URL } from "@/lib/quonApi";
import { captureCsrf, csrfToken } from "@/lib/api/csrf";
import { http } from "@/lib/platform";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

/** Default request deadline. Without one, a stalled socket leaves the promise
 *  pending forever: the document viewer's originals fetch (syncApi.blob ->
 *  here) can hang on a dead connection and show a frozen spinner for minutes.
 *  A timeout turns "hangs silently" into "fails loudly with a Retry". Callers
 *  moving big payloads (originals-chunk push on a slow uplink) pass a larger
 *  value. */
const DEFAULT_TIMEOUT_MS = 30_000;

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (method !== "GET" && method !== "HEAD") headers["X-QUON-CSRF"] = csrfToken();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await http().fetch(`${QUON_API_URL}${path}`, {
      ...init,
      method,
      headers,
      signal: controller.signal,
      credentials: "include",
    });
  } catch (err) {
    // An abort reads terribly as "AbortError: signal is aborted without reason"
    // - name the actual event so error surfaces can say something true.
    if (controller.signal.aborted)
      throw new ApiError(0, `${path} timed out after ${timeoutMs / 1000}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
  captureCsrf(res);

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const detail =
      body && typeof body === "object" && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : typeof body === "string" && body
          ? body
          : res.statusText;
    throw new ApiError(res.status, detail);
  }
  return body as T;
}
