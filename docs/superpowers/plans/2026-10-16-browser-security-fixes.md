# Browser security fixes implementation plan

> Execute inline with `superpowers:executing-plans`; workspace delegation is prohibited. The user has approved fixing, committing, pushing and deploying the reported findings.

**Goal:** Close SEC-001 and SEC-002 from the 16 October security review and deploy the verified frontend to shared testnet.

**Architecture:** Keep key invalidation in the existing session module. Send only account/scope/type events between same-origin tabs; events can reduce access and never grant it. Apply anti-framing HTTP headers at Vite and deployed static hosting, preserving top-level OAuth redirects and popups.

**Tech stack:** Existing Vue/Pinia, browser messaging/storage, Zod, Vitest, Playwright and Caddy. No new dependencies or native contract changes.

**Spec:** [Security review follow-up](../../../../daclify-backend-core/docs/evidence/2026-10-16-browser-security-remediation.md), SEC-001 and SEC-002; original audit evidence at `/data/daclify-runtime/security-review-20261016/`; user authorization in this session.

## Constraints and review focus

- Preserve immediate local key locking when logout is delayed or fails.
- Invalidate pending private work and cached account/private UI in the affected tab.
- Ignore different accounts, networks and malformed events; avoid event loops.
- Clear keys on definite session removal and incompatible account/key changes.
- Block untrusted framing while keeping top-level pages and OAuth popups usable.

## Task 1: Session/vault invalidation

Files: `src/auth/session.ts`, `src/App.vue`, `tests/e2e/session-security.spec.ts`, existing provider/session unit tests, `docs/users/passwordless-access.md`.

- [x] Add real two-tab browser tests with synthetic vaults and only HTTP responses stubbed. Assert current-tab and remote signing fail after logout (including failure), manual lock propagates, account/scope mismatches remain isolated, and session removal locks keys. Confirm they fail before the fix.
- [x] Add `startSessionSecurity(): () => void` to the existing session module and start/stop it with the app lifecycle. Use native cross-tab messaging with a storage-event fallback, validate bounded signal data, and keep generation/private-work guards intact.
- [x] Run the new tests and the existing frontend unit suite; document browser-wide logout and private-data limits.

## Task 2: HTTP framing protection

Files: `public/_headers`, `vite.config.ts`, deployment example under `docs/`, `docs/netlify-dev.md`, `tests/e2e/session-security.spec.ts`.

- [x] Add browser assertions that an unrelated-origin iframe cannot render consent while top-level/popup consent remains visible. Confirm failure before policy changes.
- [x] Supply HTTP `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY` for portal responses. Keep the same values in Vite, static-host headers and the documented Caddy deployment example. Do not change cross-window opener policy.
- [x] Run desktop/mobile security tests, type checks and the production build. Top-level/popup consent rendering is verified; new real-provider authorization is outside the local fixtures.

## Task 3: Delivery

- [x] Check current VERT advisory reachability/remedy; do not substitute unqualified crypto dependencies. Record unresolved upstream advisories clearly.
- [ ] Increment frontend prerelease version, review the full diff, and commit/push `dev`.
- [ ] Prepare exact build/config rollback; validate Caddy and deploy frontend assets atomically with the entry last. Keep previous hashed assets available to open sessions.
- [ ] Verify public response framing, real browser frame rejection, page/API health and published asset hashes. Record commits, checks and any unverified provider/mainnet limits.

Delivery completion is recorded in the core evidence above and `/data/daclify-runtime/security-fixes-20261016/`; deployment steps remain a release checklist, not a claim that deployment happened before this source commit.
