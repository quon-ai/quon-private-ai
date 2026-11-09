/**
 * The composer's microphone - a POINTER to the keyboard's own dictation, not an
 * engine QUON runs.
 *
 * Why there is no engine here: the Web Speech API looks like the keyboard mic
 * but is a cloud service (Safari uploads the audio to Apple, Chrome to Google),
 * so it would send raw, unscrubbed speech to a third party before the scrubber
 * ever saw it, and audio cannot be scrubbed. It is also missing entirely in
 * iOS home-screen web apps and fails with `network` on macOS. On-device
 * Whisper needs >=123 MB and its quantised decoders do not load. See
 * lib/dictation/platform.ts.
 *
 * The keyboard mic is on-device on modern iOS, needs no download, no permission
 * from us, works in the installed app, and hands QUON only the finished text.
 * The button's whole job is to tell people where that key is on their device -
 * a mic icon is where they look for it.
 */
import { Mic } from "lucide-react";

import { useT } from "@/lib/i18n/i18n";
import { micPlatform } from "@/lib/dictation/platform";
import type { MessageKey } from "@/lib/i18n/catalog";

const HINT_KEY: Record<ReturnType<typeof micPlatform>, MessageKey> = {
  ios: "chat.dictationHintIos",
  android: "chat.dictationHintAndroid",
  macos: "chat.dictationHintMacos",
  windows: "chat.dictationHintWindows",
  other: "chat.dictationHintOther",
};

export function DictationButton({
  onHint,
  disabled,
}: {
  /** Shown in the composer's info line - this button never errors, it explains. */
  onHint: (message: string) => void;
  disabled?: boolean;
}) {
  const { t } = useT();
  const label = t("chat.dictationTitle");

  return (
    <button
      type="button"
      onClick={() => onHint(t(HINT_KEY[micPlatform()]))}
      disabled={disabled}
      aria-label={label}
      title={label}
      data-testid="dictation-button"
      data-mic="keyboard"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-quon-muted transition hover:text-quon-text disabled:opacity-40"
    >
      <Mic className="h-4 w-4" />
    </button>
  );
}
