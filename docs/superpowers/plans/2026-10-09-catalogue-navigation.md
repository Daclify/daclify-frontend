# Modules and Names navigation implementation plan

Execute inline on `dev` under the repository's continuous-review workflow.

**Goal:** Replace Marketplace in the sidebar with Modules and give Names its own
sidebar entry and page.

**Architecture:** Split the existing Vue view into `Modules.vue` and `Names.vue`,
preserving their content, validation, and API types. Each page loads its own
service. Redirect `/marketplace` to `/modules`, or `/names` for name-payment
returns, retaining the query and hash. Keep the existing styles and Lucide icons.

**Scope:** `src/App.vue`, `src/main.ts`, the two catalogue views,
`src/views/PlatformDao.vue`, `README.md`, browser regressions and the requirement
register. No backend, dependencies, provider calls, or deployment changes.

## Execution ledger

- [x] Inspect repository, callers, API schemas, checkout return URLs and policies.
- [x] Add and observe failing navigation regression before implementation.
- [x] Split the views, update navigation/routes and platform links; clear pending
      quote work when leaving Names.
- [x] Update route documentation and the requirement register.
- [x] Run static/build/unit and focused desktop/mobile browser checks.
- [x] Review the diff and record actual outcomes and limitations.

## Verification

The new `tests/e2e/catalogue-navigation.spec.ts` uses schema-validated synthetic
HTTP fixtures to check sidebar navigation, isolated reads, name input/quotes,
legacy redirects, error isolation and desktop/mobile layout. The existing
`tests/e2e/marketplace.spec.ts` retains native-fixture coverage of catalogue
filters/details and name pricing, with its navigation updated to the new pages.

Run `DACLIFY_TEST_UI_PORT=5398 npx playwright test --config playwright.config.ts
tests/e2e/catalogue-navigation.spec.ts`, `npm run verify`, `npm run build`, and
Prettier on the changed files. HTTP fixtures establish frontend behavior only;
they do not establish live checkout, settlement or native-chain qualification.

## Results — 2026-10-09

- Initial regression: one expected failure because `/modules` did not exist;
  stopped after that failure. The first complete browser run passed 10 cases and
  failed two because its synthetic name had 13 characters. Corrected the fixture
  to a valid 12-character name; the product validation was working correctly.
- Final checks use the pinned Node 24.21.0/npm 11.19.0 toolchain. The earlier
  build/unit checks also passed under the shell's Node 24.14.1/npm 11.11.0, which
  are below the package's required versions and are not the qualification result.
- `npm run verify`: lint policy passed, Vue/TypeScript passed, all 151 unit tests
  passed across 31 files.
- `npm run build`: passed, including Vue template type checking.
- `DACLIFY_TEST_UI_PORT=5398 npx playwright test --config playwright.config.ts
  tests/e2e/catalogue-navigation.spec.ts`: all 14 desktop/mobile Chromium cases
  passed. Includes both new pages, isolated service reads, price validation/quote
  presentation, queued-quote cancellation and legacy bookmarks/checkout returns.
- Axe scans found no accessibility violations on either page in both projects.
  Overflow checks passed. Reviewed desktop Modules and mobile Modules/Names
  screenshots under ignored `.artifacts/browser/`.
- Prettier checks on changed Vue/TypeScript/JSON files and `git diff --check`
  passed. Reviewed the final diff; an AST comparison confirmed preservation of
  all 44 original top-level declarations other than the removed tab state.

The native-fixture `marketplace.spec.ts` journey was updated but not run: the
local API on port 3008 was unavailable. Live Stripe checkout/settlement, native
chain execution, Safari/Firefox and actual Telegram clients were not tested.
No backend, schema, environment file, or provider configuration was changed.
