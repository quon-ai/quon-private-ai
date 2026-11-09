/**
 * Password strength policy - enforced CLIENT-SIDE by design.
 *
 * QUON is zero-knowledge: the server only ever receives the derived `authToken`,
 * never the password, so it cannot check strength. This shared helper is used at
 * every place a password is set (register, recovery reset, change-password) so the
 * rule is identical. Deliberately dependency-free (no zxcvbn) to stay light in the
 * bundle - the real protection is length + the Argon2id KDF; this just blocks the
 * worst, most-guessable choices.
 */

import { tr } from "./i18n/i18n";

export const MIN_PASSWORD_LENGTH = 12;

// A small denylist of the most common/guessable passwords (normalized lowercase).
// Not exhaustive - it only stops the obvious ones.
const COMMON = new Set([
  "password",
  "passwort",
  "password1",
  "passwort1",
  "123456",
  "1234567",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty",
  "qwertz",
  "qwerty123",
  "qwertyuiop",
  "111111",
  "000000",
  "iloveyou",
  "admin",
  "welcome",
  "letmein",
  "monkey",
  "dragon",
  "abc123",
  "changeme",
  "secret",
  "quon",
  "quonpassword",
]);

export interface PasswordCheck {
  ok: boolean;
  message?: string;
}

/** Validate a candidate password against the shared policy. */
export function checkPassword(pw: string): PasswordCheck {
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: tr("common.pwTooShort", { min: MIN_PASSWORD_LENGTH }) };
  }
  const norm = pw.trim().toLowerCase();
  if (COMMON.has(norm)) {
    return { ok: false, message: tr("common.pwTooCommon") };
  }
  if (/^(.)\1+$/.test(pw)) {
    return { ok: false, message: tr("common.pwRepeating") };
  }
  return { ok: true };
}
