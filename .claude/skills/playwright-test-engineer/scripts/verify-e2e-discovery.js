#!/usr/bin/env node
/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

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
      "No node_modules found (neither in the package nor at the repo root). Run `pnpm install` at the repo root first — " +
        "this check needs Playwright's own loader, which needs real installed dependencies."
    );
    process.exit(2);
  }
  if (!fs.existsSync(path.join(pkgDir, "playwright.config.ts"))) {
    console.error(
      `No playwright.config.ts in ${path.relative(repoRoot, pkgDir)} — nothing to discover yet (bootstrap case).`
    );
    process.exit(2);
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
