# Changelog

## 0.7.0-alpha.1 — Shared hosting and connected payments

Free shared creation and 10 included members; explicit monthly graduated capacity, governed future rates and grandfathered agreements. Optional DAO merchant onboarding,5% governed Connect commission, receipt/refund controls and server-only broker integration. Public Hub portal discovery, isolated independent API selection and issuer-bound account-control challenges. Coordinated protocol/help/SDK upgrade and local regression checks; live provider qualification remains held.

## 0.6.0-alpha.1 — Wallet disaster recovery

Wallet-only account and creation flows explain recovery/decryption boundaries. Recover or create an encrypted vault and attach it to the same profile with separate wallet approval. Updated core/modules 0.6 development artifacts and browser/crypto regressions.

Updated READMEs, documentation navigation, recovery/storage limits and coordinated 0.6 upgrade instructions. Generated help and development package integrities are refreshed together; older dated evidence remains historical.

Development prerelease; production release gates remain in force.

## 0.2.0-alpha.1 — Purpose presets and participant modes

- DAO preset onboarding, purpose filtering and contextual workspace descriptions.
- Separate human, mixed and guarded-agent participation choices.
- Policy, participant and scoped-credential controls with authority disclosures.
- Unsigned guardian transaction preparation for external native signing.
- Works funding votes and passed-vote execution.

Requires compatible core and module 0.2.0-alpha.1 artifacts. Production deployment is not included.

## 0.1.0-alpha.2

- Align shared Vue UI with the supplied CIQ/MIQ operational design: espresso
  surfaces, amber actions, ivory text, lime success and coral errors.
- Bundle Inter locally and use consistent Vue Lucide icons in navigation and
  the DAO hub.
- Improve filter touch targets, destructive-button contrast, field boundaries
  and mobile focus/layout behavior. Add desktop/mobile presentation regressions.
- Document the visual source, Daclify adaptations and limits of fixture-based
  verification. Core/module protocol pins remain at `0.1.0-alpha.1`.
- Module enablement now sends the reviewed code hash. Disabling sends an empty
  pin because the runtime clears grants without requiring the current code.
- Lint rejects explicit `any`, TypeScript suppressions, non-null assertions,
  and unchecked casts through `unknown`. `npm run verify` runs that lint,
  `vue-tsc`, and the unit tests. It does not publish a release.
- A provider session can identify an account without unlocking a user-controlled
  vault. A different signing key locks a vault that is already open.
