# Deploy the dev frontend on Netlify

Use a separate Netlify project for `https://testnet.app.daclify.com`. Build locally from `dev` and upload the prebuilt `dist` directory. This follows the chosen local-build workflow. The frontend currently consumes ignored tarballs from its two private sibling repositories; importing only the frontend repository into Netlify does not provide those dependencies.

`dev` selects source code; `VITE_NETWORK=testnet` selects and locks the deployed app's network. Saved Production choices are ignored, the network switch is hidden and only the testnet API setting is required. The app shows a Testnet badge and keeps workspace screens closed if the API reports another environment.

## Build on the Mac

Keep core, modules and frontend sibling checkouts on `dev`, using Node 24.21+ in Node 24 and npm 11.19+ in npm 11. For a fresh checkout, run core's `node tools/bootstrap.ts` first. When producer SDK/module source changes, rebuild and reinstall the affected packages through that bootstrap before building the frontend.

From `daclify-frontend`, set these public values in the ignored frontend `.env.testnet`, confirming the API address points at the intended service:

```dotenv
VITE_NETWORK=testnet
VITE_API_TESTNET=https://testnet.api.daclify.com
```

After updating the clean sibling checkouts:

```sh
git switch dev
git pull --ff-only origin dev
npm run verify
npm run build -- --mode testnet
```

The build embeds the locked network and its API origin; no `dist/networks.json` edit is needed. The lock takes precedence over direct development overrides, saved selections and the existing network file. Invalid lock values, missing selected origins and URLs containing HTTP, credentials, paths, queries or fragments are rejected. Leave tracked `public/networks.json` in local mode for development and older deployments.

For the separate mainnet project, use frontend `.env.production` with `VITE_NETWORK=production` and `VITE_API_PRODUCTION=https://api.daclify.com`, then run `npm run build`. Production expects the API to report `mainnet`. Restart a development server or rebuild/redeploy static files after env changes. Editing Netlify's environment settings after a local build does not modify the uploaded bundle. Never upload backend environment files or place provider secrets in `VITE_*` settings. Existing `dist/_redirects` provides the Vue route fallback. [Vite environment files and build modes](https://vite.dev/guide/env-and-mode).

## Create the separate project and domain

1. Log in to the intended Netlify team and create a project by uploading the **prebuilt `dist` folder** through [Netlify Drop](https://app.netlify.com/drop). Uploading an unbuilt project can start a cloud build. Keep this project separate from the future mainnet frontend and leave automatic Git builds unconfigured.
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

At the time this guide was written, the public testnet frontend and API were not yet deployed. Publishing static files alone cannot make login, payments or blockchain actions work.

## Update the deployment

Upload the new prebuilt `dist` folder in the project's Deploys page, or use an installed and authenticated Netlify CLI:

```sh
netlify login
netlify deploy --no-build --dir=dist --site=YOUR_DEV_PROJECT_ID --prod
```

Check the project ID carefully. `--prod` publishes the primary URL of **that project**, so the dedicated dev project stays on the testnet domain; this flag does not select mainnet. `--no-build` prevents the CLI from rebuilding the already prepared directory. Pushing `dev` to GitHub does not upload a manual Netlify deployment. [CLI deploy flags](https://cli.netlify.com/commands/deploy/).

After publishing, open `/account` and `/docs` directly, confirm the Testnet badge and absent switch, then check `/status` and browser network requests report the expected API/chain. Locked builds do not request `/networks.json`. Then qualify actual provider login, refresh, logout and payment returns on the custom domain. A draft URL needs separate API/provider authorization and is unsuitable as the default login origin.
