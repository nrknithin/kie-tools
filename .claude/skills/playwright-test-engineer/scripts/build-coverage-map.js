#!/usr/bin/env node
"use strict";
/**
 * Grounds Mode 2 §1 (Coverage map) / §5 (Missing scenarios) and Step 5a scenario validation in
 * a real cross-reference instead of the model manually walking src/ and tests-e2e/ by eye —
 * the single biggest token sink identified in the skill's audit (dmn-editor alone is 77 specs
 * against ~300 src files).
 *
 * Two signals, different strength:
 *   - Storybook stories are matched by their exact COMPUTED story id (Storybook's own
 *     toId(title, exportName) algorithm — reverse-engineered and verified against real usage
 *     in this repo's fixtures, not guessed) against literal occurrences in tests-e2e/ source.
 *     Since specs/fixtures navigate to `iframe.html?id=<that exact string>`, this is a strong
 *     signal. Some packages build the id half dynamically (`` `foo--${type}` ``); a prefix-only
 *     fallback catches that case and is labeled distinctly from an exact hit.
 *   - src/ features are matched by a much weaker naive whole-word check of the filename against
 *     test source text. Since Playwright tests here are E2E (interacting through the rendered
 *     UI, not by importing modules), most internal src files legitimately never appear by name
 *     even when thoroughly covered — expect a high "uncovered" rate that does NOT mean untested.
 *
 * Neither signal is proof of behavioral coverage. Treat "uncovered" as a categorized starting
 * list to verify by reading the actual specs — not as the final word on what's covered.
 *
 * Usage: node build-coverage-map.js <package-folder-name-or-path>
 */

const fs = require("fs");
const path = require("path");
const { resolveRepoRoot, walkFiles, resolvePackageDir } = require("./lib/workspace");

const EXCLUDE_SRC_SUFFIXES = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx", ".d.ts", ".stories.tsx", ".stories.ts"];
const EXCLUDE_SRC_BASENAMES = new Set(["index.ts", "index.tsx"]);

