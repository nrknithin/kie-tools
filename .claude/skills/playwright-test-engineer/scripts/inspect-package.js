#!/usr/bin/env node
"use strict";
/**
 * Step 2 ("Package analysis") guardrail: everything in this script is a plain filesystem/text
 * fact — which test-e2e* scripts exist, what the playwright.config.ts looks like, how many
 * spec/fixture/screenshot files there are, which OTHER workspace packages this package's
 * tests-e2e/ actually imports from. None of it requires judgment, so none of it should be
 * something the model free-recalls or re-derives by skimming — it should read this instead,
 * then apply judgment on top (what a feature *means*, whether coverage is *adequate*, etc.).
 *
 * Usage: node inspect-package.js <package-folder-name-or-path>
 */

const fs = require("fs");
const path = require("path");
const { resolveRepoRoot, listWorkspacePackages, walkFiles, readJson, extractImportSpecifiers, resolveWorkspaceImport, buildNameMap } = require("./lib/workspace");

function resolvePackageDir(repoRoot, query) {
  if (fs.existsSync(query) && fs.statSync(query).isDirectory()) return path.resolve(query);
  const pkgs = listWorkspacePackages(repoRoot).filter((p) => p.group !== "scripts");
  const match = pkgs.find((p) => p.name === query || p.folder === query);
  return match ? match.dir : null;
}

function inspectPackageJson(pkgDir) {
  const pkgJsonPath = path.join(pkgDir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) return null;
  const pkg = readJson(pkgJsonPath);
  const testE2eScripts = Object.fromEntries(Object.entries(pkg.scripts || {}).filter(([k]) => k.startsWith("test-e2e")));
  return {
    name: pkg.name,
    description: pkg.description || null,
    dependencies: Object.keys(pkg.dependencies || {}),
    devDependencies: Object.keys(pkg.devDependencies || {}),
    testE2eScripts,
  };
}

function inspectPlaywrightConfig(pkgDir) {
  const configPath = path.join(pkgDir, "playwright.config.ts");
  if (!fs.existsSync(configPath)) return { exists: false };
  const source = fs.readFileSync(configPath, "utf8");
  const mergesBase = /@kie-tools\/playwright-base\/playwright\.config/.test(source);
  const baseURLMatch = source.match(/baseURL:\s*`([^`]+)`/) || source.match(/baseURL:\s*["']([^"']+)["']/);
  const isStorybook = /iframe\.html/.test(source);
  const webServerIsArray = /webServer:\s*\[/.test(source);
  return {
    exists: true,
    mergesSharedBaseConfig: mergesBase,
    baseURLTemplate: baseURLMatch ? baseURLMatch[1] : null,
    servingShape: webServerIsArray ? "multi-server (full application)" : isStorybook ? "single storybook iframe" : "single webServer (non-storybook)",
  };
}

function inspectTestsE2e(pkgDir) {
  const testsE2eDir = path.join(pkgDir, "tests-e2e");
  if (!fs.existsSync(testsE2eDir)) return { exists: false };

  const specFiles = walkFiles(testsE2eDir, (n) => n.endsWith(".spec.ts"));
  const fixtureFiles = walkFiles(path.join(testsE2eDir, "__fixtures__"), (n) => n.endsWith(".ts"));
  const screenshotFiles = walkFiles(path.join(testsE2eDir, "__screenshots__"), () => true);
  const hasContainerization = fs.existsSync(path.join(testsE2eDir, "__containerization__"));
  const featureGroups = fs
    .readdirSync(testsE2eDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !["__fixtures__", "__screenshots__", "__containerization__"].includes(e.name))
    .map((e) => e.name);

  return {
    exists: true,
    specFileCount: specFiles.length,
    fixtureFileCount: fixtureFiles.length,
    screenshotFileCount: screenshotFiles.length,
    hasContainerization,
    topLevelFeatureGroups: featureGroups,
  };
}

/** Every workspace package (other than this one) that this package's tests-e2e/ imports from. */
function inspectCrossPackageImports(repoRoot, pkgDir, pkgName) {
  const testsE2eDir = path.join(pkgDir, "tests-e2e");
  if (!fs.existsSync(testsE2eDir)) return [];
  const nameMap = buildNameMap(listWorkspacePackages(repoRoot));
  const files = walkFiles(testsE2eDir, (n) => n.endsWith(".ts"));
  const found = new Map(); // otherPackageName -> Set of specifiers

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const specifier of extractImportSpecifiers(source)) {
      if (specifier.startsWith(".")) continue;
      const resolved = resolveWorkspaceImport(specifier, nameMap);
      if (resolved.matched && resolved.status !== "unresolved") {
        const otherName = specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
        // Only report if it actually IS a workspace package name and it's not this package itself.
        if (nameMap.has(otherName) && otherName !== pkgName) {
          if (!found.has(otherName)) found.set(otherName, new Set());
          found.get(otherName).add(specifier);
        }
      }
    }
  }
  return [...found.entries()].map(([name, specifiers]) => ({ package: name, importedSpecifiers: [...specifiers] }));
}

function main() {
  const query = process.argv[2];
  if (!query) {
    console.error("Usage: node inspect-package.js <package-folder-name-or-path>");
    process.exit(2);
  }
  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    console.error("Could not find repo root.");
    process.exit(2);
  }
  const pkgDir = resolvePackageDir(repoRoot, query);
  if (!pkgDir) {
    console.error(`Could not resolve package "${query}". Run list-target-packages.js --check "${query}" first.`);
    process.exit(2);
  }

  const packageJson = inspectPackageJson(pkgDir);
  const report = {
    pkgDir: path.relative(repoRoot, pkgDir),
    packageJson,
    playwrightConfig: inspectPlaywrightConfig(pkgDir),
    testsE2e: inspectTestsE2e(pkgDir),
    crossPackageImports: inspectCrossPackageImports(repoRoot, pkgDir, packageJson ? packageJson.name : null),
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
