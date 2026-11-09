/**
 * On-device photo OCR (zero-knowledge: the photo never leaves the device by
 * default; `ocrPhotoCloud` is the explicit, per-photo opt-in escalation for
 * hard cases).
 *
 * Engine: PaddleOCR PP-OCRv6 **tiny** (det ~1.7 MB + rec ~4.3 MB) via the
 * official browser SDK (`@paddleocr/paddleocr-js`, ONNX Runtime Web). The v6
 * unified model covers German AND English in one dictionary (ä/ö/ü/ß/€
 * verified - our own eval measured CER 0 on a printed German letter and <=2%
 * on photo-simulated contracts, Chromium AND WebKit). Handwriting is not
 * reliable (PP-OCRv6 tiny scores ~39% on Paddle's own handwritten-English
 * benchmark; no browser-viable model for German handwriting exists) - the UI
 * must keep the result editable and say so.
 *
 * WebKit/iOS hardening:
 * - backend is forced to plain **WASM** - the ORT WebGPU/JSEP path is unstable
 *   on WebKit (reload loops on 26.2+, crash-after-N-inferences: onnxruntime
 *   #26827/#27584), and tiny is ~1 s/page on WASM anyway.
 * - `wasmPaths` pins the **non-JSEP** ORT binaries explicitly: ORT >=1.21
 *   otherwise loads the JSEP build even in pure-CPU mode, which melts down
 *   WebKit 26.2+ merely on load. `onnxruntime-web` is pinned exactly in
 *   package.json so these files always match the bundled JS API.
 * - `numThreads: 1` - QUON serves no COOP/COEP headers (cross-origin
 *   isolation would break the HuggingFace/CDN model loads), so ORT would
 *   fall back to 1 thread anyway; setting it silences the console warning.
 *
 * CSP: the ORT runtime is **self-hosted from our own origin** (`/ort/...`, copied
 * from node_modules by scripts/copy-ort.mjs on predev/prebuild), not a CDN. The
 * enforcing CSP (src/server.ts) allows scripts only from 'self', and ORT loads
 * its glue via a dynamic `import()` - a cross-origin CDN would need the CDN in
 * `script-src`, i.e. executing third-party JS with full page access. Same-origin
 * keeps `script-src 'self'` intact and removes the runtime jsdelivr dependency.
 * (The PaddleOCR MODEL tars still come from the Paddle CDN on first use - cached
 * by the browser, carry no user data; self-hosting those is a follow-up.)
 *
 * This module is heavy - import it lazily (`await import(...)`), like
 * extract.ts.
 */

import { diagAppend } from "@/lib/diagLog";
import { tr } from "@/lib/i18n/i18n";
import {
  GOOD_QUALITY,
  passQuality,
  pickBestPass,
  rotationsToTry,
  type OcrItemLike,
  type OrientedPass,
  type Rotation,
} from "./ocrOrientation";

/** Whatever PaddleOCR.create resolves to (plain or worker-backed engine). */
type OcrEngine = Awaited<
  ReturnType<(typeof import("@paddleocr/paddleocr-js"))["PaddleOCR"]["create"]>
>;

// Same-origin (see the CSP note above). scripts/copy-ort.mjs places the exact
// pinned non-JSEP files here; the .mjs resolves its sibling .wasm relative to its
// own URL, so both must live together under /ort/. ABSOLUTE URLs (origin-prefixed)
// on purpose: ORT dynamic-imports the .mjs inside the PaddleOCR Web Worker, and a
// root-relative "/ort/..." resolves against the worker's base URL - an absolute URL
// is unambiguous in both page and worker contexts. (Guarded for SSR/Node import.)
const ORT_ORIGIN = typeof location !== "undefined" ? location.origin : "";
const NON_JSEP_WASM_PATHS = {
  mjs: `${ORT_ORIGIN}/ort/ort-wasm-simd-threaded.mjs`,
  wasm: `${ORT_ORIGIN}/ort/ort-wasm-simd-threaded.wasm`,
};

/** Cap the longer image side before OCR. Detection cost grows with area
 *  (PaddleOCR#17955: uncapped A4 scans explode memory); ~2000 px keeps small
 *  print readable while staying phone-RAM-friendly. */
export const OCR_MAX_SIDE = 2000;

export interface PhotoOcrResult {
  /** Recognized lines joined top-to-bottom - ready for the edit step. */
  text: string;
  lineCount: number;
  /** Mean per-line recognition confidence (0..1); low values should make the
   *  UI nudge the user to proof-read. */
  avgScore: number;
}

export type PhotoOcrPhase = "model" | "recognize";

/** Scale (w, h) to fit within maxSide, never upscaling. Pure - unit-tested. */
export function fitWithin(
  width: number,
  height: number,
  maxSide: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const f = maxSide / longest;
  return { width: Math.max(1, Math.round(width * f)), height: Math.max(1, Math.round(height * f)) };
}

// One engine per session - models stay warm for follow-up photos.
let enginePromise: Promise<OcrEngine> | null = null;

/** Init must never wedge the feature: a hung model download / WASM init would
 *  otherwise be cached in the singleton forever, turning every later "Try
 *  again" into the same silent spinner. */
