/**
 * Client-side mirror of the backend's redaction span matcher, plus the check that
 * turns "we asked for this to be redacted" into a provable fact.
 *
 * Why a mirror exists at all: a hand-redaction is enforced by sending the value
 * in `always_redact`, and the BACKEND decides where it matches
 * (`scrubber.find_spans`). If the client's idea of "this value occurs here"
 * disagrees with the backend's, the product either promises a redaction that
 * never happens (fail-open — the whole point of the feature lost) or blocks a
 * send that would have been fine. So the two implementations are pinned together
 * by a shared fixture generated FROM the backend:
 * `tests/fixtures/find-spans-cases.json`, asserted by
 * `src/lib/redactSpans.test.ts` and `tests/test_find_spans_parity.py`.
 *
 * Two divergences that would otherwise be silent, both handled below:
 *
 *  - **`\w` is not the same in both languages.** Python's `\w` under `re.UNICODE`
 *    matches `ä ö ü ß é`; JavaScript's `\w` is ASCII-only. Using `\w` here would
 *    make the client believe `Öl` occurs inside `Größe` when the backend says it
 *    does not — i.e. the client would declare a value redactable that the backend
 *    then leaves in place. `[\p{L}\p{N}_]` with the `u` flag is the mirror of
 *    Python's semantics (which also drive `str.isalnum()`).
 *
 *  - **Lookbehind is avoided on purpose.** The backend uses `(?<!\w)`; the
 *    boundary is checked here by index inspection instead. Lookbehind works in
 *    current WebKit, but this is the one gate whose behaviour must not depend on
 *    a Safari version — a regex that fails to compile would throw inside the
 *    verifier and turn every send into a failure.
 *
 * Also deliberate: matching uses a case-insensitive RegExp rather than
 * `toLowerCase()` on both sides. Lowercasing can CHANGE STRING LENGTH for some
 * characters (`"İ".toLowerCase().length === 2`), which would silently shift every
 * offset after it.
 */

/** Mirrors Python's Unicode `\w` / `str.isalnum() or "_"`. */
const WORDISH = /[\p{L}\p{N}_]/u;

/** Escapes only what is safe to escape under the `u` flag — `\-` and friends are
 *  invalid identity escapes in Unicode mode and would throw. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Mirrors `scrubber._normalize_value`: trim, then strip ONE layer of wrapping
 *  quotes (the model sometimes adds them), then trim again. */
export function normalizeRedactValue(value: string): string {
  let v = value.trim();
  if (v.length >= 2 && `"'\``.includes(v[0]) && v[v.length - 1] === v[0]) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

/**
 * Every case-insensitive occurrence of `value` in `text`, as `[start, end)`.
 *
 * A word boundary is required only where the value itself begins or ends with a
 * word character — so `+49 30 1234`, IBANs and emails still match mid-sentence,
 * while `Marco` does not match inside `marco_abenteuer`.
 */
export function findSpansJs(text: string, value: string): Array<[number, number]> {
  const v = normalizeRedactValue(value);
  if (!v) return [];

  const needBoundaryBefore = WORDISH.test(v[0]);
  const needBoundaryAfter = WORDISH.test(v[v.length - 1]);

  let re: RegExp;
  try {
    re = new RegExp(escapeRegExp(v), "giu");
  } catch {
    return []; // mirrors the backend's `except re.error: return []`
  }

  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (needBoundaryBefore && start > 0 && WORDISH.test(text[start - 1])) continue;
    if (needBoundaryAfter && end < text.length && WORDISH.test(text[end])) continue;
    spans.push([start, end]);
  }
  return spans;
}

/** True when the value would match somewhere in the text — i.e. asking for it to
 *  be redacted will actually do something. Used to refuse a hand-redaction that
 *  would draw a mark and redact nothing. */
export function occursIn(text: string, value: string): boolean {
  return findSpansJs(text, value).length > 0;
}

/**
 * The fail-closed check. Returns the first term that is STILL present in the
 * scrubbed text, or null when every term was honoured.
 *
 * This is what makes a hand-redaction a guarantee rather than a hope: the client
 * asked for these values to be removed, so if one survived, the send must not
 * proceed. Callers throw on a non-null result; every existing scrub call site
 * already fails closed on a throw.
 */
export function verifyRedactions(scrubbed: string, terms: readonly string[]): string | null {
  for (const term of terms) {
    if (!normalizeRedactValue(term)) continue;
    if (findSpansJs(scrubbed, term).length > 0) return term;
  }
  return null;
}

/* Note on placeholders, because it looks like a missing guard: a placeholder is
 * the PROOF a value was redacted, but it is also text — so could a term like "1"
 * or "Person" match inside "[PERSON_1]" and fail a send that was correct?
 *
 * No, and the word-boundary rule is why. "Person" inside "[PERSON_1]" is followed
 * by "_", which IS a word character, so the trailing-boundary requirement rejects
 * it; "1" is preceded by "_" and rejected the same way. A term that spans a whole
 * placeholder ("[PERSON_1]") cannot arise either — `manualRedact` refuses any
 * value containing "[" or "]".
 *
 * This was originally "fixed" by stripping placeholders before checking, with a
 * test to match. Deliberately breaking that stripping showed the test still
 * passed: the guard was never doing anything, because the boundary rule already
 * held. Removed rather than kept as decoration — an unexercised branch in the
 * gate that decides whether a send is allowed is worse than no branch. The
 * property is asserted directly in redactSpans.test.ts instead.
 */
