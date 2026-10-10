# Status Contract Map Implementation Plan

> Execute with `superpowers:executing-plans` inline. Workspace instructions prohibit delegation and authorize continuous implementation with review afterward.

**Goal:** Show observed contract authorities as an interactive map with reversible cards and live RAM/CPU/NET.

**Architecture:** Replace only the Contracts panel with an owned explorer and map component. A small display model derives graph nodes/edges and resource labels from producer-owned platform and WharfKit types. The explorer owns selection/resource lifecycle; the map owns the responsive permission tree and its list alternative.

**Tech Stack:** Existing Vue 3, strict TypeScript, WharfKit, Lucide, product tokens, Playwright and Axe; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-10-contract-map-design.md`.

## Global Constraints

- Preserve existing Status tabs, API contracts, diagnostics, refresh behavior and deployment sequence guards.
- Preserve unrelated dirty auth/package files. Work inline on dev as requested; stage only task files.
- Only public read RPC calls; verify chain ID, use no credentials and discard stale reads.
- Keep 64-bit resource integers exact; label CPU in microseconds and NET/RAM in bytes.
- Native buttons, visible focus, at least 44px targets, reduced motion, readable list alternative.
- No permission edits, signing, dependency additions or production deployment.

## Review Focus

- A key shared by owner and active must not turn a child into root authority.
- Delegations, code authority, thresholds and unresolved external authorities must remain distinguishable.
- Zero, unlimited, failed and large resource values must not become misleading percentages or imprecise numbers.
- Refresh/deployment changes must not pair old resources with new contracts or reset useful selection.
- Map nodes and card backs must remain reachable at 320px, with keyboard and 200% text.

### Task 1: Contract explorer

**Files:** Create `src/components/ContractExplorer.vue`, `src/components/PermissionMap.vue`, `src/content/contract-map.ts`, `tests/unit/contract-map.test.ts`, `tests/e2e/status-map.spec.ts`; modify `src/views/Status.vue` and the existing permission-guide search test.

**Interfaces:** Consume `PlatformStatus['chain']`, `API.v1.AccountObject` and an `active: boolean` prop. Produce the same Contracts panel plus interactive map/cards, resource status and inspector. `permissionGraph(contract)` produces typed display nodes and weighted/hierarchy edges; `resourceReading(used, max, unit)` derives exact labels and bounded visual percentages.

- [x] Write browser regressions that open a contract card and select its owner/active/shared-key nodes, check separate edge kinds/weights and related accounts, check resource states and retry, and exercise keyboard/mobile list access.
- [x] Run `npx playwright test --config playwright.config.ts tests/e2e/status-map.spec.ts --project chromium`; expect failures because the explorer is absent.
- [x] Implement the display model, map and card faces. Keep the existing full permission disclosure in the selected inspector.
- [x] Add lazy, typed chain-verified resource reads with per-account failures, abort/sequence guards and independent timestamps.
- [x] Run new browser regressions and existing `status-tabs.spec.ts` on both projects; inspect screenshots and fix failures.

### Task 2: Delivery and verification

**Files:** Update `docs/releases/requirements.json`, `CHANGELOG.md`, plan ledger and `docs/evidence/2026-10-10-contract-map.md`.

**Interfaces:** Uses Task 1's unchanged Status route and new explorer. Produces reviewable evidence and a local dev commit.

- [x] Register acceptance tests and add concise feature guidance/evidence.
- [x] Run `npm run verify`, formatting on changed files, `npm run build -- --outDir .artifacts/contract-map-dist`; expected no failures, report actual warnings.
- [x] Review the complete diff inline for the five review-focus items. Record limits and decisions, commit only task files on dev, and attempt the repository-required dev push.

## Execution ledger

- Baseline: frontend dev at `e589bda`; existing auth, unit recovery tests, package versions and vendor artifacts are user work and remain untouched.
- Ruling: carry out the supplied direct-implementation brief without another design gate; work in place and self-review under the explicit inline/no-delegation instructions.
- Pre-flight: Task 2 consumes the existing route preserved by Task 1; no producer API or package changes required. Map and resource presentation use canonical types.
- Baseline unit suite: 189/189 pass.
- Task 1: complete — initial missing-explorer regressions RED→GREEN; visible meters and related-card highlighting RED→GREEN; delegated-node distinction/following RED→GREEN. Seven map cases, thirteen Status cases and two permission-guide cases pass on desktop/mobile: 44/44.
- Added ten model tests for hierarchy, independent shared-key weights, code authority, delays, incomplete/cyclic graphs and exact/unknown/unlimited/zero/over-limit 64-bit resource readings.
- Ruling: keep the map renderer separate from selection/resource lifecycle and use a browsable card row — ten real deployment accounts would otherwise bury the map under a tall grid. The cost if unsuitable is a layout change.
- Ruling: fix the existing permission-guide search assertion to include its established preview text; no documentation behavior changed.
- Ruling: test and publish the task-only snapshot of committed dev plus this change. Concurrent passwordless/sign-in work remains untouched and excluded. Shared-tree `npm run verify` found a provider-session encryption-key fixture failure in those auth changes; the task-only snapshot passes all 192 unit tests.
- Task-only default unit run initially timed out two existing vault crypto cases under concurrent load; rerun with `npm test -- --maxWorkers=4` passes 192/192 without changing tests/timeouts/cryptography. Lint, Vue/type checks, formatting and ordinary/testnet builds pass. Existing Docs chunk-size warning remains.
- Self-review complete, inline under workspace prohibition on delegation: hierarchy/threshold semantics, public-data boundaries, resource precision/failure/replay, full diagnostics and keyboard/narrow-screen access checked. No outstanding important findings.
- Testnet: task-only checked artifacts installed with a backup and prior assets retained. Public HTTPS and actual configured RPC reads verified; screenshots/evidence recorded. No production or native-authority change.
- Git delivery: implementation commit `a0b51e0` pushed successfully to `origin/dev`. Used the established `Codex <codex@localhost>` commit identity as command-scoped settings; repository/global identity config remains unchanged. This final evidence update is a separate documentation commit on the same branch.

## Follow-up: screenshot-aligned permission tree

The user supplied a reference with nested owner, active and custom permissions, inline keys/weights and action chips. This is a concrete correction within the authorized feature; implement inline without a further design gate.

- [x] Add regressions for branch grouping, detached/cyclic input, inline multiple keys/shared selection and matched/unreported action links; watch the missing tree/link functionality fail.
- [x] Replace the two-lane SVG/zoom layout with semantic nested rows, full keys, threshold badges, weights, matching RPC action chips and responsive list access. Preserve inspector/card connections and resource lifecycle.
- [x] Complete desktop/mobile Status regressions, enlarged-text/Axe checks, task-only full verification, screenshot review and testnet read-back.
- [x] Update guide/evidence and commit/push only this task's files.

Follow-up baseline: `08bf404`. Task-only archive: `/data/daclify-runtime/permission-tree-check-4fwyljsx`. Concurrent sign-in/recovery/package changes remain excluded. Initial tree browser regression failed because inline permission rows were absent; model regressions failed because tree branches and matched action links were absent. Twelve model tests and eight desktop map cases now pass. The initial shared-tree typecheck also reported an unrelated `fast-sign-in.ts` never-type error; exact-optional account props introduced here were corrected to accept the pending/undefined reading explicitly.

- Live data review found 57 action links on the runtime execctx permission. Added a compact three-chip preview with a native disclosure for the remainder; the regression failed because the fourth action was always visible before the change.

- Final verification: 194/194 units with a 15-second test budget; 48/48 browser cases with a 60-second test budget; no assertion weakening, skipped cases or crypto changes. Lint/formatting/Vue/type/testnet build pass. After a desktop action-chip width adjustment, two responsive/Axe cases and the build were rerun successfully. Final public read-back checks all 10 resources, 57 action links, zero collapsed/expanded Axe violations and 31 asset byte matches. Backup, timestamps and timeout history are in the evidence guide.

- Git delivery: `d5121bc` pushed to origin/dev and remote ref verified. Staged only the tree files and its changelog paragraph; the concurrent password-free-devices changelog entry remains untouched and uncommitted by this task. This final ledger update is a separate docs commit.
