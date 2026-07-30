"use strict";
/**
 * Shared helpers for the playwright-test-engineer skill's guardrail scripts.
 * Zero npm dependencies on purpose — these scripts must run with plain `node`,
 * before/without a `pnpm install`, so they can gate decisions even in a fresh checkout.
 */

const fs = require("fs");
const path = require("path");
const { builtinModules } = require("module");

const NODE_BUILTIN_MODULE_NAMES = new Set(builtinModules);

// Playwright's own built-in fixtures: the runtime objects (page, context, ...) PLUS every
// `use:` config option (TestOptions/WorkerOptions), which Playwright automatically exposes
// as a fixture even though it's never declared in this repo's __fixtures__/base.ts. This is
// Playwright's public, stable API surface (unchanged across recent major versions) — if a
// future Playwright version adds a new `use:` option, add it here too.
const PLAYWRIGHT_BUILTIN_FIXTURES = new Set([
  // Runtime fixtures
  "page",
  "context",
  "browser",
  "browserName",
  "request",
  "testInfo",
  // TestOptions / WorkerOptions (every playwright.config `use:` key is also a fixture)
  "acceptDownloads",
  "actionTimeout",
  "baseURL",
  "bypassCSP",
  "channel",
  "clientCertificates",
  "colorScheme",
  "connectOptions",
  "contextOptions",
  "deviceScaleFactor",
  "extraHTTPHeaders",
  "forcedColors",
  "geolocation",
  "hasTouch",
  "headless",
  "httpCredentials",
  "ignoreHTTPSErrors",
  "isMobile",
  "javaScriptEnabled",
  "launchOptions",
  "locale",
  "navigationTimeout",
  "offline",
  "permissions",
  "proxy",
  "reducedMotion",
  "screenshot",
  "serviceWorkers",
  "storageState",
  "timezoneId",
  "trace",
  "userAgent",
  "video",
  "viewport",
]);

// Workspace directories this skill actually scans for Playwright work. `examples/` has zero
// Playwright usage anywhere (verified — no playwright.config* or tests-e2e/ under it) and
// never will (it's example integration snippets, not editor packages), and the top-level
// `scripts/` group is build tooling (run-script-if, etc.), never a test target either — so
// neither is scanned, keeping "which package did you mean" unambiguous. `packages-bamoe/` and
// `packages-bamoe-artifacts/` are downstream-only trees that DO apply on some forks.
const WORKSPACE_GLOB_DIRS = ["packages", "packages-bamoe", "packages-bamoe-artifacts"];
const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "dist-tests-e2e", "dist-storybook", ".git", "__screenshots__"]);

