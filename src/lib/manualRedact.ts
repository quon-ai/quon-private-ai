/**
 * Matching for "Auswahl schwärzen" (manual redaction in Review mode).
 *
 * Kept out of ScreenChat so the matching can be tested on its own. A silent
 * null is the one failure mode a user cannot tell from a broken button, so
 * every way this can fail has a name and the UI can say what to do instead of
 * doing nothing.
 *
 * The returned `value` must be a literal substring of `sentText`: the review
 * pipeline applies manual items with split/join over the outgoing text
 * (ReviewPanel.buildSentText), so a value that isn't literally present would
 * redact nothing. That is why the whitespace-tolerant path returns the MATCHED
 * substring from sentText, never the raw selection.
 */

import { findSpansJs } from "./redactSpans";

export type ManualRedactError =
  /** No (or only-whitespace) selection at click time. */
  | "empty"
  /** The selection touches a [PLACEHOLDER] - already redacted, or mixed. */
  | "placeholder"
  /** The selected text does not occur in the outgoing text (wrong panel, or
   *  formatting differences beyond whitespace). */
  | "not-found";

export type ManualRedactMatch = { value: string } | { error: ManualRedactError };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findManualSelection(
  rawSelection: string | undefined,
  sentText: string,
): ManualRedactMatch {
  const sel = (rawSelection ?? "").trim();
  if (!sel) return { error: "empty" };
  // Placeholder tokens are the one thing that must never become a "value":
  // buildSentText would then substitute inside placeholders. Also the honest
  // answer - that text is already being redacted.
  if (sel.includes("[") || sel.includes("]")) return { error: "placeholder" };
  if (sentText.includes(sel)) return { value: sel };
  // Whitespace-tolerant retry: selecting across a rendered line break copies
  // "\n" where the outgoing text has " " (or the reverse). Match the words with
  // any whitespace between them and redact what the TEXT actually contains.
  const pattern = sel.split(/\s+/).map(escapeRegExp).join("\\s+");
  const m = sentText.match(new RegExp(pattern));
  if (m && m[0].trim()) return { value: m[0] };
  return { error: "not-found" };
}

/* --- Durable redaction ------------------------------------------------------ */

export type DurableRedactError =
  | ManualRedactError
  /** The value is on the user's never-redact allow-list. Adding it to both lists
   *  is a contradiction; the UI offers to remove it from the allow-list instead. */
  | "never-redact"
  /** The value only occurs inside longer words here (e.g. "partner" in
   *  "Vertragspartnerin"). The backend requires word boundaries, so remembering
   *  it would draw a mark that redacts nothing - refused, never silent. */
  | "inside-word";

export type DurableRedactMatch =
  { value: string; occurrences: number } | { error: DurableRedactError };

/**
 * The single gate for making a redaction DURABLE (-> the enforced always-redact
 * list), from any surface: the chat Review panel, the document viewer's text
 * view, a rendered PDF's selection.
 *
 * Stricter than `findManualSelection` on purpose. A per-send manual item is
 * applied by literal split/join over text we hold, so "occurs as a substring" is
 * enough. A durable term is enforced by the BACKEND's word-boundary matcher
 * (`find_spans`) against every future send - so the value must be something that
 * matcher will actually hit, and the caller must know how many places it hits
 * TODAY so the user confirms the real blast radius, not a guess.
 */
export function resolveDurableRedaction(
  rawSelection: string | undefined,
  documentText: string,
  neverRedact: readonly string[],
): DurableRedactMatch {
  const found = findManualSelection(rawSelection, documentText);
  if ("error" in found) return found;

  const conflict = neverRedact.some(
    (t) => t.trim().toLowerCase() === found.value.trim().toLowerCase(),
  );
  if (conflict) return { error: "never-redact" };

  const occurrences = findSpansJs(documentText, found.value).length;
  // Present as a substring but never on a word boundary - the backend would
  // redact nothing. (The n-th occurrence being mid-word is fine; some occurrence
  // must be matchable.)
  if (occurrences === 0) return { error: "inside-word" };

  return { value: found.value, occurrences };
}
