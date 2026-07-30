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
 * Guardrail for the license-header requirement. Which header is "correct" depends on which
 * workspace group a file lives in:
 *   - packages/, examples/, scripts/              -> assets/.apache-header (upstream ASF tree,
 *                                                     enforced repo-wide by Apache RAT in CI)
 *   - packages-bamoe/, packages-bamoe-artifacts/   -> assets/.ibm-header (downstream-only tree)
 *
 * assets/.ibm-header ships as a placeholder (sentinel text) until someone pastes the real
 * IBM/BAMOE header into it — until then, files in those two groups are reported as
 * "unconfigured", never silently passed and never failed against the wrong (Apache) text.
 *
 * Usage: node check-license-header.js <file1.ts> [file2.ts ...]
 */

const fs = require("fs");
const path = require("path");
const {
  resolveRepoRoot,
  groupForFile,
  headerFilePathForGroup,
  UNCONFIGURED_HEADER_SENTINEL,
  stripShebang,
} = require("./lib/workspace");

function normalize(text) {
  return text.replace(/\r\n/g, "\n").trimEnd();
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: node check-license-header.js <file1.ts> [file2.ts ...]");
    process.exit(2);
  }

  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    console.error("Could not find repo root.");
    process.exit(2);
  }

  const headerCache = new Map(); // headerPath -> normalized content (or the unconfigured sentinel)
  const problems = [];
  const unconfigured = [];

  for (const file of files) {
    const abs = path.resolve(file);
    if (!fs.existsSync(abs)) {
      problems.push({ file, issue: "file does not exist" });
      continue;
    }

    const group = groupForFile(repoRoot, abs);
    const headerPath = headerFilePathForGroup(group);

    if (!headerCache.has(headerPath)) {
      headerCache.set(headerPath, fs.existsSync(headerPath) ? normalize(fs.readFileSync(headerPath, "utf8")) : null);
    }
    const expected = headerCache.get(headerPath);

    if (expected === null || expected === UNCONFIGURED_HEADER_SENTINEL) {
      unconfigured.push({ file, group, headerFile: path.relative(repoRoot, headerPath) });
      continue;
    }

    const content = stripShebang(fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n"));
    if (!content.startsWith(expected)) {
      problems.push({
        file,
        group,
        issue: `missing or non-verbatim header at top of file (expected ${path.relative(repoRoot, headerPath)})`,
      });
    }
  }

  console.log(JSON.stringify({ filesChecked: files.length, problems, unconfigured }, null, 2));

  if (unconfigured.length > 0) {
    console.error(
      `\n${unconfigured.length} file(s) belong to a group whose license header hasn't been provided yet ` +
        `(assets/.ibm-header is still a placeholder) — skipped, not passed. Paste the real header text in before relying on this check for those groups.`
    );
  }
  if (problems.length > 0) {
    console.error(`\n${problems.length} file(s) have a missing/incorrect header. Fix before proceeding.`);
    process.exit(1);
  }
  if (unconfigured.length > 0) {
    process.exit(3); // distinct from pass(0)/fail(1): "blocked pending header text", not a clean pass
  }
  console.error(`\nAll ${files.length} file(s) have the correct header for their group.`);
}

main();
