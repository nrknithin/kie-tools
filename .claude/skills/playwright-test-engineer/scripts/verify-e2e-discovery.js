#!/usr/bin/env node
"use strict";
/**
 * The strongest guardrail available: hand the spec(s) to Playwright's own test loader
 * instead of our own regex approximations. `playwright test --list` resolves every import,
 * evaluates fixtures, and type-checks-enough-to-load without starting a browser or the
 * webServer — so a hallucinated import/fixture that our static checks somehow missed will
 * still surface here as a hard error.
 *
 * Requires the package's node_modules to be installed (`pnpm install` at the repo root).
 * If they aren't, this script fails fast with that explanation rather than a confusing
 * Playwright stack trace — it's meant to run as a final check, not a first one.
 *
 * Usage: node verify-e2e-discovery.js <package-folder-name-or-path> [-- <extra playwright args>]
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { resolveRepoRoot, resolvePackageDir } = require("./lib/workspace");

function main() {
  const args = process.argv.slice(2);
  const dashIndex = args.indexOf("--");
  const query = dashIndex === -1 ? args[0] : args.slice(0, dashIndex)[0];
  const extraArgs = dashIndex === -1 ? [] : args.slice(dashIndex + 1);

  if (!query) {
    console.error("Usage: node verify-e2e-discovery.js <package-folder-name-or-path> [-- <extra playwright args>]");
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

  if (
    !fs.existsSync(path.join(pkgDir, "node_modules")) &&
    !fs.existsSync(path.join(repoRoot, "node_modules", ".modules.yaml"))
  ) {
    console.error(
      "No node_modules found (neither in the package nor at the repo root) — this check needs Playwright's own " +
        "loader, which needs real installed dependencies. Run `pnpm install` at the repo root to enable it.\n" +
        "Not a silent gap in the meantime: check-imports.js, check-fixture-wiring.js, and check-spec-conventions.js " +
        "(already run by run-all-checks.js by default) are the static equivalent — weaker than Playwright's own " +
        'resolution, but they still catch hallucinated imports/fixtures/naming. Don\'t treat this as "nothing was verified".'
    );
    process.exit(4); // distinct from 2 (bad usage): "environment can't run this check right now", not "you called it wrong"
  }
  if (!fs.existsSync(path.join(pkgDir, "playwright.config.ts"))) {
    console.error(
      `No playwright.config.ts in ${path.relative(repoRoot, pkgDir)} — nothing to discover yet (bootstrap case). ` +
        "Run scripts/scaffold-package-e2e.js first if you're bootstrapping Playwright into this package."
    );
    process.exit(4);
  }

  const result = spawnSync("pnpm", ["exec", "playwright", "test", "--list", ...extraArgs], {
    cwd: pkgDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    console.error(`Failed to run pnpm/playwright: ${result.error.message}`);
    process.exit(2);
  }
  process.exit(result.status ?? 1);
}

main();
