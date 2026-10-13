# Mini Apps Redesign Implementation Plan

> Execute inline with `superpowers:executing-plans`; delegation is unauthorized in this workspace.

**Goal:** Make Mini Apps easy to browse, with connection and maintenance workflows available when needed.

**Architecture:** Keep one Vue page and its first-party components, with app browsing always visible. Use native disclosures for connection, AI, directory management and card details; retain the existing route hashes as deep links. Preserve in-page drafts and the shared panels, controls and design tokens. Keep API schemas, permissions, registration, verification, transfers, reports, moderation and MCP behavior.

**Tech stack:** Vue 3, strict TypeScript, Vue Router, existing Lucide icons, Playwright and Vitest.

**Scope:** `MiniApps.vue`, `MiniAppListingForm.vue`, their browser tests and user guide. Review connection components and their callers; adjust only where required by this page. No backend, contract, dependency or deployment changes.

## Findings and decisions

- Confirmed: the page leads with developer instructions and puts all four sections in one long flow.
- Confirmed: listing maintenance, reporting and moderation controls show before a visitor chooses a task.
- Confirmed: the directory has no distinct loading/empty presentation or visible retry on failure.
- Confirmed: selecting another reported listing retains the previous listing's loaded reports.
- Decision: default to Browse apps; retain `#discover`, `#connect`, `#ai-connections` and `#learn` links.
- Decision: preserve component state when opening or closing setup. Show the editor and report form only after explicit selection; use native disclosures for optional fields and transfers.
- Decision: keep publication/origin verification limits visible, and preserve exact callback and connection binding validation.
- Authorization: the user's supplied workflow and repository instructions request continuous inline implementation and review afterward. The user subsequently explicitly requested committing, merging into `dev`, pushing and applying this change to the live dev version. Follow that authorization through frontend testnet publication; no sub-agent delegation is authorized.

## Implementation and verification

- [x] Add failing browser regressions for browse-first navigation/deep links, contextual maintenance, loading/retry, report selection and mobile accessibility.
- [x] Redesign the single page using existing panels and native disclosures and concise guidance; preserve legacy hash links and drafts.
- [x] Redesign listing cards and contextual forms, add accurate loading/empty/retry states, reset reports on listing change, and prevent obsolete responses appearing in another context.
- [x] Update existing Mini Apps browser journeys for the disclosures and contextual editor.
- [x] Run targeted browser regressions on desktop/mobile, template/type checks, lint, all unit tests and a production build. Review screenshots and complete diff.
- [x] Update the user guide and record actual results here.

## Review focus

Network/account changes must clear private context. Stale directory/report responses must not replace newer selections. Busy actions must not duplicate. Native proof/transfer and permission rules remain intact. Long untrusted descriptions/URLs must render as text and fit a narrow viewport. Existing connection, consent, receipt and revocation tests keep their meaningful assertions.

## Execution ledger

- User clarification: “loads of screens and options”. Supersedes the initial three-view design: keep one page with browsing always visible and hide setup/publishing/reporting/moderation controls until requested. Use native disclosures instead of adding navigation screens.

- Baseline: clean `dev` at `7071460`; Node 24.21.0/npm 11.19.0 match the pinned toolchain. Existing unit suite started before edits.

- Implemented: browse-first navigation and app cards; contextual editor/report forms; short disclosures; legacy hash links and in-page draft retention; correct loading/empty/error states. Reports and origin proofs clear when their listing changes. Obsolete action completions cannot restore context after an account/deployment change.
- Review: performed inline under the workspace’s no-delegation instruction. Checked all affected callers, permission/binding checks, API schemas, native journey selectors and the final diff. A report focus regression failed before the focus fix and passed afterward. No unresolved material issue was found in this scoped review.
- Initial checks: Chromium first failed on missing `libatk-1.0.so.0`; reused the existing bundled browser libraries. Vite reached the host watcher limit; a temporary dev server ignored `.artifacts` and used polling. An initial new fixture used the obsolete `/v1/me` read instead of `/v1/sign-in/session`; corrected it against the actual API client. The initial unit run caught a non-null assertion in the new test; removed it and the final lint/suite passed.
- Browser regressions: new navigation/contextual maintenance checks failed against the original page. The proof regression reproduced a visible proof after changing the listing ID; the fix now clears it. Report focus reproduced an inactive heading; the fix moves focus to the form.
- `npm run verify`: PASS, lint 5/5, template/type checks, unit suite 348/348 across 61 files (exit 0). The environment emitted watcher-limit warnings; the run completed successfully.
- Final `DACLIFY_TEST_UI_PORT=5376 LD_LIBRARY_PATH=/data/daclify-runtime/browser-libs/usr/lib/x86_64-linux-gnu npx playwright test --config playwright.config.ts mini-apps-design.spec.ts`: PASS, 16/16 desktop/mobile cases (exit 0). Includes keyboard/history/deep links, draft retention, retry/empty/loading, escaped text, report selection/focus, stale proof clearing, narrow screen layout and Axe checks. These are presentation fixtures, not chain/provider verification.
- Final `npm run build`: PASS (exit 0), including fresh Vue template/type checks after the focus fix. Existing large-chunk advisory remains outside this page’s scope.
- Changed-file Prettier check and `git diff --check`: PASS (exit 0).
- Native Mini Apps/directory/MCP journey attempt: BLOCKED before execution by `ENOENT` for `../daclify-backend-core/.artifacts/native/network.json`. No live chain behavior is claimed. Existing journey tests were updated for the new navigation/editor while preserving their contract, consent, receipt, revocation and moderation assertions.
- Screenshots inspected: `.artifacts/browser/mini-apps-design/browse-chromium.png`, `browse-mobile-chromium.png` and editor snapshots. No new dependencies, backend/contract changes, commit, push or deployment.

- Clarification follow-up completed: removed the three-view navigation; app browsing remains visible while Connect an app and AI connections expand in place. Manage listings, per-app reporting/links/expiry and moderation are collapsed until requested. Preserved existing handlers, permissions, deep links and drafts; updated the guide and native journey entry selectors.
- Follow-up regression: the default-hidden publishing assertion failed against the initial three-view design, then passed after the simplification. The updated browser suite passed 16/16 desktop/mobile cases, including collapsed controls, an always-visible app list, keyboard disclosures, deep links and retained drafts.
- Follow-up verification: `npm run verify` passed lint, template/type checks and 348/348 unit tests across 61 files; `npm run build`, changed-file Prettier and `git diff --check` passed. Inspected the updated desktop/mobile screenshots and reviewed the change inline. Native journey qualification remains blocked by the previously recorded missing fixture. No commit, push or deployment.

- Live dev delivery authorized: user explicitly requested commit, merge into `dev`, push and application to the live dev version. Release frontend `0.15.0-alpha.28`; exact core20/modules28 dependencies stay pinned. A separate preview was superseded before publication.
- Pre-integration checks for alpha28: `npm run verify` passed lint, template/type checks and 348/348 tests; desktop/mobile fixture regressions passed 16/16; the testnet-mode production build passed. The exact candidate passed read-only qualification with the actual testnet API at 1440, 390 and 320 pixels, including layout, keyboard disclosures, deep links/reload, no page exceptions, correct API origin and Axe checks. Packet: `/data/daclify-runtime/mini-apps-dev-20261013`.
