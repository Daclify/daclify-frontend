# Workspace tools implementation plan

> Implement inline with superpowers:executing-plans. No delegation is authorized.

**Goal:** Make Treasury, Documents and Members follow the existing readable toolbar/list/popup design.

**Architecture:** Preserve the current components' authoritative execution, encryption and producer schemas. Reuse one small native dialog for these screens and extend the existing people toolbar through slots.

**Tech stack:** Vue 3, TypeScript, native dialog, pinned Daclify SDKs, Playwright/Vitest.

**Spec:** ../specs/2026-10-12-workspace-tools-design.md

## Constraints and review focus

- Exact fractional exit rights and approved payment recipients/amounts remain intact.
- IDs are stable through failed/cancelled drafts; private metadata never becomes a public title.
- Role forms initialize from the selected member; administrator handover and encryption grants remain required.
- Profile/metadata failures cannot hide records; foreign DAO records are rejected.
- Native popup focus, busy edits/escape/close, keyboard tabs and mobile overflow are checked.

## Tasks

- [x] Write browser checks for the three layouts, named documents/members, contextual popup drafts, read-only boundaries and mobile accessibility; observe the missing UI failures.
- [x] Add WorkspaceDialog.vue and checked document identity generation; test collisions and bounds. Reorganize TreasuryPanel.vue without changing financial actions.
- [x] Reorganize ContentPanel.vue, FilePanel.vue and GoverningDocumentsPanel.vue into document sections and contextual popups; retain immutable publication and adoption paths.
- [x] Extend PeopleGrid.vue/PersonCard.vue/MemberDirectory.vue slots for inline tools and named management. Separate AdmissionPanel.vue creation/policy forms from application rows and replace document/version IDs with choices.
- [x] Run full lint/type/unit verification and focused plus affected browser suites, review diff inline, update user guide/requirements/evidence.
- [ ] Commit/push dev; build and publish immutable verified frontend to testnet; check public artifacts and compiled UI.

## Execution record

- Base: d4bc0ad, clean dev, origin fetched.
- Standing user preferences and repository instructions authorize continuous inline implementation; approval policies and asset movements are not changed by presentation work.

- Final source review: inline. Corrected shared-component navigation and adopted-version naming with RED→GREEN browser checks; retained original financial, membership and encryption authority.
- Final source qualification: lint/type/335 unit tests PASS; 48 desktop/mobile browser cases PASS; testnet build PASS; formatting and diff checks PASS. Provider/native payment suites remain unrun.
