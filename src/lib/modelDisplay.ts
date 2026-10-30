/**
 * Friendly display names for model slugs.
 *
 * The backend catalog labels chat models with their raw provider slug
 * (e.g. "mistralai/mistral-small-3.2-24b-instruct"), which is precise but
 * unfriendly in a picker. `modelDisplay` turns a slug into a human name + a
 * provider tag; the exact slug is still surfaced in a tooltip by the UI, so the
 * precise model is never hidden.
 *
 * The heuristic aims for "good enough for the long tail" and is backed by a
 * small override map for the common bundled models, where an exact spelling
 * matters (e.g. "GPT-4o", "Auto").
 */

export interface ModelDisplay {
  /** Human-friendly model name, e.g. "Mistral Small 3.2". */
  name: string;
  /** Vendor/provider display name, e.g. "Mistral" (may be ""). */
  provider: string;
}

// Vendor slug (the part before the first "/") → display name.
const VENDORS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  mistralai: "Mistral",
  "meta-llama": "Meta",
  meta: "Meta",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  "x-ai": "xAI",
  cohere: "Cohere",
  perplexity: "Perplexity",
  microsoft: "Microsoft",
  nvidia: "NVIDIA",
  amazon: "Amazon",
  nousresearch: "Nous",
  openrouter: "OpenRouter",
};

// Exact-slug name overrides where the heuristic would read awkwardly.
// (openrouter/auto is handled by the dedicated router branch, not here, so it
// gets no provider tag.)
const NAME_OVERRIDES: Record<string, string> = {
  "openai/gpt-4o": "GPT-4o",
  "openai/gpt-4o-mini": "GPT-4o mini",
  "openai/gpt-4.1": "GPT-4.1",
  "openai/gpt-4.1-mini": "GPT-4.1 mini",
};

// Tokens that render as acronyms rather than title-case.
const ACRONYMS = new Set(["GPT", "AI", "LLM", "OCR"]);

// Qualifier words that add noise for a friendly name.
const NOISE = new Set(["instruct", "preview", "latest", "it", "hf", "beta", "exp", "experimental"]);

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** A pure-numeric token that looks like a date stamp (year / month-day / YYYYMMDD). */
function isDateish(tok: string): boolean {
  return /^\d{2}$/.test(tok) || /^\d{4}$/.test(tok) || /^\d{6}$/.test(tok) || /^\d{8}$/.test(tok);
}

/** A parameter-size token like "24b", "70b", "a22b" (MoE active), or "8x7b". */
function isSizeToken(tok: string): boolean {
  return /^a?\d+(\.\d+)?b$/i.test(tok) || /^\d+x\d+b$/i.test(tok);
}

function titleizeToken(tok: string): string {
  if (!tok) return tok;
  if (/^\d/.test(tok)) return tok; // starts with a digit: "4o", "3.2" — keep exact
  if (/^v\d/i.test(tok)) return tok.toLowerCase(); // version tag: "v3"
  const up = tok.toUpperCase();
  if (ACRONYMS.has(up)) return up;
  return capitalize(tok); // "qwen3" → "Qwen3", "flash" → "Flash"
}

function prettifyModelPart(part: string, vendorSlug: string): string {
  const tokens = part.split("-");
  const kept = tokens.filter(
    (t) => !isDateish(t) && !isSizeToken(t) && !NOISE.has(t.toLowerCase()),
  );
  // Never return empty — fall back to the raw tokens if the filters ate them all.
  const source = kept.length ? kept : tokens;
  const words = source.map(titleizeToken);
  // If the name leads with the vendor, normalize its casing to the brand
  // ("deepseek" → "DeepSeek") rather than leaving a lowercase title-case guess.
  if (words.length && VENDORS[vendorSlug] && source[0].toLowerCase() === vendorSlug.toLowerCase()) {
    words[0] = VENDORS[vendorSlug];
  }
  return words.join(" ").trim();
}

/** Turn a bare model slug into a friendly name + provider. */
export function modelDisplay(slug: string): ModelDisplay {
  // OpenRouter "~vendor/model-latest" alias slugs: the ~ marks a floating
  // "latest" pointer — strip it for display (the exact slug stays in the
  // tooltip), so the vendor lookup still resolves ("~anthropic" → Anthropic).
  const s = (slug || "").trim().replace(/^~/, "");
  if (!s) return { name: "", provider: "" };

  const slashIdx = s.indexOf("/");
  const vendorSlug = slashIdx >= 0 ? s.slice(0, slashIdx) : "";
  const rest = slashIdx >= 0 ? s.slice(slashIdx + 1) : s;
  const provider = VENDORS[vendorSlug] ?? (vendorSlug ? capitalize(vendorSlug) : "");

  const override = NAME_OVERRIDES[s];
  if (override) return { name: override, provider };
  // "openrouter/auto" is a router, not a vendor model — no provider tag.
  if (vendorSlug === "openrouter" && rest === "auto") return { name: "Auto", provider: "" };

  return { name: prettifyModelPart(rest, vendorSlug), provider };
}

/** Minimal shape needed to display a catalog model (subset of ChatModel). */
export interface DisplayableModel {
  id: string;
  label: string;
  model?: string;
  connection_id?: string;
}

/**
 * Friendly display for a catalog entry. Models from a user's own custom
 * connection carry "<slug> · <connection>" in `label`; we keep the connection
 * name as the provider tag and prettify the slug for the name.
 */
export function chatModelDisplay(m: DisplayableModel): ModelDisplay {
  const sep = m.label.indexOf(" · ");
  const connLabel = sep >= 0 ? m.label.slice(sep + 3).trim() : "";
  // Prefer the clean provider-local slug; fall back to the composite id / label.
  const slug = m.model ?? (m.id.includes("::") ? m.id.split("::").pop()! : m.id);
  const d = modelDisplay(slug);
  return connLabel ? { name: d.name, provider: connLabel } : d;
}

/**
 * Whether the provider tag adds information beyond the name. "Gemini 2.5 Flash"
 * + "Google" → yes; "Mistral Small 3.2" + "Mistral" → no (redundant).
 */
export function showProviderTag(d: ModelDisplay): boolean {
  return !!d.provider && !d.name.toLowerCase().startsWith(d.provider.toLowerCase());
}
