# Restore an encrypted kit with its vault password

The user has a downloaded encrypted kit and their vault password, but the recovery form rejects that password with `VAULT_UNLOCK_FAILED`. The kit already stores both a password-encrypted local envelope and an independently encrypted recovery envelope. The previous restore function tried only the recovery envelope.

The compatible fix accepts either the vault password saved with that kit or its matching recovery code, preserves its signing and document keys, and encrypts the restored local vault under the selected new password. The original JSON needs no edits. File-only recovery and blockchain private-key imports are outside this change.

## Execution ledger

- [x] Reproduce the missing password recovery path with real disposable encrypted keys. The new unit case failed with `VAULT_UNLOCK_FAILED`; recovery-code restoration passed.
- [x] Implement password fallback after recovery-envelope unlock fails; retain kit validation and recovered public-key matching.
- [x] Clarify recovery labels and update affected browser journeys and canonical user guidance.
- [x] Run unit, strict Vue/TypeScript, lint, build and desktop/mobile recovery checks; review the connected diff inline.
- [x] Deliver the checked frontend to the existing testnet app and verify the public flow with disposable keys.

Initial browser execution could not launch Chromium because this shell lacked the workspace's extracted browser library path. This was an environment failure, not a product regression; subsequent browser checks use `/data/daclify-runtime/browser-libs/usr/lib/x86_64-linux-gnu`.

## Verification and delivery

- The new unit password-restoration case failed with the original `VAULT_UNLOCK_FAILED`. With the browser library path configured, its desktop journey also failed before the fix because the same account never appeared.
- `npm run verify`: lint policy, strict Vue/TypeScript checks and all 182 unit tests passed. Incorrect secrets, a mismatched advertised identity, malformed kits and existing recovery-code behavior remain covered.
- `LD_LIBRARY_PATH=/data/daclify-runtime/browser-libs/usr/lib/x86_64-linux-gnu node_modules/.bin/playwright test tests/e2e/account-entry-experience.spec.ts tests/e2e/workspace.spec.ts --grep 'restore|backup|recovery'`: eight selected account-entry journeys passed across desktop/mobile Chromium. The backend-dependent workspace membership journey did not match this selection and was not run.
- The staged testnet build passed. Its 84 text artifacts matched none of 12 distinct configured secrets. Assets-first delivery verified all 97 staged files, retained previous hashed assets, and atomically replaced the entry page. The existing documentation-chunk size warning remains.
- Core canonical account/recovery guidance was updated and regenerated; its documentation consistency, formatting and strict TypeScript checks passed. The API was restarted to load its updated help context. The frontend's immutable vendored protocol package remains 0.10.0-alpha.3, so its embedded handbook retains that version's guide until the next public package update; the recovery form and backup guidance contain the current instructions.
- [Public verification](2026-10-10-vault-password-recovery-public.json) used the actual public HTTPS frontend and API with one disposable service identity. An unchanged downloaded kit restored the same service account and public signing/encryption identity using the original password on desktop and the separate recovery code on mobile. Both new passwords subsequently unlocked their restored vaults. An incorrect password was rejected before any local vault was saved. Both selected Axe scans reported zero violations; no page errors or horizontal overflow were found.
- Public entry-page bytes match the deployed index, SHA-256 `a447fff9382065155717f1e644d45f3644f09cd41e81b1a3d748721481f6a6f0`. API and frontend services are active. A verification probe initially requested a nonexistent `/v1/docs` endpoint and received 404; the handbook uses the vendored bundle rather than that endpoint.

Frontend development version is 0.10.0-alpha.10. Inline review found no new privilege grant: the fallback only decrypts an envelope already present in the file, requires its password, and still verifies both recovered public keys. No dependency or persisted envelope format changed.

The user's JSON, password and account have not been accessed. Production, native authorities and assets remain outside scope.
