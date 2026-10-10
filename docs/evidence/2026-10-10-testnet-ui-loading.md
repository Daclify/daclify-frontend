# Testnet UI data-loading regression — 10 October 2026

Verified through the public HTTPS app and API at approximately 21:25 UTC.

The served frontend had been replaced by an ordinary production-mode verification
build without testnet settings. Its `networks.json` selected local mode, so the
browser requested `/v1/network`, `/v1/daos` and Status from the static app origin.
Caddy returned its SPA HTML fallback with HTTP 200. The actual testnet API was
healthy: its network, DAO list, Hub directory and platform status all returned
HTTP 200 and passed the pinned public response schemas.

Rebuilt the frontend with `--mode testnet`. Moved Caddy's root from repository
`dist/` to `/data/daclify-runtime/builds/frontend-testnet`. The runtime rebuild
helper now builds in a fresh staging folder, copies completed files while retaining
previous hashed assets, and publishes `index.html` last. Previous configuration
and helper files are preserved in `/data/daclify-runtime/ui-loading-before-20261010`.
The API service, database and blockchain were not modified.

Added [a reusable public browser regression](../../tools/check-testnet-public.mjs),
available as `npm run test:testnet-public`, and [workspace publication instructions](../workspace-testnet.md).

| Check actually run                                                                  | Result                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public regression before restoration                                                | Failed: missing Testnet deployment badge; Hub showed zero communities and static-origin API requests returned HTML.                                                                                              |
| Public browser check after restoration and again after the rebuild helper published | Desktop 1440×1000 and mobile 390×844 passed. Real Hub discovery, Status, RAM/CPU/NET readings, contract selection and Daclify DAO workspace loaded; no misplaced API requests, page errors or API 5xx responses. |
| Ordinary `npm run build` after isolation                                            | Passed, including Vue type/template checks. Published `index.html` checksum remained unchanged; public browser check passed afterward.                                                                           |
| Failed rebuild using an invalid Node option                                         | Returned nonzero, left the published checksum unchanged and removed the staging directory.                                                                                                                       |
| `daclify-rebuild frontend`                                                          | Passed with testnet mode; published checksum matched the reviewed build.                                                                                                                                         |
| Frontend unit suite                                                                 | 38 files / 209 tests passed.                                                                                                                                                                                     |
| Frontend lint                                                                       | 5 checks passed.                                                                                                                                                                                                 |
| Changed-file formatting and diff checks                                             | Passed.                                                                                                                                                                                                          |
| Caddy configuration and serving                                                     | Configuration valid; public health endpoint 200, missing asset 404.                                                                                                                                              |

Existing Vite large-chunk warnings remain. These checks exercise unauthenticated
data reads, not login, payments, signing or ownership handover. No contract code
changed, so native contract suites were not rerun for this operational repair.
