# Account entry and Telos DAO navigation

Date: 11 October 2026. Frontend: `0.14.0-alpha.2`; pinned core protocol/API: `0.14.0-alpha.1`; modules SDK: `0.10.0-alpha.1`.

## Result

Account starts with three compact Login, New Account and Restore Account cards. Login opens Welcome back with Back. New Account opens New to Daclify? with Create with: and E-Mail, Telegram, Telos Zero and Own Keys immediately below the assisted-recovery checkbox. Restore Account opens the existing encrypted-kit ceremony. Desktop uses three initial cards in a row; narrow screens stack them and use two columns for creation buttons.

Telos DAO is directly below Daclify DAO in the sidebar and opens `/telos`. My DAO and Hub no longer contain the Telos governance shortcut. Network ballot history remains separate from ordinary Daclify DAO membership/governance.

## Preserved boundaries

- Email/Telegram require configured providers and explicit assisted-recovery consent. Their existing verification and same-key recovery ceremonies are reused.
- Telos Zero uses the existing producer-owned native signup purpose and Anchor account proof. It creates/reuses a wallet-only paired profile; original Daclify signing/document keys need a separate attachment or recovery flow.
- Own Keys uses the existing encrypted local vault, backup acknowledgment and saved-vault replacement safeguards.
- Pending signup, sign-in and wallet operations block Back and method switching. Child disposal invalidates late responses; a fresh guard runs after the native challenge read and before requesting its proof.
- Callback tickets resume New Account. The complete return destination remains attached to the route. Back and recovery cancellation return keyboard focus to the selected initial card.
- Authenticated account tabs, provider management, private-document access and encrypted-kit validation remain in their existing flows.

## Verification

- The new card/native/sidebar assertions were observed failing before implementation: two initial-card tests and two native/sidebar tests failed on missing controls/order.
- `npm run verify`: lint policy passed, Vue/TypeScript checks passed, 44 unit files / 280 tests passed. The final run used frontend `0.14.0-alpha.2`.
- The first broader browser run covered Account, catalogue navigation, fast sign-in, Telos governance and wallet recovery: 74 passed / 4 failed. All failures were older Names assertions (collapsed catalogue, a card label despite disabled card payments, and revised submitted-payment copy). Those assertions were corrected without changing Names behavior; the entire catalogue suite then passed 16/16 on desktop/mobile. Together these runs establish passing results for all 78 cases in the selected suites.
- Quick signup and assisted opt-out passed 16/16 on desktop/mobile against a separate owned loopback API/PostgreSQL fixture. This includes real Telegram HMAC and signed OIDC JWT verification, storage-outage retry, original-key access on a fresh browser and preservation of another account's saved vault. They do not qualify live Telegram, SMTP, external storage or Anchor clients.
- A testnet-mode candidate build passed. The served directory remained separate from the candidate output.
- Final review traced all Account/QuickSignup/native-panel callers, busy/disposal guards, saved-vault and recovery state, operator navigation and the exact requested labels. No new dependencies, API schemas, database migrations or contracts were needed. Unused availability emission and removed-card CSS were deleted.

Additional authenticated-caller checks passed for signed rename, module activation, original-key device transfer and keyboard forms on desktop/mobile (8 cases). Their first attempt incorrectly selected Login in fixtures that already had a session; those unnecessary test edits were removed. The monthly-consent caller initially failed its fixture's fixed port/audience check; binding the fixture to the actual page origin retained the application guard and both cases then passed. This establishes 104 distinct passing browser cases across the selected suites. An interrupted caller run is retained in private logs; it is not counted as passing.

Other native-fixture browser suites were updated to enter the new cards but were not rerun as part of this frontend-only change. No new live provider or native contract qualification is claimed. Actual public publication results are recorded below.

## Publication

Publication targets the existing authorized workspace testnet at `https://testnet.app.daclify.com`. Build from committed dev source, retain old hashed assets and install the new entry point last. The API and native contracts continue using their current rollout. The reproducible read-only public check is `npm run test:testnet-public`; it now covers all three account journeys, four creation methods, focus, Axe/viewport checks, My DAO separation and live Telos contract history in addition to its existing platform checks.

