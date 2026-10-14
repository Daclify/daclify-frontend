# Ballot content and module review delivery — 14 October 2026

## Release pins

- Frontend implementation: `999403ce71b42f11a41e0fa42a4a9f7d2d4f8c84`, version `0.15.0-alpha.34`.
- Modules producer: `526515539e85cf0bb3f24130ba8e1d04d4f43951`, SDK `0.10.0-alpha.31`.
- Both implementation commits were fast-forwarded into `dev`, pushed and checked against their remote heads. This evidence is a later documentation-only commit; the deployed source remains the implementation commit above.
- Vendored/immutable module package SHA-256: `e8405f186ac580ef209a0457a563af80641249bf5041ac07574bfe41cca651b0`.
- Core API/protocol stays `0.15.0-alpha.22`. Contract code, ABI, action/table layouts and native authority are unchanged.

## Result

New ordinary ballots require a public title and explanation. The editor offers fixed Reject/Approve proposals or a poll with three to sixteen choices, and an optional existing document pinned to its exact version and commitment. Cards show actual choices, tallies, recorded votes and results. Invalid or inconsistent definitions block voting; malformed or unavailable attachment references cannot silently substitute the latest document.

The [capability review](../module-capability-gaps.md) covers first-party modules, external Telos governance, connected apps/payments and archive boundaries. Its remaining work is explicitly separate from this UI/SDK release.

## Verification

- Producer full suite: 221 tests in 34 files passed, with lint, strict types and generated-document consistency. A serialized focused rerun passed 65 tests across metadata, Decide, elections, governed Works and Grants.
- Frontend full suite: 364 tests in 62 files passed, with strict Vue/TypeScript checks, lint and touched-file formatting.
- Stationary-source ballot/Decide browser suites: 42 desktop/mobile cases passed, including disposable-key signed creation/voting at a mocked API boundary, policy preservation, legacy definitions, precise document links, retained drafts, accessibility and narrow-screen labels.
- Wider browser run: 96 of 98 passed initially. Two older creation fixtures needed the newly required explanation; both corrected signed retry cases passed on desktop/mobile. The entire wider run was not repeated after the final focused changes.
- Concurrent emulator runs produced six election setup timeouts; the serialized focused rerun passed without changing contracts or assertions. One earlier cold-start browser load failed under concurrent load; the final stationary-source suite passed. Details remain in the [execution ledger](2026-10-14-ballot-content-progress.md).
- Clean testnet-mode production build passed from the exact deployed commit. Existing large-chunk and external output-directory warnings remain.
- Public desktop/mobile journeys passed account entry, navigation, DAO/Decide, external governance and contract/status reads, accessibility and overflow checks. No JavaScript page errors, API requests to the frontend origin or API 5xx responses were recorded.
- Public index, entry, ModulesPanel and Workspace assets matched local SHA-256 values. The public help bundle contains the new canonical ballot guidance. An initial ad hoc numeric-text assertion used the wrong punctuation; matching the canonical producer text passed.

## Testnet publication

`https://testnet.app.daclify.com` was updated from the clean detached checkout under `/data/daclify-runtime/releases/20261014-ballot-content/daclify-frontend`. Its environment was checked for `VITE_NETWORK=testnet` and `VITE_API_TESTNET=https://testnet.api.daclify.com` before building.

The existing delivery script staged assets, retained older hashed files and replaced `index.html` last. The API stayed active with the same PID, `990215`; its network endpoint returned testnet JSON and core version `0.15.0-alpha.22`.

Entry asset: `index-D0l1-1pY.js`; ballot asset: `ModulesPanel-CQf7dECi.js`; workspace asset: `Workspace-CTHZq8Ab.js`. Full hashes, public browser results and local screenshots are retained under `/data/daclify-runtime/ballot-content-20261014` and the release checkout's `.artifacts/public` directory.

## Remaining limits

Reload the portal before custom polls: older cached interfaces can still render binary labels. The existing contract-checked ballot-definition commitment upgrade remains the first follow-up; UI validation alone does not bind a signed vote to the definition the API displayed. Neutral two-choice polls, richer voting, Works arbitration and payroll renewal were not added.

Supporting-document metadata does not create an archive-retention dependency. No live user signature, new Anchor wallet payload, financial transfer, production deployment or contract upgrade was exercised in this delivery.