/** Walk upward from `startDir` until a directory containing pnpm-workspace.yaml is found. */
function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Best-effort repo root resolution: try cwd first, then this script's own location. */
function resolveRepoRoot() {
  return findRepoRoot(process.cwd()) || findRepoRoot(__dirname);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Strip a leading shebang line (e.g. "#!/usr/bin/env node\n") if present. Executable scripts
 * legitimately need the shebang as the literal first line of the file, before the license
 * header — Apache RAT and most header checkers account for this. Comparing header text
 * without stripping the shebang first produces a false "missing header" on every CLI script.
 */
function stripShebang(content) {
  return content.startsWith("#!") ? content.slice(content.indexOf("\n") + 1) : content;
}

// Which license header file (in assets/) applies to which workspace group.
// packages/ (the upstream ASF tree) uses the Apache header, the default below.
// Downstream-only groups use the IBM header instead — see assets/.ibm-header.
// Add an entry here if another downstream-only group needs a different header.
const HEADER_FILE_BY_GROUP = {
  "packages-bamoe": ".ibm-header",
  "packages-bamoe-artifacts": ".ibm-header",
};
const DEFAULT_HEADER_FILE = ".apache-header";
const UNCONFIGURED_HEADER_SENTINEL = "__PASTE_IBM_HEADER_HERE__";

/** The workspace group (top-level pnpm-workspace.yaml dir) a file lives under, e.g. "packages-bamoe". */
function groupForFile(repoRoot, absFile) {
  const rel = path.relative(repoRoot, absFile);
  return rel.split(path.sep)[0];
}

/** Absolute path to the license header file (in assets/) that applies to a given workspace group. */
function headerFilePathForGroup(group) {
  const fileName = HEADER_FILE_BY_GROUP[group] || DEFAULT_HEADER_FILE;
  return path.join(__dirname, "..", "..", "assets", fileName);
}

/** List every workspace package: { name, dir (absolute) } across every glob in pnpm-workspace.yaml. */
function listWorkspacePackages(repoRoot) {
  const out = [];
  for (const group of WORKSPACE_GLOB_DIRS) {
    const groupDir = path.join(repoRoot, group);
    if (!fs.existsSync(groupDir)) continue;
    for (const entry of fs.readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(groupDir, entry.name);
      const pkgJsonPath = path.join(dir, "package.json");
      if (!fs.existsSync(pkgJsonPath)) continue;
      let name;
      try {
        name = readJson(pkgJsonPath).name;
      } catch (e) {
        continue;
      }
      if (!name) continue;
      out.push({ name, dir, group, folder: entry.name });
    }
  }
  return out;
}

/** { "@kie-tools/dmn-editor": "/abs/path/packages/dmn-editor", ... } */
function buildNameMap(pkgs) {
  const map = new Map();
  for (const p of pkgs) map.set(p.name, p.dir);
  return map;
}

/** Packages (from packages/, packages-bamoe/, or packages-bamoe-artifacts/) that already ship a playwright.config.ts. */
function listPlaywrightPackages(repoRoot) {
  return listWorkspacePackages(repoRoot).filter((p) => fs.existsSync(path.join(p.dir, "playwright.config.ts")));
}

/**
 * Resolve a user-supplied package identifier — a real directory path, a workspace folder name
 * (e.g. "dmn-editor"), or a package.json "name" (e.g. "@kie-tools/dmn-editor") — to its
 * absolute directory, or null if it doesn't match anything. Shared by every script that takes
 * a "<package>" argument, so package resolution can't silently drift between them.
 */
function resolvePackageDir(repoRoot, query) {
  if (fs.existsSync(query) && fs.statSync(query).isDirectory()) return path.resolve(query);
  const pkgs = listWorkspacePackages(repoRoot);
  const match = pkgs.find((p) => p.name === query || p.folder === query);
  return match ? match.dir : null;
}

/** Recursively collect files under `dir` whose basename matches `filter(name)`. */
function walkFiles(dir, filter) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, filter));
    } else if (filter(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx", ".d.ts"];

/** Try `base + suffix` for each candidate suffix; return the first that exists on disk, else null. */
function firstExisting(base) {
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Resolve a bare import specifier (e.g. "@kie-tools/playwright-base/playwright.config")
 * against the workspace package name map. Returns a structured result rather than
 * throwing, because "unresolved" has two very different causes in this monorepo:
 *
 *   - the specifier points at that package's `dist/` (compiled output) — completely
 *     normal cross-package pattern here, but only resolvable AFTER that package has been
 *     built (`pnpm build:dev`/`tsc`). No build was necessarily run in this environment,
 *     so this is not evidence of a hallucination — status "requires-build".
 *   - the specifier points at neither `dist/` nor a real `src/` file — genuinely
 *     unresolvable, and *that* is the hallucination signal — status "unresolved".
 *
 * Return shape:
 *   { matched: false }                                              not a workspace package name
 *   { matched: true, status: "resolved", path }                     subpath is a real file
 *   { matched: true, status: "requires-build", path: string|null }  dist/ subpath; path is the
 *                                                                    resolved src/ mirror if one
 *                                                                    exists, else null
 *   { matched: true, status: "unresolved", packageName, packageDir, subpath, triedSuffixes }
 */
function resolveWorkspaceImport(specifier, nameMap) {
  const names = [...nameMap.keys()].sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (specifier === name || specifier.startsWith(name + "/")) {
      const subpath = specifier === name ? "" : specifier.slice(name.length + 1);
      const baseDir = nameMap.get(name);

      if (!subpath) return { matched: true, status: "resolved", path: path.join(baseDir, "package.json") };

      const resolved = firstExisting(path.join(baseDir, subpath));
      if (resolved) return { matched: true, status: "resolved", path: resolved };

      if (subpath === "dist" || subpath.startsWith("dist/")) {
        const srcSubpath = subpath === "dist" ? "" : subpath.slice("dist/".length);
        const srcMirror = firstExisting(path.join(baseDir, "src", srcSubpath || "index"));
        return { matched: true, status: "requires-build", path: srcMirror };
      }

      return {
        matched: true,
        status: "unresolved",
        packageName: name,
        packageDir: baseDir,
        subpath,
        triedSuffixes: RESOLVE_SUFFIXES.map((s) => subpath + s),
      };
    }
  }
  return { matched: false };
}

// Node.js built-in modules are never npm dependencies — "fs", "node:fs", and "fs/promises"
// all resolve without a package.json entry. Real usage in this repo's tests-e2e/__fixtures__
// (Node-side test helpers, not browser bundle code) uses the bare form (e.g. "fs", "path")
// at least as often as the "node:" prefixed one, so both are always treated as valid.
function isNodeBuiltinSpecifier(specifier) {
  if (specifier.startsWith("node:")) return true;
  return NODE_BUILTIN_MODULE_NAMES.has(specifier.split("/")[0]);
}

/** Resolve a relative import ("./foo", "../__fixtures__/base") from the file that imports it. */
function resolveRelativeImport(specifier, fromFile) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  return firstExisting(base);
}

/** Extract import/require specifiers from TS source via regex (no TS compiler dependency). */
function extractImportSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /import\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/g,
    /import\s+["']([^"']+)["']/g,
    /require\(\s*["']([^"']+)["']\s*\)/g,
    /export\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(source)) !== null) specifiers.push(m[1]);
  }
  return [...new Set(specifiers)];
}

/** Find the nearest package.json walking up from `fromFile`, and its declared dependency names. */
function nearestDeclaredDeps(fromFile) {
  let dir = path.dirname(fromFile);
  while (true) {
    const pkgJsonPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      const pkg = readJson(pkgJsonPath);
      return new Set([
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {}),
        ...Object.keys(pkg.peerDependencies || {}),
      ]);
    }
    const parent = path.dirname(dir);
    if (parent === dir) return new Set();
    dir = parent;
  }
}

/** Given a bare specifier like "@playwright/test" or "lodash/merge", get its declared package name. */
function bareSpecifierPackageName(specifier) {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}

module.exports = {
  findRepoRoot,
  resolveRepoRoot,
  readJson,
  listWorkspacePackages,
  buildNameMap,
  listPlaywrightPackages,
  walkFiles,
  firstExisting,
  resolveWorkspaceImport,
  resolveRelativeImport,
  extractImportSpecifiers,
  nearestDeclaredDeps,
  bareSpecifierPackageName,
  isNodeBuiltinSpecifier,
  groupForFile,
  headerFilePathForGroup,
  UNCONFIGURED_HEADER_SENTINEL,
  PLAYWRIGHT_BUILTIN_FIXTURES,
  stripShebang,
  resolvePackageDir,
};
