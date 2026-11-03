/**
 * Merged message catalogs. EN is the source of truth for the KEY set; DE is
 * typed as Record<MessageKey, string>, so a missing German translation is a
 * COMPILE error, never a silent English fallback.
 *
 * Each screen cluster owns a file under ./catalogs/ exporting { en, de } with a
 * shared namespace prefix (auth.*, chat.*, …). All namespaces are registered
 * here; the string-externalization pass fills the per-namespace files.
 */
import { admin } from "./catalogs/admin";
import { auth } from "./catalogs/auth";
import { chat } from "./catalogs/chat";
import { common } from "./catalogs/common";
import { connectors } from "./catalogs/connectors";
import { demo } from "./catalogs/demo";
import { docs } from "./catalogs/docs";
import { errors } from "./catalogs/errors";
import { memory } from "./catalogs/memory";
import { nav } from "./catalogs/nav";
import { onboarding } from "./catalogs/onboarding";
import { projects } from "./catalogs/projects";
import { settings } from "./catalogs/settings";
import { trust } from "./catalogs/trust";

export const EN = {
  ...common.en,
  ...errors.en,
  ...auth.en,
  ...chat.en,
  ...settings.en,
  ...nav.en,
  ...connectors.en,
  ...demo.en,
  ...trust.en,
  ...memory.en,
  ...docs.en,
  ...projects.en,
  ...onboarding.en,
  ...admin.en,
} as const;

export type MessageKey = keyof typeof EN;

export const DE: Record<MessageKey, string> = {
  ...common.de,
  ...errors.de,
  ...auth.de,
  ...chat.de,
  ...settings.de,
  ...nav.de,
  ...connectors.de,
  ...demo.de,
  ...trust.de,
  ...memory.de,
  ...docs.de,
  ...projects.de,
  ...onboarding.de,
  ...admin.de,
};
