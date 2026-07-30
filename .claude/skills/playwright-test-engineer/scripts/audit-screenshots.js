#!/usr/bin/env node
"use strict";
/**
 * Grounds Mode 2 §2/§4 (screenshot-related test-quality and flakiness observations) in a real
 * cross-reference between `tests-e2e/__screenshots__/` baseline images and the
 * `toHaveScreenshot("...")` calls that reference them. Packages here accumulate hundreds of
 * baselines (dmn-editor alone has 470), which is far past the point of checking by hand.
 *
 * Per `packages/playwright-base/playwright.config.ts`'s `snapshotPathTemplate`
 * (`{testDir}/__screenshots__/{projectName}/{testFileDir}/{arg}{ext}`), a baseline's path is
 * `__screenshots__/<project>/<specsDirRelativeToTestsE2e>/<name>.png` — so a screenshot is
 * "orphaned" if no spec file directly inside that same relative directory calls
 * `toHaveScreenshot("<name>.png")`. This only proves the FILENAME is unreferenced, not that
 * the underlying test scenario is gone — always confirm before deleting a baseline.
 *
 * Usage: node audit-screenshots.js <package-folder-name-or-path>
 */

const fs = require("fs");
const path = require("path");
const { resolveRepoRoot, walkFiles, resolvePackageDir } = require("./lib/workspace");

function extractReferencedScreenshotNames(source) {
  const names = new Set();
  const re = /toHaveScreenshot\(\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(source)) !== null) names.add(m[1]);
  return names;
}

function main() {
  const query = process.argv[2];
  if (!query) {
    console.error("Usage: node audit-screenshots.js <package-folder-name-or-path>");
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

  const testsE2eDir = path.join(pkgDir, "tests-e2e");
  const screenshotsDir = path.join(testsE2eDir, "__screenshots__");

  if (!fs.existsSync(screenshotsDir)) {
    console.log(JSON.stringify({ note: "No tests-e2e/__screenshots__/ found — nothing to audit yet." }, null, 2));
    process.exit(0);
  }

  // referencedByDir["drdArtifacts"] = Set of "name.png" referenced by specs directly in that dir.
  const specFiles = walkFiles(testsE2eDir, (n) => n.endsWith(".spec.ts"));
  const referencedByDir = new Map();
  for (const specFile of specFiles) {
    const dir = path.relative(testsE2eDir, path.dirname(specFile));
    const names = extractReferencedScreenshotNames(fs.readFileSync(specFile, "utf8"));
    if (names.size === 0) continue;
    if (!referencedByDir.has(dir)) referencedByDir.set(dir, new Set());
    for (const n of names) referencedByDir.get(dir).add(n);
  }

  const screenshotFiles = walkFiles(screenshotsDir, (n) => n.endsWith(".png"));
  const orphaned = [];
  const usedCount = { total: 0 };
  const seenBaselines = new Set(); // "<dirKey>::<name>" across all projects, for the reverse check below

  for (const file of screenshotFiles) {
    const relToScreenshots = path.relative(screenshotsDir, file); // "<project>/<dir...>/<name>.png"
    const parts = relToScreenshots.split(path.sep);
    const project = parts[0];
    const name = parts[parts.length - 1];
    // dirKey must match the spec-side key exactly (path.relative returns "" for the same dir) —
    // "(top-level)" is only a display label, never used for the lookup itself.
    const dirKey = parts.slice(1, -1).join(path.sep);
    const dirLabel = dirKey || "(top-level)";

    seenBaselines.add(`${dirKey}::${name}`);

    const referenced = referencedByDir.get(dirKey);
    if (referenced && referenced.has(name)) {
      usedCount.total++;
    } else {
      orphaned.push({ file: path.relative(repoRoot, file), project, dir: dirLabel, name });
    }
  }

  // Reverse check: a toHaveScreenshot(...) call with no baseline in ANY project for its dir —
  // informational only (a fresh scenario just needs `--update-snapshots` run once), not a problem.
  const neverGenerated = [];
  for (const [dirKey, names] of referencedByDir.entries()) {
    for (const name of names) {
      const existsInAnyProject = seenBaselines.has(`${dirKey}::${name}`);
      if (!existsInAnyProject) neverGenerated.push({ dir: dirKey || "(top-level)", name });
    }
  }

  const report = {
    pkgDir: path.relative(repoRoot, pkgDir),
    screenshotFilesChecked: screenshotFiles.length,
    referencedCallsFound: [...referencedByDir.values()].reduce((sum, s) => sum + s.size, 0),
    orphanedBaselines: orphaned,
    neverGeneratedYet: neverGenerated,
  };

  console.log(JSON.stringify(report, null, 2));
  console.error(
    `\n${orphaned.length}/${screenshotFiles.length} baseline image(s) have no matching toHaveScreenshot(...) call in their spec directory — ` +
      `candidates for cleanup (verify the underlying scenario was actually removed, not just renamed, before deleting). ` +
      `${neverGenerated.length} referenced name(s) have no baseline in any project yet (expected for brand-new scenarios pending a snapshot-update run).`
  );
}

main();
