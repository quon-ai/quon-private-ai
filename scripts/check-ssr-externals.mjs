#!/usr/bin/env node
// The production frontend image contains dist/ and nothing else, so every
// package the SSR bundle needs must be inside it. A bare import that survives
// bundling is a crash on the first request of a fresh install, and nothing
// else catches it: `vite dev`, the unit tests and the E2E all run with
// node_modules present.
import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";

const dir = "dist/server";
const files = [];
for (const d of [dir, join(dir, "assets")]) {
  try {
    for (const f of readdirSync(d))
      if (f.endsWith(".js") || f.endsWith(".mjs")) files.push(join(d, f));
  } catch {
    /* missing dir -> no files -> fails below */
  }
}
if (!files.length) {
  console.error("check-ssr-externals: no server bundle under dist/server — run the build first");
  process.exit(1);
}
const builtin = new Set(builtinModules);
const bare = new Map();
// Statement forms only: `import x from "pkg"`, `import "pkg"`, `export ... from "pkg"`,
// and dynamic `import("pkg")`. Anchored to a statement start so object keys and
// string literals inside code never match.
const re =
  /(?:^|[;}\n])\s*(?:import|export)\b(?:[^;"'`]*?\bfrom\s*)?["']([^"'./][^"']*)["']|\bimport\(\s*["']([^"'./][^"']*)["']\s*\)/g;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(re)) {
    const spec = (m[1] ?? m[2]).replace(/^node:/, "");
    if (spec.includes("${")) continue; // a computed URL inside a template literal (pdfjs), not a package
    const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    if (builtin.has(pkg)) continue;
    if (!bare.has(pkg)) bare.set(pkg, f);
  }
}
if (bare.size) {
  console.error(
    "check-ssr-externals: the SSR bundle still imports packages that are not in the image:",
  );
  for (const [pkg, f] of bare) console.error(`  ${pkg}  (first seen in ${f})`);
  console.error("Add them to ssr.noExternal in vite.config.ts.");
  process.exit(1);
}
console.log(`check-ssr-externals: ${files.length} server files, no bare package imports`);
