#!/usr/bin/env node
"use strict";
/**
 * Step 1 guardrail: produce the package list from the filesystem, not from memory/guessing.
 * Scoped to packages/, packages-bamoe/, and packages-bamoe-artifacts/ — Playwright is never
 * used under examples/ or the top-level scripts/ workspace group (verified, not assumed; see
 * lib/workspace.js's WORKSPACE_GLOB_DIRS comment), so neither is scanned here.
 *
 * Usage:
 *   node list-target-packages.js                 # JSON: { withPlaywright: [...], all: [...] }
 *   node list-target-packages.js --check <name>   # exit 0 + print resolved dir if <name> is a
 *                                                  # real package folder or workspace package
 *                                                  # name; exit 1 + suggestions if not.
 */

const path = require("path");
const { resolveRepoRoot, listWorkspacePackages, listPlaywrightPackages } = require("./lib/workspace");

function main() {
  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    console.error("Could not find repo root (no pnpm-workspace.yaml found above cwd or script dir).");
    process.exit(2);
  }

  const args = process.argv.slice(2);
  if (args[0] === "--check") {
    const query = args[1];
    if (!query) {
      console.error("Usage: node list-target-packages.js --check <package-name-or-folder>");
      process.exit(2);
    }
    checkPackage(repoRoot, query);
    return;
  }

  const all = listWorkspacePackages(repoRoot);
  const withPlaywright = listPlaywrightPackages(repoRoot);

  const result = {
    repoRoot,
    withPlaywright: withPlaywright.map((p) => ({ name: p.name, group: p.group, folder: p.folder })),
    all: all.map((p) => ({ name: p.name, group: p.group, folder: p.folder })),
  };
  console.log(JSON.stringify(result, null, 2));
}

function checkPackage(repoRoot, query) {
  const all = listWorkspacePackages(repoRoot);
  const match = all.find((p) => p.name === query || p.folder === query || p.dir === path.resolve(query));

  if (match) {
    const hasPlaywright = require("fs").existsSync(path.join(match.dir, "playwright.config.ts"));
    console.log(
      JSON.stringify(
        {
          found: true,
          name: match.name,
          folder: match.folder,
          group: match.group,
          dir: path.relative(repoRoot, match.dir),
          hasPlaywrightConfig: hasPlaywright,
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  console.log(
    JSON.stringify(
      {
        found: false,
        query,
        message: `"${query}" is not a package folder name or package.json "name" under packages/, packages-bamoe/, or packages-bamoe-artifacts/.`,
        didYouMean: all
          .map((p) => p.folder)
          .filter((f) => f.toLowerCase().includes(query.toLowerCase()) || query.toLowerCase().includes(f.toLowerCase()))
          .slice(0, 10),
      },
      null,
      2
    )
  );
  process.exit(1);
}

main();
