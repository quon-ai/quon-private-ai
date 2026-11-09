/** Split extracted document text into overlapping chunks for embedding.
 *
 * A faithful TS port of the backend `documents/chunker.py`: split on paragraph
 * breaks first, further split oversize paragraphs on sentence boundaries, then
 * accumulate segments into chunks up to `maxChars` with a small overlap so a
 * sentence at a boundary isn't lost. Pure, no dependencies. */

export interface TextChunk {
  text: string;
  index: number;
}

const DEFAULT_MAX_CHARS = 512;
const DEFAULT_OVERLAP = 64;

/** Hard-split a string with no usable boundaries into <= maxChars pieces. */
function hardSplit(s: string, maxChars: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += maxChars) out.push(s.slice(i, i + maxChars));
  return out;
}

export function chunkText(
  input: string,
  maxChars: number = DEFAULT_MAX_CHARS,
  overlap: number = DEFAULT_OVERLAP,
): TextChunk[] {
  const text = input.trim();
  if (!text) return [];

  // 1. Paragraph segments.
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  // 2. Split any paragraph that is still too large on sentence boundaries.
  const segments: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      segments.push(para);
      continue;
    }
    // Sentence-split, then hard-split any sentence still over the limit. Tables
    // and data dumps often have no sentence breaks; without this a single
    // "sentence" could become a chunk far larger than maxChars, producing a huge
    // token sequence that blows the embedder's memory.
    const sentences = para
      .split(/(?<=[.!?])\s+/)
      .flatMap((s) => (s.length <= maxChars ? [s] : hardSplit(s, maxChars)));
    let buf = "";
    for (const sentence of sentences) {
      if (buf && buf.length + sentence.length + 1 > maxChars) {
        segments.push(buf.trim());
        buf = sentence;
      } else {
        buf = buf ? `${buf} ${sentence}` : sentence;
      }
    }
    if (buf.trim()) segments.push(buf.trim());
  }

  // 3. Accumulate segments into chunks with tail overlap.
  const chunks: TextChunk[] = [];
  let current = "";
  const flush = (): void => {
    const t = current.trim();
    if (t) chunks.push({ text: t, index: chunks.length });
  };

  for (const seg of segments) {
    if (current && current.length + seg.length + 1 > maxChars) {
      flush();
      const tail = overlap > 0 ? current.slice(-overlap).trim() : "";
      current = tail ? `${tail} ${seg}` : seg;
    } else {
      current = current ? `${current} ${seg}` : seg;
    }
  }
  if (current.trim()) flush();

  return chunks;
}
