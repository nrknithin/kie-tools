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
 * Hard constraint #3 guardrail: "No hallucinated imports."
 *
 * For every given .ts file, extracts every import/require specifier and resolves it:
 *   - relative ("./x", "../x")        -> must exist on disk
 *   - workspace package ("@kie-tools/...", "@kie-tools-core/...", "@kie-tools-examples/...")
 *                                     -> must resolve to a real file inside that package, OR be a
 *                                        dist/ (compiled-output) path — reported separately as
 *                                        "requiresBuild" since it can't be verified without that
 *                                        package having been built, and is a normal pattern here
 *   - "node:xxx"                      -> always fine, Node built-in
 *   - anything else (npm deps, "@playwright/test", "react", "lodash/merge", ...)
 *                                     -> the base package name must be declared in the nearest
 *                                        package.json's dependencies/devDependencies/peerDependencies
 *
 * Exits non-zero if ANY import fails to resolve (excluding requiresBuild, which is informational).
 * This is meant to run on files the skill is about to write (or just wrote) BEFORE they're
 * presented as done.
 *
 * Usage: node check-imports.js <file1.ts> [file2.ts ...]
 */

const fs = require("fs");
const path = require("path");
const {
  resolveRepoRoot,
  listWorkspacePackages,
  buildNameMap,
  extractImportSpecifiers,
  resolveWorkspaceImport,
  resolveRelativeImport,
  nearestDeclaredDeps,
  bareSpecifierPackageName,
  isNodeBuiltinSpecifier,
} = require("./lib/workspace");

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: node check-imports.js <file1.ts> [file2.ts ...]");
    process.exit(2);
  }

  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    console.error("Could not find repo root (no pnpm-workspace.yaml found).");
    process.exit(2);
  }
  const nameMap = buildNameMap(listWorkspacePackages(repoRoot));

  let problems = [];
  let requiresBuild = [];
  let checkedCount = 0;

  for (const file of files) {
    const abs = path.resolve(file);
    if (!fs.existsSync(abs)) {
      problems.push({ file, specifier: null, issue: "file does not exist" });
      continue;
    }
    const source = fs.readFileSync(abs, "utf8");
    const specifiers = extractImportSpecifiers(source);

    for (const specifier of specifiers) {
      checkedCount++;

      if (specifier.startsWith(".")) {
        const resolved = resolveRelativeImport(specifier, abs);
        if (!resolved) {
          problems.push({ file, specifier, issue: "relative import does not resolve to any existing file" });
        }
        continue;
      }

      if (isNodeBuiltinSpecifier(specifier)) continue;

      const workspaceResolved = resolveWorkspaceImport(specifier, nameMap);
      if (workspaceResolved.matched) {
        if (workspaceResolved.status === "resolved") continue;
        if (workspaceResolved.status === "requires-build") {
          requiresBuild.push({
            file,
            specifier,
            note: workspaceResolved.path
              ? `dist/ subpath not built yet, but a matching src/ file exists (${path.relative(repoRoot, workspaceResolved.path)}) — build the dependency to verify fully`
              : "dist/ subpath not built yet and no matching src/ file found either — re-check this one manually once the dependency is built",
          });
          continue;
        }
        // status === "unresolved" — matched a real workspace package name, but the
        // subpath isn't a real file and isn't a dist/ (unbuilt) path. That's the
        // hallucination case.
        problems.push({
          file,
          specifier,
          issue:
            `"${specifier}" looks like a workspace import of package "${workspaceResolved.packageName}" ` +
            `(${path.relative(repoRoot, workspaceResolved.packageDir)}), but no file matches subpath "${workspaceResolved.subpath}" ` +
            `(tried: ${workspaceResolved.triedSuffixes.join(", ")})`,
        });
        continue;
      }

      // Bare npm specifier: must be a declared dependency somewhere up the tree.
      const declared = nearestDeclaredDeps(abs);
      const pkgName = bareSpecifierPackageName(specifier);
      if (!declared.has(pkgName)) {
        problems.push({
          file,
          specifier,
          issue: `"${pkgName}" is not declared in the nearest package.json (dependencies/devDependencies/peerDependencies)`,
        });
      }
    }
  }

  const report = {
    filesChecked: files.length,
    importsChecked: checkedCount,
    problems,
    requiresBuild,
  };
  console.log(JSON.stringify(report, null, 2));

  if (requiresBuild.length > 0) {
    console.error(
      `\n${requiresBuild.length} import(s) point at unbuilt dist/ output — not a failure, but verify manually if in doubt.`
    );
  }
  if (problems.length > 0) {
    console.error(`\n${problems.length} unresolved import(s) found — see "problems" above. Fix before proceeding.`);
    process.exit(1);
  }
  console.error(`\nAll ${checkedCount} imports across ${files.length} file(s) resolved to real files/declared deps.`);
}

main();
