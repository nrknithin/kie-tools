#!/usr/bin/env node
"use strict";
/**
 * Regression test for scripts/lib/workspace.js and check-playwright-config.js's self-case.
 * Every assertion here encodes a real bug found by hand-testing against this repo's actual
 * packages during development (not a synthetic/mocked scenario) — dist/ import resolution,
 * Node builtin detection, Playwright's `channel` fixture, the bare-"dist" subpath edge case,
 * and playwright-base's self-referential config check. None of these would be caught by
 * TypeScript or a linter; they're only caught by actually exercising the functions.
 *
 * Run this after any change to lib/workspace.js (or the scripts that depend on it) before
 * trusting the guardrail suite again. Exits non-zero if any assertion fails.
 *
 * Usage: node selftest.js
 */

const assert = require("assert");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  resolveRepoRoot,
  listWorkspacePackages,
  buildNameMap,
  listPlaywrightPackages,
  resolvePackageDir,
  resolveWorkspaceImport,
  isNodeBuiltinSpecifier,
  stripShebang,
  groupForFile,
  headerFilePathForGroup,
  PLAYWRIGHT_BUILTIN_FIXTURES,
} = require("./lib/workspace");

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push({ name, error: e.message });
  }
}

function main() {
  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    console.error("Could not find repo root — selftest needs a real checkout to test against.");
    process.exit(2);
  }
  const nameMap = buildNameMap(listWorkspacePackages(repoRoot));

  // --- resolveWorkspaceImport: dist/ subpaths (unbuilt output, not a hallucination) ---
  check("dist/ subpath with trailing segments resolves to requires-build with a src/ mirror", () => {
    const r = resolveWorkspaceImport("@kie-tools/bpmn-editor/dist/normalization/normalize", nameMap);
    assert.strictEqual(r.matched, true);
    assert.strictEqual(r.status, "requires-build");
    assert.ok(
      r.path && r.path.endsWith(path.join("src", "normalization", "normalize.ts")),
      `expected src mirror, got ${r.path}`
    );
  });

  check("bare 'dist' subpath (no trailing slash) also resolves to requires-build", () => {
    const r = resolveWorkspaceImport("@kie-tools/dmn-editor-standalone/dist", nameMap);
    assert.strictEqual(r.matched, true);
    assert.strictEqual(r.status, "requires-build");
    assert.ok(r.path && r.path.endsWith(path.join("src", "index.ts")), `expected src/index.ts mirror, got ${r.path}`);
  });

  check("real cross-package fixture import resolves directly", () => {
    const r = resolveWorkspaceImport(
      "@kie-tools/boxed-expression-component/tests-e2e/__fixtures__/boxedExpression",
      nameMap
    );
    assert.strictEqual(r.matched, true);
    assert.strictEqual(r.status, "resolved");
  });

  check("a genuinely hallucinated subpath (real package, fake file, not dist/) is 'unresolved'", () => {
    const r = resolveWorkspaceImport("@kie-tools/dmn-editor/src/this/does/not/exist.tsx", nameMap);
    assert.strictEqual(r.matched, true);
    assert.strictEqual(r.status, "unresolved");
  });

  check("a non-existent package name is simply not matched (not a hallucination verdict)", () => {
    const r = resolveWorkspaceImport("@kie-tools/does-not-exist-package/foo", nameMap);
    assert.strictEqual(r.matched, false);
  });

  // --- Node builtins ---
  check("node: prefixed specifiers are builtins", () => {
    assert.strictEqual(isNodeBuiltinSpecifier("node:test"), true);
    assert.strictEqual(isNodeBuiltinSpecifier("node:fs"), true);
  });
  check("bare Node builtins (no node: prefix) are also recognized", () => {
    assert.strictEqual(isNodeBuiltinSpecifier("fs"), true);
    assert.strictEqual(isNodeBuiltinSpecifier("path"), true);
    assert.strictEqual(isNodeBuiltinSpecifier("fs/promises"), true);
  });
  check("a real npm package name is not mistaken for a builtin", () => {
    assert.strictEqual(isNodeBuiltinSpecifier("not-a-real-npm-dep"), false);
    assert.strictEqual(isNodeBuiltinSpecifier("@playwright/test"), false);
  });

  // --- Playwright's own built-in fixtures (TestOptions/WorkerOptions, auto-exposed) ---
  check("Playwright's use:-option fixtures are recognized (e.g. 'channel')", () => {
    assert.strictEqual(PLAYWRIGHT_BUILTIN_FIXTURES.has("channel"), true);
    assert.strictEqual(PLAYWRIGHT_BUILTIN_FIXTURES.has("page"), true);
  });
  check("a made-up fixture name is NOT in the built-in set", () => {
    assert.strictEqual(PLAYWRIGHT_BUILTIN_FIXTURES.has("totallyMadeUpFixture"), false);
  });

  // --- Shebang stripping ---
  check("stripShebang removes a leading #! line", () => {
    assert.strictEqual(stripShebang("#!/usr/bin/env node\nfoo"), "foo");
  });
  check("stripShebang leaves non-shebang content untouched", () => {
    assert.strictEqual(stripShebang("foo\nbar"), "foo\nbar");
  });

  // --- Group / header mapping ---
  check("a packages/ file maps to the Apache header", () => {
    const group = groupForFile(repoRoot, path.join(repoRoot, "packages", "dmn-editor", "tests-e2e", "x.spec.ts"));
    assert.strictEqual(group, "packages");
    assert.ok(headerFilePathForGroup(group).endsWith(".apache-header"));
  });
  check("a packages-bamoe/ file maps to the IBM header", () => {
    const group = groupForFile(repoRoot, path.join(repoRoot, "packages-bamoe", "foo", "tests-e2e", "x.spec.ts"));
    assert.strictEqual(group, "packages-bamoe");
    assert.ok(headerFilePathForGroup(group).endsWith(".ibm-header"));
  });

  // --- Package resolution ---
  check("resolvePackageDir resolves a known real package by folder name", () => {
    const dir = resolvePackageDir(repoRoot, "dmn-editor");
    assert.ok(dir && dir.endsWith(path.join("packages", "dmn-editor")));
  });
  check("resolvePackageDir returns null for a bogus name", () => {
    assert.strictEqual(resolvePackageDir(repoRoot, "totally-bogus-package-xyz"), null);
  });
  check("listPlaywrightPackages finds the real Playwright-enabled packages", () => {
    const names = listPlaywrightPackages(repoRoot).map((p) => p.name);
    assert.ok(names.includes("@kie-tools/dmn-editor"));
    assert.ok(names.includes("@kie-tools/bpmn-editor"));
  });

  // --- check-playwright-config.js's self-referential no-op for playwright-base ---
  check("check-playwright-config.js correctly no-ops on playwright-base itself (it IS the base)", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, "check-playwright-config.js"), "playwright-base"],
      {
        encoding: "utf8",
      }
    );
    assert.strictEqual(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.note && parsed.note.includes("shared base config itself"), `unexpected output: ${result.stdout}`);
  });

  console.log(`\n${passed}/${passed + failures.length} assertions passed.`);
  if (failures.length > 0) {
    console.error("\nFAILURES:");
    for (const f of failures) console.error(`  - ${f.name}\n    ${f.error}`);
    process.exit(1);
  }
  console.error("All guardrail-script regression assertions passed.");
}

main();
