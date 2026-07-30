#!/usr/bin/env node
"use strict";
/**
 * Bootstraps Playwright infrastructure into a package that has none yet. Writing ~150 lines of
 * config/env/fixtures by hand is the easiest place in this workflow to drift from the repo's
 * conventions, so this generates the parts that are mechanical copies of the established
 * pattern (references/repo-conventions.md) and clearly flags the parts that still need a real
 * decision (which storybook story to point at, which dev servers a served-app needs).
 *
 * Creates (only if missing — never overwrites):
 *   - env/index.js               (root-env + webpack-base/env + playwright-base/env composition)
 *   - playwright.config.ts       (merges @kie-tools/playwright-base/playwright.config)
 *   - tests-e2e/__fixtures__/base.ts   (empty test.extend, ready for fixtures to be added)
 * Additively merges into package.json (only ADDS missing keys, never touches existing ones):
 *   - the standard test-e2e* script family
 *   - the devDependencies every Playwright-enabled package declares
 *
 * Usage: node scaffold-package-e2e.js <package> [--served-app] [--port <PORT>]
 *   --served-app   generate the multi-webServer skeleton (like online-editor) instead of the
 *                  default single-storybook-iframe shape. Needs manual completion either way —
 *                  a served app's actual dev-server commands can't be invented.
 *   --port <PORT>  use this storybook port instead of an auto-suggested free one.
 */

const fs = require("fs");
const path = require("path");
const {
  resolveRepoRoot,
  listWorkspacePackages,
  resolvePackageDir,
  readJson,
  groupForFile,
  headerFilePathForGroup,
  UNCONFIGURED_HEADER_SENTINEL,
} = require("./lib/workspace");

const REPO_PLAYWRIGHT_TEST_VERSION = "^1.45.2"; // matches every package.json in this repo — verified, not invented

