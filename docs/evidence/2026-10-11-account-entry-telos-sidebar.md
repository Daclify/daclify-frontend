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
