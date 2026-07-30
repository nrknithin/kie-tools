#!/usr/bin/env node
"use strict";
/**
 * Guardrail for hard constraint #4 ("don't duplicate infrastructure") and Mode 2's
 * "Fixture & config hygiene" section. Whether a playwright.config.ts correctly inherits the
 * shared base, or silently re-defines something the base already owns, is a mechanical text
 * fact — it shouldn't rest on the model's impression from skimming the file.
 *
 * Checks:
 *   1. The config imports "@kie-tools/playwright-base/playwright.config" and calls
 *      `merge(...)` on it (the repo-wide pattern — see references/repo-conventions.md).
 *   2. The config's own `defineConfig({...})` object doesn't redeclare a key that
 *      packages/playwright-base/playwright.config.ts already sets at the top level
 *      (testDir, outputDir, snapshotPathTemplate, fullyParallel, forbidOnly, retries,
 *      workers, reporter, expect) — redeclaring these silently drops the shared default
 *      instead of extending it, which is exactly the "duplicated infrastructure" this
 *      constraint exists to prevent.
 *
 * Usage: node check-playwright-config.js <package-folder-name-or-path>
 */

const fs = require("fs");
const path = require("path");
const { resolveRepoRoot, listWorkspacePackages, readJson } = require("./lib/workspace");

const SHARED_BASE_PACKAGE_NAME = "@kie-tools/playwright-base";

const BASE_OWNED_TOP_LEVEL_KEYS = ["testDir", "outputDir", "snapshotPathTemplate", "fullyParallel", "forbidOnly", "retries", "workers", "reporter", "expect"];

function resolvePackageDir(repoRoot, query) {
  if (fs.existsSync(query) && fs.statSync(query).isDirectory()) return path.resolve(query);
  const pkgs = listWorkspacePackages(repoRoot).filter((p) => p.group !== "scripts");
  const match = pkgs.find((p) => p.name === query || p.folder === query);
  return match ? match.dir : null;
}

function main() {
  const query = process.argv[2];
  if (!query) {
    console.error("Usage: node check-playwright-config.js <package-folder-name-or-path>");
    process.exit(2);
  }
  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    console.error("Could not find repo root.");
    process.exit(2);
  }
  const pkgDir = resolvePackageDir(repoRoot, query);
  if (!pkgDir) {
    console.error(`Could not resolve package "${query}".`);
    process.exit(2);
  }

  const pkgJsonPath = path.join(pkgDir, "package.json");
  const pkgName = fs.existsSync(pkgJsonPath) ? readJson(pkgJsonPath).name : null;
  if (pkgName === SHARED_BASE_PACKAGE_NAME) {
    // This IS the shared base config other packages merge over — it defines the keys this
    // script checks for elsewhere, so "does it import/merge itself" is a meaningless question.
    console.log(JSON.stringify({ note: `${SHARED_BASE_PACKAGE_NAME} is the shared base config itself — not a consumer of it, nothing to check.` }, null, 2));
    process.exit(0);
  }

  const configPath = path.join(pkgDir, "playwright.config.ts");
  if (!fs.existsSync(configPath)) {
    console.log(JSON.stringify({ note: "No playwright.config.ts — nothing to check yet (bootstrap case)." }, null, 2));
    process.exit(0);
  }

  const source = fs.readFileSync(configPath, "utf8");
  const findings = [];

  const importsBase = /from\s+["']@kie-tools\/playwright-base\/playwright\.config["']/.test(source);
  const callsMerge = /merge\(/.test(source);
  if (!importsBase) {
    findings.push({ severity: "high", rule: "missing-base-import", message: 'does not import "@kie-tools/playwright-base/playwright.config" — every Playwright-enabled package in this repo merges over the shared base' });
  }
  if (importsBase && !callsMerge) {
    findings.push({ severity: "high", rule: "missing-merge-call", message: "imports the shared base config but never calls merge(...) on it — it's imported but not actually applied" });
  }

  // Find the FIRST top-level defineConfig({...}) block (the package's own customConfig),
  // not the final merge(...) call, so we only inspect what this package itself declares.
  const customConfigMatch = source.match(/defineConfig\(\{([\s\S]*)\}\s*\)\s*;\s*\n\s*export default defineConfig\(merge/);
  const customConfigBody = customConfigMatch ? customConfigMatch[1] : source;

  for (const key of BASE_OWNED_TOP_LEVEL_KEYS) {
    const re = new RegExp(`(^|[{,\\s])${key}\\s*:`, "m");
    if (re.test(customConfigBody)) {
      findings.push({
        severity: "medium",
        rule: "redeclares-base-owned-key",
        message: `redeclares "${key}", which packages/playwright-base/playwright.config.ts already sets — this overwrites (via lodash/merge on objects it still merges, but replaces arrays/primitives) rather than extends the shared default; verify this is intentional`,
      });
    }
  }

  const bySeverity = { high: 0, medium: 0 };
  for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;

  console.log(JSON.stringify({ pkgDir: path.relative(repoRoot, pkgDir), importsBase, callsMerge, bySeverity, findings }, null, 2));

  if (bySeverity.high > 0) {
    console.error(`\n${bySeverity.high} high-severity config finding(s). This package's config does not correctly inherit the shared base.`);
    process.exit(1);
  }
  console.error(`\nConfig inheritance OK.${bySeverity.medium > 0 ? ` ${bySeverity.medium} redeclared-key note(s) reported above.` : ""}`);
}

main();
