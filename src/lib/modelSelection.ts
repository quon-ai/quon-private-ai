/**
 * Pure decision for "keep a valid chat model selected".
 *
 * The chat model picker must never be stuck on an unusable option (a legacy
 * pre-connection id, or a model whose provider key was removed). But the
 * correction MUST wait for the REAL catalog to load: the bundled placeholder
 * (`CHAT_MODELS`) uses plain ids ("openai/gpt-4o") while the real catalog uses
 * connection-scoped ids ("openrouter::openai/gpt-4o"), so judging validity
 * against the placeholder would treat every restored/valid selection as invalid
 * and reset it to the default — silently clobbering the user's saved model on
 * every reload (persisted via the local store). Hence `modelsLoaded`.
 */

export interface SelectableModel {
  id: string;
  disabled?: boolean;
}

/**
 * The model id to switch to, or `null` when the current selection is fine (or we
 * shouldn't touch it yet). Only ever returns a change once the real catalog has
 * loaded and the current id isn't an enabled option in it.
 */
export function correctedModelId(
  modelsLoaded: boolean,
  models: SelectableModel[],
  current: string,
): string | null {
  // Don't judge validity against the placeholder catalog — that's the reload-
  // clobber bug. Wait for the real list.
  if (!modelsLoaded || models.length === 0) return null;
  // Current selection is a usable option → leave it.
  if (models.some((m) => m.id === current && !m.disabled)) return null;
  // Otherwise fall back to the first enabled model (or the first at all).
  const first = models.find((m) => !m.disabled) ?? models[0];
  return first && first.id !== current ? first.id : null;
}
