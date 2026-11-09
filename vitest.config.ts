/**
 * Vitest config - intentionally separate from vite.config.ts so the test run does
 * not pull in the TanStack Start / nitro SSR plugins. Just the `@/` path alias and
 * the React/JSX transform (so pure helpers living in .tsx files import cleanly).
 *
 * Tests are pure-logic regression tests (no DOM/network); run with `npm run test`.
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // `environment: "node"` means no DOM, so Web Storage should not exist -
    // yet the suite passed locally because Node 25 provides it as a built-in
    // and Node 20 (CI) does not. The shim makes the run identical on every
    // Node version; see the file for the full story.
    setupFiles: ["./tests/setup/webstorage.ts"],
  },
});
