/**
 * Pure "resolve effective chat defaults" logic for per-project defaults
 * (ProjectItem.defaultModelId / defaultProtection / defaultReasoningEffort).
 *
 * A project's defaults only SEED the initial state of a chat opened/created in
 * that project — they never fight later manual per-chat changes, and (as of the
 * 2026-07 fix below) they never leak into the GLOBAL protection/model/reasoning
 * state either. ScreenChat calls `resolveProjectChatSeed` once per chat open
 * (keyed on the logical chat) and hands the result to `applyProjectChatSeed`,
 * which only ever writes the chat-local override state (`chatProtectionOverride`
 * / `chatModelOverride` / `chatEffortOverride` — plain `useState` in ScreenChat,
 * reset on every chat switch). It is never given a reference to the global
 * `quon.setProtectionLevel` / `quon.setActiveModel` setters, so seeding cannot
 * mutate Settings/the dashboard/other chats even by accident — see
 * `applyProjectChatSeed`'s JSDoc and its unit tests for the regression this
 * closes (ScreenChat used to call the global setters directly here, so opening
 * one chat in a "None"-default project silently flipped filtering off app-wide).
 * Anything unset in the seed means "keep the effective (override ?? global)
 * behavior as it already was".
 */

import type { ChatModel } from "./quonApi";
import type { ProjectItem } from "./projectStore";
import type { ProtectionLevel, ReasoningEffort } from "./quonStore";

/** What to apply when a chat starts in a project. Absent field = leave as-is. */
export interface ProjectChatSeed {
  /** Model to select now (validated: an enabled option in the current list). */
  modelId?: string;
  /**
   * The project's default model when it is NOT (yet) an enabled option — the
   * /models list loads async, so the caller retries once the list updates
   * instead of setting an id the "keep a valid model" guard would kick out.
   */
  pendingModelId?: string;
  protection?: ProtectionLevel;
  reasoningEffort?: ReasoningEffort;
  disabledEntityTypes?: string[];
}

/**
 * Resolve which chat settings a project's defaults should seed, given the model
 * options currently known. Tolerates a missing project (not synced yet) and
 * items from before the defaults existed (all fields optional).
 */
export function resolveProjectChatSeed(
  project:
    | Pick<
        ProjectItem,
        | "defaultModelId"
        | "defaultProtection"
        | "defaultReasoningEffort"
        | "defaultDisabledEntityTypes"
      >
    | undefined,
  models: ChatModel[],
): ProjectChatSeed {
  if (!project) return {};
  const seed: ProjectChatSeed = {};
  if (project.defaultModelId) {
    const enabled = models.some((m) => m.id === project.defaultModelId && !m.disabled);
    if (enabled) seed.modelId = project.defaultModelId;
    else seed.pendingModelId = project.defaultModelId;
  }
  if (project.defaultProtection) seed.protection = project.defaultProtection;
  if (project.defaultReasoningEffort) seed.reasoningEffort = project.defaultReasoningEffort;
  if (project.defaultDisabledEntityTypes)
    seed.disabledEntityTypes = project.defaultDisabledEntityTypes;
  return seed;
}

/** The chat-LOCAL override setters a seed may be applied through. Deliberately
 *  narrower than the global `quon` store setters — a caller can only ever wire
 *  this to per-chat `useState` overrides, never to `quon.setProtectionLevel` /
 *  `quon.setActiveModel`, so the seeding path has no channel to reach global
 *  state even by mistake. */
export interface ProjectChatSeedSetters {
  setProtectionOverride: (level: ProtectionLevel) => void;
  setModelOverride: (modelId: string) => void;
  setReasoningOverride: (effort: ReasoningEffort) => void;
  setDisabledEntityTypesOverride: (types: string[]) => void;
}

/**
 * Apply a resolved seed via the given LOCAL per-chat override setters — and
 * only those. See the module docstring: this function's signature is the
 * enforcement mechanism for "project defaults never touch global state" (it
 * simply has no global setter to call). `seed.pendingModelId` is intentionally
 * NOT applied here — the caller retries it once `/models` lands (see
 * `resolveProjectChatSeed`'s docs on `pendingModelId`).
 */
export function applyProjectChatSeed(seed: ProjectChatSeed, setters: ProjectChatSeedSetters): void {
  if (seed.protection) setters.setProtectionOverride(seed.protection);
  if (seed.reasoningEffort) setters.setReasoningOverride(seed.reasoningEffort);
  if (seed.disabledEntityTypes) setters.setDisabledEntityTypesOverride(seed.disabledEntityTypes);
  if (seed.modelId) setters.setModelOverride(seed.modelId);
}
