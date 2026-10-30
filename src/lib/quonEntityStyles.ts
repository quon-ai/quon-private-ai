/**
 * Presentation metadata for QUON entity types: a human label plus color-coded
 * Tailwind classes. Full literal class strings are required so the Tailwind JIT
 * scanner can pick them up.
 */

import { tr } from "./i18n/i18n";
import type { MessageKey } from "./i18n/catalog";

export interface EntityStyle {
  label: string;
  /** classes for a small color dot */
  dot: string;
  /** classes for a chip / pill (text + bg + border) */
  chip: string;
}

/** Color classes + a catalog key for the label; the human label is resolved to
 *  the active language at read time by entityStyle(). */
interface RawStyle {
  labelKey: MessageKey;
  dot: string;
  chip: string;
}

const STYLES: Record<string, RawStyle> = {
  PERSON: {
    labelKey: "chat.entity.person",
    dot: "bg-quon-indigo",
    chip: "text-quon-indigo bg-quon-indigo/10 border-quon-indigo/30",
  },
  EMAIL: {
    labelKey: "chat.entity.email",
    dot: "bg-quon-green",
    chip: "text-quon-green bg-quon-green/10 border-quon-green/30",
  },
  PHONE: {
    labelKey: "chat.entity.phone",
    dot: "bg-quon-yellow",
    chip: "text-quon-yellow bg-quon-yellow/10 border-quon-yellow/30",
  },
  IBAN: {
    labelKey: "chat.entity.iban",
    dot: "bg-red-400",
    chip: "text-red-400 bg-red-400/10 border-red-400/30",
  },
  ROUTING: {
    labelKey: "chat.entity.routing",
    dot: "bg-rose-400",
    chip: "text-rose-400 bg-rose-400/10 border-rose-400/30",
  },
  FINANCIAL_AMOUNT: {
    labelKey: "chat.entity.amount",
    dot: "bg-red-400",
    chip: "text-red-400 bg-red-400/10 border-red-400/30",
  },
  DATE: {
    labelKey: "chat.entity.date",
    dot: "bg-sky-400",
    chip: "text-sky-400 bg-sky-400/10 border-sky-400/30",
  },
  PIN: {
    labelKey: "chat.entity.pin",
    dot: "bg-orange-400",
    chip: "text-orange-400 bg-orange-400/10 border-orange-400/30",
  },
  INTERNAL_URL: {
    labelKey: "chat.entity.internalUrl",
    dot: "bg-purple-400",
    chip: "text-purple-400 bg-purple-400/10 border-purple-400/30",
  },
  CREDENTIAL: {
    labelKey: "chat.entity.credential",
    dot: "bg-orange-400",
    chip: "text-orange-400 bg-orange-400/10 border-orange-400/30",
  },
  TAX_ID: {
    labelKey: "chat.entity.taxId",
    dot: "bg-pink-400",
    chip: "text-pink-400 bg-pink-400/10 border-pink-400/30",
  },
  INSURANCE_ID: {
    labelKey: "chat.entity.insuranceId",
    dot: "bg-teal-400",
    chip: "text-teal-400 bg-teal-400/10 border-teal-400/30",
  },
  ADDRESS: {
    labelKey: "chat.entity.address",
    dot: "bg-orange-400",
    chip: "text-orange-400 bg-orange-400/10 border-orange-400/30",
  },
  CUSTOM: {
    labelKey: "chat.entity.custom",
    dot: "bg-fuchsia-400",
    chip: "text-fuchsia-400 bg-fuchsia-400/10 border-fuchsia-400/30",
  },
  MANUAL: {
    labelKey: "chat.entity.manual",
    dot: "bg-quon-muted",
    chip: "text-quon-muted bg-quon-muted/10 border-quon-muted/30",
  },
};

const DEFAULT_STYLE: RawStyle = {
  labelKey: "chat.entity.redacted",
  dot: "bg-quon-muted",
  chip: "text-quon-muted bg-quon-muted/10 border-quon-muted/30",
};

export function entityStyle(type: string): EntityStyle {
  const raw = STYLES[type];
  // Unknown type → keep the raw type string as the label (no catalog entry).
  if (!raw) return { label: type, dot: DEFAULT_STYLE.dot, chip: DEFAULT_STYLE.chip };
  return { label: tr(raw.labelKey), dot: raw.dot, chip: raw.chip };
}
