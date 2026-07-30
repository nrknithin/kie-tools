# Pinned Playwright version — what actually applies here

Every Playwright-enabled package in this repo pins the exact same version: `@playwright/test@1.45.2` (confirmed in `packages/*/package.json` and locked in `pnpm-lock.yaml`'s `@playwright/test@1.45.2` / `playwright@1.45.2` entries — pull, don't assume). This matters because **playwright.dev's live docs always show the current release**, not a per-version archive — as of this writing the current stable is around 1.61 (mid-2026), roughly two years and dozens of releases ahead of what this repo actually runs. Advice or API names pulled from today's playwright.dev may not exist, or may behave differently, in 1.45.2.

**When you need to verify something about the Playwright API and it matters whether it's actually available here, read the docs off the pinned tag, not the live site**: `https://raw.githubusercontent.com/microsoft/playwright/v1.45.2/docs/src/<page>.md` (e.g. `best-practices-js.md`, `locators.md`, `test-api/class-test.md`). This guarantees version-accurate advice instead of describing a feature this repo can't use.

## What the v1.45.2 docs actually say (fetched from the pinned tag, not memory)

**Locator priority** (`locators.md`, recommended order): `getByRole` → `getByText` → `getByLabel` → `getByPlaceholder` → `getByAltText` → `getByTitle` → `getByTestId`. Role locators are preferred because they "reflect how users and assistive technology perceive the page." Long CSS/XPath chains coupling to DOM structure are explicitly called out as brittle. This is why `references/evaluation-checklist.md`'s "selector stability" check and `scripts/check-spec-conventions.js`'s raw-`page.locator(...)` flag exist — they're enforcing this, not an invented house rule.

**Web-first assertions, not manual polling** (`best-practices-js.md`): use `await expect(locator).toBeVisible()`, never `expect(await locator.isVisible()).toBe(true)` — the latter checks once and returns immediately with no retry/wait, which is a real source of the flakiness `scripts/check-spec-conventions.js`'s `waitForTimeout` check targets (same root cause: bypassing Playwright's built-in auto-waiting).

**Test isolation** (`best-practices-js.md`): each test should run independently with its own storage/session/cookies; use `beforeEach` for shared setup rather than relying on execution order. This is exactly what `test.beforeEach(async ({ editor }) => { await editor.open(); })` in this repo's specs already does — don't remove it when refactoring.

## Component Testing for React exists, but isn't used here — don't introduce it unprompted

`docs/src/test-components-js.md` at v1.45.2 confirms `@playwright/experimental-ct-react` is real and **explicitly marked experimental** at this version — it mounts real React components in a browser while the test runs in Node, as an alternative to full E2E. Verified separately (see `references/repo-conventions.md`): **no package in this repo uses it** — all seven Playwright-enabled packages do full E2E against a storybook iframe or a served app, never isolated component mounting. If a scenario would be easier to express as component-level testing, say so as an observation, but don't start using `@playwright/experimental-ct-react` without the user explicitly asking to adopt it — that would be introducing a new pattern the repo doesn't have, which constraint #4 (`SKILL.md`) exists to prevent.

## Optional: the Playwright MCP server, if connected

If this session has an MCP server exposing tools like `browser_navigate`, `browser_snapshot`, `browser_click`, or similar (check the available tools list / `ToolSearch` for names — don't assume a specific tool name without confirming it's actually present), it's the official `microsoft/playwright-mcp` server or a compatible one. It drives a real browser via Playwright and can return an accessibility-tree snapshot of the live page instead of you inferring one from JSX.

Where this genuinely helps, if available:

- **Step 2 / Step 7a selector accuracy**: instead of guessing a component's accessible role/name from reading `src/`, start the package's dev server (`pnpm start`, same command `playwright.config.ts`'s `webServer` already uses) and navigate the MCP browser to the actual storybook story or app route, then read the real accessibility snapshot before writing a `getByRole(...)`/`getByTestId(...)` locator into a fixture. This directly reduces the risk of a selector that compiles but doesn't match anything at runtime.
- **Mode 2 evaluation**: cross-checking whether a spec's assumed selector still matches the live app is a good sanity check for "selector stability" findings you're not fully sure about.

This is a genuine enhancement, not a requirement — the skill's guardrail scripts (`scripts/*.js`) work identically with or without it, since they check static facts (files, imports, naming), not live rendering. Never assume the Playwright MCP is connected; check first, and fall back to static analysis if it isn't.

## Sources (fetched directly, not recalled)

- https://github.com/microsoft/playwright/blob/v1.45.2/docs/src/locators.md
- https://github.com/microsoft/playwright/blob/v1.45.2/docs/src/best-practices-js.md
- https://github.com/microsoft/playwright/blob/v1.45.2/docs/src/test-components-js.md
- https://github.com/microsoft/playwright-mcp (README, main branch — the MCP server itself is version-independent of the pinned `@playwright/test` version, since it drives browsers directly rather than depending on the test runner)
