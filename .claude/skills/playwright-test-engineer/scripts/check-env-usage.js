#!/usr/bin/env node
"use strict";
/**
 * Grounds evaluation-checklist.md §3's "are build-env keys actually used, or is there dead
 * config left over from a copy-paste of another package's setup?" in a real cross-reference
 * instead of eyeballing env/index.js.
 *
 * A package's custom env keys (the object returned from `get env() { return {...} }` in
 * env/index.js) are consumed two different ways in this repo — both verified by reading real
 * examples, not assumed:
 *   - from TypeScript: `buildEnv.dmnEditor.storybook.port` (playwright.config.ts, webpack config)
 *   - from a package.json script, via the CLI: `$(build-env dmnEditor.storybook.port)`
 * Both forms contain the dotted key path as contiguous literal text, so a plain substring
 * search across every other file in the package (excluding env/index.js itself) catches both
 * without needing two separate parsers.
 *
 * Usage: node check-env-usage.js <package-folder-name-or-path>
 */

const fs = require("fs");
const path = require("path");
const { resolveRepoRoot, walkFiles, resolvePackageDir } = require("./lib/workspace");

/**
 * Lightweight recursive-descent over the `get env() { return { ... } }` object literal.
 * Not a full JS parser — just tracks each `key:` and whether its value is a nested object
 * (`{`) or a leaf (anything else: a string, a `getOrDefault(this.vars.X)` call, a number,
 * whatever this particular repo's env/index.js files use — the actual leaf expression doesn't
 * matter, only its dotted path).
 */
function extractLeafPaths(source) {
  const returnMatch = source.match(/get\s+env\(\)\s*\{\s*return\s*(\{[\s\S]*?\});?\s*\}\s*,?\s*\}?\s*\);?\s*$/m);
  const objText = returnMatch ? returnMatch[1] : null;
  if (!objText) return [];

  const leaves = [];
  const keyRe = /"?([a-zA-Z0-9_]+)"?\s*:\s*(\{)?/g;
  const positions = [];
  let m;
  while ((m = keyRe.exec(objText)) !== null) positions.push({ index: m.index, key: m[1], isObject: m[2] === "{" });

  // Track brace depth up to each key's position to know its nesting path.
  function depthAt(pos) {
    let d = 0;
    for (let j = 0; j < pos; j++) {
      if (objText[j] === "{") d++;
      else if (objText[j] === "}") d--;
    }
    return d;
  }

  const pathStack = [];
  for (const p of positions) {
    const d = depthAt(p.index);
    while (pathStack.length > d - 1) pathStack.pop();
    if (p.isObject) {
      pathStack.push(p.key);
    } else {
      leaves.push([...pathStack, p.key].join("."));
    }
  }
  return [...new Set(leaves)];
}

function main() {
  const query = process.argv[2];
  if (!query) {
    console.error("Usage: node check-env-usage.js <package-folder-name-or-path>");
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

  const envPath = path.join(pkgDir, "env", "index.js");
  if (!fs.existsSync(envPath)) {
    console.log(JSON.stringify({ note: "No env/index.js — nothing to check yet." }, null, 2));
    process.exit(0);
  }

  const envSource = fs.readFileSync(envPath, "utf8");
  const leafPaths = extractLeafPaths(envSource);

  if (leafPaths.length === 0) {
    console.log(
      JSON.stringify(
        { note: "No custom env keys found in env/index.js's `get env()` block (only composes shared envs)." },
        null,
        2
      )
    );
    process.exit(0);
  }

  // Search every other file in the package (not just playwright.config.ts) — a key might
  // legitimately be consumed from webpack.config.js, a .storybook/ config, or package.json.
  const otherFiles = walkFiles(pkgDir, (n) => n.endsWith(".ts") || n.endsWith(".js") || n === "package.json").filter(
    (f) => f !== envPath
  );
  const corpus = otherFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");

  const used = leafPaths.filter((p) => corpus.includes(p));
  const unused = leafPaths.filter((p) => !corpus.includes(p));

  const report = {
    pkgDir: path.relative(repoRoot, pkgDir),
    leafPathsDefined: leafPaths,
    used,
    possiblyDead: unused,
  };
  console.log(JSON.stringify(report, null, 2));

  if (unused.length > 0) {
    console.error(
      `\n${unused.length}/${leafPaths.length} env key(s) defined in env/index.js have no literal reference anywhere else in the package — ` +
        "possible dead config from a copy-pasted setup. Verify with a repo-wide search before removing (a sibling package could reference it via a shared script)."
    );
  } else {
    console.error(`\nAll ${leafPaths.length} custom env key(s) are referenced somewhere in the package.`);
  }
}

main();
