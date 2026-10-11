# Workspace testnet frontend

The continuing `/data` development server publishes `https://testnet.app.daclify.com`
through Caddy on port 9091. Its API is `https://testnet.api.daclify.com`, on port 9090.
Frontend public configuration comes from `.env.testnet`; API credentials remain separate.

The combined 11 October 2026 update now serves core/frontend `0.14.0-alpha.1` and modules SDK `0.10.0-alpha.1`, including the Telos entry, monthly module fees and compact platform controls. `/telos` reads testnet contract history; voting stays disabled until Decide signing pins are qualified. The actual public desktop/mobile checks and exact deployed source are recorded in [the workspace rollout evidence](../../daclify-backend-core/docs/evidence/2026-10-11-workspace-testnet-rollout.md). Recovery remains the same-VM development mode and its current qualification expires on 17 October at 14:46 UTC.

Caddy serves `/data/daclify-runtime/builds/frontend-testnet`, **not the repository's
`dist/` directory**. A normal `npm run build` uses production mode and may have no
testnet API configuration. Serving that output caused requests such as `/v1/network`
to reach the app's static server and receive HTML instead of API JSON.

`/data/daclify-runtime/bin/daclify-rebuild frontend` builds with `--mode testnet` into
a fresh staging directory under `/data/daclify-runtime/builds`. It copies the
completed files to `frontend-testnet`, retaining previous hashed assets for open
tabs, then renames the new `index.html` into place last. Failed builds leave the
published files alone. Ordinary builds and browser test builds use other directories.
Caddy's runtime configuration and the rebuild command must use the same published path.

After intentional frontend updates, run:

```sh
export PATH=/data/daclify-runtime/bin:$PATH
daclify-rebuild frontend
cd /data/daclify-frontend
LD_LIBRARY_PATH=/data/daclify-runtime/browser-libs/usr/lib/x86_64-linux-gnu npm run test:testnet-public
```

The read-only public browser check uses desktop and mobile viewports. It checks
the testnet lock despite a saved production preference, Hub data, Status, real
contract RAM/CPU/NET reads, contract selection and the Daclify DAO workspace.
It fails if API requests go to the app origin, required responses contain HTML,
browser errors occur or an API returns a server error. It uses the actual public
HTTPS routes without API fixtures. It does not sign transactions or qualify
login, payments, provider writes or an on-chain ownership migration.

To check build isolation, record the published `index.html` checksum, run ordinary
`npm run build`, then verify the published checksum is unchanged and rerun the
public browser check. Repository `dist/` may change; the served folder must not.

The expressly approved audit update was published on 2026-10-11 with core/frontend `0.13.0-alpha.3`, modules SDK `0.9.0-alpha.19`, upgraded runtime/Names, Hub hash refresh and Relay/Fees owner/active delegation to executive governance. Its strict Names response schema adds inventory cursors; the API now uses Relay `operator`. Both the standard public desktop/mobile check and additional live Relay/Fees permission/resource checks passed. See [irreversible transactions and rollout evidence](../../daclify-backend-core/docs/evidence/2026-10-11-project-audit-testnet-rollout.md) and [the cutover guide](../../daclify-backend-core/docs/operations/project-audit-remediation.md). Ordinary builds still require an explicit publication step.
