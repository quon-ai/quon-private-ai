import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

import base from "../../playwright.config";

/**
 * README walkthrough capture - not part of the E2E gate.
 *
 * Reuses the E2E throwaway stack (same webServer commands, ports and env from
 * the main config), but runs a single Chromium project at a fixed 1280x800
 * viewport and records video. The spec additionally takes timed screenshots,
 * which tests/capture/assemble-gif.mjs turns into docs/assets/quon-walkthrough-en.gif.
 *
 *   npx playwright test -c tests/capture/playwright.config.ts
 */
// The main config's webServer commands use repo-relative paths, and a
// webServer's cwd defaults to the directory of the config that declares it.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// GLiNER ON for the backend (index 0): production runs it, and without it the
// local tier alone does not catch the person name in the walkthrough message.
// Offline: the model must come from the local Hugging Face cache.
const servers = (Array.isArray(base.webServer) ? base.webServer : [base.webServer]).flatMap(
  (s, i) =>
    s
      ? [
          {
            ...s,
            cwd: REPO_ROOT,
            timeout: i === 0 ? 180_000 : s.timeout,
            env: i === 0 ? { GLINER_ENABLED: "true", HF_HUB_OFFLINE: "1" } : s.env,
          },
        ]
      : [],
);

export default defineConfig({
  testDir: ".",
  testMatch: /walkthrough\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  outputDir: "../../test-results/capture",
  use: {
    ...base.use,
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    video: { mode: "on", size: { width: 1280, height: 800 } },
    trace: "off",
    screenshot: "off",
    storageState: base.use?.storageState,
  },
  projects: [{ name: "chromium" }],
  webServer: servers,
});
