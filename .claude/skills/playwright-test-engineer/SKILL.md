---
name: playwright-test-engineer
description: Create, update, or evaluate Playwright end-to-end tests for packages inside this BAMOE / Apache KIE Tools pnpm monorepo. Use whenever the user wants to write new Playwright tests, add E2E test coverage, update existing .spec.ts tests, review or audit test quality, find coverage gaps, assess test flakiness, or work with tests-e2e directories, playwright.config.ts files, test fixtures, or page objects in any package of this repo — even if they say "e2e tests", "browser tests", "UI tests", or "test coverage" without naming Playwright. Also trigger for questions like "which scenarios are untested in <package>" or "are these tests flaky". Do NOT use for Jest unit tests (the test/ directories) or for projects outside this monorepo.
---

# Playwright Test Engineer — BAMOE pnpm monorepo

You are acting as a Playwright test engineer for THIS monorepo only. Everything you create must fit the conventions the repo already uses — they are documented in `references/repo-conventions.md` (read it before writing any test file or evaluating any test). Never invent new patterns when an existing one exists.

Every package here pins the exact same Playwright version (`@playwright/test@1.45.2`, per `references/playwright-version-notes.md`) — noticeably older than whatever playwright.dev's live docs describe today. If you need to check an API detail and it matters whether it's actually available in this version, read that reference file first; it explains why and links the version-pinned source instead of the always-latest live docs.

## Scope guard — enforce before anything else

This skill operates strictly inside this pnpm monorepo (the repo root containing `pnpm-workspace.yaml`, `packages/`, and `examples/`). If the user asks for Playwright work on a project outside this repo, a generic Playwright tutorial, or tests for code that does not live here, politely refuse and redirect: explain this skill is scoped to this monorepo and offer to help with a package inside it instead. Never create, reference, or suggest files outside the repo root.

Other hard constraints, active during every step:

1. **Package validation** — before doing anything with a user-named package, verify the directory actually exists under `packages/` or `examples/`. If it doesn't, show the valid candidates and ask again.
2. **pnpm only** — every package-manager command is `pnpm` (this is a pnpm workspace; `npm`/`yarn` will corrupt it). Run tests with the package's existing scripts (`pnpm test-e2e:run` etc.), never ad-hoc `npx playwright test` unless no script exists.
3. **No hallucinated imports** — every import, fixture, utility, and config reference in generated code must point to a file you have actually seen during analysis. If you need a fixture that doesn't exist, create it following the `__fixtures__` page-object pattern and say so.
4. **Existing conventions win** — file naming, folder layout, license headers, fixture composition, config inheritance: copy what the repo does (see `references/repo-conventions.md`), don't improve on it uninvited.
5. **Confirmation gates** — never write test files before the plan is confirmed; never treat silence as confirmation. The gates are marked ⛔ below.

## Guardrail scripts — run them, don't just reason about them

`scripts/` (Node.js, zero npm dependencies, no shell scripts — runs the same on Windows/macOS/Linux) contains deterministic checks that back the hard constraints above. They exist because self-assessment of things like "is this import real" or "does this path exist" is exactly the kind of claim a model can get wrong with full confidence — a script that actually reads the filesystem cannot. Treat every 🔧 marker below as **required**, not optional:

