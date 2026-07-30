# Verified Playwright conventions in this repo

Everything below was confirmed by reading the actual files, not assumed. If something you need isn't covered here, go read the analogous file in `dmn-editor` or `bpmn-editor` before inventing a pattern — those two are the most complete examples.

## Which packages have Playwright today

Exactly seven `playwright.config.ts` files exist in the repo, all under `packages/` (none under `examples/`):

- `packages/playwright-base` — the shared base itself, not a test target.
- `packages/boxed-expression-component`
- `packages/bpmn-editor`
- `packages/dmn-editor`
- `packages/dmn-editor-standalone`
- `packages/scesim-editor`
- `packages/online-editor`

All Playwright usage in this repo is **E2E only** — there is no Playwright Component Testing (`@playwright/experimental-ct-*`) anywhere, and Jest (`test/` or `tests/`, `*.test.ts`) is the unit-test layer. Don't conflate the two.

## `playwright.config.ts` pattern

Every consuming package does the same merge:

```ts
import { defineConfig } from "@playwright/test";
import playwirghtBaseConfig from "@kie-tools/playwright-base/playwright.config"; // note: typo "playwirght" is in the actual repo import name in several packages — match whichever the target package already uses, don't silently "fix" it
import merge from "lodash/merge";
import { env } from "./env";
const buildEnv: any = env;

const customConfig = defineConfig({
  use: { baseURL: `http://localhost:${buildEnv.<package>.storybook.port}` },
  webServer: { command: "pnpm start", url: "...iframe.html?args=&id=<story>&viewMode=story", reuseExistingServer: true, stdout: "pipe", timeout: 180000 },
});

export default defineConfig(merge(playwirghtBaseConfig, customConfig));
```

Two shapes exist for `webServer`, pick based on how the target package runs:

- **Storybook-driven editors** (`boxed-expression-component`, `bpmn-editor`, `dmn-editor`, `dmn-editor-standalone`, `scesim-editor`): a single `webServer` object pointing at a storybook `iframe.html?...&viewMode=story` URL, `command: "pnpm start"`.
- **Full application** (`online-editor`): `webServer` is an **array** of multiple servers that must all come up (cors-proxy, extended-services, accelerator quarkus, the app itself), plus `use: { viewport: {1600,1200}, ignoreHTTPSErrors: true }`. Use this shape only if the target package is a standalone app, not a component/editor served by storybook.

If the selected package has no `playwright.config.ts` yet (bootstrap case, e.g. an `examples/*` app), copy the shape from the closest analogue (storybook-driven vs. full-app) rather than writing one from scratch.

## `packages/playwright-base` — the shared base

- `playwright.config.ts` sets `testDir: "./tests-e2e"`, `outputDir: "dist-tests-e2e/output"`, `snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{testFileDir}/{arg}{ext}"`, projects filtered by env flags, and shared `use`/`expect` defaults (`screenshot: "only-on-failure"`, `video: "on-first-retry"`, `trace: "on-first-retry"`, `locale: "en-US"`, `toHaveScreenshot.maxDiffPixelRatio`).
- `projectNames.ts` exports `ProjectName`: `CHROMIUM = "chromium"`, `WEBKIT = "webkit"`, `GOOGLE_CHROME = "Google Chrome"`.
- `annotations.ts` exports `TestAnnotations`: `REGRESSION = "regression"`, `AFFECTED_BY = "affected-by"`, `WORKAROUND_DUE_TO = "workaround-due-to"`. Use these to tag tests that pin a bugfix, e.g.:
  ```ts
  test.info().annotations.push({ type: TestAnnotations.REGRESSION, description: "https://github.com/apache/incubator-kie-issues/issues/980" });
  ```
- Its `bin.js`/`src/bin.ts` provides the `playwright-base-container` CLI (used by the `test-e2e:container:*` scripts below) for running tests inside a Docker/Podman container — this is how CI runs E2E, so the local `pnpm test-e2e:run` result and the containerized one can differ (fonts/rendering → screenshot diffs).

## Env / build-env chain

Config values come from a layered `env/index.js`, not from a `.env` file:

```
@kie-tools/root-env/env
  → @kie-tools/playwright-base/env  (adds playwrightBase.{installDeps, enableChromiumProject, enableWebkitProject, enableGoogleChromeProject, projectTimeout, expectTimeout, maxDiffPixelRatio, retries(default 2), workers(default 2)})
    → <package>/env/index.js        (adds package-specific keys, e.g. dmnEditor.storybook.port = "9901")
```

A package's `playwright.config.ts` imports its own local `./env`, which composes all of the above (plus e.g. `@kie-tools-core/webpack-base/env` for the storybook port). If you bootstrap Playwright into a package that has none of this, create `env/index.js` following the shape of `packages/dmn-editor/env/index.js`.

## `tests-e2e/` directory layout

```
tests-e2e/
  __fixtures__/            # page objects, composed into one `test`
    base.ts                # test.extend<Fixtures>({...}); re-exports { test, expect }
    <pageObject>.ts         # one class per concern (diagram.ts, editor.ts, nodes.ts, ...)
    propertiesPanel/        # nested when a package has many panel variants (dmn-editor pattern)
  __screenshots__/<projectName>/<specSubdir>/<name>.png   # never hand-author these; toHaveScreenshot() generates/updates them
  __containerization__/
    playwright-docker-compose.yml
    playwright-docker-compose.ci.yml
  <featureGroup>/<camelCaseScenario>.spec.ts   # grouped by feature area; naming of the group folder is package-specific (dmn-editor: drgElements/, drgRequirements/, drdArtifacts/, drds/, readOnly/; bpmn-editor: flowElements/, propertiesPanel/; scesim-editor: features/misc/scesimEditor/useCases/; online-editor: createFiles/, editorPage/, homePage/, ...). Match the target package's own existing top-level grouping — don't impose another package's taxonomy.
```

### `__fixtures__/base.ts` pattern

```ts
import { test as base } from "@playwright/test";
import { Diagram } from "./diagram";
// ... one import per page object

type PackageFixtures = {
  diagram: Diagram;
  // ...
};

export const test = base.extend<PackageFixtures>({
  diagram: async ({ page }, use) => { await use(new Diagram(page)); },
  // fixtures can depend on other fixtures, e.g.:
  nodes: async ({ page, diagram, browserName }, use) => { await use(new Nodes(page, diagram, browserName)); },
});

export { expect } from "@playwright/test";
```

**Cross-package fixture reuse is a real, load-bearing pattern**: `dmn-editor`'s `base.ts` imports `BoxedExpressionEditor` straight from `@kie-tools/boxed-expression-component/tests-e2e/__fixtures__/boxedExpression`, and a dmn-editor spec imports `CloseOption` from `@kie-tools/boxed-expression-component/tests-e2e/api/nameAndDataTypeCell`. When the selected package embeds another package's editor/component, check that package's `tests-e2e/__fixtures__/` (and any `tests-e2e/api/`) for reusable page objects/helpers before writing new ones — this requires the dependency to already be declared in `package.json` (workspace deps use `workspace:*`).

### Spec file pattern

```ts
/* <license header, see assets/license-header.txt — verbatim, CI's Apache RAT check enforces it> */

