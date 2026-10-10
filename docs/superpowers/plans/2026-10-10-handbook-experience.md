# Handbook experience implementation plan

Goal: Make guide discovery and reading clear on desktop and phones while preserving producer-owned content, generated references and honest deployment verification.

Scope: frontend `dev`, starting at fetched `ca7bf6b`. Use the existing Vue/router, native disclosures, design tokens and installed Lucide icons. No backend schemas, guides, credentials, contracts or dependencies change. Implement inline under the user's autonomous design brief and repository instructions.

Design: Keep six established guide groups. Overview uses collection cards without a duplicate sidebar. Search presents canonical titles/paragraph previews in the main area; URL query/collection state follows the Hub's router pattern so reload/back restores results. Reading uses a title-first article, breadcrumb, readable measure, grouped contents and previous/next guides within its category. Mobile contents defaults closed. Version notices remain before instructions; advanced references remain lazy and expandable. Failed module lookup offers retry; validate DAO identity and ignore late responses after context changes.

Alternatives: purely restyling the existing narrow layout retains mobile navigation before the article and weak search results. A new documentation engine or client-generated chapter structure adds machinery and invents content structure not present in the producer bundle. Refine the current catalogue and view instead.

## Tasks

- [x] Add canonical mock-only handbook fixtures and reproduce missing article hierarchy, mobile folding, useful search/back behavior and DAO-scoped retry.
- [x] Update `src/views/Docs.vue`: URL-backed search/filter, overview/result presentation, contextual links, native contents disclosure, reading typography, route focus and previous/next navigation. Preserve external sources, contract diagram, license links and lazy references.
- [x] Update the module-read boundary in `Docs.vue`: DAO/interface checks, current network/request sequence, explicit retry and invalid-reference feedback. Keep `src/help/catalog.ts` producer types and version checks authoritative.
- [x] Update `tests/e2e/documentation.spec.ts` for the changed overview/mobile presentation; make its HTTP fixtures self-contained. Extend `tests/e2e/handbook-experience.spec.ts` with actual code/version mismatches, wrong DAO, late responses, navigation, filters, sources, references, keyboard, layout and accessibility.
- [x] Run selected browser suites on an owned free port, inspect actual desktop/phone/tablet/landscape/320px/200% text screenshots; run verify, formatting and a fixed testnet build.
- [x] Review the final diff, update README/docs/changelog/requirements/evidence, increment frontend-only prerelease and commit/push `dev`.

Commands: `DACLIFY_TEST_UI_PORT=5360 npx playwright test tests/e2e/handbook-experience.spec.ts tests/e2e/documentation.spec.ts tests/e2e/docs-assistant.spec.ts tests/e2e/theme.spec.ts --config playwright.config.ts`; `npm run verify`; `npm run format:check`; `VITE_NETWORK=testnet VITE_API_TESTNET=https://testnet.api.daclify.com npm run build`.

Fixtures validate canonical HTTP responses and use current packed module manifests/code hashes. They establish browser behavior, not live API/provider availability or deployed contract correctness. Inspect source paragraphs unchanged; no HTML/Markdown renderer, arbitrary remote help or speculative caching is introduced.

Verification: frontend 0.10.0-alpha.5; 168 unit and 56 selected browser checks passed with type checking, lint, formatting and a fixed testnet build. [Evidence and limits](../../evidence/2026-10-10-handbook-experience.md). Delivery is frontend dev; backend repositories remain unchanged.