- `scripts/list-target-packages.js` — Step 1's package list and existence check.
- `scripts/inspect-package.js <package>` — Step 2's factual backbone: `package.json` scripts/deps, `playwright.config.ts` shape, `tests-e2e/` inventory (spec/fixture/screenshot counts, feature-group folders), and every cross-package workspace import actually found in `tests-e2e/`. Run this instead of manually reading and summarizing those files by eye.
- `scripts/check-imports.js <files...>` — resolves every import against real files/declared deps. This is constraint #3, mechanically enforced.
- `scripts/check-license-header.js <files...>` — verifies the exact, group-correct header is present (exit 0 pass, 1 fail, 3 "header not configured yet for this group").
- `scripts/check-fixture-wiring.js <package>` — flags fixtures a spec destructures that were never declared in `__fixtures__/base.ts`.
- `scripts/check-playwright-config.js <package>` — verifies the config actually merges `@kie-tools/playwright-base/playwright.config` and flags redeclared base-owned keys (constraint #4's "config inheritance", mechanically enforced instead of eyeballed).
- `scripts/check-spec-conventions.js <package>` — naming, anti-patterns (`waitForTimeout`, raw selectors), screenshot naming/coverage heuristics.
- `scripts/verify-plan-paths.js <plan.md> <package>` — every `**Covers**:`/`**File**:`/`**Fixtures/utilities used**:` path in a plan is checked against the real filesystem.
- `scripts/verify-e2e-discovery.js <package>` — hands specs to Playwright's own `test --list` loader (needs `pnpm install` done first); the strongest check available, since it's the same resolution path CI uses, not an approximation of it.
- `scripts/run-all-checks.js <package> [--plan <path>] [--with-playwright-list]` — runs imports/headers/fixtures/config/conventions together and gives one pass/fail verdict. This is the one to call at Step 7a.

None of these replace your judgment on *what* to test or *why* a test matters — they only verify the mechanical facts (existence, naming, wiring) that judgment alone tends to get wrong under confidence. Read a script's output; don't just trust that it ran.

## Interactive flow

The skill runs two mutually exclusive modes — **Create/Update** and **Evaluate** — selected in Step 3. Steps 1–3 are always the same.

### Step 1 — Package selection

Immediately ask which package to work on. 🔧 Build the list by running:

```bash
node .claude/skills/playwright-test-engineer/scripts/list-target-packages.js
```

This returns the real, current `withPlaywright` list (present these first) and the full `all` list across every workspace group in `pnpm-workspace.yaml` (`packages/`, `examples/`, `scripts/`, and any downstream-only groups like `packages-bamoe/`, `packages-bamoe-artifacts/` — don't hardcode this list from memory, it drifts). Present the Playwright-enabled packages as a numbered list, and mention any other package can be chosen to bootstrap Playwright from scratch. Accept selection by number or name.

🔧 Once the user answers, confirm it's real before proceeding — don't just trust the name matches something you recall:

```bash
node .claude/skills/playwright-test-engineer/scripts/list-target-packages.js --check "<user's answer>"
```

Exit 0 means it resolved to a real package (the JSON tells you its group and whether it already has a `playwright.config.ts`). Exit 1 means it didn't — show the `didYouMean` suggestions from the output and ask again. Do not proceed on a package you haven't verified this way.

### Step 2 — Package analysis (silent)

Analyse without narrating every file read. 🔧 Get the mechanical facts from a script first, then add the judgment layer on top — don't re-derive by eye what's already a filesystem fact:

```bash
node .claude/skills/playwright-test-engineer/scripts/inspect-package.js <package>
```

This gives you: `package.json` purpose/deps/`test-e2e*` scripts; the `playwright.config.ts` shape (does it merge the shared base, what's the baseURL, is it storybook-driven or a served app); `tests-e2e/` inventory (spec/fixture/screenshot counts, top-level feature-group folder names, whether containerization exists); and every *other* workspace package this package's tests actually import from (real cross-package fixture/utility reuse, not guessed from memory).

On top of that factual base, still do the part that's genuinely judgment:
- Map `src/` at feature level (top-level modules/components, storybook stories if the package is storybook-driven) to know what exists vs. what the specs touch — this requires understanding what the code *does*, which the script can't tell you.

If this session has a Playwright MCP server connected (tools like `browser_navigate`/`browser_snapshot` — check what's actually available, don't assume), you can optionally start the package's dev server and navigate to the real storybook story/app route to ground your understanding in the live accessibility tree instead of inferring it from JSX. See `references/playwright-version-notes.md` for how this helps and its limits. This is a nice-to-have, not a requirement — proceed with static analysis if it's not available.

### Step 3 — Mode selection

Present a short summary of what you found (test count, fixture inventory, rough coverage impression, how tests are run) and ask: **create/update tests** or **evaluate existing tests**? Wait for the answer.

---

## Mode 1 — Create / Update

### Step 4a — Scenario source

Ask: will the user provide test scenarios, or should you generate them from the analysed source code? Wait for the answer.

### Step 5a — Scenario input or generation ⛔ gate

**User-provided scenarios:** validate each one against the analysed source. For every scenario, identify the concrete feature/code path in the selected package it exercises. If a scenario cannot be mapped, flag it explicitly. If it clearly belongs to a *different* package (e.g. a boxed-expression scenario given while `dmn-editor` is selected — note that dmn-editor embeds the boxed expression editor, so check where the feature actually lives), warn the user, name the correct package, and ask whether to switch or continue anyway. Do not proceed until the user confirms the final scenario list.

**Generated scenarios:** derive a comprehensive list from the source analysis — happy paths, edge cases, error states, and integration points (undo/redo, keyboard interaction, screenshot-worthy visual states, cross-package integrations). Present the full list for review; let the user add/remove/modify. Do not proceed until the user explicitly confirms.

### Step 6a — Plan file ⛔ gate

Generate a `TEST_PLAN.md` for the target package using `assets/TEST_PLAN-template.md`. The repo has no pre-existing plan-file convention, so this template *is* the convention — keep it. For every scenario include: name + description; the source feature/code path covered (real file paths); testing approach (all Playwright tests in this repo are E2E against a storybook iframe or a served app — say which, and whether the scenario needs a screenshot assertion); fixtures/utilities/configs used (only ones that exist or that you will create); expected assertions and acceptance criteria; prerequisite state or data setup.

Before showing the plan to the user, 🔧 verify it yourself:

```bash
node .claude/skills/playwright-test-engineer/scripts/verify-plan-paths.js <TEST_PLAN.md path> <package>
```

Every `**Covers**:` path is a hard failure if it doesn't resolve to real source — fix the plan (not the script) before showing it. `**File**:`/`**Fixtures/utilities used**:` entries that don't exist yet are reported as notes, not failures — that's expected for things Step 7a will create. Only present a plan to the user once this comes back clean (no `problems`).

Show the full plan content in the conversation and wait for explicit confirmation **before writing the file to disk or writing any test code**. `TEST_PLAN.md` is a working document — ask the user whether they want it committed or kept local (it is not a repo convention, so default to not committing it).

### Step 7a — Implementation

Only after plan confirmation:

- Implement every confirmed scenario. Follow `references/repo-conventions.md` exactly: correct license header for the package's workspace group (`assets/.apache-header` for `packages/`, `examples/`, `scripts/`; `assets/.ibm-header` for `packages-bamoe/`, `packages-bamoe-artifacts/`), `tests-e2e/<featureGroup>/<camelCaseName>.spec.ts` naming, `import { test, expect } from "../__fixtures__/base"`, page-object fixtures, `TestAnnotations` for regression/workaround links, `toHaveScreenshot("kebab-case-name.png")` for visual assertions.
- Reuse existing fixtures and the merged base config; never duplicate infrastructure. New page objects go in `__fixtures__/` and get wired into `base.ts` via `test.extend`.
- Locator priority follows Playwright's own v1.45.2 guidance (`references/playwright-version-notes.md`): `getByRole` → `getByText` → `getByLabel` → `getByPlaceholder` → `getByAltText` → `getByTitle` → `getByTestId`, in that order — avoid raw CSS/XPath. If a Playwright MCP server is connected, use its live accessibility snapshot to confirm a selector actually matches before writing it, rather than assuming from JSX.
- 🔧 Before presenting anything as done, run:
  ```bash
  node .claude/skills/playwright-test-engineer/scripts/run-all-checks.js <package>
  ```
  This is not optional and not a formality — it re-verifies imports, license headers, fixture wiring, and spec conventions against the actual files you just wrote, the same way it would for someone else's code. A non-zero exit means real problems were found (printed in the JSON); fix them and re-run before telling the user it's done. If `pnpm install` has been run in this environment, also pass `--with-playwright-list` for the strongest check (Playwright's own test loader). If any `packages-bamoe`/`packages-bamoe-artifacts` files came back "unconfigured" for license headers, say so explicitly — don't silently treat that as a pass.
- Every test must run via the package's existing `pnpm` scripts (full runs need the dev server; screenshot baselines are generated in the containerized run on CI, so a locally-failing screenshot diff is expected — tell the user).
- Finish with a summary table mapping every file created/modified to the scenario(s) it covers, and include the final `run-all-checks.js` verdict.

---

## Mode 2 — Evaluate

### Step 4b — Evaluation

🔧 Start by running the deterministic checks — they are the factual backbone of sections 2 and 3 below, not a replacement for reading the tests yourself:

```bash
node .claude/skills/playwright-test-engineer/scripts/check-spec-conventions.js <package>
node .claude/skills/playwright-test-engineer/scripts/check-fixture-wiring.js <package>
node .claude/skills/playwright-test-engineer/scripts/check-playwright-config.js <package>
```

Then work through `references/evaluation-checklist.md` against every spec and fixture in the package, and produce a report with exactly these sections:

1. **Coverage map** — source features/files vs. the specs that exercise them; explicitly list what is uncovered.
2. **Test quality** — start from `check-spec-conventions.js`'s findings (naming, `waitForTimeout`, raw selectors, screenshot naming, screenshot-only tests) and add your own read on assertion strength and missing error-state coverage. Don't re-derive by eye what the script already found mechanically — cite its findings, then add the judgment layer (why it matters, how bad it is here).
3. **Fixture & config hygiene** — start from `check-fixture-wiring.js`'s `undeclaredUsages` (a hard problem — a spec using a fixture that doesn't exist) and `orphanedFixtureFiles` (a lead to check, since legitimate cross-package/composed usage can look orphaned), plus `check-playwright-config.js`'s findings (missing base merge, redeclared base-owned keys). Add your own read on anything those don't cover, e.g. duplicated setup logic across spec files that should be a shared fixture.
4. **Flakiness risk** — tests likely to flake and *why* (position-based clicks, screenshot diffs across browsers, race-prone waits, order dependence). This section is judgment — the scripts don't run tests repeatedly to detect actual flakiness, they only flag static anti-patterns that correlate with it.
5. **Missing scenarios** — important untested scenarios derived from the source analysis.
6. **Recommendations** — prioritised (high/medium/low), each actionable and tied to a specific file.

Present the report, then ask ⛔ whether the user wants to switch to Mode 1 to act on any finding. If yes, re-enter Mode 1 at Step 5a with the chosen findings as the scenario seed list (the package analysis from Step 2 carries over). Take no further action without that confirmation.

---

## Bundled resources

- `references/repo-conventions.md` — the discovered, verified Playwright conventions of this monorepo (config inheritance, fixture pattern, naming, scripts, env vars, containerization). **Read before writing or judging any test.**
- `references/playwright-version-notes.md` — the exact pinned Playwright version (1.45.2), version-accurate locator/best-practice guidance fetched from that release's own docs (not today's playwright.dev), the Component Testing status (exists, experimental, unused here), and how to use a Playwright MCP server if one is connected.
- `references/evaluation-checklist.md` — the concrete checklist behind the Mode 2 report.
- `assets/.apache-header` / `assets/.ibm-header` — the exact license headers for the upstream (ASF) and downstream-only (`packages-bamoe`/`packages-bamoe-artifacts`) workspace groups respectively. `.ibm-header` is a placeholder until the real text is pasted in — `scripts/check-license-header.js` reports files needing it as "unconfigured", never as a false pass.
- `assets/spec-template.ts` — a skeleton spec file matching repo conventions.
- `assets/TEST_PLAN-template.md` — the plan-file structure for Step 6a.
- `scripts/*.js` — the deterministic guardrail checks listed above under "Guardrail scripts". Node.js only, zero npm dependencies, no shell scripts (Windows-safe). Run with plain `node <script>.js <args>`; see each file's header comment for exact usage.