Decide signing pins remain unqualified, so the public Telos entry remains read-only. Actual Anchor approval and a mainnet vote have not been qualified by this frontend change. Recovery remains the existing same-VM testnet development mode.


### Deployed and checked

- Deployed frontend source: `e98990a177eab73775f432327a79c39b9a208c54` on dev, pushed to origin. The later documentation-only commit does not change the frontend bundle.
- `npm ci --ignore-scripts` from the committed standalone archive installed all dependencies successfully (0 reported vulnerabilities). The existing frontend rebuild helper then built in testnet mode and published successfully, retaining old hashed assets and replacing `index.html` last.
- Published index SHA-256: `7ec9cf19bf6c4697580b52afdf1fcbf2476233ca22d43040eb2ff3e02f2e2426`.
- `LD_LIBRARY_PATH=/data/daclify-runtime/browser-libs/usr/lib/x86_64-linux-gnu npm run test:testnet-public` passed against actual public HTTPS at 1440×1000 and 390×844. All three journeys, four buttons, consent gates, Back/Cancel focus, unchanged return destination, Telos menu order and My DAO separation were checked. Axe reported no violations and no horizontal overflow was found in the checked screens.
- Live testnet ballot history and the selected ballot `1cw3rwrjq2no` loaded from the actual API. The existing Status resource/permission and Daclify DAO checks also passed. Required API responses were JSON from the configured API origin; no page errors, misplaced API requests or server-error responses were recorded.
- Public Account/New Account/Telos screenshots and hashed logs are retained privately under `/data/daclify-runtime/releases/20261011-account-entry-telos-sidebar/` with the source archive and rollback index. The runtime smoke helper was also updated to enter Login/New Account explicitly.
- API was not restarted, and contracts, authority, balances, recovery qualification and provider configuration were not changed. The owned browser API fixture was stopped after verification.

## Later account card cleanup

Removed Account help from the page heading and moved Back into the top-right corner of both Login and New Account cards. Quick signup shows the assisted-recovery reason only when assisted signup is unavailable, removing the testnet development notice while preserving unavailable-service explanations and recovery consent.

- `npm run build`, `npm run lint`, formatting checks for both changed Vue files and `git diff --check` passed. The build retained its existing large-chunk warning.
- `npm test`: 44 files / 280 tests passed.
- `DACLIFY_TEST_UI_PORT=5258 LD_LIBRARY_PATH=/data/daclify-runtime/browser-libs/usr/lib/x86_64-linux-gnu npx playwright test tests/e2e/account-entry-experience.spec.ts --config playwright.config.ts --output .artifacts/account-card-browser`: 34 desktop/mobile cases passed, including recovery, enlarged text, pending-request controls and focus.
- Direct browser checks at 1280, 390 and 320 pixels verified Back's placement inside each card, removal of the requested copy, focus restoration, no horizontal overflow and no Axe violations. Unavailable-signup explanations remained visible. Desktop/mobile screenshots are retained under `/data/daclify-runtime/account-card-{1280,390}-20261011.png`.
- Initial browser attempts encountered a missing Chromium library path and then a shared development server shutdown; the complete passing run used the documented libraries and a separate owned server on port 5258. A temporary Axe check also needed an explicit browser context before succeeding.

No new repository tests, dependencies or backend changes were added for this presentation-only change.

### Account card cleanup publication

After the user requested the live update, committed frontend source `8bcab8e40253d7723bb888075fc6e13eb01b7a34` was archived into a separate release directory, installed with `npm ci --ignore-scripts` and published using the existing frontend rebuild helper in testnet mode. The public index matched the served index with SHA-256 `01b9bf7a93257e252ea94bdfa2be18650a3969f94611e4dff1d594f59eeb3bfc`. The previous index and hashed assets were retained.

- The committed `npm run test:testnet-public` check passed against public HTTPS at 1440×1000 and 390×844, including account journeys, Telos history, Hub, Status and Daclify DAO. No browser errors, misplaced API requests or server-error responses were found.
- Additional read-only public browser checks verified all three requested changes in Login and New Account: Account help absent, Back inside the top-right of the card, and the testnet development notice absent. Assisted signup remained available. Focus restoration, Axe and overflow checks passed on both viewports.
- Source archive, rollback index, public screenshots, build/check logs and their hashes are retained under `/data/daclify-runtime/releases/20261011-account-card-cleanup/`, with `release-manifest.json` recording the source and verification results. Publication did not restart the API or change contracts, provider configuration or account recovery.

