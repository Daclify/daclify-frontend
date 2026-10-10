# Status Contract Map Implementation Plan

> Execute with `superpowers:executing-plans` inline. Workspace instructions prohibit delegation and authorize continuous implementation with review afterward.

**Goal:** Show contract connections as a name-only interactive diagram that selects one Contract Account Details panel with live RAM/CPU/NET and a permission tree.

**Architecture:** Replace only the Contracts panel with an owned explorer and map component. A small display model derives graph nodes/edges and resource labels from producer-owned platform and WharfKit types. The explorer owns selection/resource lifecycle; the diagram owns contract layout/lines; the map owns the responsive permission tree.

**Tech Stack:** Existing Vue 3, strict TypeScript, WharfKit, Lucide, product tokens, Playwright and Axe; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-10-contract-map-design.md`.

## Global Constraints

- Preserve existing Status tabs, API contracts, diagnostics, refresh behavior and deployment sequence guards.
- Preserve unrelated dirty auth/package files. Work inline on dev as requested; stage only task files.
- Only public read RPC calls; verify chain ID, use no credentials and discard stale reads.
- Keep 64-bit resource integers exact; label CPU in microseconds and NET/RAM in bytes.
- Native buttons, visible focus, at least 44px targets, reduced motion and readable nested rows.
- No permission edits, signing, dependency additions or production deployment.

## Review Focus

- A key shared by owner and active must not turn a child into root authority.
- Delegations, code authority, thresholds and unresolved external authorities must remain distinguishable.
- Zero, unlimited, failed and large resource values must not become misleading percentages or imprecise numbers.
- Refresh/deployment changes must not pair old resources with new contracts or reset useful selection.
- Contract names and tree rows must remain reachable at 320px, with keyboard and 200% text.

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

## Follow-up: contract diagram and unified account details

The user specifies a name-only connection diagram selecting one Contract Account Details panel. Move resources beside its tree, remove Tree/List toggles and duplicate authority blocks. Continue inline within the established implementation scope.

- [x] Add helper/browser regressions and observe RED for absent contract connection derivation and diagram/account-details regions.
- [x] Derive cross-contract delegation and matching RPC action links; aggregate each directed kind/account pair. Ignore self/external links and shared keys as dependency edges.
- [x] Replace reversible cards with native name buttons and responsive measured SVG arrows; preserve unconnected accounts and shared-authority highlights.
- [x] Move selected RAM/CPU/NET into Contract Account Details; retain release hashes, RPC validation, stale-read cancellation, retries and useful connection navigation.
- [x] Make the nested tree the only authority view; remove duplicate definitions and the empty inspector.
- [x] Complete task-only full checks, desktop/mobile Status regressions, screenshot review and actual public API/RPC read-back.
- [ ] Update evidence and commit/push only the correction's files.

Baseline: `953d268`; task-only archive `/data/daclify-runtime/contract-accounts-check-yzkqs_of`. Preserve concurrent passwordless/auth/package/vendor work and exclude it from build/commit. Initial helper tests fail because contractConnections is absent; the browser fails because Contract connections is absent. Ten focused desktop browser checks pass after implementation. A helper fixture copied a self-code authority under a different account, thereby creating a real cross-contract delegation; correct the no-link fixture to include only shared-key authorities. An unused type import was removed after Vue/type checking. No producer or RPC boundary changes.

Task-only qualification passes 196/196 units, 50/50 desktop/mobile Status/guide cases, lint, changed-file formatting and Vue/type/testnet build. Detected the independently deployed 0.12 frontend before publication; a separate current-version integration snapshot preserves that account work and passes 207/207 units and the build. Qualify its Status and existing account/device browser flows before publication. The UI commit will still exclude unrelated auth/package/vendor changes.

Final 0.12 integration qualification: 207/207 units and 56/56 desktop/mobile browser cases pass; build/type checks pass. Public read-back confirms ten names, five reported action connections, fifty-seven matched runtime chips, correct account switching and zero desktop/expanded/mobile Axe violations. All thirty loaded assets match the installed build. Original 0.12 deployment backed up at `/data/daclify-runtime/contract-accounts-before-20261010-175408`; kept old assets and replaced the index atomically with a concurrent-change guard. Inspected actual diagram/details screenshots. No production/backend/native-authority operation. Inline review found no outstanding important UI issue.

Final review adds explicit release-disclosure open-state assertions to the failed-refresh/recovery case; desktop/mobile rerun passes 2/2. No tested UI code changed after the full qualification or public read-back.

The independent account work was committed as `f015f75` on the shared dev branch during final delivery. This UI commit follows it and changes only the thirteen listed UI/test/guide/changelog files. Both the original baseline and integrated 0.12 build were verified as recorded above.
