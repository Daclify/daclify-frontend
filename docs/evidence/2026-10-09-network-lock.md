# Fixed deployment networks

Date: 9 October 2026. Branch: `dev`. The user approved explicitly fixing the testnet and production frontends to their intended networks.

`VITE_NETWORK=testnet` requires `VITE_API_TESTNET`; `VITE_NETWORK=production` requires `VITE_API_PRODUCTION`. The lock precedes saved browser choices, direct development overrides and legacy network files. Only the selected HTTPS origin is required. Unsupported lock values or missing origins reject startup. Existing unlocked local/dual-network behavior remains available.

The header shows a fixed network badge and hides the switch. Calling the old switch method also rejects. The common API client checks canonical `/v1/network` metadata: testnet expects `testnet`, production expects `mainnet`. Workspace screens remain unmounted until metadata succeeds. Wrong-environment services do not populate workspace identity/membership state. Independent-operator restoration checks central metadata before reading directory entries or contacting the operator. This checks reported metadata and existing operator pins; it is not a new cryptographic proof of the server's configuration.

## Verification

- Before implementation, all 11 added selection/validation/network-response unit cases failed. The new operator-restoration regression failed, and the selected browser regression failed because the fixed badge was absent.
- After implementation, `npm run verify` passed lint, Vue/TypeScript and 150 unit tests across 30 files. Formatting and the default build passed.
- `playwright.network-lock.config.ts` passed four desktop/mobile cases: fixed selection after reload, hidden switch and mismatched-service workspace/identity blocking.
- The existing `networks.spec.ts` passed four desktop/mobile cases for local proxy mode and legacy network switching/card-checkout navigation.
- Separate compiled testnet and production builds passed eight browser smoke scenarios across desktop/mobile and matching/mismatched API metadata. Matching cases retained their lock across reload and opened a deep route. Mismatched cases displayed an error without opening Create DAO or reading identity. Neither build called the other network's API or read the network file.
- Core generated-document checking passed after updating its runbooks. No protocol/module artifact changed.

All browser responses were synthetic fixtures served to owned loopback previews. No live provider login, charge, chain write or hosted deployment occurred. Backend/native/provider suites were not rerun for this frontend change. Environment edits require a new static build/upload; prior immutable release evidence does not qualify these new commits.
