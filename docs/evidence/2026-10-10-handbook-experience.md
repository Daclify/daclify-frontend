# Handbook discovery and reading — 10 October 2026

Frontend development **0.10.0-alpha.5**, starting at fetched `dev` **ca7bf6b**. Core protocol **0.10.0-alpha.1**, modules SDK/help **0.9.0-alpha.8** and contracts **0.9.0-alpha.5** stay pinned. No producer content, API/schema, contracts, dependencies, credentials or environment files changed.

## Findings and delivered behavior

| Priority | Evidence or design judgment | Change |
| --- | --- | --- |
| High | The main article title followed release warnings; mobile topic navigation occupied space before reading. | Title-first article, breadcrumb and readable text. Native search/contents disclosures default closed for mobile reading. Version warnings remain before instructions. |
| High | DAO module response validation checked chain/runtime but not the requested DAO ID. | Reject a different DAO at the view boundary. The existing producer schema already rejects unsupported interface values; no second interface validator is needed. Retain sequence guards across DAO/network changes and unmount. |
| High | A failed module lookup had no focused retry. | Explicit deployment-check failure and Retry deployment check; the guide remains readable. Invalid DAO links do not send module requests. |
| Medium | Search results were small navigation links or collection links, without main-area previews; search/filter state was lost on reload. | Canonical title/first-paragraph previews in the main area, clear no-match/reset states, URL `q`/`collection` and back/reload restoration. Keep DAO/other query context. |
| Medium | Overview repeated collections in a sidebar and cards. | Keep six collection cards with native expandable guide lists; sidebar exists only for reading/unknown topics. Future guides still use the catalogue's More guides group. |
| Medium | Readers had no previous/next guide destinations or explicit focus after navigation. | Group-based previous/next links, selected-title focus and current-page navigation semantics. Search reset returns focus to its field. |
| Medium | A 200% text screenshot showed a narrow article even though it did not overflow. | A native CSS container query stacks contents/article when available space is insufficient. Paragraphs, headings, labels and references scale with text. |
| Medium | A core guide with DAO context queried unrelated modules; module failure appeared beside a valid core-version match. | Only module guides request module release data. Use the established eight `done` cursors to skip unrelated module history. Core/overview/search reads remain available without that service. |

Existing producer paragraphs remain unchanged, with plain Vue text rendering. Sources/review dates, the permission diagram, license links, version messages and generated ABI/API/configuration references remain available. References mount only on expansion and close when changing guide/search view. No new content engine, remote executable help, computed reading-time claim, caching or dependency was added.

## Actual verification

Node **24.21.0**, npm **11.19.0**. Owned browser/Vite port **5360**; the user's running local frontend and backend were left running. HTTP responses are synthetic and validated with producer schemas, except the deliberately malformed interface-response test.

| Check | Result |
| --- | --- |
| Initial regressions | Four failing tests reproduced missing reading title, folded contents, result previews/back state and lookup retry. |
| Core lookup regression | Failed because an unrelated module failure appeared on the core account guide; corrected lookup scope is covered by the final run. |
| `npm run verify` | Passed lint policy (5 checks), Vue/TypeScript and **168 unit tests** across 33 files. |
| `npm run format:check` | Passed. |
| Fixed testnet build | Passed; existing large-chunk warning remains. Docs bundle **513.79 kB**, gzip **74.89 kB**. No loading/performance improvement is claimed. |
| Final handbook/documentation/Daxi/theme browser integration | **56 passed** across desktop/mobile Chromium. No selected final tests failed or were skipped. Earlier run: **52 passed**, before the additional scope/interface cases. |
| Accessibility/layout | Zero Axe violations in scanned normal/enlarged states after awaiting the lazy-loaded page. No horizontal overflow at tested dimensions. This is not complete WCAG qualification. |
| Actual render review | Desktop, phone, tablet, landscape, 320px and 200% text; overview, selected guide and enlarged article screenshots inspected. |
| Final review | Connected routes, consumers, producer prose/schemas, DAO and stale-read checks, native disclosure/focus behavior, lazy references and final diff reviewed. `git diff --check` passed. Backend repositories are clean and unchanged. |

Coverage: full-text search, paragraph previews, collection filters, literal `all`, malicious text rendered as text, reset focus, query/hash/DAO preservation, back/reload, unknown/invalid links, keyboard disclosures, collapsed phone controls, title focus, group navigation, producer prose, lazy references, expanded canonical ABI vote fields, reviewed sources, diagram and license navigation, failed lookup/retry, actual module code/version mismatch, foreign chain/runtime/DAO, malformed interface data, and late response after synthetic SPA browser-history navigation. The history test preserves the mounted Docs instance; it is not a chain or operator test.

Earlier harness corrections: initial type checking found an unsafe string index into the test's hash fixture; it now validates the ID with the producer deployment schema. The first enlarged-text scan ran before the lazy page had a heading; the test now waits for the actual guide. An article-width assertion was initially placed in the late-response test, then moved to the enlarged-text layout test. The additional interface test initially tried to construct a canonical interface-2 response even though this protocol supports only interface 1; it now sends deliberately invalid HTTP to verify client rejection. An incorrect account-guide title expectation was corrected to the actual producer title. These failed runs are not counted as passing final qualification.

```sh
DACLIFY_TEST_UI_PORT=5360 npx playwright test \
  tests/e2e/handbook-experience.spec.ts tests/e2e/documentation.spec.ts \
  tests/e2e/docs-assistant.spec.ts tests/e2e/theme.spec.ts \
  --config playwright.config.ts
npm run verify
npm run format:check
VITE_NETWORK=testnet VITE_API_TESTNET=https://testnet.api.daclify.com npm run build
```

Ignored logs: `.artifacts/handbook-red.log`, `.artifacts/handbook-core-scope-red.log`, `.artifacts/handbook-integration-final.log`, `.artifacts/handbook-verify.log`, `.artifacts/handbook-format.log`, `.artifacts/handbook-build.log`. Screenshots regenerate under `.artifacts/browser/handbook-experience-*` and the earlier documentation suite's outputs.

## Limits and review

Live API/module deployment qualification, Daxi's real model/provider, Safari/Firefox, physical assistive technology and performance/load testing were not executed. Synthetic code hashes exercise the browser's verification handling, not actual deployed code. Core version matching still means the service-reported package; core contract code verification remains separate. No production deployment or main release occurred. Generated guide prose was not rewritten; deeper editorial restructuring belongs to the producers.
