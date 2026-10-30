/**
 * Feature registry — core edition: every optional feature is off, and the
 * modules behind these flags are not in this tree (docs/CORE.md). The full
 * product keeps the same file with the flags on; nothing else differs.
 */
export type FeatureKey = "connectors" | "agents" | "feedback" | "sharing" | "briefing";

export const FEATURES: Readonly<Record<FeatureKey, boolean>> = {
  connectors: false,
  agents: false,
  feedback: false,
  sharing: false,
  briefing: false,
};

/** No optional sidebar entries in the core edition (see the full product's
 *  features.ts for why the list lives here). */
export const OPTIONAL_NAV = [] as const;
