/** Combine several documents into one attachment text under a shared character
 *  budget (the scrubber's max_text_length), so "attach all documents" can send a
 *  whole project's files in a single message.
 *
 *  Budget is distributed fairly ("water-filling"): short documents keep their full
 *  text, and the space they don't need is redistributed to the longer ones — so a
 *  two-line note never steals room from the 30-page contract next to it.
 */

export interface NamedDoc {
  name: string;
  text: string;
}

const header = (name: string) => `=== Document: ${name} ===\n`;
const SEPARATOR = "\n\n";

export function combineDocuments(
  docs: NamedDoc[],
  budget: number,
): { text: string; truncated: boolean } {
  const usable = docs
    .map((d) => ({ name: d.name, text: d.text.trim() }))
    .filter((d) => d.text.length > 0);
  if (usable.length === 0) return { text: "", truncated: false };

  const overhead =
    usable.reduce((sum, d) => sum + header(d.name).length, 0) +
    SEPARATOR.length * (usable.length - 1);
  let remaining = Math.max(0, budget - overhead);

  // Ascending by length: docs that fit under the fair share release their surplus
  // to the docs still waiting.
  const order = usable.map((d, i) => ({ ...d, i })).sort((a, b) => a.text.length - b.text.length);
  const alloc = new Array<number>(usable.length).fill(0);
  let left = order.length;
  for (const d of order) {
    const share = Math.floor(remaining / left);
    const take = Math.min(d.text.length, share);
    alloc[d.i] = take;
    remaining -= take;
    left -= 1;
  }

  const truncated = usable.some((d, i) => alloc[i] < d.text.length);
  const text = usable.map((d, i) => header(d.name) + d.text.slice(0, alloc[i])).join(SEPARATOR);
  return { text, truncated };
}