function isFeatureSrcFile(name) {
  if (!(name.endsWith(".ts") || name.endsWith(".tsx"))) return false;
  if (EXCLUDE_SRC_BASENAMES.has(name)) return false;
  return !EXCLUDE_SRC_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function identifierFor(filePath) {
  return path.basename(filePath).replace(/\.(tsx|ts)$/, "");
}

/**
 * Storybook's actual `toId(title, name)` algorithm (verified against real usage in this repo —
 * e.g. title "Use cases/Loan Pre Qualification" + export "LoanPreQualification" produces exactly
 * "use-cases-loan-pre-qualification--loan-pre-qualification", matching the literal iframe URL
 * `editor.ts` navigates to). The title segment is slugified as-is (no word-splitting); the name
 * segment is word-split at camelCase/PascalCase boundaries first (Storybook auto-generates a
 * display name from the export key via startCase before slugifying it).
 */
function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function slugifyExportName(name) {
  return slugify(name.replace(/([a-z0-9])([A-Z])/g, "$1-$2"));
}
function toStorybookId(title, name) {
  return `${slugify(title)}--${slugifyExportName(name)}`;
}

/**
 * Extract { title, stories: [{ exportName, id }] } from a *.stories.tsx/ts file's source. Only
 * `export const X: Story = {...}` counts as a story export (verified convention across every
 * .stories.tsx checked) — a plain `export const helperFn = () => ...` in the same file (common
 * for fixture-data generators) is NOT a story and must not be treated as one.
 */
function extractStories(source) {
  const titleMatch = source.match(/title:\s*["']([^"']+)["']/);
  const title = titleMatch ? titleMatch[1] : null;
  const exportNames = [];
  const exportRe = /export\s+const\s+(\w+)\s*:\s*Story\b/g;
  let m;
  while ((m = exportRe.exec(source)) !== null) {
    exportNames.push(m[1]);
  }
  if (!title) return [];
  return exportNames.map((exportName) => ({ exportName, id: toStorybookId(title, exportName) }));
}

function main() {
  const query = process.argv[2];
  if (!query) {
    console.error("Usage: node build-coverage-map.js <package-folder-name-or-path>");
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

  const srcDir = path.join(pkgDir, "src");
  const testsE2eDir = path.join(pkgDir, "tests-e2e");

  if (!fs.existsSync(srcDir)) {
    console.log(JSON.stringify({ note: `No src/ directory found at ${path.relative(repoRoot, pkgDir)}.` }, null, 2));
    process.exit(0);
  }

  // Concatenate every tests-e2e .ts file's source once — cheap enough, and lets each src
  // identifier be checked with a single regex pass instead of re-reading files per identifier.
  const testFiles = walkFiles(testsE2eDir, (n) => n.endsWith(".ts") || n.endsWith(".tsx"));
  const testsCorpus = testFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");

  const srcFiles = walkFiles(srcDir, isFeatureSrcFile);
  // Stories live in a top-level <package>/stories/ directory in every package checked
  // (dmn-editor, bpmn-editor, boxed-expression-component, scesim-editor,
  // dmn-editor-standalone), never under src/ — verified, not assumed.
  const storiesDir = path.join(pkgDir, "stories");
  const storyFiles = walkFiles(storiesDir, (n) => n.endsWith(".stories.tsx") || n.endsWith(".stories.ts"));

  const features = srcFiles.map((f) => ({
    file: path.relative(repoRoot, f),
    identifier: identifierFor(f),
  }));

  const stories = storyFiles.flatMap((f) =>
    extractStories(fs.readFileSync(f, "utf8")).map((s) => ({ file: path.relative(repoRoot, f), ...s }))
  );

  function mentionedInTests(identifier) {
    if (!identifier) return false;
    const re = new RegExp(`\\b${identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    return re.test(testsCorpus);
  }

  // Stories are matched by their exact computed Storybook id (e.g. "misc-empty--empty") — this
  // is the literal string a spec/fixture navigates to (iframe.html?id=<this>), so a substring
  // match here is a much stronger signal than the naive whole-word name matching used for
  // src/ features below. Some packages (e.g. boxed-expression-component) build the id half
  // dynamically instead — `` `boxed-expressions-context--${type}` `` — so the full literal id
  // never appears verbatim even though the story IS reachable. Fall back to checking whether
  // the id's prefix (before "--") appears immediately followed by "--" anywhere in the corpus,
  // which catches that parameterized-navigation pattern; tag it as a weaker "possible" match
  // rather than conflating it with an exact hit.
  function storyMatchKind(id) {
    if (testsCorpus.includes(id)) return "exact";
    const prefix = id.split("--")[0];
    if (testsCorpus.includes(`${prefix}--`))
      return "prefix-only (likely dynamic/parameterized navigation — verify manually)";
    return null;
  }

  const featuresMentioned = features.filter((f) => mentionedInTests(f.identifier));
  const featuresUnmentioned = features.filter((f) => !mentionedInTests(f.identifier));
  const storiesWithMatchKind = stories.map((s) => ({ ...s, match: storyMatchKind(s.id) }));
  const storiesMentioned = storiesWithMatchKind.filter((s) => s.match !== null);
  const storiesUnmentioned = storiesWithMatchKind.filter((s) => s.match === null).map(({ match, ...s }) => s);

  const specFiles = walkFiles(testsE2eDir, (n) => n.endsWith(".spec.ts"));
  const specsByFeatureGroup = {};
  for (const f of specFiles) {
    const rel = path.relative(testsE2eDir, f);
    const group = rel.includes(path.sep) ? rel.split(path.sep)[0] : "(top-level)";
    specsByFeatureGroup[group] = (specsByFeatureGroup[group] || 0) + 1;
  }

  const report = {
    pkgDir: path.relative(repoRoot, pkgDir),
    disclaimer:
      "Two different confidence levels here. storiesLikelyUncovered/Covered match on the exact computed " +
      "Storybook id (e.g. 'misc-empty--empty') — the literal string a spec navigates to — so this is a strong " +
      "signal: a story whose id never appears in tests-e2e/ is genuinely very likely never opened by any spec. " +
      "featuresLikelyUncovered/Covered is a much weaker naive whole-word match of src/ filenames against test " +
      "source text — most internal modules (types, hooks, providers, utilities) legitimately never appear by " +
      "name in E2E specs even when thoroughly covered through the UI, so expect a high 'uncovered' rate there " +
      "that does NOT mean untested. Use the features list only as a rough starting point to skim, and the " +
      "stories list as the much more actionable one — but always verify by reading the actual spec before " +
      "reporting a gap.",
    srcFeatureCount: features.length,
    storyCount: stories.length,
    specFileCount: specFiles.length,
    specsByFeatureGroup,
    featuresLikelyUncovered: featuresUnmentioned.map((f) => f.file),
    featuresLikelyCovered: featuresMentioned.map((f) => f.file),
    storiesLikelyUncovered: storiesUnmentioned,
    storiesLikelyCovered: storiesMentioned,
  };

  console.log(JSON.stringify(report, null, 2));
  console.error(
    `\n${featuresUnmentioned.length}/${features.length} src feature(s) have no name-match in tests-e2e/ — review these first. ` +
      `${storiesUnmentioned.length}/${stories.length} storybook stor(y/ies) likewise.`
  );
}

main();
