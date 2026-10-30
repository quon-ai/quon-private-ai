#!/usr/bin/env node
/**
 * Supply-chain guard: fail if a production dependency resolves to a version
 * published less than MIN_AGE_HOURS ago.
 *
 * Why this exists as a script: it used to live in `bunfig.toml` as bun's
 * `minimumReleaseAge = 86400`. Nothing in this project ever ran bun — CI,
 * the deploy and local installs all use npm — so the guard was inert while
 * reading like an active control. Deleting the file without replacing the
 * intent would have quietly lowered the bar, so the rule moved here, where it
 * actually runs (see .github/workflows/supply-chain.yml).
 *
 * What it defends against: the compromised-maintainer / typosquat pattern,
 * where a malicious version is published and pulled into builds within hours.
 * `npm audit` cannot see those — an advisory does not exist yet. Waiting a day
 * is the cheap, boring mitigation: by then the ecosystem has usually noticed.
 *
 * Deliberately PRODUCTION dependencies only, matching `npm audit --omit=dev`:
 * a dev-tool release never reaches a user's browser.
 *
 * Usage: node scripts/check-release-age.mjs [--hours 24]
 * Exit 0 = clean, 1 = a package is too fresh (or the registry could not be
 * reached for one — unknown age is treated as a failure, not a pass).
 */

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const hoursArg = args.indexOf("--hours");
const MIN_AGE_HOURS = hoursArg !== -1 ? Number(args[hoursArg + 1]) : 24;

/** Names to skip, with a reason. Every entry weakens the guard — the bun config
 *  carried exactly one, for the same package, for the same reason. */
const ALLOW = new Map([
  [
    "@lovable.dev/vite-tanstack-config",
    "build-time only (vite config) and pinned; it never ships to a browser",
  ],
]);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));

// Resolve each production dependency to the version the lockfile actually
// installs — the range in package.json is not what lands on disk.
const wanted = new Set(Object.keys(pkg.dependencies ?? {}));
const resolved = new Map();
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (!path.startsWith("node_modules/")) continue;
  const name = path.slice("node_modules/".length);
  // Nested copies (a/node_modules/b) are transitive — the direct tree is what
  // this project chose; transitive risk is npm audit's and the SBOM's job.
  if (name.includes("/node_modules/")) continue;
  if (wanted.has(name) && entry.version) resolved.set(name, entry.version);
}

const cutoffMs = MIN_AGE_HOURS * 3600 * 1000;
const now = Date.now();
const tooFresh = [];
const unknown = [];

await Promise.all(
  [...resolved].map(async ([name, version]) => {
    if (ALLOW.has(name)) return;
    try {
      // The FULL packument, deliberately: the abbreviated
      // `application/vnd.npm.install-v1+json` document omits `time`, which is
      // the one field this check is about.
      const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
      if (!res.ok) {
        unknown.push(`${name}@${version} (registry responded ${res.status})`);
        return;
      }
      const meta = await res.json();
      const published = meta.time?.[version];
      if (!published) {
        unknown.push(`${name}@${version} (no publish date in registry metadata)`);
        return;
      }
      const ageMs = now - Date.parse(published);
      if (ageMs < cutoffMs) {
        tooFresh.push(`${name}@${version} — published ${(ageMs / 3600000).toFixed(1)} h ago`);
      }
    } catch (err) {
      unknown.push(`${name}@${version} (${err instanceof Error ? err.message : String(err)})`);
    }
  }),
);

console.log(
  `Checked ${resolved.size} production dependencies against a ${MIN_AGE_HOURS} h minimum release age.`,
);
for (const [name, why] of ALLOW) {
  if (resolved.has(name)) console.log(`  allow-listed: ${name} — ${why}`);
}

if (unknown.length) {
  console.error("\nCould not determine the publish date for:");
  for (const u of unknown) console.error(`  ${u}`);
}
if (tooFresh.length) {
  console.error("\nToo fresh to trust yet:");
  for (const t of tooFresh) console.error(`  ${t}`);
  console.error(
    "\nWait out the window and re-run, or add an allow-list entry in this file\n" +
      "with a reason — after confirming with a human that the release is expected.",
  );
}

process.exit(tooFresh.length || unknown.length ? 1 : 0);
