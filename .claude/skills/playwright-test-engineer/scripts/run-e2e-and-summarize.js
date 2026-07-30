#!/usr/bin/env node
"use strict";
/**
 * Runs a package's actual Playwright suite (via `pnpm exec playwright test --reporter=json`)
 * and summarizes pass/fail/flaky/skipped counts plus failing-test titles and error snippets —
 * instead of the model reading raw terminal output and eyeballing what passed.
 *
 * The JSON-report walker is deliberately schema-tolerant: rather than hardcoding the exact
 * suites/specs/tests/results nesting depth (which this environment can't verify against a real
 * run — no node_modules installed here), it recursively scans the whole parsed report for any
 * object carrying a recognized `status` value (Playwright's own stable status enum: passed,
 * failed, timedOut, interrupted, skipped) and pairs it with the nearest enclosing `title`. This
 * is resilient to minor shape differences across Playwright versions as long as those two
 * fields exist somewhere in the tree, which has been true throughout the JSON reporter's
 * history — but treat the summary as best-effort, not a guaranteed-exact schema match, and
 * always look at the full JSON (`fullReportPath` in the output) if something looks off.
 *
 * Degrades the same way verify-e2e-discovery.js does when node_modules/config aren't ready
 * (exit 4, not silent failure).
 *
 * Usage: node run-e2e-and-summarize.js <package> [-- <extra playwright test args>]
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const { resolveRepoRoot, resolvePackageDir } = require("./lib/workspace");

const KNOWN_STATUSES = new Set(["passed", "failed", "timedOut", "interrupted", "skipped"]);

function collectResults(node, titleContext, out) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectResults(item, titleContext, out);
    return;
  }
  const nextTitle = typeof node.title === "string" ? node.title : titleContext;
  if (typeof node.status === "string" && KNOWN_STATUSES.has(node.status)) {
    out.push({
      title: nextTitle,
      status: node.status,
      duration: typeof node.duration === "number" ? node.duration : null,
      error: node.error && typeof node.error.message === "string" ? node.error.message : null,
    });
  }
  for (const key of Object.keys(node)) {
    if (key === "status") continue;
    collectResults(node[key], nextTitle, out);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const dashIndex = argv.indexOf("--");
  const query = dashIndex === -1 ? argv[0] : argv.slice(0, dashIndex)[0];
  const extraArgs = dashIndex === -1 ? [] : argv.slice(dashIndex + 1);

  if (!query) {
    console.error("Usage: node run-e2e-and-summarize.js <package> [-- <extra playwright test args>]");
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

  if (
    !fs.existsSync(path.join(pkgDir, "node_modules")) &&
    !fs.existsSync(path.join(repoRoot, "node_modules", ".modules.yaml"))
  ) {
    console.error(
      "No node_modules found — running the real suite needs installed dependencies (and a browser download). " +
        "Run `pnpm install` at the repo root first. Static checks (run-all-checks.js) don't need this and already ran."
    );
    process.exit(4);
  }
  if (!fs.existsSync(path.join(pkgDir, "playwright.config.ts"))) {
    console.error(`No playwright.config.ts in ${path.relative(repoRoot, pkgDir)} — run scaffold-package-e2e.js first.`);
    process.exit(4);
  }

  const reportPath = path.join(os.tmpdir(), `playwright-test-engineer-report-${Date.now()}.json`);
  const result = spawnSync("pnpm", ["exec", "playwright", "test", "--reporter=json", ...extraArgs], {
    cwd: pkgDir,
    encoding: "utf8",
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
    shell: process.platform === "win32",
  });

  if (result.error) {
    console.error(`Failed to run pnpm/playwright: ${result.error.message}`);
    process.exit(2);
  }

  let report = null;
  if (fs.existsSync(reportPath)) {
    try {
      report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    } catch (e) {
      // fall through to stdout parsing below
    }
  }
  if (!report) {
    try {
      report = JSON.parse(result.stdout);
    } catch (e) {
      console.error("Could not parse a JSON report from either the output file or stdout.");
      console.error("Raw output follows:\n" + result.stdout + result.stderr);
      process.exit(result.status ?? 1);
    }
  }

  const collected = [];
  collectResults(report, null, collected);

  const bySeverity = { passed: 0, failed: 0, timedOut: 0, interrupted: 0, skipped: 0 };
  for (const r of collected) bySeverity[r.status]++;
  const failing = collected.filter(
    (r) => r.status === "failed" || r.status === "timedOut" || r.status === "interrupted"
  );

  const summary = {
    pkgDir: path.relative(repoRoot, pkgDir),
    exitCode: result.status,
    counts: bySeverity,
    totalResultsFound: collected.length,
    failingTests: failing.map((f) => ({ title: f.title, status: f.status, error: f.error })),
    fullReportPath: reportPath,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (result.status === 0) {
    console.error(`\n${bySeverity.passed} passed, ${bySeverity.skipped} skipped. Full JSON report at ${reportPath}.`);
  } else {
    console.error(
      `\n${failing.length} failing result(s) out of ${collected.length}. See failingTests above; full JSON report at ${reportPath}.`
    );
  }
  process.exit(result.status ?? 1);
}

main();
