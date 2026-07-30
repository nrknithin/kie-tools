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
 * Step 1 guardrail: produce the package list from the filesystem, not from memory/guessing.
 *
 * Usage:
 *   node list-target-packages.js                 # JSON: { withPlaywright: [...], all: [...] }
 *   node list-target-packages.js --check <name>   # exit 0 + print resolved dir if <name> is a
 *                                                  # real package/example folder or workspace
 *                                                  # package name; exit 1 + suggestions if not.
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

  const all = listWorkspacePackages(repoRoot).filter((p) => p.group !== "scripts");
  const withPlaywright = listPlaywrightPackages(repoRoot);

  const result = {
    repoRoot,
    withPlaywright: withPlaywright.map((p) => ({ name: p.name, group: p.group, folder: p.folder })),
    all: all.map((p) => ({ name: p.name, group: p.group, folder: p.folder })),
  };
  console.log(JSON.stringify(result, null, 2));
}

function checkPackage(repoRoot, query) {
  const all = listWorkspacePackages(repoRoot).filter((p) => p.group !== "scripts");
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
        message: `"${query}" is not a package folder name or package.json "name" under packages/ or examples/.`,
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
