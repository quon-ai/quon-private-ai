/**
 * Pure helpers for the scrub-only demo page (/demo). The API call lives in
 * quonApi.ts next to the other requests; this file holds what a unit test can
 * pin: splitting a scrubbed text into plain and placeholder segments, and the
 * example texts. Every value in the examples is synthetic (example.org, the
 * published test IBAN, placeholder names); nothing here is a real person.
 */
import { PLACEHOLDER_RE } from "./quonApi";

export type Segment =
  { kind: "text"; text: string } | { kind: "placeholder"; text: string; type: string };

/** "[EMAIL_1]" -> "EMAIL"; anything else -> "UNKNOWN" (styled neutrally). */
export function placeholderType(placeholder: string): string {
  const m = /^\[([A-Z]+)_\d+\]$/.exec(placeholder);
  return m ? m[1] : "UNKNOWN";
}

/** Splits a scrubbed text so the page can colour each placeholder by type.
 *  Adjacent plain text stays one segment; an empty input yields no segments. */
export function splitByPlaceholders(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    out.push({ kind: "placeholder", text: m[0], type: placeholderType(m[0]) });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

export const DEMO_SAMPLE: Record<"de" | "en", string> = {
  de: "Hallo Frau Beispiel, bitte überweisen Sie die 1.250,00 € bis zum 15.11.2026 auf die IBAN DE89 3704 0044 0532 0130 00. Rückfragen gern an jana.beispiel@example.org oder +49 30 1234567. Viele Grüße, Max Mustermann",
  en: "Hi Alex, please wire the USD 1,250.00 to IBAN DE89 3704 0044 0532 0130 00 by 15 November 2026. Questions: jane.sample@example.org or +1 415 555 0132. Thanks, Max Example",
};
