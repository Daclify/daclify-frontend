# Daclify V2 frontend

Vue 3 application for account onboarding, DAO creation, governance, works, payroll, treasury, documents, and the hosted-service receipt. The stack is Vue 3, Vite, Vue Router, and Pinia. It does not use Quasar. It does not define contract rules, custody, or a second copy of the API schemas.

The screen consumes the packed protocol from [daclify-backend-core](https://github.com/Daclify/daclify-backend-core) and the packed module SDK from [daclify-backend-modules](https://github.com/Daclify/daclify-backend-modules). Their versioned public packages are committed in [vendor](vendor/README.md), with integrity hashes in `package-lock.json`. A frontend-only checkout can run `npm ci` and build without backend checkouts or registry credentials. To change the SDKs, check out the producers as siblings and run core’s [development bootstrap](https://github.com/Daclify/daclify-backend-core/blob/dev/docs/development.md), then commit the refreshed packages and lockfiles. Deploy names, Stripe, and API origins are specified in core’s operations guide.

Development uses **`dev`**, with matching core/modules checkouts on `dev`. Feature branches start from `dev` and return there; `main` is updated only on an explicit release request. Follow the [Netlify dev deployment guide](docs/netlify-dev.md) for local builds, the testnet custom domain and backend settings.

Current development version: **0.9.0-alpha.1**, consuming matching core/module protocol, SDK and help packages. Shared creation is free for 10 active-member slots, with administrator-approved graduated monthly capacity above that. Independent contract/server and own-portal choices say Contact for pricing. Optional DAO Connect merchant payments and hosting are separate. Review [upgrade 0.8](../daclify-backend-core/docs/operations/upgrade-0.8.md) and [payment operations](../daclify-backend-core/docs/operations/connected-payments.md). Development checks do not establish live provider/client qualification.

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
| `/modules`                         | Illustrated module cards, search, details and DAO activation               |
| `/names`                           | Telos account name availability, prices and purchasing                     |
| `/marketplace`                     | Redirect to Modules; name-payment returns redirect to Names                |
| `/dao/:id` and `/dao/:id/:section` | Members, ballots, works, grants, payroll, treasury, settings and documents |
| `/account`                         | Sign-in methods, wallet bindings, encrypted vault/kit and payment receipts |
| `/docs` and `/docs/:topic`         | Versioned core/module product guides and references                        |
| `/status`                          | Safe configuration, capabilities and technical platform details            |

The visual system and its checks are described in [docs/ui/ciq-alignment.md](docs/ui/ciq-alignment.md).

## Install Daclify

The frontend is an installable, online-only PWA. Its manifest opens the DAO hub
in a standalone window and uses the existing Daclify mark for desktop, Android
and Apple home-screen icons. Install from the stable HTTPS app domain for your
network; testnet and production remain separate apps because they use different
origins.

- **Chrome / Edge on desktop:** Use the browser's install icon or app installation menu.
- **Chrome on Android:** Open the browser menu and choose Install app or Add to Home screen.
- **iPhone / iPad:** In Safari, use Share → Add to Home Screen.
- **Safari on Mac:** Use File → Add to Dock on supported macOS versions.

The browser controls installation availability and prompts. The app needs HTTPS
(localhost/loopback also works for development). Governance, payments and private
content still need an online connection. Installation adds no offline actions or
service-worker cache; a service worker is
[not required for installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).
Keep your recovery kit: installation does not back up vault keys, and browser/OS
app storage may differ from the browser tab's storage.

Run `npm run test:e2e:pwa` to build an isolated production bundle and check
Chromium's manifest parsing, installability and icon decoding on desktop/mobile.
This does not perform native OS installation or qualify Safari/iOS login and
wallet flows. Deploy the entire `dist` folder, including the manifest and icons,
with the existing SPA route fallback. No additional hosting configuration is
required for the current root-hosted Netlify app.

Each module card shows its purpose and usage price. **Details** opens an illustrated
module overview, its included tools, and a pricing/activation panel. Selecting a
tool shows its description while keeping the module name visible. **Contract
details** expands the on-chain listing and code hash. **Activate** lets you choose
a DAO where you are an active administrator, review compatibility and requested
permissions, unlock or connect your matching signer, and enable the module. Activation is a signed DAO action;
opening the dialog does not change the DAO. Already-enabled modules are marked
Enabled. Card styles use published SDK code hashes and known first-party titles
for older builds, so deployed contract account names can vary. Card artwork does
not establish compatibility; activation verifies the DAO deployment separately.

Run `DACLIFY_TEST_UI_PORT=5398 npx playwright test --config playwright.config.ts
tests/e2e/module-cards.spec.ts tests/e2e/catalogue-navigation.spec.ts` for the
isolated desktop/mobile card, dialog, signature, permission and navigation checks.
The HTTP fixtures do not establish live authorization or chain execution.

## Local and deployed API

Vite serves the dev build at `http://127.0.0.1:5178`. With no frontend API environment settings, `public/networks.json` keeps `{ "mode": "local" }`: API calls use relative `/v1` URLs, proxied to `http://127.0.0.1:3008`, and the service-network switch stays hidden. Start the core API before expecting those calls to succeed. The theme browser check does not need the API. Other browser checks do.

For a production static deployment, copy `.env.production.example` to the ignored `.env.production`, confirm the public HTTPS API origin, then build:

```dotenv
VITE_NETWORK=production
VITE_API_PRODUCTION=https://api.daclify.com
```

For the testnet frontend, set `VITE_NETWORK=testnet` and `VITE_API_TESTNET=https://testnet.api.daclify.com` in `.env.testnet`, then use `npm run build -- --mode testnet`. A fixed deployment requires only its matching API origin, ignores saved browser selections and the direct development override, and replaces the switch with a network badge. A mismatched API environment keeps workspace screens closed; production expects the API's `mainnet` environment. Current independent-operator registration checks must also match the fixed environment.

Every configured origin must be HTTPS without credentials, path, query or hash. The API must allow the actual frontend origin. Session cookies remain scoped to their API host and CSRF tokens to the network. Without `VITE_NETWORK`, configuring both origins retains the legacy Production/Testnet switch and saved browser choice, defaulting to Production; with all env settings absent, local proxy/file behavior remains available. Invalid lock values or missing matching origins fail closed. Leave the committed local-mode file unchanged. Vite embeds `VITE_*` settings during the build: rebuild/redeploy after edits, and never put secrets there. See [Vite environment setup](https://vite.dev/guide/env-and-mode).

To develop locally against a hosted testnet API without a deployment lock, leave `VITE_NETWORK` unset, set the development-only `VITE_API_ORIGIN` in `.env.testnet` and run `npm run dev -- --mode testnet`. This single HTTPS origin takes precedence during development and keeps CSRF storage separate. Optional `DACLIFY_TEST_HOST`, `DACLIFY_TEST_HTTPS_CERT` and `DACLIFY_TEST_HTTPS_KEY` support a local trusted HTTPS hostname. The API must explicitly allow that browser origin. Follow core's [same-site login setup](https://github.com/Daclify/daclify-backend-core/blob/dev/docs/development.md#local-frontend-with-a-hosted-testnet-api); HTTP localhost alone may lose cross-site login cookies.

Build and verify on the Mac. All three GitHub verification workflows are manual-only; pushing does not start them. Netlify can build the standalone frontend from `dev` using its public build environment settings, or accept a locally built `dist` with `netlify deploy --no-build --dir=dist --site=YOUR_NETLIFY_PROJECT_ID`. No output-file edit is needed. The committed `_redirects` supplies SPA routes. See the [Netlify dev guide](docs/netlify-dev.md) for both paths.

## Service payment

The account screen lists receipts from `GET /v1/billing/receipts` and can start `POST /v1/billing/checkout`. The button redirects only when the URL is `https://checkout.stripe.com`. The return query `billing=submitted` or `billing=cancelled` is a note. It is not a receipt. The receipt appears after the API accepts the Stripe webhook. A receipt does not change votes, permissions, withdrawals, or a DAO treasury. If the API has no Stripe configuration, the screen reports that card payment is not configured.

The amount is the Stripe Price configured on the API. This repository does not contain a price.

## Checks

`npx playwright test --config playwright.network-lock.config.ts` covers locked testnet selection, reload, the hidden switch and wrong-network workspace blocking on desktop/mobile with HTTP fixtures. It starts its own Vite server on 5308 and performs no live chain or payment operation.

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

## Executive governance

DAO governance settings show executive offices, paired native accounts, inactivity, pending handover and synchronized native quorum. The final paired controller can replace their wallet atomically; unlinking is disabled and enforced by the contracts. Initial owner transactions are downloaded for external owner/quorum signing, with explanatory in-app documentation.
