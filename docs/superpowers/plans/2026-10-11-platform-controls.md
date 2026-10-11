# Compact platform controls implementation plan

> Execute inline using `superpowers:executing-plans`; workspace instructions prohibit delegation and authorize continuous implementation with review afterward.

**Goal:** Make Create → Pricing navigate in the current tab, and make platform administration compact and easier to manage.

**Architecture:** Retain the existing Vue page, pinned producer SDKs and every existing signing/validation callback. Use the application's accessible tab pattern and scoped layout styles; no backend or native policy change is required.

**Tech stack:** Vue 3, TypeScript, existing Lucide icons, Playwright and Axe.

**Design:** Three sections: Pricing (monthly module rows, graduated membership pricing, RAM/storage), Catalogue (searchable compact entries and registration/description editing), Policies (shared hosting, Connect, commissions/names and authority explanation). Show actual configured totals and administrator/signer state above the sections. Desktop uses two columns for related settings; mobile stacks fields. Preserve drafts between tabs and preserve current units and action labels.

## Constraints and review focus

- Same-tab navigation must not create a popup; browser Back must return to Create.
- A visitor or locked administrator must not gain signing authority.
- Keyboard tabs support arrows, Home and End with correct selection/focus.
- Hidden sections retain typed values. Editing a catalogue entry must target that account and use its producer-owned fields.
- Failure or mismatched runtime pricing must never appear as a zero-priced plan.
- The running backend is core alpha.7. Keep its qualified SDKs and the separately committed Telos-governance work intact; do not deploy unrelated code.

## Task 1 — navigation and compact management

Files: `src/views/CreateDao.vue`, `src/views/PlatformDao.vue`, `tests/e2e/dao-pricing.spec.ts`, `tests/e2e/platform-controls.spec.ts`, existing `tests/e2e/platform.spec.ts`.

- [x] Change the Pricing browser assertion to click and remain on the same page; run and observe its existing `_blank` behavior fail.
- [x] Add browser checks for tab visibility/keyboard, draft preservation, catalogue filtering/editing, read-only controls and desktop/mobile accessibility/width; observe the absent sections fail.
- [x] Remove new-tab attributes/announcement and use the current-tab arrow.
- [x] Reorganize the existing forms, preserve callbacks/field guards, add tab/search/edit state and responsive scoped styles.
- [x] Update native browser journey navigation for the new sections; run focused browser checks, full unit/type/template/lint/build checks and review the diff.

## Task 2 — documented testnet delivery

Files: `docs/evidence/2026-10-11-platform-controls.md`, frontend version/lock, core `docs/operations/dao-pricing.md`.

- [x] Record actual results and update the pricing navigation guide.
- [x] Publish a fresh frontend version from committed source with unchanged SDK archives, API and native contracts.
- [x] Verify the deployed Create link and all Platform sections on desktop/mobile, without submitting live governance changes; record screenshots and measured page height.
- [x] Integrate and push remote dev, preserving original checkout changes and unrelated commits.

## Execution ledger

Baseline: running Platform page measured 7,222 px at 1440×1000 and showed 13 forms. Existing fee-release verification passed frontend 43 files / 276 tests and 20 pricing/module-access/apps browser tests. This work uses the already isolated fee worktree on `feat/platform-controls-ui`, based on remote dev; original checkouts retain separate Telos-governance commits.

Verification checkpoint: observed the current-tab and missing-section regressions fail (five failures, three existing pricing checks passed). Initial redesign checks exposed a combined input label and invalid definition-list structure; both were corrected from browser evidence. Final focused browser suite passed all 16 desktop/mobile cases. Full frontend verification passed 43 files / 276 tests, lint and Vue/TypeScript checks; the final testnet-mode build passed with its existing bundle-size warning. A source comparison confirmed all existing load, validation and signed-action callbacks are byte-for-byte unchanged. Native browser journey tab navigation was updated, but its Docker-dependent fixture was not run for this UI change.

Delivery: committed source cddac91, frontend 0.13.0-alpha.10, archived npm-ci/testnet build and atomic static publication passed. Original assets and a private index backup were retained; the API/native contracts and pinned SDKs were unchanged. Actual live Create/Pricing and all three Platform sections passed desktop/mobile, read-only enforcement, main-region Axe, catalogue search/edit and no page errors/overflow. Desktop default height fell from 7,222 to 2,246 px (approximately 69%). Frontend and core guide changes were fast-forwarded into remote dev; original Telos-governance commits/checkouts remained intact. [Live evidence](../../evidence/2026-10-11-platform-controls.md).
