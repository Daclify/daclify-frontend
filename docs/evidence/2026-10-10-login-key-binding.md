# Frontend vault login v3 — 2026-10-10

Frontend/core protocol 0.10.0-alpha.1 consumes modules SDK 0.9.0-alpha.8 and unchanged module contracts 0.9.0-alpha.5. Challenge requests send both validated vault public keys; client validation rejects mismatched keys/context and old domains before signing. Actual client/vault regressions verify the K1 signature and prove refused challenges do not submit login, unlock keys or store CSRF. Existing account/recovery keys are preserved.

Refreshed self-contained vendor packages and lock integrities; removed obsolete archives. Updated login fixtures, including the module browser fixture that incorrectly confused core package and deployed contract versions. Production compatibility checks remain intact.

Verified `npm run verify` (33 files / 168 unit tests plus Vue template/type/lint checks), `npm run format:check`, testnet build, 4 payment and 18 module-card desktop/mobile Playwright checks. Fresh standalone `npm ci --ignore-scripts`, verification and testnet build passed without backends, private envs or a registry token. Browser API responses were fixtures; native backend/runtime verification is recorded in core.

See [core evidence](https://github.com/Daclify/daclify-backend-core/blob/dev/docs/evidence/2026-10-10-login-key-binding.md) and [coordinated rollout](https://github.com/Daclify/daclify-backend-core/blob/dev/docs/operations/login-v3.md). No public deployment/live provider qualification occurred. Mixed versions reject new vault logins; older app tabs and pending logins need refreshing/restarting. Existing sessions and original encrypted recovery kits are preserved.
