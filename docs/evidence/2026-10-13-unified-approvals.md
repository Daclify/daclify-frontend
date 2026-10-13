# Unified account approvals — 13 October 2026

Frontend **0.15.0-alpha.30**, core protocol **0.15.0-alpha.20**, modules **0.10.0-alpha.28**. No API, database, custody or native contract change.

## Delivered behavior

Account > Access & recovery > Approval setup chooses one browser/account/operator/network default, verifies its account pairing, reviews selected DAO authorizations and wallet replacements, and activates at most 20 memberships per gesture. Current membership/nonces are reread; original member and incoming-wallet consent are preserved. Failures stop the batch and retries skip confirmed bindings. A concurrent revocation cannot be reported as enabled. Readiness and dispatch check the saved wallet identity, so another connected wallet does not silently become the default.

Ordinary creation, claim-link creation, join instructions, workspace and action cards share the setup destination. Claim secrets stay out of that destination. Account sign-in/recovery remains in setup until the user returns; restoring keys preserves the chosen default. A ready wallet is not labelled sign-in-only when local keys are locked. Public actions can use the authorized wallet; private content still needs the original encryption keys and permitted grants.

## Verification

- Baseline 348 tests passed. Missing shared setup entry failed before implementation.
- `npm run verify`: lint, strict Vue/TypeScript and 363 tests passed before the final wallet-identity guard.
- Final lint/typecheck and full unit rerun: 364 tests in 62 files passed, including actual scoped preference behavior, native incoming member consent, fresh nonces, inactive/wrong identity refusal, paired-wallet checks, context changes and concurrent EVM revocation.
- Broader account entry/settings, DAO presets/workspace, recovery and feature browser group: **94 desktop/mobile checks passed**.
- Final complete feature group: **10 desktop/mobile checks passed**, covering secret-free claim entry, locked-key creation, shared action setup, default preservation through recovery/reload and a failed second DAO approval followed by safe retry. Real encrypted vaults and K1 account/member signatures were verified against synthetic HTTP responses. Ethereum provider responses are synthetic; these checks do not establish live EOA proof verification.
- Red regressions caught recovery leaving setup too early, same-account refresh clearing selections, concurrent revocation reported as success, missing claim routing, a different connected wallet overriding the default, and oversized 852 px checkboxes. Each relevant final path passed after correction. Scoped 18 px checkboxes keep a 44 px label target; accessibility checks passed.
- Reviewed the new card and shared signing/recovery/creation callers inline. User instructions prohibit agent delegation.

## Limits

The default is a local browser preference, not a cross-device server setting or authorization record. Another device chooses its paired wallet again. Native and EVM chain bindings remain separate and authoritative. First activation still requires existing account/member keys; original-key recovery is not bypassed. Managed production custody is not introduced.

Physical Anchor/EVM wallets, the real Pinata document write and native creation/claim suites were not rerun for this frontend change. Existing instruction encodings, wallet transaction validation and deployed native artifacts are unchanged. Provider/chain doubles establish the UI flow; they do not establish new live integration qualification.

Testnet delivery uses a clean source build with explicit `VITE_NETWORK=testnet` and `VITE_API_TESTNET=https://testnet.api.daclify.com`. Exact source, entry hash, rollback entry and live public browser results are recorded in the owned runtime delivery packet.

The clean source `aa801ad4e0b77704f3cc1b7628e030c9011e778d` was deployed to testnet; entry SHA-256 `19ff31c262a878985c5d032afc09ed72734f5c69a48ee46e893282894b63ca07` matched the hosted response. Candidate and hosted startup/network/DAO checks passed **8/8 each** on desktop/mobile, including a saved Production choice and reload. API remained active with no restart. The broader `test:testnet-public` check failed at its Names quote assertion: `ORACLE_STALE`, HTTP 503, with the existing names-oracle unit restarting. The approval/portal checks passed; Names oracle repair was outside this frontend change and remains an operational follow-up.
