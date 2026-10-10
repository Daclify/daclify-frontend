# User setup and services implementation plan

> Execute inline with superpowers:executing-plans. The user and workspace instructions authorize continuous implementation and prohibit delegation.

**Goal:** Improve Users, member details, Names, Create DAO and Status Services, then verify sign-in and provider readiness on the actual Telos testnet server.

**Architecture:** Keep Vue, existing components and canonical API types. Improve recovery and hierarchy without changing authorization, purchase prices, governance, custody or settlement. Provider checks distinguish configuration, live reads, sandbox exercises and human consent.

**Tech stack:** Vue 3, Pinia, TypeScript, Vite, Playwright, core Fastify/PostgreSQL API.

**Spec:** User's pasted Principal UI/UX Designer brief, requested page order and testnet service checks. Design choices are implementer decisions using existing tokens and native disclosures; user requested direct implementation.

## Constraints and review focus

- Preserve concurrent Help edits and existing backend server setup; commit only owned changes on dev.
- No frontend secrets, live payment tests, native transfers, authority changes or destructive provider cleanup.
- User permits disposable sandbox data. Email/Telegram final approval remains with the user; no inbox/account access needed.
- Failed directory/profile loads must not imply no users. Partial data survives pagination failures.
- Old name quotes must never reappear after input or deployment changes; keys and purchase context remain guarded.
- Member labels and profiles must match the complete DAO reference.
- Disabled DAO creation must explain the actual failed prerequisite, without relaxing backend policy.
- Services must not describe configured credentials as verified availability. Unknown service IDs remain visible.

## Execution ledger

### 1. Users and member details

- [x] Add and observe failing browser tests for search reset, failed detail retry and cross-DAO profile rejection.
- [x] Modify Users.vue, PeopleGrid.vue and UserDetail.vue: result feedback, scoped search, contextual retry, compact profile hierarchy and full-reference checks.
- [x] Run people-workspace browser tests on desktop/mobile; inspect actual layouts and accessibility.

### 2. Names

- [x] Add and observe failing name quote race and service retry tests in names-management.spec.ts.
- [x] Modify Names.vue: lead with name search, optional suggestions, quote → key backup → payment sequence; invalidate pending quotes immediately, retry service discovery and guard deployment changes.
- [x] Run existing seller-management regressions and new purchase presentation tests on desktop/mobile.

### 3. Create DAO

- [x] Add and observe failing readiness recovery test in dao-presets.spec.ts.
- [x] Modify CreateDao.vue: numbered setup sections, readable live summary and precise readiness/validation feedback. Retain immutable order review, idempotency and explicit execution.
- [x] Run preset, creation presentation and recovery regressions appropriate to available fixtures.

### 4. Status Services

- [x] Add and observe failing grouped/filterable services regression in status-tabs.spec.ts.
- [x] Group all reported services, provide user destinations and optional operator details; distinguish credentials from live qualification and allow filter recovery.
- [x] Run Status regressions desktop/mobile and accessibility checks.

### 5. Sign-in and live provider checks

- [x] Inventory every supported sign-in path and service against source and sanitized runtime settings.
- [x] Perform real read-only checks and bounded sandbox exercises where credentials permit; fix demonstrated server/configuration failures with regression tests.
- [x] Document human sign-in steps and missing provider/chain prerequisites, without silently enabling unsupported services.

### 6. Delivery

- [x] Run frontend verification, format, testnet build and relevant core checks after server changes.
- [x] Inspect desktop/mobile screenshots, keyboard flow, loading/error states and final diff.
- [x] Deploy the testnet build, verify public pages through HAProxy and scan bundled assets for configured secrets.
- [x] Record concrete evidence and limitations, commit owned changes and attempt dev publication using available credentials.

## Initial findings

Verified from source: failed user details have no retry; search keeps the own card regardless of the query; user badges/profile matching omit part of a DAO reference; quote invalidation occurs too late; Names discovery failure still displays Reading the chain; Create DAO conflates readiness with order errors; Services repeats undifferentiated operator cards.

Design judgments: make search and purchase the primary actions, shorten empty profile covers, move optional name inspiration/catalogue behind disclosures, and use a summary alongside the DAO form. No new dependencies or multistep wizard required.

## Delivery and open external gates

Implemented inline, reviewed against the connected code and tested before testnet delivery. Frontend 179 unit tests passed; targeted browser checks cover every requested page, recovery, current DAO references, quote/clipboard races, consent and network lock. All three server services are active. Core targeted selections total 91 passed tests (provider/sign-in, notifications, native proofs, environment/preflight); core typecheck/lint passed.

The operator/service inventory is completed, with feasible sandbox configuration applied and actual public/provider checks recorded in the evidence. “Completed” checkboxes above describe those work steps; they do not mark all providers as qualified. The tester subsequently confirmed email receipt and authorized the Telegram domain; the actual widget now renders. Approved free creation with ten slots passed a disposable browser-to-chain flow. The approved $1 basic-name tier, 30 KiB RAM, 0.5 TLOS CPU/NET and 100 test-TLOS reserve were applied irreversibly; public quotes and a read-only native purchase simulation passed. A five-minute timer maintains fresh trusted Names observations. Human sign-in pairing/consent, Connect/Google setup, funded gateway, actual payment/native settlement, cleanup and managed custody remain external or implementation gates. Receipts and precise limits are in the updated evidence.

Public deployment, commit IDs and GitHub authentication outcome are recorded in the UX evidence.
