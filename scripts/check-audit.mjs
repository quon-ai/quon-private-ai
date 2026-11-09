#!/usr/bin/env node
/**
 * `npm audit` gate with a DOCUMENTED exception list.
 *
 * Why not raw `npm audit --audit-level=high`: an advisory with **no fix
 * available** in an **unreachable** dependency keeps the gate red through no
 * action anyone can take, and a permanently red gate trains people to ignore
 * red, at which point it catches nothing and real advisories sit unnoticed
 * behind the known one. npm has no built-in ignore mechanism, so this wrapper
 * adds one with the two properties an exception must have: a written reason
 * and an expiry, after which it must be re-justified.
 *
 * Fails on any high/critical advisory in production dependencies that is not
 * allow-listed. Prints allow-listed hits so they stay visible, never silent.
 */

import { execSync } from "node:child_process";

/** GHSA id -> { reason, expires (YYYY-MM-DD), addedBy } */
const ALLOW = new Map([
  // Currently empty. Entry shape:
  //   ["GHSA-xxxx", { reason, expires: "YYYY-MM-DD", addedBy }]
]);

let report;
try {
  // npm audit exits non-zero when advisories exist - capture output either way.
  report = execSync("npm audit --omit=dev --json", {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  report = err.stdout ?? "";
  if (!report) {
    console.error("npm audit produced no output:", err.message);
    process.exit(1);
  }
}

const audit = JSON.parse(report);
const vulns = audit.vulnerabilities ?? {};
const today = new Date().toISOString().slice(0, 10);

const blocking = [];
const excepted = [];
const expired = [];

for (const [name, v] of Object.entries(vulns)) {
  if (!["high", "critical"].includes(v.severity)) continue;
  // `via` mixes advisory objects (direct) and package-name strings (transitive
  // chains); only the objects carry GHSA urls.
  const advisories = (v.via ?? []).filter((x) => typeof x === "object");
  if (advisories.length === 0) continue; // transitive echo of a package listed elsewhere
  for (const a of advisories) {
    const ghsa = (a.url ?? "").split("/").pop() ?? "";
    const entry = ALLOW.get(ghsa);
    const line = `${name}: ${a.title} [${ghsa}] (${v.severity})`;
    if (!entry) blocking.push(line);
    else if (entry.expires < today) expired.push(`${line} — exception EXPIRED ${entry.expires}`);
    else excepted.push(`${line}\n      allowed until ${entry.expires}: ${entry.reason}`);
  }
}

if (excepted.length) {
  console.log("Allow-listed advisories (visible on purpose, never silent):");
  for (const e of excepted) console.log(`  - ${e}`);
}
if (expired.length) {
  console.error(
    "\nExpired exceptions — re-justify them in scripts/check-audit.mjs or fix the dep:",
  );
  for (const e of expired) console.error(`  - ${e}`);
}
if (blocking.length) {
  console.error("\nBlocking advisories (high/critical, production, not excepted):");
  for (const b of blocking) console.error(`  - ${b}`);
}

if (blocking.length || expired.length) process.exit(1);
console.log(
  `\nOK: no unexcepted high/critical production advisories (${excepted.length} documented exception${excepted.length === 1 ? "" : "s"}).`,
);
