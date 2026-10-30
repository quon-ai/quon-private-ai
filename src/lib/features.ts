import type { Lang } from "./langPref";

/**
 * Feature registry — this build: every optional feature is off, and the
 * modules behind these flags are not in this tree yet. The full
 * product keeps the same file with the flags on; nothing else differs.
 */
export type FeatureKey =
  "connectors" | "agents" | "feedback" | "sharing" | "briefing" | "releaseNotes";

export const FEATURES: Readonly<Record<FeatureKey, boolean>> = {
  connectors: false,
  agents: false,
  feedback: false,
  sharing: false,
  briefing: false,
  releaseNotes: false,
};

/** No optional sidebar entries in this build (see the full product's
 *  features.ts for why the list lives here). */
export const OPTIONAL_NAV = [] as const;

/** This build speaks English until a device chooses otherwise. */
export const DEFAULT_LANG: Lang = "en";
