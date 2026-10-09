# Module cards and DAO activation

Execute inline on `dev`, retaining the existing design system and signing flow.

**Goal:** A responsive grid of square module cards with distinctive vector
artwork, clear pricing/details, and a DAO selector for activation.

**Architecture:** `Modules.vue` owns presentation, search and the native activation
dialog. Select artwork by producer-owned published code hashes, with known
first-party titles for older builds whose pins differ. This is presentation only;
it does not establish deployment identity or compatibility. Reuse `ActionSigner`
and `ModulesPanel` inside the dialog, with an optional account filter so only the
chosen module is shown. Existing version, code, membership and signing checks
remain authoritative. Only active administrators in the current deployment are
offered DAO choices. No automatic activation or bulk writes.

**Scope:** Modules view/scoped styles, the focused ModulesPanel option, affected
catalogue tests, browser activation regressions, route/user documentation and the
requirement register. No backend/schema/dependency changes.

## Ledger

- [x] Inspect catalogue, actual testnet accounts, public schemas, signing and UI.
- [x] Add failing browser checks for cards, DAO selection and blocked activation.
- [x] Implement square cards, artwork, detail view and focused activation dialog.
- [x] Verify signing/permissions, state isolation, accessibility and responsive UI.
- [x] Run lint, typecheck, unit/build/format checks and review screenshots/diff.
- [x] Update the live local preview and record evidence.
- [x] Commit and push `dev`.

Read-only HTTP fixtures establish UI behavior only. The current public-data
preview cannot sign in or activate modules; signed activation requires a real
authenticated backend and a matching authorized key/wallet.

## Verification — 2026-10-09

Initially verified against the 0.8 packages: 151 unit tests and 26 focused browser
cases passed. The first test failed as expected before the square cards existed.
Development checks exposed ambiguous implicit select labels and initial-load
dialog state changes; explicit labels and stable identity watchers fixed them.
The requirement register's comment scanner also misread a wildcard URL string;
equivalent regular-expression fixture routing avoids that false empty-suite result.

Integrated upstream `57ae41d` and `7d3f109` without dropping either change, then
installed the locked 0.9 protocol/module packages. Final verification uses Node
24.21.0/npm 11.19.0 on that updated source:

- `npm run verify`: passed lint policy, strict Vue/TypeScript and all 155 unit tests
  across 32 files.
- `npm run build`: passed, including Vue template checks.
- `DACLIFY_TEST_UI_PORT=5398 npx playwright test --config playwright.config.ts
  tests/e2e/module-cards.spec.ts tests/e2e/catalogue-navigation.spec.ts
  tests/e2e/executives.spec.ts`: all 34 desktop/mobile Chromium cases passed.
- Activation checks include active administrator/deployment filtering, locked
  signers, deployed account aliases, code-pin and version verification even when
  an API claims compatibility, already-enabled modules, unavailable third-party
  deployments, and blocked picker/close controls while a request is pending.
- The signing fixture uses the real encrypted vault and verifies the K1 signature,
  exact DAO/target/module/permissions/code-pin request, a single submission, and
  the refreshed Enabled state. API fulfillment is mocked; no chain transaction
  was sent.
- Axe scans found no violations on the grid and activation dialog in both projects;
  overflow and square-card checks passed. Reviewed desktop/mobile grid and mobile
  dialog screenshots, then shortened the focused dialog review to fit the enable
  button on mobile without removing permission information. Rechecked afterward.
- Prettier on changed Vue/TypeScript/JSON files and `git diff --check` passed.

The local preview on `127.0.0.1:5198` was restarted after the package upgrade and
reads public testnet data only. Testnet's currently listed Decide hash differs
from the 0.9 SDK pin; its older first-party artwork remains identifiable, while
activation still requires the authoritative DAO deployment to match. The native
fixture marketplace journey was updated but not run. Live signing/chain execution,
Safari/Firefox and actual Telegram clients remain unverified. No production
deployment, backend changes, credentials or authority changes were performed.