const INIT_TIMEOUT_MS = 90_000;

function getEngine(): Promise<OcrEngine> {
  // SDK import stays dynamic so this module itself is cheap to import (and
  // testable in Node - the SDK expects a browser).
  enginePromise ??= Promise.race([
    import("@paddleocr/paddleocr-js").then(({ PaddleOCR }) =>
      PaddleOCR.create({
        // tiny is only reachable via explicit model names (lang/ocrVersion
        // maps to the ~30 MB small pair); the tars carry their own dictionaries.
        textDetectionModelName: "PP-OCRv6_tiny_det",
        textRecognitionModelName: "PP-OCRv6_tiny_rec",
        ortOptions: {
          backend: "wasm",
          numThreads: 1,
          // ORT accepts the {mjs, wasm} object form; the SDK forwards this
          // verbatim to ort.env.wasm.wasmPaths (its type just says string).
          wasmPaths: NON_JSEP_WASM_PATHS as unknown as string,
        },
      }),
    ),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timed out")), INIT_TIMEOUT_MS),
    ),
  ]).catch((err) => {
    enginePromise = null; // next attempt retries (transient download failures)
    throw err;
  });
  return enginePromise;
}

/** What the bytes actually are, by magic numbers - extensions and MIME lie
 *  (Android sharing hands over HEIF bytes named .jpg; cloud-backed Google
 *  Photos picks can arrive truncated/empty). Pure - unit-tested. */
export function sniffImageFormat(bytes: Uint8Array): string {
  if (bytes.length === 0) return "leer/empty";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e)
    return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpeg";
  if (
    bytes.length >= 12 &&
    bytes[8] === 0x57 && // "WEBP" in RIFF....WEBP
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "webp";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46)
    return "gif";
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79) {
    // ISO-BMFF "ftyp" - brand at bytes 8..11 tells HEIF vs AVIF apart.
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand.startsWith("avi")) return "avif";
    return `heif (${brand.trim()})`;
  }
  return "unbekannt/unknown";
}

/** Last-resort decode via an <img> element - a different decoder pipeline that
 *  sometimes accepts files createImageBitmap rejects (color-profile / gainmap
 *  oddities). Deliberately onload+drawImage, not img.decode(): Chromium defers
 *  decode() indefinitely for hidden pages (the documented gotcha). */
function decodeViaImgElement(bytes: Uint8Array): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
    const img = new Image();
    const done = (fn: () => void) => {
      URL.revokeObjectURL(url);
      fn();
    };
    img.onload = () => done(() => resolve(img));
    img.onerror = () => done(() => reject(new Error("img element decode failed")));
    img.src = url;
  });
}

/** Decode an image file EXIF-upright and downscaled onto a canvas.
 *  createImageBitmap decodes off the main thread AND - unlike `img.decode()`,
 *  which Chromium defers indefinitely for hidden pages - keeps working when
 *  the tab is backgrounded mid-scan. `imageOrientation: "from-image"` honours
 *  EXIF; the plain retry covers engines that reject the option.
 *
 *  Hardened after a real Pixel-10 report ("The source image could not be
 *  decoded" on a plain screenshot): (a) the bytes are read EXPLICITLY first,
 *  so an unreadable/empty picker blob (cloud-backed Google-Photos item) gets
 *  its own honest message instead of a generic decode error; (b) on decode
 *  failure an <img>-element fallback tries a second decoder pipeline; (c) the
 *  final error names the SNIFFED format + size and lands in the technical log
 *  (diagLog) - so the next report tells us exactly what arrived. */
async function decodeToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  // Read the bytes up front. A picker handing over a dead content:// reference
  // fails here, distinguishably, not as a bogus "decode" error.
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    diagAppend(`ocr decode: picker blob unreadable (type=${file.type || "?"}, size=${file.size})`);
    throw new Error(tr("docs.ocrReadImageError", { detail: tr("docs.ocrBlobUnreadable") }));
  }
  const format = sniffImageFormat(bytes);
  if (bytes.length === 0) {
    diagAppend(`ocr decode: 0-byte file from picker (type=${file.type || "?"})`);
    throw new Error(tr("docs.ocrReadImageError", { detail: tr("docs.ocrBlobEmpty") }));
  }

  const draw = (source: CanvasImageSource, w: number, h: number): HTMLCanvasElement => {
    const { width, height } = fitWithin(w, h, OCR_MAX_SIDE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(source, 0, 0, width, height);
    return canvas;
  };

  const blob = new Blob([bytes as BlobPart]);
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" }).catch(() =>
      createImageBitmap(blob),
    );
    try {
      return draw(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  } catch (err) {
    // Second decoder pipeline before giving up (loses EXIF rotation for the
    // rare files that need it - an upright-ish scan beats no scan).
    try {
      const img = await decodeViaImgElement(bytes);
      return draw(img, img.naturalWidth, img.naturalHeight);
    } catch {
      /* fall through to the honest, format-naming error */
    }
    const raw = err instanceof Error ? err.message : "decode failed";
    const detail = `${raw} — Format: ${format}, ${Math.round(bytes.length / 1024)} KB`;
    diagAppend(
      `ocr decode failed: format=${format} size=${bytes.length} type=${file.type || "?"} err=${raw}`,
    );
    throw new Error(tr("docs.ocrReadImageError", { detail }));
  }
}

