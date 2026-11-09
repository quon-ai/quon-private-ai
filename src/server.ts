import "./lib/error-capture";

import { AsyncLocalStorage } from "node:async_hooks";

import { cspExtraFromCookieHeader } from "./lib/cspExtra";
import { FEATURES } from "./lib/features";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { DEFAULT_LANG, langFromCookieHeader, type Lang } from "./lib/langPref";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

// --- Content-Security-Policy (enforcing, nonce-based) ----------------------
// The Master Key lives in sessionStorage, so XSS is the attack that matters -
// a strict CSP is the highest-leverage mitigation. TanStack Start emits dynamic
// inline scripts (hydration state, stream chunks), which rules out a static
// header: we mint a nonce per request, hand it to the router (which tags every
// inline script it injects - see router.tsx), and put the same nonce in this
// header. The client picks the nonce up from the <meta property="csp-nonce">
// tag rendered by the root shell.
//
// Enabled only in production builds (vite dev needs eval/inline for HMR).
// QUON_CSP=off is the emergency escape hatch; QUON_CSP_CONNECT_EXTRA appends
// origins to connect-src (e.g. "http://localhost:8000" when testing the prod
// bundle locally against a separate-origin API - in real deploys the API is
// same-origin behind /api).
const CSP_ENABLED = import.meta.env.PROD && process.env.QUON_CSP !== "off";

const nonceStore = new AsyncLocalStorage<string>();
// Handshake with getRouter() (isomorphic code can't import node:async_hooks).
(globalThis as { __quonCspNonce?: () => string | undefined }).__quonCspNonce = () =>
  nonceStore.getStore();

// Per-request UI language, resolved from the `quon_lang` cookie and handed to
// the isomorphic root render the same way as the nonce, so SSR emits the right
// <html lang> and initial catalog (see src/lib/i18n resolveInitialLang).
const langStore = new AsyncLocalStorage<Lang>();
(globalThis as { __quonLang?: () => Lang | undefined }).__quonLang = () => langStore.getStore();

function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}

function buildCsp(nonce: string, userExtra: string | null): string {
  // Two extra-connect sources, deliberately separate: the OPERATOR's env var
  // (whole-instance, e.g. the operator's own Paperless) and the USER's cookie
  // (per-browser, strictly one shape-validated origin - see lib/cspExtra.ts
  // for the rules and the honestly-stated costs).
  // The user cookie exists for the Paperless connector; a build without
  // connectors has no reason to widen its CSP for it.
  const extra = [
    (process.env.QUON_CSP_CONNECT_EXTRA ?? "").trim(),
    FEATURES.connectors ? (userExtra ?? "") : "",
  ]
    .filter(Boolean)
    .join(" ");
  return [
    "default-src 'self'",
    // wasm-unsafe-eval: libsodium + Transformers.js instantiate WASM from bytes.
    // unsafe-eval: the on-device photo-OCR engine (PaddleOCR WASM, lib/documents/
    // ocr.ts) is compiled with Emscripten embind, whose runtime builds its function
    // dispatchers with new Function(). It runs in the SDK's own Web Worker, which
    // INHERITS this document policy (a worker can only ADD restrictions, never relax
    // an inherited one), so the exception must live here, not on the worker. The
    // nonce stays the real barrier against script injection and QUON evaluates no
    // user-controlled string as code, so the marginal risk is low. Clean long-term
    // fix: isolate the OCR engine in a separate-origin sandbox iframe (its own,
    // eval-allowing CSP).
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval' 'unsafe-eval'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    // huggingface.co + CDN mirrors: embedding model download; cdn.jsdelivr.net:
    // Transformers.js + PaddleOCR ONNX-runtime WASM binaries;
    // paddle-model-ecology...bcebos.com: photo-OCR model tars (lib/documents/ocr.ts).
    "connect-src 'self' https://huggingface.co https://cdn-lfs.huggingface.co" +
      " https://cdn-lfs-us-1.huggingface.co https://cdn.jsdelivr.net" +
      // The browser-direct connectors widen the egress allowlist; an edition
      // without them (FEATURES.connectors=false) must not carry the hosts.
      // Dropbox: the two API hosts. OneDrive (Microsoft Graph): the download
      // hosts are wildcards on purpose - `@microsoft.graph.downloadUrl` points
      // at a per-request CDN host, *.files.1drv.com for personal accounts and
      // <tenant>.sharepoint.com for work/school ones, so no fixed origin can
      // cover it; login.microsoftonline.com is the PKCE token exchange.
      (FEATURES.connectors
        ? " https://api.dropboxapi.com https://content.dropboxapi.com" +
          " https://graph.microsoft.com https://login.microsoftonline.com" +
          " https://*.files.1drv.com https://*.sharepoint.com"
        : "") +
      ` https://paddle-model-ecology.bj.bcebos.com${extra ? " " + extra : ""}`,
    "worker-src 'self' blob:", // embedder + pdfjs workers
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** Attach the enforcing CSP header (HTML responses only - assets/API don't
 *  execute scripts). Rebuilds the Response to keep the streamed body intact. */
function withCsp(response: Response, nonce: string, userExtra: string | null): Response {
  if (!CSP_ENABLED) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", buildCsp(nonce, userExtra));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} - try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // Every request renders under its own nonce; getRouter() reads it from the
    // AsyncLocalStorage while React SSR runs inside this scope.
    const nonce = newNonce();
    const cookieHeader = request.headers.get("cookie");
    const lang = langFromCookieHeader(cookieHeader) ?? DEFAULT_LANG;
    // User-chosen extra connect-src origin (own Paperless on the hosted app) -
    // validated hard in cspExtraFromCookieHeader; malformed cookies are ignored.
    const userExtra = cspExtraFromCookieHeader(cookieHeader);
    return langStore.run(lang, () =>
      nonceStore.run(nonce, async () => {
        try {
          const handler = await getServerEntry();
          const response = await handler.fetch(request, env, ctx);
          return withCsp(await normalizeCatastrophicSsrResponse(response), nonce, userExtra);
        } catch (error) {
          console.error(error);
          return withCsp(
            new Response(renderErrorPage(), {
              status: 500,
              headers: { "content-type": "text/html; charset=utf-8" },
            }),
            nonce,
            userExtra,
          );
        }
      }),
    );
  },
};
