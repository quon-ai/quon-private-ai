/**
 * Vite config — plain, no wrapper.
 *
 * This used to go through `@lovable.dev/vite-tanstack-config`, the scaffolding
 * preset QUON was generated from. Lovable is no longer used, and the wrapper
 * was not free: it pinned peer ranges that forced `--legacy-peer-deps` on every
 * install, it injected dev plugins meant for the Lovable sandbox (asset proxy,
 * error-report bridges), and it hid the plugin order behind a package — so
 * "why does the build do that?" had no answer in this repo.
 *
 * Everything below reproduces what the wrapper actually produced, verified by
 * dumping its resolved config for both `build/production` and `serve/development`
 * before deleting it. Plugin ORDER is load-bearing: tailwind → tsconfig-paths →
 * tanstackStart → nitro (build only) → react.
 */
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type PluginOption, type UserConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * E2E-only: serve the mirrored embedding-model files (tests/e2e/.models, see
 * scripts/fetch-e2e-models.mjs) under /e2e-models so the ~20 document-heavy
 * specs stop re-downloading ~100MB from huggingface.co per browser context.
 * Enabled ONLY by the Playwright webServer (QUON_E2E_LOCAL_MODELS=1); inert in
 * normal dev and structurally absent from production builds (configureServer
 * is a dev-server hook). Misses 302-redirect to huggingface.co, so a stale or
 * missing mirror degrades to the old slow path, never to a broken suite.
 */
const MODEL_MIME: Record<string, string> = {
  ".json": "application/json",
  ".onnx": "application/octet-stream",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
};
const e2eLocalModels = (): PluginOption => ({
  name: "quon-e2e-local-models",
  configureServer(server) {
    if (process.env.QUON_E2E_LOCAL_MODELS !== "1") return;
    const root = join(process.cwd(), "tests/e2e/.models");
    server.middlewares.use("/e2e-models", (req, res, next) => {
      const rel = normalize((req.url ?? "/").split("?")[0]).replace(/^([/\\.])+/, "");
      const file = join(root, rel);
      if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
        // Miss → let the browser fetch the real thing from HF (CORS-permissive).
        res.statusCode = 302;
        res.setHeader("location", `https://huggingface.co/${rel}`);
        res.end();
        return;
      }
      const ext = file.slice(file.lastIndexOf("."));
      res.setHeader("content-type", MODEL_MIME[ext] ?? "application/octet-stream");
      createReadStream(file).pipe(res);
      void next;
    });
  },
});

/**
 * The build id written by scripts/write-version.mjs (a `prebuild`/`predev`
 * step), inlined so the running app knows which build it IS. It compares that
 * against the deployed public/version.json to offer a reload — see
 * src/lib/appVersion.ts. Falls back to "dev" when the stamp is missing, which
 * disables the check rather than claiming a wrong version.
 */
function buildId(): string {
  try {
    const raw = readFileSync(join(ROOT, "public", "version.json"), "utf8");
    return (JSON.parse(raw) as { build?: string }).build || "dev";
  } catch {
    return "dev";
  }
}

