#!/usr/bin/env node
"use strict";
/**
 * Generates the mechanical boilerplate for a new spec file — the exact things spec-template.ts
 * warns about in prose ("license header must match the group", "../__fixtures__/base depth
 * must match nesting") but leaves to be done by hand. This computes both instead of asking the
 * model to count directories or remember which header applies.
 *
 * What this DOES generate: the correct license header for the target's workspace group, the
 * correctly-computed relative import path to __fixtures__/base, and a placeholder
 * test.describe/test skeleton (still just placeholders — same shape as assets/spec-template.ts).
 *
 * What this does NOT generate: the actual test logic, fixture usage, or assertions — that's
 * still the model's job once Step 6a's plan is confirmed. This only removes the parts that are
 * pure arithmetic/lookup, not the parts that require understanding the scenario.
 *
 * Usage: node scaffold-spec.js <package> <relative-path-under-tests-e2e> [--force]
 *   e.g. node scaffold-spec.js dmn-editor drgElements/addFooBar.spec.ts
 */

const fs = require("fs");
const path = require("path");
const {
  resolveRepoRoot,
  resolvePackageDir,
  groupForFile,
  headerFilePathForGroup,
  UNCONFIGURED_HEADER_SENTINEL,
} = require("./lib/workspace");

function main() {
  const [pkgQuery, relSpecPath, ...rest] = process.argv.slice(2);
  const force = rest.includes("--force");

  if (!pkgQuery || !relSpecPath) {
    console.error("Usage: node scaffold-spec.js <package> <relative-path-under-tests-e2e> [--force]");
    console.error("  e.g. node scaffold-spec.js dmn-editor drgElements/addFooBar.spec.ts");
    process.exit(2);
  }

  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    console.error("Could not find repo root.");
    process.exit(2);
  }
  const pkgDir = resolvePackageDir(repoRoot, pkgQuery);
  if (!pkgDir) {
    console.error(`Could not resolve package "${pkgQuery}". Run list-target-packages.js --check "${pkgQuery}" first.`);
    process.exit(2);
  }

  const basename = path.basename(relSpecPath);
  if (!/^[a-z][a-zA-Z0-9]*\.spec\.ts$/.test(basename)) {
    console.error(`"${basename}" doesn't match the repo's camelCase.spec.ts convention (e.g. addInputData.spec.ts).`);
    process.exit(2);
  }

  const testsE2eDir = path.join(pkgDir, "tests-e2e");
  const targetPath = path.join(testsE2eDir, relSpecPath);

  if (fs.existsSync(targetPath) && !force) {
    console.error(
      `${path.relative(repoRoot, targetPath)} already exists. Pass --force to overwrite (rarely what you want).`
    );
    process.exit(2);
  }

  const group = groupForFile(repoRoot, targetPath);
  const headerPath = headerFilePathForGroup(group);
  if (!fs.existsSync(headerPath)) {
    console.error(`No header file found for group "${group}" (expected ${path.relative(repoRoot, headerPath)}).`);
    process.exit(2);
  }
  const header = fs.readFileSync(headerPath, "utf8").trimEnd();
  if (header === UNCONFIGURED_HEADER_SENTINEL) {
    console.error(
      `The license header for group "${group}" hasn't been configured yet (${path.relative(repoRoot, headerPath)} ` +
        `is still a placeholder). Provide the real header text before scaffolding files for this group.`
    );
    process.exit(2);
  }

  const fixturesBasePath = path.join(testsE2eDir, "__fixtures__", "base");
  let importPath = path.relative(path.dirname(targetPath), fixturesBasePath).split(path.sep).join("/");
  if (!importPath.startsWith(".")) importPath = "./" + importPath;

  const content = `${header}

// Fill in every <ANGLE_BRACKET> placeholder with real values from the confirmed test plan.
// Only destructure fixtures that are actually declared in __fixtures__/base.ts's test.extend
// (run check-fixture-wiring.js if unsure which ones exist) — do not invent fixture names.

import { test, expect } from "${importPath}";

test.describe("<Feature under test>", () => {
  test.describe("<Sub-scenario grouping>", () => {
    test("should <expected behavior, plain language>", async ({ /* <fixtures used> */ }) => {
      // Act: drive the UI through the page-object fixtures, not raw locators.

      // Assert: functional assertion(s) first, then (if visual) a toHaveScreenshot(...) call,
      // and (if the package exposes a model fixture) an assertion on the underlying model too.
    });
  });
});
`;

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);

  console.log(
    JSON.stringify(
      {
        written: path.relative(repoRoot, targetPath),
        group,
        headerUsed: path.relative(repoRoot, headerPath),
        fixturesImportPath: importPath,
      },
      null,
      2
    )
  );
  console.error(
    `\nWrote ${path.relative(repoRoot, targetPath)} with the correct header and import depth. ` +
      "Fill in the placeholders per the confirmed plan, then run check-imports.js/check-spec-conventions.js (or run-all-checks.js) before presenting it as done."
  );
}

main();
