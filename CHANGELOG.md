# Changelog

## Unreleased — welcome page and grouped handbook

Add a branded welcome page at `/` with guest and signed-in shortcuts. Move DAO
discovery to `/hub`, preserving older filtered root bookmarks. Keep network
verification on workspace routes while introductory content remains readable
during API failures.

Replace the full-handbook overview with a compact guide index and six collapsible
contents groups. Retain full-text search, direct links, DAO context, version
checks and generated references. Add desktop/mobile navigation, keyboard,
accessibility, search and guide-coverage regressions.

## Unreleased — installable PWA

Add a standalone web app manifest, maskable Daclify icons and Apple home-screen
metadata. Users can install the app through supported browsers; it remains
online-only with no service-worker cache. Document installation and add
production-build desktop/mobile Chromium installability and icon checks.

## Unreleased — documentation assistant

Consume the refreshed core handbook with Daclify provider/Telegram setup and unambiguous hosting examples. Explain the assistant's docs-only scope, evidence checks and provider privacy. Failed status requests no longer imply missing configuration. Desktop/mobile regressions cover plain-text answers, source links and status/refusal behavior.

## 0.8.0-alpha.1 development candidate — Resources and Archive

Resources presents observed per-payer RAM, actual enforcement, native/card acquisition, separate pinned storage agreements, approved capacity, grace and curation. Archive flows include export consent, verified backup download, approval/revocation, constrained pruning, history recovery and exact restoration. Treasury offers full-claim selection for emergency exits; partial withdrawals still need ordinary RAM.

Status shows shared gateway allowance and operational gates. Context changes clear stale resource reports. Producer packages and versioned help remain coordinated development artifacts; live providers, public rollout and immutable release qualification are still gated.

Consumed the updated module packet with failed-vote migration handling and the retained native-qualified poll Archive decoder. Existing exported votes remain readable across the Decide code update.

Deployed API origins now use `VITE_API_PRODUCTION` and `VITE_API_TESTNET` before the legacy network file, removing manual edits after the build. Incomplete or invalid settings fail closed; local proxy mode and the direct development override remain supported. Added a production env example and updated Netlify/local deployment instructions.

`VITE_NETWORK=testnet|production` locks a deployment to its matching API origin, ignoring saved choices and hiding the switch. Mismatched API environments block workspace screens and independent-operator restoration. Unlocked local/legacy setups remain supported.

## 0.7.0-alpha.1 — Shared hosting and connected payments

Applied AGPL-3.0-only to first-party code, contracts, SDKs and documentation; preserved third-party licenses. Development packages include the license and source guidance.

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
