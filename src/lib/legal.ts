/**
 * Single source of truth for the legal agreement the user accepts at sign-up.
 *
 * `TERMS_VERSION` is sent to the server on /auth/register and stored alongside
 * the acceptance timestamp (users.terms_version / terms_accepted_at, migration
 * 0008) so we can later prove *which* wording a given account agreed to. Bump it
 * whenever the substance of the Nutzungsvereinbarung (src/routes/terms.tsx)
 * changes — existing accounts keep the version they accepted; only new sign-ups
 * (or a future re-consent flow) record the new one.
 *
 * The date form doubles as the human "Stand" shown on the terms page.
 */
export const TERMS_VERSION = "2026-07-09";

/** Human-readable effective date shown on the terms page ("Stand: …"). */
export const TERMS_EFFECTIVE_DATE = "9. Juli 2026";

/** Marks the document as a pre-launch draft (a lawyer review is still pending). */
export const TERMS_IS_DRAFT = true;
