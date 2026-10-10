# Interactive contract map evidence

Date: 2026-10-10. Scope: frontend Status/Contracts only. Source baseline: frontend `dev` at `e589bda` plus this task's files. Core protocol `0.11.0-alpha.2`, modules `0.9.0-alpha.13`, WharfKit `4.0.2` in the task-only tested/deployed snapshot. No dependency, API, contract, authority or production change.

## Delivered behavior

The Contracts section now has browsable resource cards and selectable permission maps. Opening a card reveals its permission summary. Owner/active hierarchy, signing keys, delegated account permissions, code authority, waits, contributor weights and thresholds remain distinct. Selecting a contributor highlights matching permissions and related cards. The inspector lists observed connections and can follow a delegated permission when its contract definition was returned. Full hashes, pins, RAM snapshots and public authority records remain accessible.

Live account RAM/CPU/NET comes from the existing typed WharfKit API. Chain-ID and account-name checks precede acceptance. Requests omit credentials, time out, abort on context changes and reject late results. Resource figures retain 64-bit precision and have explicit unknown, unlimited, zero-capacity and over-capacity states. Failed resources leave the permission snapshot available with retry and labelled RAM fallback.

The current map uses a nested permission tree with native buttons and a readable list alternative; the screenshot follow-up below replaces the initial zoomable two-lane renderer. Contract cards use arrow controls, touch scrolling and keyboard access. Motion respects reduced-motion preferences. Overview links directly to the explorer through its existing tab.

## Verification

| Check | Actual result |
| --- | --- |
| Initial shared-tree unit baseline | 189/189 pass |
| Initial explorer regressions | 4 failures because the explorer did not exist; GREEN after implementation |
| Visible meter / related-card regressions | RED at zero meter width and absent related-card highlighting; GREEN after scoped layout/highlighting changes |
| Delegated-node distinction/following | RED because contributor and definition lacked distinct navigation; GREEN with labelled contributor and definition link |
| Model unit cases | 10/10 pass: unordered hierarchy, shared weights, code/delays, incomplete/cyclic graphs, large/unknown/unlimited/zero/over-limit resources |
| Lint and Vue/TypeScript checks | Pass in shared tree and task-only snapshot |
| Changed TypeScript/Vue/JSON formatting | Pass |
| Task-only full unit suite | 192/192 pass with `npm test -- --maxWorkers=4` |
| Browser regressions | 44/44 pass: 7 map, 13 existing Status and 2 permission-guide cases on desktop/mobile |
| Ordinary and testnet builds | Pass; existing Docs chunk above 500kB remains a warning |
| Captured public API metadata + actual browser RPC | All 10 contract resources read from `https://testnet.telos.caleos.io`; zero selected-map Axe violations |
| Public HTTPS frontend, actual API/RPC, no interception | Pass; API snapshot `2026-10-10T16:46:14.701Z`, 10 contracts, zero selected-map Axe violations, all 31 loaded assets match installed files |

Browser command:

```sh
LD_LIBRARY_PATH=/data/daclify-runtime/browser-libs/usr/lib/x86_64-linux-gnu \
DACLIFY_TEST_UI_PORT=5458 npx playwright test --config playwright.config.ts \
tests/e2e/status-map.spec.ts tests/e2e/status-tabs.spec.ts \
tests/e2e/contract-permissions.spec.ts --output .artifacts/contract-map-review
```

The fixture suite exercises real frontend components with canonical synthetic HTTP data. It verifies client behavior rather than actual transaction authorization. The separate public check loads the deployed app and its real API/RPC responses.

Screenshots were inspected at 320, 390, 768 and 1440px, plus 200% text. Selected map and card-back/list Axe checks use WCAG 2/2.1/2.2 A/AA tags. Physical screen readers and Telegram webviews were not tested.

## Concurrent work and resolved test conditions

The shared tree is also being edited for passwordless recovery and fast sign-in. `npm run verify` in that evolving tree reported 200 passes and one failure: `provider-session.test.ts` / `keeps the same unlocked vault when the provider account matches its signing key`. Its concurrently edited session function now also checks encryption-key identity. Those source/package/vendor/fixture changes were preserved and excluded from this task's deployment.

A task-only archive was assembled at `/data/daclify-runtime/contract-map-check-j8ffqo00` from committed dev plus this task's files. It installed the committed lockfile with `npm ci --ignore-scripts --no-audit --no-fund`. Its default full unit run timed out two existing vault recovery crypto cases under concurrent browser/build load. The complete suite passed with four workers, without altering test timeouts or cryptography. The guide-search regression also had a stale exact accessible-name assertion that excluded the existing preview paragraph; the assertion now accepts the guide title prefix. Guide behavior was unchanged.

