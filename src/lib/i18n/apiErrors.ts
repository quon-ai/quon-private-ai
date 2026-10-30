/**
 * Localize backend-originated errors. The server returns English `detail`
 * strings (ApiError.message) and English provider-error strings over the chat
 * stream. We map the known, stable strings to catalog keys; anything unmapped
 * falls through to the raw English text (rare edge cases stay English, by
 * design). Matching is on the trimmed exact string — if a backend message is
 * reworded, update BOTH here and the errors catalog (a unit test guards this).
 */
import { ApiError } from "@/lib/api/http";
import type { MessageKey } from "./catalog";

// Backend detail string (exact) → catalog key.
const DETAIL_TO_KEY: Record<string, MessageKey> = {
  "invalid email or password": "errors.invalidCredentials",
  "email not verified": "errors.emailNotVerified",
  "account suspended": "errors.accountSuspended",
  "Invalid invite code.": "errors.invalidInviteCode",
  "invalid email address": "errors.invalidEmail",
  "invalid or expired token": "errors.invalidOrExpiredToken",
  "malformed token": "errors.malformedToken",
  "could not provision your AI access — please retry": "errors.provisionFailed",
  "email already registered": "errors.emailAlreadyRegistered",
  "current password is incorrect": "errors.currentPasswordIncorrect",
  "password is incorrect": "errors.passwordIncorrect",
  "session expired": "errors.sessionExpired",
  "invalid session": "errors.sessionExpired",
  "not authenticated": "errors.notAuthenticated",
  "account not activated": "errors.notAuthenticated",
  "too many enrolled devices": "errors.tooManyDevices",
  "language must be 'de' or 'en'": "errors.badLanguage",
  "no AI access key for cloud text recognition": "errors.noCloudOcrKey",
  "invalid image encoding": "errors.invalidImage",
  "image too large": "errors.imageTooLarge",
  "unsupported image type — send a JPEG, PNG or WebP": "errors.unsupportedImage",
  "no AI access key for this provider": "errors.noProviderKey",
  "this connection has no API key configured": "errors.connectionNoKey",
  // Own-key verification at save time (openrouter_keycheck.py, #84/#91).
  "That is not an OpenRouter key — an OpenRouter key starts with sk-or-… (openrouter.ai → Keys). A key from OpenAI or Anthropic does not work here.":
    "errors.ownKeyNotOpenRouter",
  "OpenRouter does not know this key — check it at openrouter.ai → Keys.": "errors.ownKeyUnknown",
  "Could not verify the key with OpenRouter right now — try again in a moment.":
    "errors.ownKeyUnverified",
};

// Provider-relay strings (provider.py friendly_provider_error) → catalog key.
// Matched by a distinctive substring so upstream punctuation drift is tolerated.
const PROVIDER_SUBSTRING_TO_KEY: Array<[string, MessageKey]> = [
  ["rate-limiting", "errors.providerRateLimited"],
  ["budget is used up", "errors.providerBudgetExhausted"],
  ["rejected this account's API key", "errors.providerBadKey"],
  ["Could not reach", "errors.providerUnreachable"],
];

/** Map a known backend string to a catalog key, or null if unmapped. */
export function apiErrorKey(message: string): MessageKey | null {
  const trimmed = message.trim();
  if (trimmed in DETAIL_TO_KEY) return DETAIL_TO_KEY[trimmed];
  for (const [needle, key] of PROVIDER_SUBSTRING_TO_KEY) {
    if (trimmed.includes(needle)) return key;
  }
  return null;
}

/** Localize any thrown error for display. `t` comes from useT(). Falls back to
 *  the raw message (English) for unmapped strings, then a generic message. */
export function translateApiError(err: unknown, t: (key: MessageKey) => string): string {
  const raw =
    err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err ?? "");
  const key = apiErrorKey(raw);
  if (key) return t(key);
  return raw || t("errors.generic");
}
