# Deploy the dev frontend on Netlify

Use a separate Netlify project for `https://testnet.app.daclify.com`. It can build the frontend directly from `dev`, or accept a locally built `dist` directory. The frontend includes the two versioned public SDK archives in [vendor](../vendor/README.md), pinned by `package-lock.json`; neither path needs backend checkouts or private registry credentials just to build the frontend. GitHub verification workflows remain manual-only.

`dev` selects source code; `VITE_NETWORK=testnet` selects and locks the deployed app's network. Saved Production choices are ignored, the network switch is hidden and only the testnet API setting is required. The app shows a Testnet badge and keeps workspace screens closed if the API reports another environment.

## Build from Git on Netlify

Connect the project to `Daclify/daclify-frontend` and set:

| Setting | Value |
| --- | --- |
| Production branch | `dev` |
| Base directory | Leave empty (repository root) |
| Build command | `npm run build -- --mode testnet` |
| Publish directory | `dist` |

For this dedicated testnet project, add these environment variables in Netlify with **Builds** scope for its deployment contexts:

```dotenv
VITE_NETWORK=testnet
VITE_API_TESTNET=https://testnet.api.daclify.com
```

Netlify's **Production branch** means the branch published at this project's primary URL; it does not mean the blockchain's mainnet. Here it is `dev` and the app is explicitly locked to testnet. `.nvmrc` selects Node 24.21.0; use npm 11.19+ in npm 11. Netlify installs npm dependencies before running the build command. The committed archives make that installation work without a sibling bootstrap. Do not run the backend bootstrap on Netlify or add backend secrets to this project. [Netlify dependency installation](https://docs.netlify.com/build/configure-builds/manage-dependencies/).

Save the settings and retry the latest `dev` deployment containing the `vendor/` packages. If the previous failed install was cached, clear the build cache when retrying. The old `ENOENT` for `../daclify-backend-*/.artifacts/*.tgz` is fixed by the repo-local package paths, not by a different build command. Public `VITE_*` settings are embedded during the build; changes require a new deployment.

For a separate mainnet project, select the explicitly released `main` branch, use `npm run build`, and configure `VITE_NETWORK=production` plus `VITE_API_PRODUCTION=https://api.daclify.com`. This does not authorize a mainnet release.

## Build on the Mac instead

Use Node 24.21+ in Node 24 and npm 11.19+ in npm 11. A frontend-only checkout can run `npm ci`. When producer SDK/module source changes, keep core, modules and frontend as matching sibling checkouts on `dev` and run core's `node tools/bootstrap.ts` to refresh frontend's tracked archives and lockfile. Commit those refreshed files with the affected producer changes before deploying from Git.

From `daclify-frontend`, set these public values in the ignored frontend `.env.testnet`, confirming the API address points at the intended service:

```dotenv
VITE_NETWORK=testnet
VITE_API_TESTNET=https://testnet.api.daclify.com
```

After updating the clean sibling checkouts:

```sh
git switch dev
git pull --ff-only origin dev
npm ci
npm run verify
npm run build -- --mode testnet
```

The build embeds the locked network and its API origin; no `dist/networks.json` edit is needed. The lock takes precedence over direct development overrides, saved selections and the existing network file. Invalid lock values, missing selected origins and URLs containing HTTP, credentials, paths, queries or fragments are rejected. Leave tracked `public/networks.json` in local mode for development and older deployments.

For the separate mainnet project, use frontend `.env.production` with `VITE_NETWORK=production` and `VITE_API_PRODUCTION=https://api.daclify.com`, then run `npm run build`. Production expects the API to report `mainnet`. Restart a development server or rebuild/redeploy static files after env changes. Editing Netlify's environment settings after a local build does not modify the uploaded bundle. Never upload backend environment files or place provider secrets in `VITE_*` settings. Existing `dist/_redirects` provides the Vue route fallback. [Vite environment files and build modes](https://vite.dev/guide/env-and-mode).

## Create the separate project and domain

1. Use the Git-connected testnet project above, or create a manual project by uploading the **prebuilt `dist` folder** through [Netlify Drop](https://app.netlify.com/drop). Keep this project separate from the future mainnet frontend. For manual-only deployments, leave Git builds unconfigured or stopped.
2. In the project's **Domain management**, add `testnet.app.daclify.com` and follow its DNS verification instructions. Keep DNS at Namecheap.
3. In Namecheap's Advanced DNS for `daclify.com`, create a CNAME with host `testnet.app` and target the exact assigned `YOUR_DEV_SITE.netlify.app` hostname shown by Netlify. Resolve any conflicting record for that same host. Do not change the API records to point at Netlify; those belong to the Hetzner server.
4. Wait for DNS verification and HTTPS certificate provisioning. Use the stable custom domain for login testing; the temporary `netlify.app` origin is cross-site with the API and may encounter browser cookie restrictions.

[Netlify manual uploads](https://docs.netlify.com/deploy/create-deploys/), [external DNS](https://docs.netlify.com/manage/domains/configure-domains/configure-external-dns/).

## Configure the testnet API

On the Hetzner **testnet** service, keep secrets in its private environment and set:

```dotenv
FRONTEND_ORIGIN=https://testnet.app.daclify.com
API_PUBLIC_ORIGIN=https://testnet.api.daclify.com
```

Restart that service after configuration changes. Register actual provider callbacks against the hosted API, including Telegram's `https://testnet.api.daclify.com/v1/sign-in/telegram/oidc/callback`. Google uses the actual frontend origin. See core's [paired-login runbook](../../daclify-backend-core/docs/operations/paired-login.md) and [payment runbook](../../daclify-backend-core/docs/operations/connected-payments.md); provider credentials belong to the API. Additional developer origins need the explicit API allowlist in core's [same-site local development instructions](../../daclify-backend-core/docs/development.md#local-frontend-with-a-hosted-testnet-api).

The frontend build does not deploy or verify the API. Publishing static files alone cannot make login, payments or blockchain actions work; the hosted API and provider callbacks must be ready separately.

## Update the deployment

For Git-connected projects, pushing `dev` triggers the configured Netlify build. That is independent of GitHub Actions. For a manual deployment, upload the new prebuilt `dist` folder in the project's Deploys page, or use an installed and authenticated Netlify CLI:

```sh
netlify login
netlify deploy --no-build --dir=dist --site=YOUR_DEV_PROJECT_ID --prod
```

Check the project ID carefully. `--prod` publishes the primary URL of **that project**, so the dedicated dev project stays on the testnet domain; this flag does not select mainnet. `--no-build` prevents the CLI from rebuilding the already prepared directory. Pushing `dev` to GitHub does not upload a manual Netlify deployment. [CLI deploy flags](https://cli.netlify.com/commands/deploy/).

After publishing, open `/account` and `/docs` directly, confirm the Testnet badge and absent switch, then check `/status` and browser network requests report the expected API/chain. Locked builds do not request `/networks.json`. Then qualify actual provider login, refresh, logout and payment returns on the custom domain. A draft URL needs separate API/provider authorization and is unsuitable as the default login origin.
