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
 * Guardrail for "reuse shared fixtures, don't duplicate infrastructure" and for catching
 * fixture names a spec references that were never actually declared anywhere (a common
 * hallucination shape: the model "remembers" a fixture name from a different package).
 *
 * Checks, inside <package>/tests-e2e/:
 *   1. Every page-object file in __fixtures__/ (other than base.ts) exports something that
 *      is actually referenced inside __fixtures__/base.ts. Flags orphaned fixture files
 *      (warning only — might be intentionally imported directly by another package).
 *   2. Every spec file's destructured test-callback parameters (the fixture names a test
 *      asks for) are either a Playwright built-in fixture or a key declared in base.ts's
 *      `test.extend<...>({ ... })` object. Flags names that are neither (hard failure —
 *      this is exactly what "no hallucinated fixtures" needs to catch).
 *
 * Usage: node check-fixture-wiring.js <package-folder-name-or-path>
 */

const fs = require("fs");
const path = require("path");
const { resolveRepoRoot, walkFiles, PLAYWRIGHT_BUILTIN_FIXTURES, resolvePackageDir } = require("./lib/workspace");

function extractExportedNames(source) {
  const names = [];
  const re = /export\s+(?:class|const|function)\s+(\w+)/g;
  let m;
  while ((m = re.exec(source)) !== null) names.push(m[1]);
  return names;
}

function extractDeclaredFixtureKeys(baseSource) {
  const keys = new Set();
  const re = /(^|\n)\s*(\w+):\s*async\s*\(/g;
  let m;
  while ((m = re.exec(baseSource)) !== null) keys.add(m[2]);
  return keys;
}

function extractUsedFixtureNames(source) {
  const used = [];
  const re = /async\s*\(\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const names = m[1]
      .split(",")
      .map((s) => s.trim().split(":")[0].trim()) // handles renamed destructuring `foo: bar` -> "foo"
      .filter(Boolean);
    used.push(...names);
  }
  return used;
}

function main() {
  const query = process.argv[2];
  if (!query) {
    console.error("Usage: node check-fixture-wiring.js <package-folder-name-or-path>");
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

  const testsE2eDir = path.join(pkgDir, "tests-e2e");
  const fixturesDir = path.join(testsE2eDir, "__fixtures__");
  const baseFile = path.join(fixturesDir, "base.ts");

  if (!fs.existsSync(baseFile)) {
    console.log(
      JSON.stringify(
        {
          note: "No tests-e2e/__fixtures__/base.ts found — nothing to check yet (bootstrap case).",
          pkgDir: path.relative(repoRoot, pkgDir),
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  const baseSource = fs.readFileSync(baseFile, "utf8");
  const declaredFixtureKeys = extractDeclaredFixtureKeys(baseSource);

  // 1. Orphaned fixture files.
  const fixtureFiles = walkFiles(fixturesDir, (n) => n.endsWith(".ts")).filter((f) => f !== baseFile);
  const orphanedFixtureFiles = [];
  for (const file of fixtureFiles) {
    const source = fs.readFileSync(file, "utf8");
    const exported = extractExportedNames(source);
    const referenced = exported.some((name) => new RegExp(`\\b${name}\\b`).test(baseSource));
    if (exported.length > 0 && !referenced) {
      orphanedFixtureFiles.push({ file: path.relative(repoRoot, file), exports: exported });
    }
  }

  // 2. Undeclared fixture usage in spec files.
  const specFiles = walkFiles(testsE2eDir, (n) => n.endsWith(".spec.ts"));
  const undeclaredUsages = [];
  for (const file of specFiles) {
    const source = fs.readFileSync(file, "utf8");
    const used = extractUsedFixtureNames(source);
    for (const name of new Set(used)) {
      if (!PLAYWRIGHT_BUILTIN_FIXTURES.has(name) && !declaredFixtureKeys.has(name)) {
        undeclaredUsages.push({ file: path.relative(repoRoot, file), fixture: name });
      }
    }
  }

  const report = {
    pkgDir: path.relative(repoRoot, pkgDir),
    declaredFixtureKeys: [...declaredFixtureKeys].sort(),
    orphanedFixtureFiles,
    undeclaredUsages,
  };
  console.log(JSON.stringify(report, null, 2));

  if (undeclaredUsages.length > 0) {
    console.error(
      `\n${undeclaredUsages.length} spec(s) destructure a fixture name that is not declared in __fixtures__/base.ts and is not a Playwright built-in. ` +
        `Either it's a typo/hallucination, or the fixture needs to be added to base.ts's test.extend(...).`
    );
    process.exit(1);
  }
  if (orphanedFixtureFiles.length > 0) {
    console.error(
      `\nNote: ${orphanedFixtureFiles.length} fixture file(s) export something not referenced in base.ts (warning only).`
    );
  }
  console.error("\nFixture wiring OK.");
}

main();
