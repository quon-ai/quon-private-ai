/**
 * "Prüfen & schwärzen" on a STAGED chat attachment: before a document
 * leaves the device, the user can open it in the real viewer - rendered PDF
 * pages, the detection preview, select-to-redact - from the composer chip, in
 * Filter mode as well as Review mode.
 *
 * Two kinds of source, decided here so ScreenChat and the viewer agree:
 *
 * - **library** - the attachment is one Documents-library item. The viewer
 *   opens the DocItem itself, and a redaction made there is DURABLE
 *   (`DocItem.redactTerms`, enforced on every future send of that document).
 * - **ad-hoc** - everything else: a fresh upload (no DocItem exists yet), a
 *   Paperless pull (never stored in QUON), a combined multi-document
 *   attachment. The viewer opens the staged text (+ the file's bytes when we
 *   kept them), and a redaction made there is PER-SEND: it rides into this
 *   message's `always_redact` and is verified by scrubText like every other
 *   enforced term - but it is not remembered anywhere. The copy says so.
 *
 * A combined library attachment is deliberately ad-hoc: the button then says
 * "for this message", and saving a term durably onto documents behind a
 * button that promises less would be the dishonest direction.
 */

import { shouldStoreOriginal } from "./documents/originalStore";

export interface StagedAttachmentLike {
  name: string;
  text: string;
  mime?: string;
  bytes?: Uint8Array;
  combined?: boolean;
  source?: "paperless";
  docIds?: string[];
  redactTerms?: string[];
}

export type PreviewSource =
  | { kind: "library"; docId: string }
  | {
      kind: "adhoc";
      filename: string;
      mime: string;
      text: string;
      bytes?: Uint8Array;
      redactTerms: string[];
    };

export type AdhocPreview = Extract<PreviewSource, { kind: "adhoc" }>;

/** The ad-hoc shape of any staged attachment - also the fallback when a
 *  library item vanished under the chip (preview the staged text, never nothing). */
export function adhocSourceFor(a: StagedAttachmentLike): AdhocPreview {
  return {
    kind: "adhoc",
    filename: a.name,
    mime: a.mime ?? "text/plain",
    text: a.text,
    bytes: a.bytes,
    redactTerms: a.redactTerms ?? [],
  };
}

/** Which viewer source a staged attachment opens as (see module doc). */
export function previewSourceFor(a: StagedAttachmentLike): PreviewSource {
  if (a.docIds?.length === 1 && !a.combined) return { kind: "library", docId: a.docIds[0] };
  return adhocSourceFor(a);
}

/** Whether a fresh upload's bytes are worth carrying on the staged attachment:
 *  only formats the viewer renders from bytes (PDF/DOCX/HTML/image), under the
 *  same cap the library uses. Text and Markdown render from the text itself. */
export function keepUploadBytes(mime: string, filename: string, size: number): boolean {
  return shouldStoreOriginal(mime, filename, size);
}

/** Case-insensitive, order-preserving union of enforced redaction terms. */
export function mergeRedactTerms(...lists: readonly (readonly string[])[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const raw of list) {
      const t = raw.trim();
      const k = t.toLowerCase();
      if (!t || seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}
