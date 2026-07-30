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
 * Deterministic backbone for Mode 2 (Evaluate) "Test quality" section, and a pre-flight
 * check for Mode 1 (Create/Update) before presenting new specs as done. Runs cheap, static,
 * regex-based checks over every *.spec.ts in a package — these are heuristics (a regex isn't
 * a parser), so treat findings as leads to verify, not as unappealable verdicts. What they
 * remove is the need to trust an LLM's unaided claim that "no anti-patterns were found".
 *
 * Selector-stability (raw `page.locator(...)` usage) is also checked across `__fixtures__/`
 * page-object files, not just specs — a CSS-selector-based locator baked into a fixture is
 * exactly as fragile as one written directly in a spec (see references/evaluation-checklist.md).
 * The other spec-only checks (naming, license header, fixtures-import) don't apply to fixture
 * files, which have their own different conventions.
 *
 * Usage: node check-spec-conventions.js <package-folder-name-or-path>
 */

const fs = require("fs");
const path = require("path");
const {
  resolveRepoRoot,
  walkFiles,
  groupForFile,
  headerFilePathForGroup,
  UNCONFIGURED_HEADER_SENTINEL,
  stripShebang,
  resolvePackageDir,
} = require("./lib/workspace");

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

function checkHeader(repoRoot, file, source) {
  const group = groupForFile(repoRoot, file);
  const headerPath = headerFilePathForGroup(group);
  if (!fs.existsSync(headerPath))
    return { severity: "warning", rule: "license-header", message: `no header file found for group "${group}"` };
  const expected = fs.readFileSync(headerPath, "utf8").replace(/\r\n/g, "\n").trimEnd();
  if (expected === UNCONFIGURED_HEADER_SENTINEL) {
    return {
      severity: "warning",
      rule: "license-header",
      message: `header for group "${group}" not configured yet (see assets/.ibm-header) — skipped`,
    };
  }
  const content = stripShebang(source.replace(/\r\n/g, "\n"));
  if (!content.startsWith(expected)) {
    return {
      severity: "high",
      rule: "license-header",
      message: "missing or non-verbatim license header for this file's group",
    };
  }
  return null;
}

function findAll(source, re) {
  const matches = [];
  let m;
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  while ((m = global.exec(source)) !== null) matches.push(m);
  return matches;
}

/** Raw `page.locator(...)` usage — checked in both specs and fixtures, per Playwright's own
 * locator-priority guidance (getByRole/getByTestId/etc. over CSS/xpath selectors). */
function checkSelectorStability(source, whereDescription) {
  const findings = [];
  for (const m of findAll(source, /\bpage\.locator\(/g)) {
    findings.push({
      severity: "medium",
      rule: "raw-selector",
      line: lineOf(source, m.index),
      message: `page.locator(...) used directly ${whereDescription} — prefer a role/testid-based locator (getByRole/getByTestId/etc.)`,
    });
  }
  return findings;
}

function checkFixtureFile(repoRoot, file) {
  const source = fs.readFileSync(file, "utf8");
  const rel = path.relative(repoRoot, file);
  const findings = checkSelectorStability(source, "in a fixture");
  return { file: rel, findings };
}

function checkFile(repoRoot, file) {
  const source = fs.readFileSync(file, "utf8");
  const rel = path.relative(repoRoot, file);
  const findings = [];

  const basename = path.basename(file);
  if (!/^[a-z][a-zA-Z0-9]*\.spec\.ts$/.test(basename)) {
    findings.push({
      severity: "high",
      rule: "naming",
      message: `"${basename}" should be camelCase.spec.ts naming the action (e.g. addInputData.spec.ts)`,
    });
  }

  const headerFinding = checkHeader(repoRoot, file, source);
  if (headerFinding) findings.push(headerFinding);

  if (!/__fixtures__\/base["']/.test(source)) {
    findings.push({
      severity: "high",
      rule: "fixtures-import",
      message:
        'no `import { test, expect } from ".../__fixtures__/base"` found — spec may bypass the shared fixture composition',
    });
  }

  for (const m of findAll(source, /page\.waitForTimeout\(/g)) {
    findings.push({
      severity: "high",
      rule: "hardcoded-wait",
      line: lineOf(source, m.index),
      message: "page.waitForTimeout(...) — wait on a locator/condition instead",
    });
  }

  findings.push(...checkSelectorStability(source, "in a spec, bypassing the page-object fixtures"));

  for (const m of findAll(source, /toHaveScreenshot\(\s*["']([^"']+)["']/g)) {
    const name = m[1];
    if (!/^[a-z0-9]+(-[a-z0-9]+)*\.png$/.test(name)) {
      findings.push({
        severity: "medium",
        rule: "screenshot-naming",
        line: lineOf(source, m.index),
        message: `"${name}" is not kebab-case-with-.png`,
      });
    }
  }

  // Screenshot-only test detection: split the file into per-test chunks and count expect() calls in each.
  const testStarts = findAll(source, /\btest\(\s*["']/g).map((m) => m.index);
  for (let i = 0; i < testStarts.length; i++) {
    const start = testStarts[i];
    const end = i + 1 < testStarts.length ? testStarts[i + 1] : source.length;
    const chunk = source.slice(start, end);
    const expectCalls = findAll(chunk, /expect\(/g);
    if (expectCalls.length === 1 && /expect\([^)]*\)\.toHaveScreenshot/.test(chunk)) {
      findings.push({
        severity: "low",
        rule: "screenshot-only",
        line: lineOf(source, start),
        message: "test's only assertion is a screenshot — consider adding a functional/model assertion too",
      });
    }
  }

  return { file: rel, findings };
}

function main() {
  const query = process.argv[2];
  if (!query) {
    console.error("Usage: node check-spec-conventions.js <package-folder-name-or-path>");
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
  const specFiles = walkFiles(testsE2eDir, (n) => n.endsWith(".spec.ts"));
  const fixtureFiles = walkFiles(path.join(testsE2eDir, "__fixtures__"), (n) => n.endsWith(".ts"));

  const specResults = specFiles.map((f) => checkFile(repoRoot, f)).filter((r) => r.findings.length > 0);
  const fixtureResults = fixtureFiles.map((f) => checkFixtureFile(repoRoot, f)).filter((r) => r.findings.length > 0);
  const flat = [...specResults, ...fixtureResults].flatMap((r) => r.findings.map((f) => ({ file: r.file, ...f })));
  const bySeverity = { high: 0, medium: 0, low: 0, warning: 0 };
  for (const f of flat) bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;

  console.log(
    JSON.stringify(
      {
        pkgDir: path.relative(repoRoot, pkgDir),
        specFilesChecked: specFiles.length,
        fixtureFilesChecked: fixtureFiles.length,
        bySeverity,
        findings: flat,
      },
      null,
      2
    )
  );

  if (bySeverity.high > 0) {
    console.error(`\n${bySeverity.high} high-severity finding(s). Fix before presenting work as done.`);
    process.exit(1);
  }
  console.error(
    `\nNo high-severity findings across ${specFiles.length} spec file(s) and ${fixtureFiles.length} fixture file(s). ${bySeverity.medium + bySeverity.low} lower-severity note(s) reported above.`
  );
}

main();
