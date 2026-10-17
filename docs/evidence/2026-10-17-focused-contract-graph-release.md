# Focused contract graph deployed to testnet — 17 October 2026

The user approved only the focused contract overview and then authorized making it live. Portal **0.15.0-alpha.71** activated at **15:22:17 UTC**. This is a frontend-only deployment; the running API process and smart contracts were unchanged.

## Source and scope

- Feature: `cf73069a284a390d1ecb9e817f2b29db5d3af4c8`.
- Deployed source, including release metadata: `0464a58af3e8d0042bcc473ebf62adc03a857182`.
- Sealed portal: `/data/daclify-runtime/releases/20261017-focused-contract-graph`.
- API and embedded workers remain on the existing review-fixes release: core/SDK50 and modules SDK63. MCP23 is unchanged.

The contract overview now provides labelled circular nodes, direct-connection focus, neighbor expansion/collapse, zoom, pan, Fit and browser-supported fullscreen. It consumes the existing relationship data and role labels. The entire existing account-details and permission-tree block remains byte-identical; no account, governance, financial, navigation or document behavior changed. See the [usage guide](../users/status-contracts.md).

The build uses `npm run build -- --mode testnet`. Package and lockfile metadata advance only the portal version. The immutable manifest verifies 2,461 files, including the source archive and 2,445 retained prior assets. The previous portal and Caddy configuration remain available for rollback. The only public server-configuration difference is its static root; the API was not stopped or restarted. Mainnet and Almaiso are excluded.

## Verification

Before deployment, the feature passed 467 default frontend tests, 26 desktop/mobile graph browser cases, strict Vue/TypeScript production build, formatting and scope checks. Red/green checks covered focus, narrow-screen crowding and reselecting the current account after Show all. The release's testnet build also passed.

The compiled candidate and then the public HTTPS portal passed graph checks at widths 1440 and 390, using actual testnet API/RPC data without provider fixtures. Checks cover account selection and details, focus, expansion/collapse, Show all, zoom, keyboard pan/reset, fullscreen, layout and accessibility. Public page errors and API 5xx responses were absent. The served HTML and its 33 entry/preload assets match the sealed hashes; cache and frame headers are preserved.

The broader `npm run test:testnet-public` check passed both desktop and mobile journeys, including account entry, navigation, Telos records, contract resources/permissions, fresh name quotes and Daclify DAO modules. Its initial mobile run used the old assumption that all contract buttons were always on screen. The follow-up smoke-tool change uses Fit and Show all before selecting accounts in the new canvas; no assertions or authorization checks were removed. That testing/evidence follow-up does not alter the deployed portal source.

Complete logs, hashes, screenshots, the configuration backup and activation/completion reports are retained under `/data/daclify-runtime/focused-contract-graph-20261017/deployment`. Public read checks did not perform email/wallet consent ceremonies or sign customer transactions. Chromium desktop/mobile viewport verification does not establish every physical browser's fullscreen support.
