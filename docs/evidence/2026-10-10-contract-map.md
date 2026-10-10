# Interactive contract map evidence

Date: 2026-10-10. Scope: frontend Status/Contracts only. Source baseline: frontend `dev` at `e589bda` plus this task's files. Core protocol `0.11.0-alpha.2`, modules `0.9.0-alpha.13`, WharfKit `4.0.2` in the task-only tested/deployed snapshot. No dependency, API, contract, authority or production change.

## Delivered behavior

The Contracts section now has browsable resource cards and selectable permission maps. Opening a card reveals its permission summary. Owner/active hierarchy, signing keys, delegated account permissions, code authority, waits, contributor weights and thresholds remain distinct. Selecting a contributor highlights matching permissions and related cards. The inspector lists observed connections and can follow a delegated permission when its contract definition was returned. Full hashes, pins, RAM snapshots and public authority records remain accessible.

Live account RAM/CPU/NET comes from the existing typed WharfKit API. Chain-ID and account-name checks precede acceptance. Requests omit credentials, time out, abort on context changes and reject late results. Resource figures retain 64-bit precision and have explicit unknown, unlimited, zero-capacity and over-capacity states. Failed resources leave the permission snapshot available with retry and labelled RAM fallback.

The map uses native buttons, labelled zoom, horizontal/vertical scrolling and a readable list alternative. Contract cards use arrow controls, touch scrolling and keyboard access. Motion respects reduced-motion preferences. Overview links directly to the explorer through its existing tab.

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
