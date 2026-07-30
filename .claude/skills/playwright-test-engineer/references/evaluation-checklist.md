# Mode 2 evaluation checklist

Work file-by-file through the package's `tests-e2e/` directory. This checklist backs the six report sections in `SKILL.md` Step 4b.

## 1. Coverage map

- List every top-level `src/` feature/component (and, for storybook-driven packages, every story under the package's stories) alongside the spec file(s) that exercise it. A feature with zero specs is uncovered — say so by name, not just "some gaps exist".
- For packages that embed another package's editor (e.g. `dmn-editor` embeds the boxed-expression component), check whether the embedded feature is covered here, upstream in the embedded package's own `tests-e2e/`, or nowhere — don't credit coverage that doesn't exist just because the dependency has its own tests for its own package.
- Cross-reference `jsonModel`/model-assertion fixtures if present: DOM-only coverage (`toBeVisible`, `toHaveScreenshot`) without an accompanying assertion on the underlying model (XML/JSON) is weaker than tests that check both — note where model assertions are missing.

## 2. Test quality

- **Assertions**: flag tests whose only assertion is a screenshot (`toHaveScreenshot`) with no functional assertion above it — screenshots catch visual regressions, not logic regressions, and are the flakiest assertion type in this stack (cross-browser/font rendering).
- **Selector stability**: prefer the page-object fixtures over ad-hoc `page.locator(...)` calls in spec files. If a spec bypasses the fixtures with raw CSS/xpath/nth-child selectors, flag it — it belongs in a fixture method instead.
- **Anti-patterns to search for explicitly**:
  - `page.waitForTimeout(` — hardcoded sleep instead of waiting on a condition/locator state.
  - Hardcoded absolute pixel coordinates for drag/drop without a documented reason (some diagram interactions in this repo legitimately need coordinates — check whether a comment/annotation explains why, and whether `diagram.resetFocus()`-style helpers are used around it).
  - Missing `test.beforeEach` cleanup/setup mirroring what sibling specs in the same folder do (inconsistency across specs in the same feature group is itself a smell).
  - Tests with no `test.describe` grouping when every sibling file uses one — organizational drift.
- **Error-state coverage**: does the spec file (or its feature group) test failure/invalid-input paths, or only the happy path?

## 3. Fixture & config hygiene

- Confirm `playwright.config.ts` still merges `@kie-tools/playwright-base/playwright.config` via `lodash/merge` rather than redefining shared options (projects, reporters, retries) locally — local redefinition drifts from the shared base silently.
- Confirm new fixtures were added to `__fixtures__/base.ts`'s `test.extend` rather than instantiated ad hoc inside spec files.
- Check for duplicated setup logic across multiple spec files that should be a `test.beforeEach` in a shared fixture or a helper method instead.
- Check `env/index.js` — are build-env keys actually used by the config, or is there dead config left over from a copy-paste of another package's setup?

## 4. Flakiness risk

Call out tests as flaky-risk when they show:

- Screenshot assertions on elements affected by animation, async data loading, or non-deterministic layout (e.g. anything not preceded by an explicit wait on a stable locator state).
- Order-dependent tests: a test that only passes because a previous test in the same file left state behind, instead of using `test.beforeEach`/`editor.open()` for isolation.
- Drag-and-drop or coordinate-based interactions without a settle/wait step, which are sensitive to CI machine timing.
- Cross-browser-only assertions (`browserName` checks) that suggest a test behaves differently per project — a sign the underlying interaction isn't actually stable.
- Reliance on real timers/network without mocking where the target package has a mocking convention already (check sibling specs).

Explain *why* for each flagged test, not just that it's "risky".

## 5. Missing scenarios

Derive from the Step 2 source analysis, not from imagination: walk `src/` (or storybook stories) again and list concrete scenarios with no matching spec — happy path, edge case, error state, or integration point. Tie each to a real file path.

## 6. Recommendations

Prioritised list (High/Medium/Low), each one line, each pointing at a specific file or file pattern — not generic advice like "add more tests". Example shape:

- **High** — `tests-e2e/foo/bar.spec.ts:42` — replace `page.waitForTimeout(2000)` with waiting on `nodes.get({name:...})` to be attached.
- **Medium** — no spec covers the "invalid file import" error state in `src/features/import/*` — add one under the package's existing feature-group folder.
- **Low** — `__fixtures__/base.ts` instantiates `Foo` without a corresponding fixture in three spec files — extract to a fixture.
