# Grants experience implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. Sub-agent delegation is unauthorized in this workspace. Steps use checkbox syntax for tracking.

**Goal:** Replace mixed Grants forms and raw identifiers with two readable lists and contextual, validated popups.

**Architecture:** Keep GrantsPanel responsible for the Grants interface and canonical action payloads. ModulesPanel supplies independent, DAO-checked document/member metadata and the existing execution/busy/error/success state. Reuse existing integer amount and document-label helpers; add focused local timing validation.

**Tech Stack:** Vue 3, native dialog, TypeScript, pinned Daclify SDKs, Vitest and Playwright.

**Spec:** ../specs/2026-10-12-grants-experience-design.md

## Global constraints

- Frontend-only, strict canonical types, no dependencies or backend/schema/contract changes.
- Positive whole native-token inputs; exact BigInt totals and native asset bounds; never round existing fractional amounts.
- 1–16 separately dated milestones, term at most 365 days, strictly ordered round deadlines ending within 365 days; uint32 date bounds.
- Keep permission, code-pin, applicant consent, funding vote and independent review rules.
- Pending requests block edits/closing; failed or cancelled drafts survive; clear only after confirmed success.
- Inline on dev; prior testnet publication authorization applies; excluded account-deletion worktrees remain untouched.

## Review focus

- Foreign/unavailable documents block submission without hiding rounds/applications; retry restores only DAO-matching choices.
- Distinct round/application/review drafts never overwrite one another; application amendment preserves every due date.
- Deadline expiry, closed rounds and inactive agent applicants disable actions even if forms are submitted programmatically.
- Legacy fractional amounts and asset-overflow totals are never silently rounded or encoded.
- Relay failure/pending response, context/role changes and refresh cannot close or clear a failed draft or sign a different record.

### Task 1: Inputs and list/dialog interface

**Files:** src/content/grants-inputs.ts, tests/unit/grants-inputs.test.ts, src/components/GrantsPanel.vue, src/components/ModulesPanel.vue, tests/e2e/grants-design.spec.ts.

**Interfaces:** parseRoundInputs(maximum, applicationsClose, reviewClose, awardsClose, precision, now) returns cap base units and checked native deadlines; parseGrantTerms(milestones, start, end, precision, cap, now) returns units, total, dues and term epochs. GrantsPanel consumes DaoContent, readable member labels, metadata status/retry, busy/action results and now from ModulesPanel.

- [x] Write tests for exact totals/different dates, deadline/term bounds, malformed/overflow amounts and legacy fractions; observe red before implementing helpers.
- [x] Add desktop/mobile tests for tab toolbar, readable names/documents, three creation steps, milestone rows, filters, keyboard/focus, draft isolation and accessibility; observe red before changing UI.
- [x] Implement the helpers, independent parent metadata load and Grants list/popups using existing patterns; run unit and browser checks.

### Task 2: Signed actions and failure recovery

**Files:** tests/e2e/grants-design.spec.ts, tests/e2e/module-authoring.spec.ts, tests/e2e/research-modules.spec.ts, src/components/GrantsPanel.vue.

**Interfaces:** Existing GrantsActions and Decide openaward codecs; parent run returns Promise<void>, actionSuccess/actionError identify confirmed completion.

- [x] Add disposable-vault signed tests decoding the actual canonical payload for round, application, amendment, consent, review and award. Assert exact selected document versions, due dates, policy and real signature verification.
- [x] Cover code/permission/deadline gates, forced form submission, failed first relay and a held retry; verify pending controls and success-only clearing.
- [x] Update existing native authoring/read callers to the new interface; record any native suites not run.

### Task 3: Verification, documentation and authorized publication

**Files:** docs/users/grants-rounds.md, docs/evidence/2026-10-12-grants-experience.md, docs/evidence/2026-10-12-grants-experience-testnet.json, package.json, package-lock.json, requirement register.

- [x] Review the whole diff and run formatting, lint, Vue/TS, full unit suite, Grants desktop/mobile and adjacent module regressions, then the testnet build.
- [ ] Update the user guide and evidence with passed/failed/unrun distinctions; bump a fresh frontend prerelease; commit and push dev.
- [ ] Archive exact source into an immutable runtime release packet, compare tracked bytes, install locked dependencies and publish only the frontend to testnet.
- [ ] Verify HTTPS index/assets, actual public desktop/mobile and compiled-assets popup flows; save hashes/evidence, push documentation follow-up and verify clean dev.
