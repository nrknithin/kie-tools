# Playwright Test Engineer

> **Repo-only doc.** Not installed — only [`payload/`](payload/) reaches your Bob.

A skill asset. A Bob skill for writing and evaluating Playwright E2E tests in the BAMOE/KIE Tools monorepo, following the repo's own conventions instead of inventing new ones.

## What it does

Turns "add E2E tests for X" or "are the tests in Y any good?" into a gated, repeatable workflow scoped to this monorepo. It reads the conventions the repo already uses — the shared `@kie-tools/playwright-base` config, the `tests-e2e/__fixtures__/base.ts` page-object composition, the `test-e2e*` script family, the per-group license headers — and works inside them rather than introducing a second way of doing things.

It runs in one of two modes, chosen after it has analysed the target package:

- **Create / Update** — collects scenarios (yours or generated from the source), validates each one maps to a real code path, writes a `TEST_PLAN.md` for review, and only implements after you confirm the plan.
- **Evaluate** — produces a six-section report on existing tests: coverage map, test quality, fixture/config hygiene, flakiness risk, missing scenarios, and prioritised recommendations.

### Scripts do the mechanical work

The skill ships 18 zero-dependency Node scripts so the repeatable parts aren't re-derived by hand (or guessed) on every run. Plain `node`, no shell scripts, no `npm install` — they work on Windows, macOS and Linux, and in a fresh checkout before dependencies exist.

**Analysis / generation**

| Script | Does |
| --- | --- |
| `list-target-packages.js` | Real package list + existence check for a name you were given |
| `inspect-package.js` | `package.json` scripts/deps, config shape, `tests-e2e/` inventory, cross-package fixture imports |
| `build-coverage-map.js` | Cross-references `src/` and `stories/` against `tests-e2e/` (computes real Storybook story ids) |
| `audit-screenshots.js` | Orphaned `__screenshots__` baselines, and referenced names with no baseline |
| `check-env-usage.js` | Custom `env/index.js` keys that nothing in the package actually consumes |
| `scaffold-spec.js` | New spec file with the right license header and correct `../__fixtures__/base` import depth |
| `scaffold-package-e2e.js` | Bootstraps config + env + fixtures + `package.json` entries for a package with no Playwright yet |

**Verification**

| Script | Does |
| --- | --- |
| `check-imports.js` | Every import resolves to a real file or declared dep (understands `dist/` output and Node builtins) |
| `check-fixture-wiring.js` | Fixtures a spec destructures are actually declared, or are Playwright built-ins |
| `check-playwright-config.js` | Config really merges the shared base; flags redeclared base-owned keys |
| `check-spec-conventions.js` | Naming, hardcoded waits, raw selectors, screenshot naming — in specs *and* fixtures |
| `check-license-header.js` | Exact header for the file's workspace group |
| `verify-plan-paths.js` | Every path a `TEST_PLAN.md` cites is real |
| `verify-e2e-discovery.js` | Hands specs to Playwright's own loader — the strongest available check |
| `run-e2e-and-summarize.js` | Runs the suite and returns structured pass/fail/flaky instead of raw output |
| `run-all-checks.js` | One pass/fail verdict over the verification set |
| `selftest.js` | Regression test for the shared `lib/workspace.js` resolver logic |

Verification is separated from judgment on purpose. The scripts settle mechanical facts — does this file exist, does this import resolve, is this fixture declared — because those are the claims most easily asserted with unearned confidence. What to test, whether coverage is adequate, and why a test is likely to flake stay judgment calls, and the reports say which is which. Heuristic output is labelled as such: `build-coverage-map.js` ships a `disclaimer` field explaining which of its two signals is trustworthy and which is a rough lead only.

### Gates

Nothing is written before you say so. The skill stops for explicit confirmation after the scenario list, after the generated `TEST_PLAN.md`, and after an evaluation report — and silence is never treated as approval.

## Scope

`packages/` only, plus `packages-bamoe/` and `packages-bamoe-artifacts/` on downstream forks. `examples/` and the top-level `scripts/` workspace group have no Playwright usage and aren't valid targets. Anything outside the monorepo is refused and redirected. All package-manager commands are `pnpm`.

## Notes

- **`assets/.ibm-header` is a placeholder.** Until the real downstream header text is pasted in, files under `packages-bamoe*` are reported as *unconfigured* (exit 3, non-blocking) rather than checked against the wrong text, and the scaffolders refuse to generate into those groups. Filling the file in is the only step needed — no code changes.
- **Playwright is pinned at `1.45.2`** across every package here, which is well behind what playwright.dev documents. `references/playwright-version-notes.md` explains how to get version-accurate API docs instead of assuming the latest.
- **`verify-e2e-discovery.js` and `run-e2e-and-summarize.js` need `pnpm install` first.** Without it they exit 4 and name the static checks that substitute, rather than failing silently.
- **Editing `scripts/lib/` means running `selftest.js`.** It's the only thing that catches a regression in the shared resolver; nothing else will.
