# Status experience implementation plan

> Execute inline with `superpowers:executing-plans`; workspace instructions prohibit delegation. The user's UI/UX brief authorizes direct implementation and routine design decisions, with review afterward.

**Goal:** Make Status useful at a glance, honest about configuration versus live checks, and stable during refresh.

**Architecture:** Refine the existing Vue Status view and its owned CSS. Consume the unchanged canonical platform and assistant schemas; retain all six keyboard-accessible tabs and existing diagnostics. No new dependencies, API changes or provider calls beyond existing read-only metadata.

**Tech stack:** Vue 3, strict TypeScript, existing dark/amber tokens, Lucide, Playwright and Axe.

**Spec:** User's Principal UI/UX Designer & Frontend Engineer brief and the direction recorded below.

## Audit and design decisions

- High, verified in source: refreshing removes all readings/tabs and loses the user's place; the platform response waits for unrelated assistant metadata. Preserve successful readings during same-context refresh and show each result independently.
- High, verified in live data: chain/database reads are reachable while TLOS quotes are stale and most services remain unqualified. Surface those distinct states without an aggregate “all operational” claim.
- Medium, verified in source: the database's live state is omitted; service qualification uses machine labels; empty contract readings can look like a completed check. Show readable, explicit states.
- Medium, design judgment from desktop/mobile screenshots: long prose and full-width panels obscure scanning; the mobile tabs are small, wrapped pills. Add a compact live-check grid, grouped overview, readable service rows and 44px tab targets.
- Preserve hashes, public authorities, RAM, versions, all fee values, gateway counters/conditions, limits, Daxi metadata/help and navigation. No removal of functionality or fee/policy changes.

## Review focus

- Failed refresh: retained readings must be visibly previous and recover through another refresh.
- Partial failure: slow/failed assistant metadata must not block platform readings or imply missing configuration.
- Deployment change: clear readings and ignore responses from the previous network/runtime/RPC.
- Missing or mismatched chain: do not claim verified reads, current quotes or usable shared setup.
- Narrow/enlarged text and keyboard: all tabs, hashes, service names and disclosure content must remain readable and reachable.

## Task 1: Status presentation and refresh

Files: `src/views/Status.vue`, `tests/e2e/status-tabs.spec.ts`; preserve existing platform acceptance expectations in `tests/e2e/platform.spec.ts`.

Consumes: `api.platformStatus(): Promise<PlatformStatus>`, `api.docsAgent()` and workspace deployment metadata. Produces: the same `/status` route, six tabs, independent result/loading/error state and an at-a-glance checked summary.

- [x] Add failing browser regressions for retained refresh context, delayed assistant metadata, unverified/mismatched reads and initial failure recovery. Run them against the current page and inspect failures.
- [x] Implement independently settled requests with sequence guards, previous-reading labels and context clearing; add live summary, concise overview, explicit gateway/service/contract states and responsive scoped CSS.
- [x] Run selected Status regressions on desktop/mobile, including keyboard, Axe, disclosures, exact integer counters and readable diagnostics; inspect screenshots at phone/tablet/desktop and 200% text.

## Task 2: Verification and delivery

Files: development version/changelog, requirement register if necessary, and `docs/evidence/2026-10-10-status-experience.md`.

- [x] Run `npm run verify`, formatting and the testnet build. Run related Daxi/theme regressions. Expected: no failures; record existing build warnings honestly.
- [x] Review the final diff inline; record results and limitations. Increment only the frontend development version; retain pinned producer versions.
- [ ] Serve the checked build on the existing testnet frontend, verify public HTTPS Status and linked assets, then commit/push `dev` and confirm the remote ref. No production/main release.

## Execution ledger

- Baseline: clean frontend `dev` at `91bd794`; public HTTPS Status and canonical API response inspected on desktop/390px phone. Both routes return 200. Baseline screenshots: ignored `.artifacts/status-review/before-*.png`.
- Ruling: follow the user's direct-implementation brief and existing continuous-session authorization; no additional design gate or delegation.
- Task 1: complete — four initial browser regressions RED→GREEN; additional rate distinction RED→GREEN; selected diagnostics, refresh focus and exact counters pass.
- Task 2 verification: complete — combined committed Help + Status snapshot passes lint/typecheck, 168 unit tests, formatting, testnet build and 56 desktop/mobile cases. The strengthened database check separately passes both projects.
- Final review: self-review, per workspace prohibition on delegation. No outstanding critical/important findings. Provider qualification and physical assistive-technology testing remain outside this UI task.
- Testnet delivery: complete — published checked files, real public HTTPS desktop/mobile checks pass, 28 loaded assets match, selected Axe scans report zero violations. [Evidence](../../evidence/2026-10-10-status-experience.md).
