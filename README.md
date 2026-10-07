# Daclify V2 frontend

Vue 3 application for account onboarding, DAO creation, governance, works, payroll, treasury, documents, and the hosted-service receipt. The stack is Vue 3, Vite, Vue Router, and Pinia. It does not use Quasar. It does not define contract rules, custody, or a second copy of the API schemas.

The screen consumes the packed protocol from [daclify-backend-core](https://github.com/Daclify/daclify-backend-core) and the packed module SDK from [daclify-backend-modules](https://github.com/Daclify/daclify-backend-modules). Check those out as siblings and follow core’s [development bootstrap](https://github.com/Daclify/daclify-backend-core/blob/main/docs/development.md) before `npm ci` here. Deploy names, Stripe, and the API origins are specified in core’s operations guide. Locally that file is `../daclify-backend-core/docs/operations.md`.

This is an incomplete development application. It is not a production launch.

DAO creation now offers community, NGO / grants, gaming guild, team / cooperative and custom presets, independently of human, mixed or guarded-agent participation. Policy and participant controls are in workspace settings; Works funding can require an executable member vote. Native guardian actions are prepared for external signing. See core's [authority and merge notes](../daclify-backend-core/docs/dao-presets.md).

## Screens

| Route                              | Screen                                                           |
| ---------------------------------- | ---------------------------------------------------------------- |
| `/`                                | Hub listing for the connected runtime                            |
| `/create`                          | Create a DAO on that runtime                                     |
| `/dao/:id` and `/dao/:id/:section` | Members, ballots, works, payroll, treasury, and documents        |
| `/account`                         | The signed-in account, recovery, and the service-payment receipt |
| `/docs` and `/docs/:topic`         | Versioned guides from the packed core and module bundles         |

The visual system and its checks are described in [docs/ui/ciq-alignment.md](docs/ui/ciq-alignment.md).

## Local and deployed API

Vite serves the dev build at `http://127.0.0.1:5178`. `public/networks.json` in this repository is `{ "mode": "local" }`. In that mode every API call is a relative `/v1` URL, and Vite proxies it to `http://127.0.0.1:3008`. The service-network switch is hidden. Start the core API before expecting those calls to succeed. The theme browser check does not need the API. Other browser checks do.

A deployed static server replaces `networks.json` with exactly two https origins:

```json
{
  "production": "https://api.example",
  "testnet": "https://testnet-api.example"
}
```

The switch then offers Production and Testnet. The choice is stored in `localStorage` at `daclify.network` and defaults to production. Each origin must be https, without a username, password, path, query, or hash. Both APIs must set `FRONTEND_ORIGIN` to this frontend’s origin, or the browser calls are rejected. Session cookies on those https APIs are `SameSite=None` so the cross-origin call can include them. CSRF tokens are stored per selected network.

Leave the committed `{ "mode": "local" }` file in the repository. If it is missing, Vite’s fallback can return `index.html` for `/networks.json` and the app will fail closed on an invalid document. `VITE_API_PRODUCTION` and `VITE_API_TESTNET` are a fallback only when `/networks.json` itself returns 404. See `.env.example`.

## Service payment

The account screen lists receipts from `GET /v1/billing/receipts` and can start `POST /v1/billing/checkout`. The button redirects only when the URL is `https://checkout.stripe.com`. The return query `billing=submitted` or `billing=cancelled` is a note. It is not a receipt. The receipt appears after the API accepts the Stripe webhook. A receipt does not change votes, permissions, withdrawals, or a DAO treasury. If the API has no Stripe configuration, the screen reports that card payment is not configured.

The amount is the Stripe Price configured on the API. This repository does not contain a price.

## Checks

Node 24.21 or later, and npm 11.19 or later.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run verify
npm run test:e2e
```

`npm run verify` runs lint, `vue-tsc`, and the unit tests. It does not run Playwright. `npm run test:e2e` starts Vite when port 5178 is free and reuses a server that is already running. The Playwright projects are desktop Chrome and a Pixel 7 viewport. Run the disposable core API and database first when the journey needs them. `theme.spec.ts` is the exception: it checks the visual layer with fixtures and does not need a chain.

Run `npx playwright test --config playwright.presets.config.ts` for the DAO purpose, participant and authority-rendering regressions. They mock HTTP responses and start their own Vite instance on port 5278 without reusing another session's server. They do not prove contract execution; core's isolated native/API suite covers that separately.

## Boundaries

The browser holds user-controlled signing and decryption keys. It does not receive Pinata credentials, the relay key, or the Stripe secret. Private documents are encrypted before upload. The guides inside the app come from the packed protocol bundles, so a guide edited in core appears here after that package is rebuilt and this repository reinstalls it. Live Google and Telegram redirects, a native-wallet journey, and discovery across more than one runtime are not qualified in this application.

## 0.5 account and module flows

Returning users can use paired email, Telegram, passkeys, Telos Zero or EOA wallets. Account pairing, DAO admission, governance authorization and private decryption are separate explicit steps. Workspace signing offers Daclify keys or an activated native/EOA wallet; private content still requires encryption keys. Provider availability follows service configuration.

Discovery uses v3 public summaries/raster branding and URL filters. Works offers contribution agreements and authored public service listings; Grants handles application consent, eligibility and award votes; Members handles optional endorsement admission; Decide offers representative terms/elections; Treasury provides complete JSON/CSV spending exports with honest coverage/reconciliation indicators. Module actions are checked against this client’s pinned SDK version/hash, and Documentation displays matching package versions and generated request/action/configuration references.

Use core’s [execution ledger](../daclify-backend-core/docs/evidence/2026-10-07-research-execution.md) and [0.5 upgrade runbook](../daclify-backend-core/docs/operations/upgrade-0.5.md). Local fixtures do not qualify real provider credentials, wallet clients, durable custody or production deployment.
