# DAO workspace experience implementation plan

**Goal:** Give visitors, members and administrators a clear route from DAO details to everyday work and configuration.

**Architecture:** Keep canonical core/module API records and existing action panels. `Workspace.vue` owns DAO context, full-reference membership matching, module availability and routes. A focused `WorkspaceOverview.vue` presents balances and everyday destinations; `DaoSettings.vue` owns identity/configuration organization and the existing rename operation. Preserve independent operator checks, signing/decryption separation, native emergency exits and on-chain authority. No backend/protocol changes, new dependencies or invented activity statistics.

**Tech stack:** Existing Vue/TypeScript, Pinia/Router, producer schemas/SDK, design tokens and Lucide icons.

**Execution:** Inline on current clean `dev`; repository rules prohibit delegation and require continuous implementation. The supplied brief authorizes routine design decisions and implementation. No production deployment or account authority changes.

## Verified problems and design direction

- Overview advertises Decide/Works regardless of installation; module lookup failure is swallowed. Replace this with available tools, paused-tool disclosure and recoverable loading/failure states.
- Eleven undifferentiated navigation choices mix member work with setup. Group existing links into Workspace and DAO setup, wrapping on small screens to preserve established direct-link journeys.
- The full signer/account-binding panel repeats on every section. Put it in accessible native disclosure, expanded when an active member needs a signer; preserve all wallet controls and private-decryption explanations.
- Settings combines hosting, branding, name, technical records and governance. Use URL-backed Identity, Governance and Services sections, with contextual explanations and public/read-only permission labels.
- Generic fallback falsely says module screens are being connected. Unknown sections should offer workspace recovery instead.
- DAO names and privacy need readable hierarchy and actual member roles. Use compact public metrics, task cards, reserved-funds disclosure and separately labelled personal claim/stake exits. Do not infer voting eligibility from membership alone.

## Tasks

- [x] Add canonical synthetic fixtures in `tests/e2e/dao-workspace-experience.spec.ts`; run failing regressions for unavailable-tool shortcuts, signing disclosure and grouped settings.
- [x] Refine `src/views/Workspace.vue`: grouped responsive routes, access/privacy/signing disclosure, full-reference membership key, scoped module retry/state guards and unavailable-section recovery.
- [x] Add `src/components/WorkspaceOverview.vue`: authoritative balances, real member details/exit links, enabled or installed tools, core document/member destinations and module-load feedback.
- [x] Add `src/components/DaoSettings.vue`: query-preserving settings controls; existing identity/branding/governance/service panels; canonical `MetadataSchema` validation, signability/admin/busy guards and stale-context handling for rename.
- [x] Extend browser regressions for roles, disabled actions, module failure/retry/paused state, DAO isolation, URL/hash return destinations, direct configuration links and responsive/accessibility behavior. Update existing settings journeys in `dao-presets.spec.ts` and `executives.spec.ts` to open Governance.
- [x] Run actual desktop/phone/tablet/landscape renders and Axe/overflow/enlarged-text/keyboard checks; inspect overview, configuration and signer states. Fix the measured 710px public-image consent checkbox by reusing the existing checkbox class; use scalable configuration labels.
- [x] Run frontend verify, formatting and testnet build; review final diff, update README/changelog/requirement coverage/evidence and increment frontend-only development version to `0.10.0-alpha.3`. Delivery branch is `dev`.

Execution and limits: [workspace evidence](../../evidence/2026-10-10-dao-workspace-experience.md). No backend, private environment, live provider or blockchain changes.

## Acceptance commands

```sh
DACLIFY_TEST_UI_PORT=5358 npx playwright test --config playwright.config.ts \
  tests/e2e/dao-workspace-experience.spec.ts tests/e2e/people-workspace.spec.ts \
  tests/e2e/dao-presets.spec.ts tests/e2e/executives.spec.ts \
  tests/e2e/hub-experience.spec.ts tests/e2e/theme.spec.ts
npm run verify
npm run format:check
VITE_NETWORK=testnet VITE_API_TESTNET=https://testnet.api.daclify.com npm run build
```

Presentation fixtures do not establish live wallet signing, settlement, native permissions or hosted operator/provider readiness. Report unrun checks explicitly. Existing module actions must retain their authoritative checks and supported-release pins.