## Testnet delivery

Built the task-only snapshot with the public settings `VITE_NETWORK=testnet` and `VITE_API_TESTNET=https://testnet.api.daclify.com`, using `npm run build -- --mode testnet --outDir .artifacts/contract-map-testnet-dist`.

Installed the checked files into the existing Caddy root `/data/daclify-frontend/dist`, copying assets first and replacing `index.html` last. Prior assets remain for open/cached tabs. Previous files are backed up at `/data/daclify-runtime/contract-map-before-20261010-164512`. No service restart, backend deployment, signing or authority action occurred.

Public review: [Status](https://testnet.app.daclify.com/status), then **Contracts** or **Explore contract map** in Overview.

Ignored artifacts in the frontend:

- `.artifacts/contract-map-public-desktop.png`, `.artifacts/contract-map-public-mobile.png` and `.artifacts/contract-map-public-report.json` — real public app checks.
- `.artifacts/contract-map-live-desktop.png`, `.artifacts/contract-map-live-mobile.png` and `.artifacts/contract-map-live-report.json` — task-only preview using captured metadata and actual browser RPC reads.
- `.artifacts/contract-map-review/` — synthetic browser screenshots/results.

## Review and limits

Self-review performed inline under the workspace's prohibition on delegation. Checked hierarchy semantics, contributor thresholds, public-data/request boundaries, exact resource arithmetic, context cancellation, retained disclosures, full diagnostics and keyboard/narrow layouts. No outstanding important finding.

The graph shows returned authority relationships, not a calculation of effective/transitive control or contract call dependencies. External accounts may be unexpanded; action links are absent from the platform status schema. RAM/CPU/NET are account totals shared by hosted DAOs. Resource snapshots are later than the displayed platform permission snapshot. Primary semantics were checked against [Antelope accounts and permissions](https://docs.antelope.io/docs/latest/protocol/accounts_and_permissions/) and the installed [WharfKit APIClient](https://wharfkit.com/docs/antelope/api-client).

Git delivery: implementation committed as `a0b51e0` and successfully pushed to `origin/dev`. This final ledger update is a separate documentation commit. The unrelated sign-in/recovery work remains unstaged by this task.

## Screenshot follow-up

Baseline: `08bf404` with the same committed producer packages. The user's reference shows nested owner/active/custom permission rows containing their keys and weights. Replaced the two-lane SVG renderer and zoom controls with semantic nested lists and responsive full-width rows. Each permission has a threshold badge and its own inline public keys, delegated permissions, code authority and waits. Selecting a repeated key still highlights every matching permission and related contract. The inspector remains below the tree, with compact connection columns. Resource cards and their read/cancel/precision behavior are preserved.

Optional linked-action chips consume the existing typed account read. A chip appears only if permission name, parent and full required authority match the canonical status permission. Missing/unreported or changed authority data produces no inferred chips. Wildcard display follows the [Leap maintainer explanation](https://github.com/AntelopeIO/leap/issues/613). The real runtime execctx reports 57 links; show three initially and expose the remainder in a native keyboard disclosure with bounded scrolling.

Regressions were observed failing before implementation: missing nested signer rows, missing hierarchy branches/action-link matching, and the fourth action in a long list always visible. The model now includes branch retention/grouping and mismatched threshold/parent/signer-weight checks.

Task-only verification archive: `/data/daclify-runtime/permission-tree-check-4fwyljsx`; npm ci installs the unchanged committed lockfile. No incomplete sign-in/recovery changes are included. The initial shared-tree typecheck showed an unrelated fast-sign-in.ts never-type error; the account prop typing introduced here was corrected separately.

Default verification under the shared VM's load: the four-worker unit run returned 192 passes and two 5-second timeouts in vault.test.ts (recovery code and vault password fresh-device re-encryption). A one-worker run returned 192 passes with 5-second timeouts in the vault-password case and private-archive-recovery.test.ts (decrypt original recovered kit and reject replaced keys/domain/ciphertext). The first browser run returned 45 passes and one 30-second timeout in status-tabs.spec.ts / all status sections fit small screens and enlarged text with accessible controls. That timeout occurred during the final tab checks, with no failed layout or Axe assertion. These source tests and runtime cryptography remain unchanged; verification uses larger command-line test budgets rather than changing code or weakening assertions. Final results and public read-back follow.

### Final follow-up verification

| Check | Actual result |
| --- | --- |
| Model unit cases | 12/12 pass |
| Full task-only unit suite | 194/194 pass, `npm test -- --maxWorkers=4 --testTimeout=15000`; no skipped cases or crypto changes |
| Lint / changed-file formatting | Pass |
| Vue/TypeScript and testnet build | Pass; existing Docs chunk-size warning retained |
| Complete desktop/mobile browser suite | 48/48 pass with a 60-second per-test budget; all assertion timeouts unchanged |
| Final wide-chip cosmetic adjustment | Responsive/keyboard/200%-text/Axe cases rerun on both projects: 2/2 pass; fresh build passes |
| Public HTTPS app + actual API/RPC, no interception | 10 contracts with checked resources, 57 reported/matched action links, zero Axe violations with the list closed and expanded |
| Public build identity | All 31 loaded assets match installed files byte-for-byte |

Final browser command:

```sh
LD_LIBRARY_PATH=/data/daclify-runtime/browser-libs/usr/lib/x86_64-linux-gnu \
DACLIFY_TEST_UI_PORT=5458 npx playwright test --config playwright.config.ts \
tests/e2e/status-map.spec.ts tests/e2e/status-tabs.spec.ts \
tests/e2e/contract-permissions.spec.ts --timeout=60000 \
--output .artifacts/permission-tree-final
```

The public API snapshot is `2026-10-10T17:27:52.593Z`; read-back completed `2026-10-10T17:28:02.860Z` (UTC). The native action disclosure was expanded from the keyboard and checked with Axe. Desktop/mobile screenshots were inspected, including full keys, parent connectors and long action lists. The final chip column accommodates full native account/action identifiers without a last-character wrap at ordinary desktop text size. Physical screen readers and Telegram webviews remain untested.

Installed the checked isolated build with assets first and atomic index replacement; prior assets remain available. Original frontend backup: `/data/daclify-runtime/permission-tree-before-20261010-172509`. No service/backend/native-authority operation occurred.

Ignored frontend artifacts: `.artifacts/permission-tree-public-tree.png`, `.artifacts/permission-tree-public-mobile-tree.png`, desktop/mobile full-page captures, `.artifacts/permission-tree-public-report.json`. Synthetic regressions and polish screenshots remain in the task-only archive's `.artifacts/permission-tree-final/` and `.artifacts/permission-tree-polish/`.

Inline review checked actual-parent grouping, cycle/orphan retention, per-permission signer weights and thresholds, matching-only RPC links, public resource/cancellation boundaries, native keyboard disclosures, full-key wrapping and preserved card/inspector navigation. No outstanding important finding. Concurrent auth/package/vendor/docs work, including its separate changelog entry, is preserved and excluded from this change's commit/build.

Follow-up implementation `d5121bc` is committed and pushed to `origin/dev`; the remote ref was verified. Only the tree files and its changelog section were included. The final ledger update follows separately without changing tested/deployed code.

## Contract diagram and unified account details correction

Baseline: `953d268`. The user explicitly replaces the card selector with a diagram containing contract names only and one selected **Contract Account Details** panel. That panel now holds RAM/CPU/NET, the nested tree and release hashes. Removed reversible card faces, Tree/List controls, the blank Follow the authority inspector and duplicate Public permission authorities disclosure. Contributor definitions remain in the tree; selecting one exposes only useful matching connections and delegated-definition navigation.

A small canonical display helper derives directed cross-contract permission delegations and action links that pass the existing full-authority/parent RPC match. It aggregates multiple actions per directed account pair, ignores self-links/external accounts and never turns shared keys into dependency edges. Shared keys instead highlight the relevant diagram names. The renderer uses native account buttons, reported-connection layers and measured SVG arrows, with ResizeObserver for responsive geometry. Existing RPC chain/account validation, credential omission, stale-read guards, precision, failure labels and retry are preserved.

Initial RED: two model cases failed because contractConnections was absent; the browser failed because Contract connections was absent. During GREEN, one unit fixture incorrectly copied a self-code authority into another account, creating a legitimate cross-contract delegation; the shared-key-only fixture was corrected. Vue/type checking identified an unused imported type, which was removed.

Task-only archive: `/data/daclify-runtime/contract-accounts-check-yzkqs_of`, installed from the unchanged committed 0.11.0-alpha.2 lockfile. All implementation/regression bytes match the archive. Results: 14/14 model cases, 196/196 full units, 5/5 lint policy cases, changed-file formatting, Vue/type checking and testnet build pass. The focused desktop browser run passes 10/10; the complete desktop/mobile Status and permission-guide run passes 50/50. Units use `--maxWorkers=4 --testTimeout=15000`; browser cases use `--timeout=60000`, consistent with the VM-load evidence above. Assertions, cryptography and configuration timeouts remain unchanged. Existing Docs chunk-size warning remains.

Before publishing, detected that another session updated the public frontend to 0.12.0-alpha.1 at 17:38:59 UTC. Do not replace it with the older task-only archive. A separate integration snapshot `/data/daclify-runtime/contract-accounts-integration-k48p6shz` captures the current 0.12 frontend plus this UI correction for compatibility/build/browser verification. The UI commit excludes the unrelated account/auth/package/vendor files. Integration verification: 207/207 full units pass with the same 15-second test budget; Vue/type checking and the 0.12 testnet build pass. Browser qualification covers the existing account/device flows as well as Status. Actual public read-back follows after the complete desktop/mobile run.

### Final correction qualification and read-back

| Check | Actual result |
| --- | --- |
| Task-only baseline units / Status+guide browsers | 196/196 units; 50/50 desktop/mobile browsers |
| Current 0.12 integration units | 207/207 pass, same 15-second budget |
| Current 0.12 integration browsers | 56/56 pass: Status/guide plus existing email/device recovery cases on both projects |
| Integration Vue/type/testnet build | Pass; existing documentation chunk-size warning remains |
| Public HTTPS, actual API/RPC | 10 contract names; 5 aggregated action-link arrows; no cross-account delegations reported in this snapshot; 57 matched runtime action chips |
| Public account selection | Keyboard selection switches resources/tree to daclifyworks; selection and mobile 200% text checks pass |
| Public Axe | Zero desktop, expanded-action and mobile violations |
| Public build identity | All 30 loaded assets match installed files byte-for-byte |

Public API snapshot: `2026-10-10T17:54:11.526Z`, API version `0.12.0-alpha.1`; read-back completed `2026-10-10T17:54:20.979Z` (UTC). No response interception, signing or account mutation was used in the public Status check. Existing account/device regressions use synthetic fixtures and do not qualify live wallet/provider cryptography.

The final browser command in `/data/daclify-runtime/contract-accounts-integration-k48p6shz`:

```sh
LD_LIBRARY_PATH=/data/daclify-runtime/browser-libs/usr/lib/x86_64-linux-gnu \
DACLIFY_TEST_UI_PORT=5468 npx playwright test \
tests/e2e/status-map.spec.ts tests/e2e/status-tabs.spec.ts \
tests/e2e/contract-permissions.spec.ts tests/e2e/fast-sign-in.spec.ts \
tests/e2e/device-recovery.spec.ts --timeout=60000 \
--output=.artifacts/contract-accounts-integration
```

Installed only the checked integration build, preserving the current 0.12 account feature instead of downgrading it. Copied assets first, kept prior hashed files and atomically replaced the index after checking that another session had not changed it. Verified every staged static file against the installed bytes. Backup: `/data/daclify-runtime/contract-accounts-before-20261010-175408`. No backend/service restart, production deployment or native-authority change occurred.

Inspected actual desktop diagram/details and mobile diagram screenshots. Ignored frontend artifacts: `.artifacts/contract-accounts-public-diagram.png`, `.artifacts/contract-accounts-public-details.png`, `.artifacts/contract-accounts-public-works.png`, mobile diagram/details captures and `.artifacts/contract-accounts-public-report.json`.

Inline review checked the user's final layout, directed/aggregated links, unconnected accounts, shared-key highlights, resource placement/precision/failure/cancellation, no duplicate authority definitions, delegated navigation, responsive measured geometry and keyboard focus. Strengthened the existing failed-refresh regression to explicitly check the Release details open state during pending, failed and recovered reads. Physical screen readers, Safari/Firefox and Telegram webviews remain untested. No outstanding important UI finding; concurrent auth/package/vendor/docs changes remain outside this UI commit.

After strengthening disclosure retention assertions, reran that regression on desktop/mobile: 2/2 pass. Changed test formatting passes; tested/deployed UI bytes are unchanged.

The independent account work was committed as `f015f75` on the shared dev branch during final delivery. This UI commit follows it and changes only the thirteen listed UI/test/guide/changelog files. Both the original baseline and integrated 0.12 build were verified as recorded above.

Git delivery: implementation `3032ed2` is committed and pushed to `origin/dev`; remote SHA `3032ed2180e3974db4d6db4bf81a477e43a6f198` was verified. The final documentation ledger follows separately. Application source matches the qualified 0.12 integration snapshot and the public entry page matches the installed checked build.
