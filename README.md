# Daclify V2 frontend

Vue 3 application for account onboarding, DAO creation, governance, works, payroll, treasury, documents, and the hosted-service receipt. The stack is Vue 3, Vite, Vue Router, and Pinia. It does not use Quasar. It does not define contract rules, custody, or a second copy of the API schemas.

The screen consumes the packed protocol from [daclify-backend-core](https://github.com/Daclify/daclify-backend-core) and the packed module SDK from [daclify-backend-modules](https://github.com/Daclify/daclify-backend-modules). Check those out as siblings and follow core’s [development bootstrap](https://github.com/Daclify/daclify-backend-core/blob/main/docs/development.md) before `npm ci` here. Deploy names, Stripe, and the API origins are specified in core’s operations guide. Locally that file is `../daclify-backend-core/docs/operations.md`.

Current development version: **0.8.0-alpha.1**, consuming matching core/module protocol, SDK and help packages. Shared creation is free for 10 active-member slots, with administrator-approved graduated monthly capacity above that. Independent contract/server and own-portal choices say Contact for pricing. Optional DAO Connect merchant payments and hosting are separate. Review [upgrade 0.8](../daclify-backend-core/docs/operations/upgrade-0.8.md) and [payment operations](../daclify-backend-core/docs/operations/connected-payments.md). Development checks do not establish live provider/client qualification.

The resource-billing-archives development branch includes exact native/card RAM consent, separate prepaid storage, whole-file retention priorities, verified Archive backups/approvals/manual batches, merged anchored history, public logo/cover upload and hosted-reference recovery after SQL loss. Uploading an image and signing its public card update are distinct. Recovery verifies ownership and bytes and restores no Stripe or social-login records. Recorded RAM allocations are visible; enforcement is in native qualification; Resources reports physical obligation and legacy-claim completion holds. Destructive retention and production pruning are disabled until migration, full restoration and provider/release qualification pass. Run `npm run test:e2e:resources` only against its owned local fixture.

DAO creation now offers community, NGO / grants, gaming guild, team / cooperative and custom presets, independently of human, mixed or guarded-agent participation. Policy and participant controls are in workspace settings; Works funding can require an executable member vote. Native guardian actions are prepared for external signing. See core's [authority and merge notes](../daclify-backend-core/docs/dao-presets.md).

## Screens

| Route                              | Screen                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------- |
| `/`                                | DAO hub for the configured runtime                                         |
| `/daclify`                         | Daclify DAO, platform fees and module catalogue administration             |
| `/create`                          | DAO setup, deployment/preset choices and free shared creation              |
| `/hosting?dao=…`                   | Approved monthly shared member capacity                                    |
| `/payments?dao=…`                  | DAO merchant setup, module-product payments and receipts                   |
| `/marketplace`                     | Modules, names and public service listings                                 |
| `/dao/:id` and `/dao/:id/:section` | Members, ballots, works, grants, payroll, treasury, settings and documents |
| `/account`                         | Sign-in methods, wallet bindings, encrypted vault/kit and payment receipts |
| `/docs` and `/docs/:topic`         | Versioned core/module product guides and references                        |
| `/status`                          | Safe configuration, capabilities and technical platform details            |

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

To develop locally against a hosted testnet API, set the development-only `VITE_API_ORIGIN` in `.env.testnet` and run `npm run dev -- --mode testnet`. This single HTTPS origin takes precedence during development and keeps CSRF storage separate. Optional `DACLIFY_TEST_HOST`, `DACLIFY_TEST_HTTPS_CERT` and `DACLIFY_TEST_HTTPS_KEY` support a local trusted HTTPS hostname. The API must explicitly allow that browser origin. Follow core's [same-site login setup](https://github.com/Daclify/daclify-backend-core/blob/main/docs/development.md#local-frontend-with-a-hosted-testnet-api); HTTP localhost alone may lose cross-site login cookies.

Build and verify on the Mac. All three GitHub verification workflows are manual-only; pushing does not start them. For Netlify, upload `dist` with `netlify deploy --no-build --dir=dist --site=YOUR_NETLIFY_PROJECT_ID`. Replace `dist/networks.json` with the actual deployed API origins first; development env overrides do not configure production bundles. The committed `_redirects` supplies SPA routes. Keep Netlify automatic Git builds stopped or unconfigured. See core's [manual deployment instructions](https://github.com/Daclify/daclify-backend-core/blob/main/docs/development.md#local-builds-and-manual-netlify-uploads).

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

`npm run verify` runs lint, `vue-tsc`, and the unit tests. It does not run Playwright. `npm run test:e2e` selects the explicitly labelled paid phase (`test:e2e:paid`, desktop Chrome/Pixel 7 journeys). Run `test:e2e:research` separately for the 8 native-evidence/report cases. Each phase checks the selected fixture bundle and actual API chain before testing; they cannot share one chain configuration. Vite starts on port 5178 when free or reuses the configured server. Set `DACLIFY_TEST_API_PORT` and `DACLIFY_TEST_UI_PORT` together for other local ports. Follow core’s 0.5 upgrade runbook when selecting the matching private fixture bundle and restarting the local API. Both phases must pass before recording browser qualification. `npx playwright test` retains the raw glob for explicit diagnostic selections. `theme.spec.ts` checks the visual layer with HTTP fixtures and can be selected directly without a chain.

Run `npx playwright test --config playwright.presets.config.ts` for the DAO purpose, participant and authority-rendering regressions. They mock HTTP responses and start their own Vite instance on port 5278 without reusing another session's server. They do not prove contract execution; core's isolated native/API suite covers that separately.

## Boundaries

The browser holds user-controlled signing and decryption keys. It does not receive Pinata credentials, the relay key, or the Stripe secret. Private documents are encrypted before upload. The guides inside the app come from the packed protocol bundles, so a guide edited in core appears here after that package is rebuilt and this repository reinstalls it. Live Google and Telegram redirects, a native-wallet journey, and discovery across more than one runtime are not qualified in this application.

## Accounts, recovery and module flows

Returning users can use configured paired email, Telegram, passkeys, Telos Zero or EOA wallets. Complete Google browser login remains unfinished. Account pairing, DAO admission, governance authorization and private decryption are separate explicit steps. Workspace signing offers Daclify keys or an activated native/EOA wallet; private content still requires encryption keys. Provider availability follows service configuration.

Discovery uses v3 public summaries/raster branding and URL filters. Works offers contribution agreements and authored public service listings; Grants handles application consent, eligibility and award votes; Members handles optional endorsement admission; Decide offers representative terms/elections; Treasury provides complete JSON/CSV spending exports with honest coverage/reconciliation indicators. Module actions are checked against this client’s pinned SDK version/hash, and Documentation displays matching package versions and generated request/action/configuration references.

After database loss, a currently bound supported blockchain wallet can reconstruct wallet-only service access to its existing member. Account clearly labels this state and Create DAO requires a proved vault before checkout. Restore the original encrypted kit with its separate recovery credential, then approve attachment with the wallet; this preserves the recovered service UUID. New vault keys are for new DAOs/content and cannot decrypt old grants or change the existing contract encryption identity.

One recovered administrator can manage the DAO; each other member needs their own current keys or bound wallet. A kit containing a rotated-out signing key does not regain governance by itself. Pairings live in PostgreSQL: a verified backup preserves them, otherwise each user pairs their methods again after recovery. Private documents additionally need original decryption keys and surviving grants/ciphertext. Follow [disaster recovery](https://github.com/Daclify/daclify-backend-core/blob/main/docs/disaster-recovery.md).

For the self-contained recovery browser regressions, use a free port and select the file explicitly:

```sh
DACLIFY_TEST_UI_PORT=5208 npx playwright test tests/e2e/wallet-recovery.spec.ts
```

These desktop/mobile tests use provider/HTTP fixtures and client cryptography. They do not qualify a real Anchor or EVM wallet client. See [frontend documentation](docs/README.md) for ownership, help routes and remaining limits.

Use core’s [execution ledger](../daclify-backend-core/docs/evidence/2026-10-07-research-execution.md) and [0.5 upgrade runbook](../daclify-backend-core/docs/operations/upgrade-0.5.md). Local fixtures do not qualify real provider credentials, wallet clients, durable custody or production deployment.

`npm run test:e2e:payments` starts an owned Vite server on 5218 and checks deployment choices and subscription consent on desktop/mobile with HTTP fixtures and axe. It performs no live Stripe or chain writes. Existing paid/research fixture suites require matching native/API releases; new shared-creation tests use the free path.

## Resources and recovery development branch

Resources shows exact DAO/payer counters, accepted once-only member-slot grants, identity/activity/completion allocations, permanent purchased capacity, native/card quotes and consent, prepaid pinned capacity and original grace deadlines. Resources reports the explicit on-chain growth guard. Recorded budgets alone do not guarantee every workflow has a physical completion hold. Cleanup is disabled by default and actual configuration is visible. See [RAM accounting](../daclify-backend-core/docs/ram-accounting.md) and [storage accounting](../daclify-backend-core/docs/storage-accounting.md).

Archive supports old document versions and ordinary-poll previews, explicit export consent, resumable exports, independent encrypted backup receipts, native availability, signed approval/revocation, manual pruning and anchored history without the old SQL index. Exact restoration verifies the original native row hash and consumes ordinary RAM; history reads do not repopulate the contract. Complete manifest/chunk groups count together in retention selection. Current/referenced rows stay live. Kits, social pairings and original file blobs are excluded from archive bundles; surviving original files remain separately pinned and billed.

Bounded hosted-reference recovery rebuilds verified pin ownership and bytes, never billing or missing files. Public card images need explicit public consent and separate signed publication; saved upload requests retry with the same ID after response loss/reload. Period-bound in-app reminders and optional configured email delivery are displayed separately.

The native encrypted-document drill pruned an old version, recreated its owned test database, reconstructed archive/file accounting, decrypted with the original kit, rejected a replacement kit and signed exact original-row restoration. The local quota/migration checks pass; complete supported-release/token qualification, actual gateway funding/access qualification and immutable 0.8 rollout remain unfinished. Live SMTP/Stripe/Pinata and production deployment remain separate gates. Use `npm run test:e2e:resources` with matching owned API/native/PostgreSQL fixtures; HTTP fixtures are not live-provider proof. See [execution evidence](../daclify-backend-core/docs/evidence/2026-10-08-resource-execution.md).

## License

First-party code, contracts, SDKs and documentation are licensed under
**AGPL-3.0-only**. See [LICENSE](LICENSE) and [licensing and source obligations](LICENSING.md).
Third-party files retain their own licenses. Contributions remain owned by their authors.

RAM totals are unavailable during an active legacy migration; the UI explains operator maintenance instead of displaying a partial total. Existing encrypted content, social pairings and signing keys are outside that migration. See [the core migration runbook](../daclify-backend-core/docs/operations/ram-migration.md).

Resources uses the actual deployment guard flag and producer-owned error messages. Missing legacy credentials, financial holds or module completion reserves are operator adoption issues; buying capacity alone cannot satisfy them. The operator must complete the documented adoption/qualification sequence before enabling a guard.


Treasury now separates receiving-wallet preparation from withdrawal authorization. Choose the receiving native account and use **Prepare receiving wallet** to fund its exact-token balance row, then sign the claim or stake exit. A missing/closed row leaves the transaction unchanged. Late treasury responses cannot cross DAO contexts. See the [native evidence and operating limits](../daclify-backend-core/docs/evidence/2026-10-09-receiving-wallet-ram.md).
