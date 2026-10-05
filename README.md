# Daclify V2 Frontend

Private development repository for the Vue 3 and strict TypeScript application. The frontend owns accessible UI components, account onboarding/recovery, client signing and encryption, wallet integration, DAO/module screens and version-aware product help.

The selected stack is Vue 3, Vite, Vue Router and Pinia, without Quasar. The application consumes pinned public protocol/SDK artifacts from core and module producers. It does not define backend business rules, custody authority or duplicate API/ABI models.

Current status: incomplete development application. Walletless user-controlled accounts/recovery, shared DAO creation, JSON and public/private file documents, Decide ballots/finalization, Works workflows, fixed-term payroll, treasury exits, module controls and version-aware help are implemented. The service currently targets one configured runtime. Native-wallet/social/managed account journeys, independent-runtime discovery and later packages remain incomplete; core contract verification holds prevent production readiness.

The canonical [master plan](https://github.com/Daclify/daclify-backend-core/blob/main/docs/superpowers/plans/2026-10-05-daclify-v2-master-plan.md), [architecture](https://github.com/Daclify/daclify-backend-core/blob/main/docs/superpowers/specs/2026-10-05-daclify-v2-architecture.md) and [versioning, documentation, Pinata and test policy](https://github.com/Daclify/daclify-backend-core/blob/main/docs/superpowers/plans/2026-10-05-daclify-v2-release-docs-test-policy.md) live in the core repository. In the standard local layout, core is at `../daclify-backend-core/`.

Implement user guides and contextual help alongside each feature, matching the connected contract/module versions. Verify strict TypeScript and Vue templates, key/privacy boundaries, complete browser journeys, accessibility, supported Telegram clients and compatibility with producer releases. Actual commands and results will accompany the implemented tooling.

The user requests one continuous implementation session and reviews the complete code afterward. Internal tests and reviews continue throughout. Production deployment, authority changes and asset migration require separate express authorization after that review.
Daclify V2 — Vue and TypeScript frontend, account experience, and module interfaces

Start from three sibling checkouts with core’s [development bootstrap](https://github.com/Daclify/daclify-backend-core/blob/main/docs/development.md). Then run `npm run build`, `npm test`, and `npm run test:e2e` with the documented disposable local API, PostgreSQL and native-chain fixtures. Pinata fixtures are labelled and do not establish live provider availability.

The shared UI follows the supplied CIQ/MIQ operational visual system, adapted to
Daclify's dashboard and governance screens. See [visual foundations and checks](docs/ui/ciq-alignment.md)
for the source, palette, locally bundled fonts/icons and accessibility behavior.
`npm run test:e2e -- theme.spec.ts` checks the visual layer using read-only,
schema-validated fixtures; it does not require a running chain or API.
