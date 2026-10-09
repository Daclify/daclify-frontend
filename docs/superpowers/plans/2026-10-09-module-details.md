# Module details redesign

Execute inline on `dev`, following the repository's continuous-session workflow.

**Goal:** Give every module a polished, readable detail view that matches the
library and makes its tools, price and DAO activation easy to understand.

**Design:** Replace the generic enclosing panel with a module-colored illustrated
hero, a tools/content column and a pricing/activation side panel. Retain the module
name as the page heading when selecting a tool; show the selected tool below its
selector. Move chain identifiers and the full code hash into a native disclosure.
Stack the layout on mobile and keep keyboard focus and readable contrast.

**Scope:** `src/views/Modules.vue` and its scoped styles, browser regressions in
`tests/e2e/module-cards.spec.ts`, the affected native catalogue journey in
`tests/e2e/marketplace.spec.ts`, README and the requirement register. Reuse existing
presentation data, icons, fees, signing and activation. No API, schema, dependency
or authority changes; no new module capabilities or compatibility claims.

## Ledger

- [x] Inspect current UI, styles, canonical listing data and affected tests.
- [x] Add and run failing detail-view browser regressions.
- [x] Implement illustrated headers, tool selection, activation panels and disclosure.
- [x] Verify all five modules and third-party fallback on desktop/mobile; review screenshots.
- [x] Run lint/type/unit/build/format checks and review the final diff.
- [x] Refresh the local public-data preview, commit and push `dev`.

## Verification

Verification on Node 24.21.0/npm 11.19.0:

- The new detail regression initially failed because the module lacked its own
  page heading. After implementation, `module-cards.spec.ts` passed all 18
  desktop/mobile Chromium cases, including tool keyboard selection, preserved
  search, third-party details and activation from the detail view.
- `catalogue-navigation.spec.ts` passed all 14 cases: 32 distinct browser cases
  passed in total. The all-module detail case was rerun after screenshot polish;
  both projects passed on the final styles. Axe scans reported no violations for
  all five module detail views, including expanded contract information.
- `npm run verify` passed lint policy, strict Vue/TypeScript and all 155 unit tests
  across 32 files. `npm run build` passed, including after the final style change.
- Scoped Prettier checks and `git diff --check` passed. Reviewed screenshots for
  every module, long titles and mobile layouts; single-tool cards fill the content
  width. Final screenshots are in ignored `.artifacts/module-detail-review/`.
- Reviewed the final diff and confirmed the redesigned Decide page is visible
  in the running public-data preview at `http://127.0.0.1:5198/modules`.

Browser HTTP fixtures verify the UI and signing request only; they do not
establish live chain execution. The native fixture marketplace journey was
updated but not run; Safari/Firefox remain unverified. The existing local preview
reads public testnet data and cannot sign in or activate a module. No backend,
schema, dependencies, signing rules, credentials or authority changes were made.
