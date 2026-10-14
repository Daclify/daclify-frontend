# Ballot content and module capability review

> Execute inline with `superpowers:executing-plans`; delegation is unauthorized. The user approved fixing the previously described ballot UI gaps and auditing the other modules. Continue through verification and delivery without another approval checkpoint.

**Goal:** Let DAO members publish and understand ballot content, exact choices and an optional existing document, and produce an evidence-based module gap report.

**Architecture:** Modules owns a versioned, bounded metadata schema and public reader/encoder. Frontend consumes its pinned package and renders the existing Decide actions. Existing binary proposal semantics, policy, signatures, monetary execution and stored records stay compatible.

**Tech stack:** Existing Vue/TypeScript, Zod, WharfKit, Vitest and Playwright; no new dependency or contract binary.

**Spec:** The approved chat description and existing programme architecture, work packages and ballot-integrity plan in core. This package supplies presentation/creation improvements; it does not claim completion of the separate on-chain definition-commitment upgrade.

## Constraints and decisions

- New metadata uses schema version 2; title ≤160 characters, explanation ≤2,000 characters, choice labels ≤80 characters, serialized UTF-8 ≤4,096 bytes.
- Require a nonblank title and explanation for new ballots. Legacy ballots stay readable and votable with their original meaning.
- Binary proposals remain exactly Reject/Approve. Custom single-choice polls require 3–16 distinct nonblank options because current finalization reserves binary index zero for rejection.
- Optional supporting document pins this DAO's existing document ID, exact version and commitment. Metadata references alone add no archival-retention guarantee.
- All inline ballot content is public. Private document labels never expose decrypted content. No arbitrary external URL or executable markup.
- Invalid, unsupported, mismatched or unlabeled multi-choice metadata never falls back to a misleading Approve/Reject vote.
- Preserve authoritative policy, signer/session guards, existing Works/Grants execution targets and permissionless finalization.
- Review other first-party modules and exposed adapters for contract/API/UI/help gaps; report gaps rather than inventing new treasury or admission policy.

## Review focus

1. UTF-8 and JSON escaping can exceed the contract byte bound before character limits.
2. Missing/reordered/duplicate choice labels or unsupported metadata must prevent misleading votes.
3. Old binary metadata, old custom ballots and funding ballots retain meanings and rights.
4. DAO switching must clear drafts; document references must match DAO/version/commitment and private labels remain private.
5. Multi-choice outcome/tallies and the user's actual choice must not be displayed as Approve/Reject.

## Task 1 — Producer metadata and compatibility

Files: modules `protocol/ballots.ts`, `sdk/ballots.ts`, public exports, `tests/ballot-metadata.test.ts`, guides/version/package artifacts.
- [x] Write and run failing tests for bounded new metadata, exact option counts, legacy binary reading, malformed/unknown definitions and UTF-8 overflow.
- [x] Implement producer schema/reader/encoder without changing contracts.
- [x] Run producer checks and build the pinned SDK/help artifact.

## Task 2 — Complete ballot creation and reading

Files: frontend `src/components/ModulesPanel.vue`, a focused `BallotPanel.vue` if it avoids growing the existing 2,000-line panel, `src/help/tools.ts`, consumer package pins, unit/browser fixtures.
- [x] Add failing UI tests for description, supporting reference, three choices, exact own vote/tallies/result and invalid metadata blocking.
- [x] Add accessible compact creation/review fields and render actual content/choices with existing signer flow.
- [x] Verify legacy binary voting, policy locking, context reset, permissions and mobile layout.

## Task 3 — Module audit and explanatory documentation

Files: frontend `docs/module-capability-gaps.md`, ballot guide/help, evidence ledger.
- [x] Compare Decide/elections, Works/agreements, Payroll, Grants, Endorsement, Activity/mini apps, connected payments/archive and external Telos governance with producer contracts, schemas, APIs and UI.
- [x] Rank concrete gaps; separate missing frontend controls from contract/policy limits and unqualified live integrations.

## Task 4 — Delivery

- [x] Run focused and full affected suites, types, lint, docs consistency, desktop/mobile/accessibility checks and clean build.
- [x] Review diff inline; record exact results and remaining limits.
- [ ] Commit and push dev; deploy the tested frontend to testnet using the existing atomic delivery process and verify public assets/portal health.
