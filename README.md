# Daclify V2 Frontend

Private development repository for the Vue 3 and strict TypeScript application. The frontend owns accessible UI components, account onboarding/recovery, client signing and encryption, wallet integration, DAO/module screens and version-aware product help.

The selected stack is Vue 3, Vite, Vue Router and Pinia, without Quasar. The application consumes pinned public protocol/SDK artifacts from core and module producers. It does not define backend business rules, custody authority or duplicate API/ABI models.

Current status: repository setup and planning only. Application source, dependency manifests, build scripts and tests have not been implemented. No release or deployment is implied.

The canonical [master plan](https://github.com/Daclify/daclify-backend-core/blob/main/docs/superpowers/plans/2026-10-05-daclify-v2-master-plan.md), [architecture](https://github.com/Daclify/daclify-backend-core/blob/main/docs/superpowers/specs/2026-10-05-daclify-v2-architecture.md) and [versioning, documentation, Pinata and test policy](https://github.com/Daclify/daclify-backend-core/blob/main/docs/superpowers/plans/2026-10-05-daclify-v2-release-docs-test-policy.md) live in the core repository. In the standard local layout, core is at `../daclify-backend-core/`.

Implement user guides and contextual help alongside each feature, matching the connected contract/module versions. Verify strict TypeScript and Vue templates, key/privacy boundaries, complete browser journeys, accessibility, supported Telegram clients and compatibility with producer releases. Actual commands and results will accompany the implemented tooling.

The user requests one continuous implementation session and reviews the complete code afterward. Internal tests and reviews continue throughout. Production deployment, authority changes and asset migration require separate express authorization after that review.
Daclify V2 — Vue and TypeScript frontend, account experience, and module interfaces