import { TestAnnotations } from "@kie-tools/playwright-base/annotations"; // only if pinning a regression
import { test, expect } from "../__fixtures__/base";

test.beforeEach(async ({ editor }) => {
  await editor.open();
});

test.describe("<Feature>", () => {
  test.describe("<Sub-scenario grouping>", () => {
    test("should <behavior>", async ({ <fixtures> }) => {
      // act
      // assert with expect(locator).toBeAttached()/toBeVisible()/etc.
      await expect(diagram.get()).toHaveScreenshot("kebab-case-name.png");
      // and/or assert on the underlying JSON/XML model via a `jsonModel`-style fixture, not just the DOM
    });
  });
});
```

Naming: file is `camelCase.spec.ts` (e.g. `addInputData.spec.ts`, `deleteAssociationWaypoint.spec.ts`) — the name states the action, not "test" or "should".

## `package.json` scripts (E2E-relevant)

Every Playwright-enabled package exposes this same script family — reuse verbatim, don't invent new script names:

```json
"test-e2e": "run-script-if --ignore-errors \"$(build-env endToEndTests.ignoreFailures)\" --bool \"$(build-env endToEndTests.run)\" --then \"pnpm test-e2e:condition\"",
"test-e2e:condition": "run-script-if --bool \"$(build-env endToEndTests.containerized)\" --then \"rimraf ./dist-tests-e2e\" \"pnpm test-e2e:container:run\" --else \"rimraf ./dist-tests-e2e\" \"pnpm test-e2e:run\"",
"test-e2e:container:clean": "playwright-base-container clean",
"test-e2e:container:run": "start-server-and-test 'pnpm start' <url> 'playwright-base-container run --additional-env=... --container-workdir=... --container-name=...'",
"test-e2e:container:shell": "start-server-and-test 'pnpm start' <url> 'playwright-base-container shell ...'",
"test-e2e:open": "pnpm exec playwright show-report dist-tests-e2e/reports",
"test-e2e:run": "pnpm exec playwright test"
```

To run/validate tests locally while developing: `pnpm test-e2e:run` (assumes the dev server; Playwright's own `webServer` block will start it if not already running), or `pnpm exec playwright test --list` to sanity-check discovery/imports without executing.

## Linting and type-checking of `tests-e2e/`

Every package's `lint` script is scoped to `./src` only (`kie-tools--eslint ./src`) — **`tests-e2e/` is not linted**. It IS type-checked as part of the whole-package `tsc` build (no separate `tsconfig` excludes it). So: generated test code must compile under the package's existing `tsconfig.json`, but does not need to satisfy the `./src` ESLint config. Still match the surrounding code style (this repo uses Prettier repo-wide via `prettier.config.mjs`).

## License header

CI enforces Apache RAT license-header checks on every source file, `tests-e2e/**/*.ts` included. Always prepend the exact header in `assets/license-header.txt` to every new `.ts` file (config, fixture, or spec).

## No pre-existing plan-doc convention

There is no `TEST_PLAN.md`/`PLAN.md` anywhere in the repo today, and `CONTRIBUTING.md`'s Testing section only points to `tests-e2e/`/`test/` and `packages/playwright-base/README.md` — it does not define a plan-file format. `assets/TEST_PLAN-template.md` in this skill is therefore the convention to use; it isn't lifted from an existing repo file.

## `examples/` has zero Playwright today

If the user picks an `examples/*` app, there is nothing to "match" inside that directory — bootstrap it using the closest `packages/` analogue (storybook-driven vs. full-app, per the `webServer` shapes above) and say explicitly that you're introducing Playwright to this app for the first time.
