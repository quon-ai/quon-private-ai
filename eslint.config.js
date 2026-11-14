import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // `.venv/**` keeps `eslint .` from linting bundled JS inside the Python
  // scrubber's virtualenv (e.g. coverage's HTML assets when pytest-cov is
  // installed) - third-party files that would otherwise flood lint with errors.
  // `public/ort/**` is the vendored ONNX Runtime WASM (copied from node_modules
  // by scripts/copy-ort.mjs) - minified third-party glue, not our source.
  {
    // src-tauri/target is Rust's build dir: it contains GENERATED JS (Tauri's
    // api-iife bundles) and binary-ish codegen assets that eslint tries to
    // parse. Same class as the .venv exclusion - never our source.
    ignores: [
      "dist",
      ".output",
      ".vinxi",
      "**/.venv/**",
      "public/ort/**",
      "tests/e2e/.models/**",
      "src-tauri/target/**",
      "src-tauri/gen/**",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // A file route exports `Route` and keeps its page component local; the router
    // plugin owns hot reload there, so the fast-refresh rule has nothing to say.
    files: ["src/routes/**/*.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  eslintPluginPrettier,
);