function toCamelCase(kebab) {
  return kebab.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function suggestFreePort(repoRoot, requestedPort) {
  const used = new Set();
  for (const pkg of listWorkspacePackages(repoRoot)) {
    const envPath = path.join(pkg.dir, "env", "index.js");
    if (!fs.existsSync(envPath)) continue;
    const source = fs.readFileSync(envPath, "utf8");
    const re = /port:\s*["'](\d{4})["']/g;
    let m;
    while ((m = re.exec(source)) !== null) used.add(Number(m[1]));
  }
  if (requestedPort) {
    return { port: requestedPort, alreadyInUse: used.has(requestedPort) };
  }
  let candidate = 9900;
  while (used.has(candidate)) candidate++;
  return { port: candidate, alreadyInUse: false };
}

function header(repoRoot, targetPath) {
  const group = groupForFile(repoRoot, targetPath);
  const headerPath = headerFilePathForGroup(group);
  if (!fs.existsSync(headerPath)) return null;
  const text = fs.readFileSync(headerPath, "utf8").trimEnd();
  return text === UNCONFIGURED_HEADER_SENTINEL ? null : text;
}

function writeIfMissing(filePath, content, created, skipped) {
  if (fs.existsSync(filePath)) {
    skipped.push(filePath);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  created.push(filePath);
}

function main() {
  const args = process.argv.slice(2);
  const pkgQuery = args[0];
  const servedApp = args.includes("--served-app");
  const portIdx = args.indexOf("--port");
  const requestedPort = portIdx !== -1 ? Number(args[portIdx + 1]) : null;

  if (!pkgQuery) {
    console.error("Usage: node scaffold-package-e2e.js <package> [--served-app] [--port <PORT>]");
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

  const configPath = path.join(pkgDir, "playwright.config.ts");
  if (fs.existsSync(configPath)) {
    console.error(
      `${path.relative(repoRoot, configPath)} already exists — this package is already bootstrapped, nothing to do.`
    );
    process.exit(2);
  }

  const configHeader = header(repoRoot, configPath);
  if (!configHeader) {
    console.error(
      `No configured license header for this package's workspace group yet — provide the real header text (see assets/.ibm-header) before bootstrapping here.`
    );
    process.exit(2);
  }

  const folderName = path.basename(pkgDir);
  const camelKey = toCamelCase(folderName);
  const { port, alreadyInUse } = suggestFreePort(repoRoot, requestedPort);

  const created = [];
  const skipped = [];

  // --- env/index.js ---
  const envPath = path.join(pkgDir, "env", "index.js");
  const envContent = `${configHeader}

const { varsWithName, composeEnv } = require("@kie-tools-scripts/build-env");

module.exports = composeEnv(
  [require("@kie-tools/root-env/env"), require("@kie-tools-core/webpack-base/env"), require("@kie-tools/playwright-base/env")],
  {
    vars: varsWithName({}),
    get env() {
      return {
        ${camelKey}: {
          storybook: {
            port: "${port}",
          },
        },
      };
    },
  }
);
`;
  writeIfMissing(envPath, envContent, created, skipped);

  // --- playwright.config.ts ---
  const configContent = servedApp
    ? `${configHeader}

import { defineConfig } from "@playwright/test";
import playwirghtBaseConfig from "@kie-tools/playwright-base/playwright.config";
import merge from "lodash/merge";

import { env } from "./env";
const buildEnv: any = env; // build-env is not typed

// SKELETON — this package serves a full app, not a single storybook story, so the actual
// webServer list can't be generated automatically. Fill in each dev server this app genuinely
// needs (see packages/online-editor/playwright.config.ts for a real multi-server example).
const customConfig = defineConfig({
  use: {
    baseURL: \`http://localhost:\${buildEnv.${camelKey}.storybook.port}\`,
  },
  webServer: [
    {
      command: "pnpm start",
      url: \`http://localhost:\${buildEnv.${camelKey}.storybook.port}\`,
      reuseExistingServer: true,
      stdout: "pipe",
    },
    // <add every other dev server this app depends on>
  ],
});

export default defineConfig(merge(playwirghtBaseConfig, customConfig));
`
    : `${configHeader}

import { defineConfig } from "@playwright/test";
import playwirghtBaseConfig from "@kie-tools/playwright-base/playwright.config";
import merge from "lodash/merge";

import { env } from "./env";
const buildEnv: any = env; // build-env is not typed

const customConfig = defineConfig({
  use: {
    baseURL: \`http://localhost:\${buildEnv.${camelKey}.storybook.port}\`,
  },
  /* Run your local dev server before starting the tests */
  webServer: {
    command: "pnpm start",
    // <PLACEHOLDER story id> — no storybook story exists yet for this package; point this at a
    // real story once one is authored (see any sibling package's playwright.config.ts for the shape).
    url: \`http://localhost:\${buildEnv.${camelKey}.storybook.port}/iframe.html?args=&id=<PLACEHOLDER-STORY-ID>&viewMode=story\`,
    reuseExistingServer: true,
    stdout: "pipe",
    timeout: 180000,
  },
});

export default defineConfig(merge(playwirghtBaseConfig, customConfig));
`;
  writeIfMissing(configPath, configContent, created, skipped);

  // --- tests-e2e/__fixtures__/base.ts ---
  const baseFixturePath = path.join(pkgDir, "tests-e2e", "__fixtures__", "base.ts");
  const baseFixtureHeader = header(repoRoot, baseFixturePath);
  const baseFixtureContent = `${baseFixtureHeader}

import { test as base } from "@playwright/test";

// Add one page-object import + fixture entry per concern as scenarios need them
// (see any sibling package's tests-e2e/__fixtures__/base.ts for the pattern).
type ${toCamelCase(folderName).replace(/^[a-z]/, (c) => c.toUpperCase())}Fixtures = {};

export const test = base.extend<${toCamelCase(folderName).replace(/^[a-z]/, (c) => c.toUpperCase())}Fixtures>({});

export { expect } from "@playwright/test";
`;
  writeIfMissing(baseFixturePath, baseFixtureContent, created, skipped);

  // --- package.json: additive merge only ---
  const pkgJsonPath = path.join(pkgDir, "package.json");
  const pkgJson = readJson(pkgJsonPath);
  const scriptsToAdd = {
    "test-e2e":
      'run-script-if --ignore-errors "$(build-env endToEndTests.ignoreFailures)" --bool "$(build-env endToEndTests.run)" --then "pnpm test-e2e:condition"',
    "test-e2e:condition":
      'run-script-if --bool "$(build-env endToEndTests.containerized)" --then  "rimraf ./dist-tests-e2e" "pnpm test-e2e:container:run" --else "rimraf ./dist-tests-e2e" "pnpm test-e2e:run"',
    "test-e2e:container:clean": "playwright-base-container clean",
    "test-e2e:container:run": `start-server-and-test 'pnpm start' http://localhost:$(build-env ${camelKey}.storybook.port) 'playwright-base-container run --additional-env=KIE_TOOLS_PLAYWRIGHT_CONTAINER__PORT=$(build-env ${camelKey}.storybook.port) --container-workdir=incubator-kie-tools/${path.relative(repoRoot, pkgDir)} --container-name=kie-tools-playwright-containerization-${folderName}'`,
    "test-e2e:container:shell": `start-server-and-test 'pnpm start' http://localhost:$(build-env ${camelKey}.storybook.port) 'playwright-base-container shell --additional-env=KIE_TOOLS_PLAYWRIGHT_CONTAINER__PORT=$(build-env ${camelKey}.storybook.port) --container-workdir=incubator-kie-tools/${path.relative(repoRoot, pkgDir)} --container-name=kie-tools-playwright-containerization-${folderName}'`,
    "test-e2e:open": "pnpm exec playwright show-report dist-tests-e2e/reports",
    "test-e2e:run": "pnpm exec playwright test",
  };
  const devDepsToAdd = {
    "@kie-tools/playwright-base": "workspace:*",
    "@kie-tools/root-env": "workspace:*",
    "@kie-tools-core/webpack-base": "workspace:*",
    "@playwright/test": REPO_PLAYWRIGHT_TEST_VERSION,
    "start-server-and-test": "^2.0.3",
    lodash: "^4.18.1",
    "@types/lodash": "^4.14.168",
  };

  pkgJson.scripts = pkgJson.scripts || {};
  pkgJson.devDependencies = pkgJson.devDependencies || {};
  const scriptsAdded = [];
  const depsAdded = [];
  for (const [key, value] of Object.entries(scriptsToAdd)) {
    if (!(key in pkgJson.scripts)) {
      pkgJson.scripts[key] = value;
      scriptsAdded.push(key);
    }
  }
  for (const [key, value] of Object.entries(devDepsToAdd)) {
    if (!(key in pkgJson.devDependencies)) {
      pkgJson.devDependencies[key] = value;
      depsAdded.push(key);
    }
  }
  if (scriptsAdded.length > 0 || depsAdded.length > 0) {
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");
  }

  const report = {
    pkgDir: path.relative(repoRoot, pkgDir),
    servingShape: servedApp
      ? "served-app (skeleton, needs manual completion)"
      : "single storybook iframe (placeholder story id)",
    portUsed: port,
    portWasAlreadyInUseByAnotherPackage: alreadyInUse,
    filesCreated: created.map((f) => path.relative(repoRoot, f)),
    filesSkippedAlreadyExisted: skipped.map((f) => path.relative(repoRoot, f)),
    packageJsonScriptsAdded: scriptsAdded,
    packageJsonDevDependenciesAdded: depsAdded,
    manualStepsRemaining: [
      servedApp
        ? "playwright.config.ts's webServer array is a skeleton — replace it with this app's actual dev servers (see packages/online-editor/playwright.config.ts for a real example)."
        : "playwright.config.ts's story id is a <PLACEHOLDER-STORY-ID> — author at least one storybook story, then point this at its real id.",
      "run `pnpm install` at the repo root to link the new workspace:* devDependencies.",
      alreadyInUse
        ? `port ${port} was requested explicitly but is already used by another package's env/index.js — pick a different one.`
        : null,
    ].filter(Boolean),
  };

  console.log(JSON.stringify(report, null, 2));
  console.error(
    `\nBootstrapped ${report.filesCreated.length} file(s), skipped ${report.filesSkippedAlreadyExisted.length} already-existing file(s). See manualStepsRemaining before this is actually runnable.`
  );
}

main();
