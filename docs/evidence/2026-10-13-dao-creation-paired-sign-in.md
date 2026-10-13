# DAO creation after paired sign in

Frontend **0.15.0-alpha.26**, commit `e2c7e2949fa73bff3d63bb5ffd00b4d15242c19a`, is pushed to `dev` and deployed on testnet. An authenticated account with its existing public identity can use shared DAO setup and explicit creation with its vault locked. Signed-out/keyless account setup remains required. Saved immutable orders now load immediately after entry or reload.

Final verification passed **345 unit tests / 60 files** and **16 desktop/mobile browser checks**, including actual local WebAuthn/API/SQL/native creation, order resume, account guards, presets and accessibility. Strict types/templates, focused lint, formatting and a clean locked build passed. Final public desktop/mobile checks verified the real setup form against the testnet API without submitting creation; no private keys entered the public browser.

The [core evidence](https://github.com/Daclify/daclify-backend-core/blob/dev/docs/evidence/2026-10-13-dao-creation-paired-sign-in.md) records exact source/artifact/report hashes, genuine regression failures, corrected harness failures, public preflight/deployment, session cleanup and limits. The API, schema, native code and authorities were unchanged. Physical user passkey retry is not yet observed. Claim links are a separate draft design and are not included in this release.