## Restore and Cancel buttons

The recovery form now ends with equally sized Restore and Cancel buttons in a spaced, responsive row. Restore uses the existing amber primary style; Cancel uses the existing bordered secondary style. Submit validation, the pending state, saved-vault replacement consent and Cancel focus restoration retain their existing behavior. Browser callers and the public check use the new labels.

- `npm run build` passed with the existing large-chunk warning; formatting and diff checks passed.
- Eight existing desktop/mobile account-entry cases passed, including real key restoration with both the kit password and recovery code, cancellation and focus restoration.
- Browser layout checks at 1280, 390 and 320 pixels verified equal button dimensions, at least a 44-pixel height, a 12-pixel gap, no horizontal overflow and no Axe violations. Restore stayed disabled without a kit; Cancel returned focus to Restore Account and retained the return destination.
- No new dependencies or tests were added for this presentation change. The broader unit and native-workspace suites were not rerun; the affected recovery cases were run.

### Restore button publication

Committed source `85abf4fcd331c38081db14e551de3652d7bb4fdf` was archived, installed from its pinned lockfile and published in testnet mode using the existing frontend helper. Its public index matched the served index with SHA-256 `549e8d0f02cbefcfb324d1d082b775ce5116109cce8122a7f8ec87ba23419dfc`. Existing hashed assets and the prior index were retained. This publication did not restart the API or change contracts or recovery configuration.

The additional public recovery-button checks passed at 1440×1000 and 390×844: exact Restore/Cancel labels, equal dimensions, spacing, disabled Restore without a kit, Cancel focus restoration, Axe and overflow. The first broader public check failed a Telos election heading viewport assertion; the public index changed during verification, and rerunning the unchanged public check against the latest build passed on both viewports. No recovery-button failure occurred. Source, snapshots, build/check logs, their hashes and `release-manifest.json` are retained under `/data/daclify-runtime/releases/20261011-restore-cancel-buttons/`.

## Compact login method buttons

Login choices now contain one icon and only Passkey, Telegram, E-Mail, Telos Zero or Telos EVM. Telos Zero uses the existing library's anchor icon; Telos EVM uses its gem icon. Removed the secondary descriptions, trailing chevrons, unused description helper, description references and associated styles. The same distinct wallet icons appear in account settings. Selected provider forms still explain availability and keep their existing authentication and pending-request behavior.

- `npm run build`, lint policy, changed-file formatting and diff checks passed.
- Twenty-two existing desktop/mobile account-entry and fast-sign-in cases passed, covering provider selection, unavailable-provider explanations, configuration retry, Telegram widget cleanup and Mini App selection, email verification/session destinations, pending-wallet controls, authenticated management, full-access email sign-in and preservation of another saved vault.
- Direct browser checks at 1280, 390 and 320 pixels verified the exact five labels, one icon per button, distinct anchor/gem icons, compact heights with at least 44-pixel targets, E-Mail selection, no horizontal overflow and no Axe violations.
- Updated the existing account-entry, fast-sign-in, quick-signup and public-check callers to use E-Mail. No dependencies or new tests were added. The full unit, native and quick-signup fixture suites were not rerun.

### Compact login button publication

Committed source `9048aaa65902b326cfa2829600708537d5d60cf3` was archived and installed from its pinned lockfile, then published with the existing testnet frontend helper. Public and served indexes matched SHA-256 `9338ad922626fb0600fa083cd1b0fb080dd6d93159d1c41e5bf29bddb24f3cea`; previous assets and the rollback index were retained.

Both the standard public site check and the dedicated login-button check passed at 1440×1000 and 390×844. The latter verified all five exact labels, one icon each, distinct Telos icons, no secondary text or chevrons, compact accessible targets, E-Mail form selection and Back focus restoration. Axe and overflow checks passed without browser errors. Source, snapshots, logs, hashes and the release manifest are retained under `/data/daclify-runtime/releases/20261011-login-method-buttons/`. This frontend publication did not restart the API or change contracts, provider configuration or recovery behavior.