/** A copy of the canvas turned clockwise by `deg` (the frame swaps sides for
 *  a quarter turn). The original is untouched - the first pass's canvas is
 *  reused for every retry. */
export function rotateCanvas(source: HTMLCanvasElement, deg: Rotation): HTMLCanvasElement {
  if (deg === 0) return source;
  const quarter = deg === 90 || deg === 270;
  const out = document.createElement("canvas");
  out.width = quarter ? source.height : source.width;
  out.height = quarter ? source.width : source.height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return out;
}

/**
 * Run the engine, and if the page reads as sideways or upside down, run it
 * again on the rotated canvas and keep the best pass (ocrOrientation.ts -
 * the engine has no angle classifier, so a landscape scan otherwise comes
 * back as garbage). `blankIsLikely` is for scanned-PDF pages, where an empty
 * result is a blank page rather than a sideways one.
 */
async function predictUpright(
  engine: OcrEngine,
  canvas: HTMLCanvasElement,
  opts: { blankIsLikely?: boolean } = {},
): Promise<OcrItemLike[]> {
  const run = async (deg: Rotation): Promise<OrientedPass> => {
    const [result] = await engine.predict(rotateCanvas(canvas, deg));
    return { rotation: deg, items: result?.items ?? [] };
  };
  const first = await run(0);
  const retries = rotationsToTry(first.items, opts);
  if (retries.length === 0) return first.items;
  const passes: OrientedPass[] = [first];
  for (const deg of retries) {
    const pass = await run(deg);
    passes.push(pass);
    if (passQuality(pass.items) >= GOOD_QUALITY) break;
  }
  const best = pickBestPass(passes);
  diagAppend(
    `ocr orientation: first pass q=${passQuality(first.items).toFixed(2)} (${first.items.length} lines) → ` +
      `best ${best.rotation}° q=${passQuality(best.items).toFixed(2)} (${best.items.length} lines) after ${passes.length - 1} retr${passes.length === 2 ? "y" : "ies"}`,
  );
  return best.items;
}

/** Base64-encode bytes chunked (String.fromCharCode has an argument limit;
 *  spreading a whole photo would overflow the stack). Pure - unit-tested. */
export function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Prepare a photo for the explicit cloud escalation: decode EXIF-upright,
 *  downscale to the same <=2000 px cap as the on-device path and re-encode as
 *  JPEG. The canvas round-trip strips all metadata (EXIF incl. GPS) before
 *  anything leaves the device. Returns base64 for the JSON API. */
export async function photoToUploadB64(file: Blob): Promise<string> {
  const canvas = await decodeToCanvas(file);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.9),
  );
  if (!blob) throw new Error(tr("docs.ocrEncodeError"));
  return bytesToB64(new Uint8Array(await blob.arrayBuffer()));
}

/** Escalate one photo to the cloud model (server relays it once, ZDR routing,
 *  nothing stored). Caller is responsible for having obtained explicit user
 *  consent - this function must never run automatically. */
export async function ocrPhotoCloud(file: Blob): Promise<{ text: string; model: string }> {
  const { ocrCloudTranscribe } = await import("@/lib/quonApi");
  return ocrCloudTranscribe(await photoToUploadB64(file));
}

/** OCR one photo, fully on-device. Throws with a friendly message on failure
 *  (model download offline, undecodable image, no text found). */
/**
 * OCR an already-rendered canvas (e.g. a pdf.js page render for a scanned
 * PDF). Unlike `ocrPhoto` this does not throw when no text is found - a blank
 * page in a scanned document is legitimate, the caller just gets "".
 */
export async function ocrCanvas(canvas: HTMLCanvasElement): Promise<PhotoOcrResult> {
  const engine = await getEngine();
  const items = await predictUpright(engine, canvas, { blankIsLikely: true });
  if (items.length === 0) return { text: "", lineCount: 0, avgScore: 0 };
  const text = items.map((i) => i.text).join("\n");
  const avgScore = items.reduce((s, i) => s + (i.score ?? 0), 0) / items.length;
  return { text, lineCount: items.length, avgScore };
}

export async function ocrPhoto(
  file: Blob,
  onPhase?: (phase: PhotoOcrPhase) => void,
): Promise<PhotoOcrResult> {
  onPhase?.("model");
  let engine: OcrEngine;
  try {
    engine = await getEngine();
  } catch (err) {
    const detail = err instanceof Error ? err.message : "download failed";
    throw new Error(tr("docs.ocrLoadReaderError", { detail }));
  }
  const canvas = await decodeToCanvas(file);
  onPhase?.("recognize");
  const items = await predictUpright(engine, canvas);
  if (items.length === 0) {
    throw new Error(tr("docs.ocrNoText"));
  }
  const text = items.map((i) => i.text).join("\n");
  const avgScore = items.reduce((s, i) => s + (i.score ?? 0), 0) / items.length;
  return { text, lineCount: items.length, avgScore };
}
