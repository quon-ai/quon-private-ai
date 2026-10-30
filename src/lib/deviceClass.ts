/**
 * Which devices QUON must treat as MEMORY-CONSTRAINED, and what heavy
 * background work is allowed on them — one policy, consulted by the embedder,
 * the lazy re-embed pass and the originals upload scan.
 *
 * Why (issues #68, #76, 2026-09-09): on iPhones the app died within ~15 s of
 * EVERY boot, for days, on any route — Safari's "Auf … ist wiederholt ein
 * Problem aufgetreten" is WebKit reporting that it killed the page process
 * repeatedly (jetsam). The macOS app had the same loop and HANDOFF names the
 * mechanism: WebKit's optimizing WASM tier grinding on the ~23 MB ONNX runtime
 * that the on-device embedder loads, plus a 113 MB model and a 16 MB tokenizer
 * — and every screen pre-warmed that embedder on mount. Two boot-time jobs
 * then RETRY FOREVER without ever learning that they are what kills the page:
 * the originals upload (a 50 MB PDF is held ~3× in memory: bytes, sealed,
 * base64 chunks) and the lazy re-embed of documents indexed under an older
 * model. On the desktop the same work is invisible.
 *
 * Two independent inputs:
 *
 * - **constrained** — the device class. iOS (every browser there is WebKit
 *   under the same jetsam rules — Safari, Chrome, the home-screen app), or a
 *   reported `deviceMemory` ≤ 4 GB (Chromium on low-end Android/laptops).
 *   Safari reports no deviceMemory at all, hence the UA rule.
 * - **crashLoop** — how many boots in a row followed a SHORT unclean session
 *   (diagLog). Two or more means "whatever we do at boot is what kills us":
 *   safe mode, on ANY device — skip every optional heavy job this session so
 *   the user gets a working app, and the log says why.
 *
 * Pure: the browser facts come in as an argument so the table is unit-tested;
 * `currentPolicy()` is the memoised app-side entry point.
 */

import { crashLoopCount } from "./diagLog";

export interface DeviceFacts {
  ua: string;
  platform?: string;
  maxTouchPoints?: number;
  /** navigator.deviceMemory (Chromium only; Safari never reports it). */
  deviceMemory?: number;
}

export function isIosDevice(f: DeviceFacts): boolean {
  // iPadOS 13+ reports itself as a Mac; the touch points give it away.
  return (
    /iPhone|iPad|iPod/.test(f.ua) || (f.platform === "MacIntel" && (f.maxTouchPoints ?? 0) > 1)
  );
}

/** Memory-constrained: iOS, or a reported device memory of 4 GB or less. */
export function isConstrainedDevice(f: DeviceFacts): boolean {
  if (isIosDevice(f)) return true;
  return typeof f.deviceMemory === "number" && f.deviceMemory <= 4;
}

/** Boots-in-a-row-after-a-short-crash at which safe mode kicks in. */
export const CRASH_LOOP_SAFE_MODE_AT = 2;

export interface HeavyWorkPolicy {
  /** Load the embedder on screen open, before anything needs it. */
  prewarmEmbedder: boolean;
  /** Re-embed stale memory/documents automatically on chat/memory mount. */
  backgroundReembed: boolean;
  /** Scan for and upload original document bytes at boot. */
  backgroundOriginalsUpload: boolean;
  /** Largest original the boot scan uploads by itself (bytes); larger ones
   *  stay device-local and are reported as such. */
  maxAutoUploadBytes: number;
  /** Inputs per worker inference call. */
  embedBatchSize: number;
  /** Terminate the embedder worker after this much idle time; 0 = never. */
  releaseEmbedderIdleMs: number;
  /** Ingest one stage at a time: cache the original bytes only AFTER text
   *  extraction, instead of reading the file a second time while pdf.js still
   *  holds its own copy — a large PDF otherwise sits in memory three times over
   *  at the same moment (the "crashes at 70 %" case on phones). */
  sequentialIngest: boolean;
  /** Why — for the diagnostics log. */
  reason: "normal" | "constrained" | "safe-mode";
}

const NORMAL: HeavyWorkPolicy = {
  prewarmEmbedder: true,
  backgroundReembed: true,
  backgroundOriginalsUpload: true,
  maxAutoUploadBytes: Number.POSITIVE_INFINITY,
  embedBatchSize: 16,
  releaseEmbedderIdleMs: 0,
  sequentialIngest: false,
  reason: "normal",
};

const CONSTRAINED: HeavyWorkPolicy = {
  prewarmEmbedder: false,
  // Only opportunistic: the pass runs when the embedder is already up for
  // something the user asked for, never as the thing that loads it.
  backgroundReembed: false,
  backgroundOriginalsUpload: true,
  maxAutoUploadBytes: 8 * 1024 * 1024,
  embedBatchSize: 4,
  releaseEmbedderIdleMs: 60_000,
  sequentialIngest: true,
  reason: "constrained",
};

const SAFE_MODE: HeavyWorkPolicy = {
  prewarmEmbedder: false,
  backgroundReembed: false,
  backgroundOriginalsUpload: false,
  maxAutoUploadBytes: 0,
  embedBatchSize: 4,
  releaseEmbedderIdleMs: 60_000,
  sequentialIngest: true,
  reason: "safe-mode",
};

export function heavyWorkPolicy(constrained: boolean, crashLoop: number): HeavyWorkPolicy {
  if (crashLoop >= CRASH_LOOP_SAFE_MODE_AT) return SAFE_MODE;
  return constrained ? CONSTRAINED : NORMAL;
}

function navigatorFacts(): DeviceFacts {
  if (typeof navigator === "undefined") return { ua: "" };
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    ua: nav.userAgent ?? "",
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    deviceMemory: nav.deviceMemory,
  };
}

let memo: HeavyWorkPolicy | null = null;

/** The policy for THIS session — decided once (the crash-loop count is a
 *  boot-time fact, the device does not change). */
export function currentPolicy(): HeavyWorkPolicy {
  memo ??= heavyWorkPolicy(isConstrainedDevice(navigatorFacts()), crashLoopCount());
  return memo;
}

/** Tests only. */
export function resetPolicyForTest(): void {
  memo = null;
}
