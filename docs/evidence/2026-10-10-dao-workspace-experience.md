# DAO workspace and configuration — 10 October 2026

Frontend development release **0.10.0-alpha.3**, starting from fetched `dev` **738906c**. Core protocol **0.10.0-alpha.1**, modules SDK/help **0.9.0-alpha.8** and module contracts **0.9.0-alpha.5** stay pinned. The backend repositories remain clean. No API/schema, contracts, fees, custody, provider configuration, environment files or dependencies changed.

## Findings and delivered experience

| Priority | Verified problem or design judgment | Delivered behavior |
| --- | --- | --- |
| High | Overview offered Decide and Works even when unavailable; module lookup failure was swallowed. | Task cards use actual installed/enabled modules. Paused modules remain discoverable for existing work. Unverified deployments disclose review requirements. Scoped retry reports failures without hiding Documents, Members or Treasury. |
| High | Configuration and daily work shared an undifferentiated navigation strip. | Workspace and DAO setup groups keep existing route links, with wrapping mobile navigation and 44px targets. Settings has bookmarkable Identity, Governance and Services sections. |
| High | Rename lacked an explicit active-admin/signability/busy guard and producer metadata validation. | Guard the submission, reject blank input before signing, validate canonical metadata and preserve description, preset/setup and branding. Avoid stale feedback after context change. Existing backend/contract authorization remains authoritative. |
| Medium | Signing controls occupied every workspace section with unclear access context. | Native Signing & wallets disclosure opens when an active member needs a signer. Readiness, visitor/member/admin/inactive roles and separate decryption requirements are explicit. Existing wallet pairing and last-controller safeguards remain in the existing component. |
| Medium | Overview relied on generic promotional copy and a blank guest credits metric. | Compact actual member/treasury statistics and everyday destination cards. Members see their real governance credits and claim/stake links. Reserved funds and non-withdrawable governance units are separately labelled; membership is not claimed to confer voting eligibility. |
| Medium | Settings combined identity, capacity, payments, governance and technical information. | Identity preserves name/card editing; Governance contains existing policies, executives and election/guardian controls; Services distinguishes hosting, resources and merchant payments. Technical identity/privacy/epoch records move to an expandable reference panel. |
| Medium | Public-image consent checkbox measured 710px wide due to an undefined class. | Reuse the existing `.checkbox` style and assert its width in both browser projects. Configuration headings/labels/help scale with root text size. |
| Medium | Unknown sections claimed module APIs were still being connected. | Truthful unavailable-section state with overview/module recovery links. |
| Medium | A valid long URL in the description caused horizontal scrolling at 320px. | Reuse the existing `.wrap` class; test long identities with the technical reference expanded. |

The overview does not request activity counts or invent open-ballot, project or wallet statistics. Module discovery uses the same manifest-only request cursors. User membership matches the canonical complete DAO reference; inactive records remain available for existing exits. Settings remains discoverable to visitors without granting mutation rights.

`Workspace.vue` owns DAO context, routes and availability; `WorkspaceOverview.vue` presents everyday read data; `DaoSettings.vue` composes configuration and the existing rename operation. Existing module, treasury, content, branding, governance, executive and platform-control panels keep their business rules. No new dependency or speculative infrastructure.

## Actual verification

Node **24.21.0**, npm **11.19.0**; isolated Vite/browser port **5358**. The existing local frontend was left running.

| Check | Result |
| --- | --- |
| Before-change regressions | Three failures reproduced unavailable-tool advertising, missing settings grouping and missing signer disclosure. |
| Checkbox regression | Failed with measured width **710px** before the class fix; passes after it. |
| `npm run verify` | Passed lint policy (5 checks), Vue/TypeScript and **168 unit tests** across 33 files. |
| `npm run format:check` | Passed. |
| Testnet static build | Passed with fixed testnet environment values. Existing large-chunk warning remains. |
| Final workspace + preset/executive/people/Hub/theme browser integration | **94 passed** across desktop and mobile Chromium, including the added long-identity regression. |
| Earlier workspace follow-up | **28 passed** after blank-name and configuration text-size refinements; the later final integration includes these cases. This is a follow-up, not 28 additional unique integration cases. |
| Accessibility/layout | Zero Axe violations in scanned states; no horizontal overflow at tested dimensions and 200% root text size. Native disclosure keyboard toggle checked. This is not complete WCAG qualification. |
| Visual inspection | Actual desktop, phone, tablet, landscape, enlarged-text configuration, locked signer and unlocked administrator identity screenshots inspected. |
| Final review | Connected calls, schema/signature path, stale reads, access guards, route callers, leaf panels, pinned packages and documentation reviewed; `git diff --check` passed. |

The signed rename test creates a disposable real encrypted vault, verifies the browser's login signature and governance instruction signature, and compares the exact ABI-encoded `setmeta` payload against canonical expected metadata. It checks blank-name blocking, once-only submission while pending, preserved metadata and refreshed identity. HTTP responses are synthetic: this does not establish native chain execution.

Other coverage includes paused/unverified tools, unavailable-tool retry, wrong-DAO module responses, late reads after switching DAOs, unsigned action gating, visitor/read-only configuration, inactive-member exits, foreign chain/contract/interface memberships, full sign-in return destinations, query/hash preservation, direct settings links, obsolete sections, long identity text, expanded technical references and responsive layouts. Existing executive tests still exercise last-paired-controller protection and unsigned quorum appointments; platform DAO navigation still reaches the same workspace.

Viewport checks: **1440×1100**, **375×812**, **768×1024**, **812×375** and **320×812**, with reduced motion. Configuration also runs at **200% root text size**. This measures text resizing, not every browser zoom or physical-device configuration.

```sh
DACLIFY_TEST_UI_PORT=5358 npx playwright test \
  tests/e2e/dao-workspace-experience.spec.ts tests/e2e/people-workspace.spec.ts \
  tests/e2e/dao-presets.spec.ts tests/e2e/executives.spec.ts \
  tests/e2e/hub-experience.spec.ts tests/e2e/theme.spec.ts \
  --config playwright.config.ts
npm run verify
npm run format:check
VITE_NETWORK=testnet VITE_API_TESTNET=https://testnet.api.daclify.com npm run build
```

Ignored local logs: `.artifacts/dao-workspace-red.log`, `.artifacts/dao-workspace-checkbox-red.log`, `.artifacts/dao-workspace-long-content-red.log`, `.artifacts/dao-workspace-integration-final.log`, `.artifacts/dao-workspace-browser-final.log`, `.artifacts/dao-workspace-verify-final.log`, `.artifacts/dao-workspace-format-final.log`, `.artifacts/dao-workspace-build-final.log`. Screenshots are reproducible under `.artifacts/browser/dao-workspace-experience-*`.

An initial expanded browser run was 11/14: its three test-harness problems were an incorrect accessible link name, uint64 decoding expectations and an accessibility scan before the route had loaded. Those were corrected before the passing integration/final runs. No selected final tests failed or were skipped.

## Limits

Live API availability, Anchor/EVM clients, provider consent/settlement, native account permissions, treasury exits and uploads were not executed. The native-backed `files.spec.ts` suite was not run without its owned fixture; its Identity route, selectors and surrounding upload/save code were inspected. Existing access-component unit checks ran. No production deployment, main release, real authority change or transfer occurred.

Safari/Firefox, physical assistive technology, load testing and bundle performance remain unqualified. The existing Docs chunk warning is retained; this change makes no performance claim. Further redesign of individual module action forms is outside this workspace/configuration change. Production operator/provider readiness still depends on the backend runbooks and qualification gates.
