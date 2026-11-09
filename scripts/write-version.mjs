/**
 * Stamp the build with an id and publish it as a static `version.json`.
 *
 * Why this exists: a running instance keeps the JavaScript it loaded. An
 * installed PWA is never reloaded just because the operator deployed, so after
 * a deploy the user goes on using the old code and reports bugs in features
 * that are already live. The client compares its compile-time id against this
 * file and offers a reload; see src/lib/appVersion.ts.
 *
 * Runs as `prebuild`, alongside copy-ort.mjs, so the file is in `public/` before
 * Vite copies it into the build output (and is git-ignored, like public/ort).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function buildId() {
  // An explicit id wins (CI / reproducible builds).
  if (process.env.QUON_BUILD_ID) return process.env.QUON_BUILD_ID;
  // A commit alone is not enough: we deploy the same commit more than once, and
  // two builds of it must still be distinguishable. Commit + build time is.
  let sha = "nogit";
  try {
    sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).toString().trim();
  } catch {
    /* not a git checkout (exported tree) - the timestamp alone still works */
  }
  return `${sha}-${Date.now().toString(36)}`;
}

const id = buildId();
const dir = join(root, "public");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "version.json"), `${JSON.stringify({ build: id })}\n`);
console.log(`[write-version] build id ${id}`);
