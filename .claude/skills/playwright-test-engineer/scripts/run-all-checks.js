#!/usr/bin/env node
"use strict";
/**
 * Single entry point tying every guardrail script together. This is what the skill should
 * actually run at its gates (Step 6a before writing files, Step 7a before declaring done,
 * and as the deterministic backbone of Mode 2's report) instead of relying on unaided model
 * judgment. Each sub-check is deterministic and independent of what the model believes it did.
 *
 * Usage:
 *   node run-all-checks.js <package-folder-name-or-path> [options]
 *
 * Options:
 *   --plan <path>          also run verify-plan-paths.js against this TEST_PLAN.md
 *   --files <f1,f2,...>    limit check-imports/check-license-header to these files
 *                          (defaults to every .ts file under the package's tests-e2e/)
 *   --with-playwright-list also run verify-e2e-discovery.js (needs node_modules installed;
 *                          skipped by default since it's slow and environment-dependent)
 *
 * Exit code is 0 only if every check that ran either passed or was explicitly non-blocking
 * (e.g. "unconfigured" license header, which is a distinct outcome — see check-license-header.js).
 */

const path = require("path");
const { spawnSync } = require("child_process");
const { resolveRepoRoot, walkFiles, resolvePackageDir } = require("./lib/workspace");

function runNode(scriptName, args) {
  const scriptPath = path.join(__dirname, scriptName);
  const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: "utf8" });
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (e) {
    // Non-JSON stdout (e.g. a usage error) — keep raw.
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, parsed };
}

function main() {
  const argv = process.argv.slice(2);
  const query = argv[0];
  if (!query) {
    console.error(
      "Usage: node run-all-checks.js <package-folder-name-or-path> [--plan <path>] [--files a.ts,b.ts] [--with-playwright-list]"
    );
    process.exit(2);
  }
  function valueAfterFlag(flag) {
    const idx = argv.indexOf(flag);
    if (idx === -1) return undefined;
    const value = argv[idx + 1];
    if (!value || value.startsWith("--")) {
      console.error(`"${flag}" requires a value (got ${value === undefined ? "nothing" : `"${value}"`}).`);
      process.exit(2);
    }
    return value;
  }

  const planPath = valueAfterFlag("--plan") || null;
  const explicitFilesArg = valueAfterFlag("--files");
  const explicitFiles = explicitFilesArg ? explicitFilesArg.split(",") : null;
  const withPlaywrightList = argv.includes("--with-playwright-list");

  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    console.error("Could not find repo root.");
    process.exit(2);
  }
  const pkgDir = resolvePackageDir(repoRoot, query);
  if (!pkgDir) {
    console.error(JSON.stringify(runNode("list-target-packages.js", ["--check", query]).parsed, null, 2));
    process.exit(2);
  }

  const testsE2eDir = path.join(pkgDir, "tests-e2e");
  const files = explicitFiles || walkFiles(testsE2eDir, (n) => n.endsWith(".ts"));

  const report = { pkgDir: path.relative(repoRoot, pkgDir), filesChecked: files.length, checks: {} };
  let blocking = false;

  if (files.length > 0) {
    const imports = runNode("check-imports.js", files);
    report.checks.imports = imports.parsed || { error: imports.stderr };
    if (imports.status !== 0) blocking = true;

    const headers = runNode("check-license-header.js", files);
    report.checks.licenseHeaders = headers.parsed || { error: headers.stderr };
    if (headers.status === 1) blocking = true; // 3 (unconfigured) is non-blocking by design
  } else {
    report.checks.imports = { note: "no .ts files under tests-e2e/ yet — bootstrap case" };
    report.checks.licenseHeaders = { note: "no .ts files under tests-e2e/ yet — bootstrap case" };
  }

  const fixtures = runNode("check-fixture-wiring.js", [pkgDir]);
  report.checks.fixtureWiring = fixtures.parsed || { error: fixtures.stderr };
  if (fixtures.status !== 0) blocking = true;

  const config = runNode("check-playwright-config.js", [pkgDir]);
  report.checks.playwrightConfig = config.parsed || { error: config.stderr };
  if (config.status !== 0) blocking = true;

  const conventions = runNode("check-spec-conventions.js", [pkgDir]);
  report.checks.specConventions = conventions.parsed || { error: conventions.stderr };
  if (conventions.status !== 0) blocking = true;

  if (planPath) {
    const plan = runNode("verify-plan-paths.js", [planPath, pkgDir]);
    report.checks.planPaths = plan.parsed || { error: plan.stderr };
    if (plan.status !== 0) blocking = true;
  }

  if (withPlaywrightList) {
    const discovery = spawnSync(process.execPath, [path.join(__dirname, "verify-e2e-discovery.js"), pkgDir], {
      encoding: "utf8",
    });
    report.checks.playwrightDiscovery = { status: discovery.status, output: discovery.stdout + discovery.stderr };
    if (discovery.status !== 0) blocking = true;
  }

  console.log(JSON.stringify(report, null, 2));

  const unconfiguredHeaderCount = (report.checks.licenseHeaders && report.checks.licenseHeaders.unconfigured) || [];
  if (unconfiguredHeaderCount.length > 0) {
    console.error(
      `\nNote: ${unconfiguredHeaderCount.length} file(s) belong to a workspace group whose license header ` +
        `isn't configured yet (see assets/.ibm-header) — not checked, not a pass. Say so explicitly, don't fold it into a clean verdict.`
    );
  }
  if (blocking) {
    console.error("\nOne or more checks failed. Do not present this package's tests as done until they pass.");
    process.exit(1);
  }
  console.error("\nAll guardrail checks passed (or were explicitly non-blocking).");
}

main();
