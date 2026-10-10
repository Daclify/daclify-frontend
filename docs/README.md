# Frontend documentation

Current development application: **0.10.0-alpha.5**, consuming core **0.10.0-alpha.1** and modules **0.9.0-alpha.8** SDK/help packages. Development uses `dev`. See the [repository README](../README.md) for routes, local development, account recovery and test phases, and the [Netlify dev guide](netlify-dev.md) for the separate testnet site.

## Help inside the application

The app starts at `/` with a welcome page; DAO discovery is at `/hub`, and My DAO
opens `/hub?mine=1`. The brand returns to the welcome page. Previous root URLs
with Hub filters redirect with their query and hash preserved.

The [Hub experience](evidence/2026-10-10-hub-experience.md) groups its browsing controls, uses readable community cards and distinguishes loading, failed listings, no matches and sign-in requirements. Loaded runtime cards remain usable when independent listings fail. Counts include independent registrations without duplicating the runtime's full DAO references. Operator review explains service separation before connecting; external portals disclose their destination. No directory listing constitutes an operator security audit.

The [DAO workspace experience](evidence/2026-10-10-dao-workspace-experience.md) separates everyday work from setup. Overview offers real balances and installed tools, with readable access/privacy states and retry when tool discovery fails. Signing & wallets preserves authorization and decryption boundaries. Settings has Identity, Governance and Services; direct Governance bookmarks use `/dao/:id/settings?settings=governance`. Members, documents, treasury, module and executive controls reuse existing action panels. Read-only exploration never grants administrative or voting rights.

`/docs` is a guide index with six expandable collections: Getting started,
Members & governance, Modules & treasury, Costs & storage, Privacy & recovery,
and Operators & reference. The overview uses collection cards without a duplicate
sidebar. Future unassigned topics remain visible under More guides. Grouping is a
frontend presentation choice; content/types remain producer-owned.

The [handbook experience](evidence/2026-10-10-handbook-experience.md) gives reading
pages a title, breadcrumb, readable paragraph width and previous/next guides within
their group. Search and mobile contents are native disclosures. Full-text search
shows canonical paragraph previews in the main area; URL `q` and `collection`
preserve results on reload/back. Navigation retains DAO context. Reset focuses
search; selecting a guide focuses its title. Failed deployment checks offer retry,
and different-DAO/interface or late responses cannot supply a matching result.
Version warnings remain before instructions; generated references load on demand.

`/docs/:topic` renders producer-owned core/module bundles, searchable by topic and content. The intended hosted handbook is [app.daclify.com/docs](https://app.daclify.com/docs); the host must be deployed and configured separately. Contextual DAO links retain their DAO reference, and the handbook checks connected service/interface/module versions and code status. An unconnected guide or a displayed API package version is not deployed-contract verification.

The recovery explanation is `/docs/recovery`; accounts, providers, documents, treasury, deployments and platform administration each have their own topic. Module guides live in Documentation, rather than a duplicate Resources entry. `/status` shows safe capability/configuration indicators and expandable technical details; `/daclify` provides the platform DAO controls with actual authorization checks.

Edit product text in the owning backend repo's `docs/guides/topics.json`, regenerate its docs, rebuild the public development packages and reinstall consumers through core's sibling bootstrap. Do not hard-code a second copy of guides or API schemas here. Keep stable topic IDs so existing UI links continue to work. Core's [documentation index](https://github.com/Daclify/daclify-backend-core/blob/main/docs/README.md) explains generation and versioning.

## Presentation and recovery

The [account entry experience](evidence/2026-10-10-account-entry-experience.md) groups returning sign-in, user-controlled creation and recovery. Saved keys take precedence. Provider forms open on selection, email codes have retry/change-address steps and failed configuration lookup is distinct from an unavailable provider. Account-flow controls coordinate pending requests; Telegram embeds mount only when needed and clean up on exit. Mobile shortcuts retain the intended return destination. Provider sessions leave user-controlled keys locked; recovery still needs the original encrypted kit and separate credential. Managed signup remains unavailable until its backend is configured.

Daxi uses backend-configured models to answer Daclify, Telos and DAO education questions from reviewed guides, with helpful explanations and occasional light humour. Unrelated or unsupported requests remain outside scope. Telos/DAO guides show reviewed source links; these are versioned learning notes, not a live website crawl. `/docs/docs-assistant` explains its scope, provider privacy, limits and Telegram commands/replies. Status → AI Daxi Help shows public model names, knowledge version and configuration; the other Status tabs cover network/contracts/fees/services, without a migration listing. App AI needs no frontend provider key; group support additionally requires the API webhook and an approved-group allowlist. See the [operator runbook](../../daclify-backend-core/docs/operations/docs-assistant.md). A configured indicator is not a live-provider qualification. The UI keeps failed status requests distinct from missing configuration and renders responses as plain text with a validated topic link.

[Visual system](ui/ciq-alignment.md) documents the supplied CIQ/MIQ design source and Daclify adaptations. [Original visual plan](superpowers/plans/2026-10-05-ciq-visual-alignment.md) is a historical design record.

The browser owns user-controlled signing/decryption keys and keeps only encrypted local envelopes at rest. Provider sessions and wallet-only access do not unlock private content. Original-kit recovery, separate wallet approval, stale-account handling and creation gating are covered by unit/crypto and desktop/mobile recovery regressions. One user's kit never restores other members' keys. See core's [recovery runbook](https://github.com/Daclify/daclify-backend-core/blob/main/docs/disaster-recovery.md) for per-user requirements and lost social pairings.

## Verification and limits

`npm run verify` checks source lint, Vue templates/TypeScript and unit tests; `npm run build` creates the static app. Playwright is separate, with paid/research native fixture phases and explicit mock-only recovery/presentation selections described in the README. [Requirements](releases/requirements.json), [changelog](../CHANGELOG.md) and core's [recovery evidence](https://github.com/Daclify/daclify-backend-core/blob/main/docs/evidence/2026-10-07-wallet-recovery.md) record actual coverage.

Real provider consent, Google browser login, real Anchor/EVM client qualification, independent operator cookie/CORS qualification, durable managed custody and hosted backup/proxy operations remain open. A successful local build or a configured provider does not close those gates. Bundle loading still needs measurement on target browsers; this update makes no performance claim.

Resources includes administrator-approved ordinary-poll exports using existing hosting capacity. Saved progress survives reload, and verified bundles can be downloaded only after comparing their manifest with the separately displayed commitment. The decoder comes from the module producer. Store the bundle and expected commitment off the server; see [export operations](../../daclify-backend-core/docs/archive-exports.md). Exports exclude account keys/login pairings/original document files. Independent backup attestation, native anchors/pruning and historic browsing remain unfinished.

## Connected payments and hosting

See core [payment operations](../../daclify-backend-core/docs/operations/connected-payments.md) and app `/docs/shared-hosting`, `/docs/payments`, `/docs/independent-operators`. Independent API discovery now has issuer/code/ABI and current-registration checks; actual operator browser cookies and external providers still need qualification.

Resources → Archive now shows the configured encrypted backup option, exact manifest commitment and saved restore-verification receipt. Backup creation and reload are covered by desktop/mobile browser tests; native approval/pruning are not yet enabled. Operator key/path details never enter this UI.
