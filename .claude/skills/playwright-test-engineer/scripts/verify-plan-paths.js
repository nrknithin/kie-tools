#!/usr/bin/env node
"use strict";
/**
 * Step 5a/6a guardrail: a TEST_PLAN.md is only as trustworthy as the file paths it cites.
 * Extracts every path referenced in "**Covers**:", "**File**:", and
 * "**Fixtures/utilities used**:" lines (the assets/TEST_PLAN-template.md fields) and checks
 * each one — either as a workspace-package import (@kie-tools/...) or as a path relative to
 * the repo root / the target package's own root.
 *
 * "**Covers**:" always names EXISTING source — those are hard failures if missing (a scenario
 * that "covers" a file that doesn't exist is describing something that isn't there).
 * "**File**:" names the NEW spec file the scenario will produce in Step 7a, so non-existence
 * there is expected and only checked for naming convention, never flagged as a problem.
 * "**Fixtures/utilities used**:" may legitimately name a fixture that doesn't exist yet (the
 * template's own convention for marking new fixtures) — missing ones are reported as notes,
 * not hard failures, since Step 7a is expected to create them.
 *
 * This does not (and cannot) verify that a scenario's prose description is semantically
 * correct — only that the concrete file paths it claims to cover are real, not invented.
 *
 * Usage: node verify-plan-paths.js <TEST_PLAN.md path> <package-folder-name-or-path>
 */

const fs = require("fs");
const path = require("path");
const { resolveRepoRoot, listWorkspacePackages, buildNameMap, resolveWorkspaceImport } = require("./lib/workspace");

function resolvePackageDir(repoRoot, query) {
  if (fs.existsSync(query) && fs.statSync(query).isDirectory()) return path.resolve(query);
  const pkgs = listWorkspacePackages(repoRoot).filter((p) => p.group !== "scripts");
  const match = pkgs.find((p) => p.name === query || p.folder === query);
  return match ? match.dir : null;
}

function extractCitedPaths(planSource) {
  const re = /\*\*(Covers|File|Fixtures\/utilities used)\*\*:\s*(.+)/g;
  const cited = [];
  let m;
  while ((m = re.exec(planSource)) !== null) {
    const field = m[1];
    const line = m[2];
    const pathRe = /`([^`]+)`/g;
    let p;
    while ((p = pathRe.exec(line)) !== null) cited.push({ field, candidate: p[1] });
  }
  return cited;
}

function looksLikePath(candidate) {
  // Filter out plain prose/placeholders like "(existing, from ...)" fragments or bare identifiers.
  return /[./]/.test(candidate) && !candidate.includes(" ");
}

function main() {
  const [planPath, pkgQuery] = process.argv.slice(2);
  if (!planPath || !pkgQuery) {
    console.error("Usage: node verify-plan-paths.js <TEST_PLAN.md path> <package-folder-name-or-path>");
    process.exit(2);
  }
  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    console.error("Could not find repo root.");
    process.exit(2);
  }
  if (!fs.existsSync(planPath)) {
    console.error(`Plan file not found: ${planPath}`);
    process.exit(2);
  }
  const pkgDir = resolvePackageDir(repoRoot, pkgQuery);
  if (!pkgDir) {
    console.error(`Could not resolve package "${pkgQuery}".`);
    process.exit(2);
  }

  const nameMap = buildNameMap(listWorkspacePackages(repoRoot));
  const planSource = fs.readFileSync(planPath, "utf8");
  const cited = extractCitedPaths(planSource).filter((c) => looksLikePath(c.candidate));
  const seen = new Set();
  const unique = cited.filter((c) => {
    const key = `${c.field}::${c.candidate}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const problems = []; // hard failures — always block
  const notes = []; // informational — expected to not exist yet (new file/fixture)
  const verified = [];

  function existsAsWorkspaceImportOrPath(candidate) {
    const ws = resolveWorkspaceImport(candidate, nameMap);
    if (ws.matched) {
      if (ws.status === "resolved") return { kind: "resolved", value: path.relative(repoRoot, ws.path) };
      if (ws.status === "requires-build") return { kind: "requires-build", value: ws.path ? path.relative(repoRoot, ws.path) : null };
      return { kind: "unresolved-workspace", value: `"${candidate}" matches workspace package "${ws.packageName}" but subpath "${ws.subpath}" doesn't exist (and isn't a dist/ path)` };
    }
    const fromPkg = path.join(pkgDir, candidate);
    const fromRoot = path.join(repoRoot, candidate);
    if (fs.existsSync(fromPkg)) return { kind: "resolved", value: path.relative(repoRoot, fromPkg) };
    if (fs.existsSync(fromRoot)) return { kind: "resolved", value: path.relative(repoRoot, fromRoot) };
    return { kind: "not-found" };
  }

  for (const { field, candidate } of unique) {
    const result = existsAsWorkspaceImportOrPath(candidate);

    if (result.kind === "unresolved-workspace") {
      // Looked like a workspace package but the subpath is definitely wrong — always a hard failure.
      problems.push({ field, candidate, issue: result.value });
      continue;
    }
    if (result.kind === "requires-build") {
      notes.push({ field, candidate, note: result.value ? `dist/ output not built yet (src/ mirror exists at ${result.value})` : "dist/ output not built yet and no src/ mirror found — verify manually once built" });
      continue;
    }
    if (result.kind === "resolved") {
      verified.push({ field, candidate, resolvedAs: result.value });
      continue;
    }

    if (field === "Covers") {
      problems.push({ field, candidate, issue: `"Covers" must reference existing source — no file found relative to package root (${path.relative(repoRoot, pkgDir)}) or repo root` });
    } else if (field === "File") {
      const validNaming = /^tests-e2e\/.+\/[a-z][a-zA-Z0-9]*\.spec\.ts$/.test(candidate) || /^[a-z][a-zA-Z0-9]*\.spec\.ts$/.test(path.basename(candidate));
      if (!validNaming) {
        problems.push({ field, candidate, issue: 'planned spec file name should be camelCase.spec.ts under tests-e2e/<featureGroup>/' });
      } else {
        notes.push({ field, candidate, note: "does not exist yet — expected, this is the file Step 7a will create" });
      }
    } else {
      notes.push({ field, candidate, note: "fixture/utility does not exist yet — expected if the plan marks it as new" });
    }
  }

  console.log(JSON.stringify({ planPath, pkgDir: path.relative(repoRoot, pkgDir), pathsChecked: unique.length, verified, notes, problems }, null, 2));

  if (problems.length > 0) {
    console.error(`\n${problems.length} path(s) cited in the plan don't correspond to real files. Fix the plan (or the scenario) before implementation.`);
    process.exit(1);
  }
  console.error(`\nAll ${verified.length} cited path(s) in the plan resolve to real files.`);
}

main();
