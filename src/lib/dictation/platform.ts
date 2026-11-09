/**
 * Which device is this, so the mic button can name the right keyboard key?
 *
 * QUON runs no speech engine of its own. Both candidates failed the product's
 * own promise or its users:
 *  - The **Web Speech API** is not the keyboard's on-device dictation, despite
 *    looking like it. It is a CLOUD service: Safari uploads the audio to Apple
 *    (macOS says so in its own permission dialog) and Chrome to Google. That
 *    would send raw, UNSCRUBBED speech - the names, IBANs and addresses the
 *    scrubber exists to remove - to a third party before QUON ever sees it.
 *    Audio cannot be scrubbed. It was also unavailable in iOS home-screen web
 *    apps and returned `network` on macOS without Siri and a separate
 *    system-level Speech Recognition grant.
 *  - **On-device Whisper** needs >=123 MB, and every quantised decoder failed
 *    ONNX session creation.
 *
 * The keyboard's own mic key has none of that: genuinely on-device on modern
 * iOS, already inside the user's trust relationship with their OS, and QUON
 * only ever receives the finished text. So the button points at it.
 */

export type MicPlatform = "ios" | "android" | "macos" | "windows" | "other";

export function isIos(nav: Navigator = navigator): boolean {
  const ua = nav.userAgent ?? "";
  // iPadOS 13+ reports itself as a Mac; the touch points give it away.
  return (
    /iPhone|iPad|iPod/.test(ua) || (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1)
  );
}

/** Which set of dictation instructions applies. */
export function micPlatform(nav: Navigator = navigator): MicPlatform {
  const ua = nav.userAgent ?? "";
  if (isIos(nav)) return "ios"; // before the Mac check - iPadOS claims MacIntel
  if (/Android/.test(ua)) return "android";
  if (/Mac OS X|Macintosh/.test(ua)) return "macos";
  if (/Windows/.test(ua)) return "windows";
  return "other";
}
