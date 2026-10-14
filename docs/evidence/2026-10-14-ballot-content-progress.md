# Ballot content execution ledger

- Authorization: user requested fixing the ballot content gap and reviewing other modules; existing session authorizes dev delivery and testnet updates, with no production or real user transaction submission.
- Sources: frontend dev 4de61be; modules dev dbff869; core protocol 0.15.0-alpha.22; modules SDK 0.10.0-alpha.30; frontend 0.15.0-alpha.33.
- Workspace: isolated frontend/modules worktrees under `/data/daclify-runtime/worktrees/ballot-content-20261014`; no delegation.
- Scope: creation/presentation using unchanged contract actions and metadata bounds; other module capability audit.
- Decision: preserve Reject/Approve binary semantics; expose custom polls with 3–16 options. Neutral two-option polls and on-chain vote-definition commitments remain separate contract gaps.
- Decision: public inline title/explanation; exact optional document reference; no implied archive retention or private-content publication.
- Task 1: baseline dependency setup running; implementation not started.

- Baseline: frontend 364 tests/62 files passed; module producer 215 tests/33 files passed. Initial frontend run encountered host watcher-limit warnings; later runs use CHOKIDAR_USEPOLLING=1.
- Task 1: six metadata tests failed for missing producer APIs, then passed after schema/encoder/reader implementation. Producer typecheck and lint passed. Contract binaries and action/table layouts are unchanged. Candidate SDK/help package 0.10.0-alpha.31 built and packed.
- Task 2: four desktop browser tests failed for missing content/options/document controls and invalid-definition blocking. All four then passed on desktop and mobile (8/8), including accessibility/overflow. Consumer typecheck passed. Signed creation/voting verification and wider regression suites remain.
- Audit: binary semantics, >50% winning threshold, missing definition-bound votes, absent Works arbitration and fixed-term payroll are contract limits, not additional UI fields. Source review in progress.

- Producer verification: lint, strict types, generated documentation consistency and the full 221 tests/34 files passed. The wrapper run consumed a worker option as an npm setting and emitted a warning; the actual complete test command was `vitest run`, not a four-worker claim.
- Review fixes: URL validation moved to Workspace and ContentPanel accepts an optional validated reference; the access-component regression failed before this change and passed afterward. Browser signing fixture now preserves in-memory keys through SPA navigation and normalizes native decoded IDs through the canonical uint64 schema; signed poll creation and choice recording passed on desktop/mobile.
- Consumer full suite/typecheck/lint/build passed (364 tests/62 files) before final lightweight directory/long-label fixes. The new directory test failed with one unnecessary people request, then passed after avoiding that read for Decide. A permitted 80-character unbroken label caused mobile overflow; targeted CSS fix in progress.

- Task 3: capability report completed for Decide/elections/governing documents, Works/agreements/services, Payroll, Grants, Endorsement, Activity/mini apps, external Telos governance, connected payments and archive. Report separates UI gaps from contract semantics/provider qualification. No financial policy or contract authority was changed.
- Remaining compatibility risk: older cached clients can still mislabel custom polls; reload the current UI. Contract-checked definition commitments and explicit neutral binary subtypes remain documented follow-up.

- Broad browser regressions: 96/98 passed; the two old ballot-submission cases lacked the now-required explanation. Their fixture was updated to supply it, and both signed retry cases passed on desktop/mobile.
- A concurrent focused WASM rerun had six election setup hook timeouts at 10 seconds; the previously complete producer run was green. A serialized unchanged-contract rerun is running; no contract/assertion change was made to conceal these timeouts.
- One cold-start ballot browser case stayed in its loading state under concurrent emulator/browser load; its mobile counterpart and earlier focused run passed. Final ballot/Decide browser checks are being run with stationary source.
- Inline review found malformed attachment parameters could fall back to the latest library. The new regression failed before a Workspace guard; the guard now rejects that link explicitly. Exact-reference mismatch and narrow-screen unbroken choice-label cases are covered.

- Final checks: 42/42 ballot/Decide browser cases passed on desktop/mobile, including signed creation/voting, exact and malformed document links, old ballots, saved policy, accessibility, long labels, missing definitions and retained drafts. The source was stationary during this run. Frontend full suite 364/364 in 62 files, types, lint and touched-file formatting passed.
- The unchanged-contract focused rerun passed 65/65 across metadata, Decide, elections, governed Works and Grants with one worker; the earlier concurrent hook timeouts did not recur. Producer full suite previously passed 221/221 in 34 files.
- Scope limits: public browser deployment checks still pending. No real user signature, live financial transfer, production deployment, contract upgrade or owner/active change is authorized or claimed here.