export default defineConfig(async ({ command, mode }): Promise<UserConfig> => {
  // VITE_* values are inlined explicitly, not left to Vite's implicit
  // import.meta.env: the SSR/nitro server bundle is built separately and must
  // see the SAME values as the client, or the app would call one API URL in the
  // browser and another during SSR. The wrapper did this too.
  // .env files first, then EXPORTED VITE_* vars on top — an explicitly exported
  // value must win, which loadEnv alone does not do (it reads files only). The
  // e2e suite relies on exactly that: playwright.config.ts starts vite with
  // VITE_QUON_API_URL=http://localhost:8011 to point the app at the throwaway
  // backend, and a `define` built from .env would silently override it back to
  // "/api" and route every spec at the wrong server.
  const env = {
    ...loadEnv(mode, ROOT, "VITE_"),
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (kv): kv is [string, string] => kv[0].startsWith("VITE_") && typeof kv[1] === "string",
      ),
    ),
  };
  const define: Record<string, string> = Object.fromEntries(
    Object.entries(env).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)]),
  );
  define["import.meta.env.VITE_QUON_BUILD"] = JSON.stringify(buildId());

  return {
    css: { transformer: "lightningcss" },
    resolve: {
      alias: { "@": resolve(ROOT, "src") },
      // One React (and one query client) across the app, its deps and the SSR
      // bundle. Two copies = "invalid hook call" / a silently empty cache.
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    define,
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        // Pre-bundle the heavy Memory/Documents libs at dev-server start.
        // Otherwise Vite discovers them on first dynamic import and triggers a
        // full page reload to re-optimize — which can orphan an in-flight
        // document ingest. (Irrelevant to production, where deps are bundled
        // ahead of time.)
        "pdfjs-dist",
        // The WORKER is a subpath entry — including the package root does NOT
        // cover it, and its first lazy import (first attach of a PDF) still
        // triggered the discover→re-optimize→full-reload that wipes the staged
        // attachment mid-flight. Found via the E2E trace on 2026-09-06: the
        // .vite/deps fetch for pdf__worker__min__mjs, three HMR reconnects,
        // and a chip that never came back.
        "pdfjs-dist/build/pdf.worker.min.mjs",
        "mammoth",
        "@huggingface/transformers",
        // The photo-OCR SDK: its first lazy import (first scan in a dev
        // session) hit the same discover→re-optimize→reload, which the scan
        // dialog then reported as "QUON was updated in the meantime" — found
        // 2026-09-14 by the real-engine orientation spec, where every case
        // died the same way before the engine ever ran.
        "@paddleocr/paddleocr-js",
      ],
    },
    ssr: {
      // The frontend image is dist/ and nothing else — no node_modules — so
      // the SSR bundle must carry every package it imports. Vite's default
      // leaves dependencies external (fine for a server with node_modules,
      // fatal here): a fresh self-host install died on its first request with
      // ERR_MODULE_NOT_FOUND for "h3-v2", TanStack's aliased h3 import, on
      // 2026-11-02. `true` bundles all of them; scripts/check-ssr-externals.mjs
      // fails the gate if a bare import ever survives again.
      noExternal: true,
    },

    server: {
      host: "::",
      // strictPort: fail loudly instead of walking to the next free port. The
      // silent walk landed a second dev server on :8081 — the mini PC's
      // frontend port and one the bash-guard blocks the gate on — so "which
      // server am I looking at" became unanswerable and the guard fired against
      // the wrong process. QUON_DEV_PORT lets a parallel session pick its own.
      port: Number(process.env.QUON_DEV_PORT ?? 8080),
      strictPort: true,
      // Proxy /api → the scrubber backend so the browser talks to a single
      // origin in dev (matches the Caddy /api/* setup in prod). This makes the
      // session cookie + readable CSRF cookie first-party, so auth works
      // without CORS.
      proxy: {
        "/api": {
          // Overridable for a machine where :8000 is taken (QUON_DEV_API_TARGET);
          // the default stays the documented dev port.
          target: process.env.QUON_DEV_API_TARGET ?? "http://localhost:8000",
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ""),
        },
      },
    },
    preview: {
      // `vite preview` behind a reverse proxy needs the public hostname
      // allow-listed (Host-header check). Comma-separated env override;
      // unset → the check is disabled (preview binds localhost and sits
      // behind the operator's proxy, so this is an acceptable default).
      allowedHosts: process.env.QUON_ALLOWED_HOSTS
        ? process.env.QUON_ALLOWED_HOSTS.split(",").map((h) => h.trim())
        : true,
    },
    plugins: [
      e2eLocalModels(),
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart({
        // Redirect TanStack Start's bundled server entry to src/server.ts (our
        // SSR error wrapper). nitro/vite builds from this.
        server: { entry: "server" },
        // NATIVE (Tauri) BUILD: emit a prerendered SPA shell instead of relying
        // on the SSR server at runtime. A desktop app ships static files —
        // there is no Node process to render per request — and QUON is
        // client-heavy anyway (crypto, sync, IndexedDB, embeddings all run in
        // the page).
        //
        // What SSR does today and why losing it is fine HERE: it mints the CSP
        // nonce and reads the `quon_lang` cookie. A native shell has no CSP at
        // all, and the language falls back to the device preference
        // (getLangPref: cookie → localStorage → "de"). Both handshakes are
        // optional lookups (`__quonCspNonce?.()`), so they simply return
        // undefined.
        //
        // Gated by an env var so the hosted build is byte-for-byte unchanged.
        ...(process.env.QUON_NATIVE
          ? { spa: { enabled: true, prerender: { enabled: true, outputPath: "/index.html" } } }
          : {}),
      }),
      viteReact(),
    ],
  };
});
