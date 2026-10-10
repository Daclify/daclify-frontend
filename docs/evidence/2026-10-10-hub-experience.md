# Hub experience — 10 October 2026

Frontend development release **0.10.0-alpha.2**, built on the latest fetched `dev` (starting commit `69e7634`). Core protocol **0.10.0-alpha.1**, modules SDK/help **0.9.0-alpha.8** and module contracts **0.9.0-alpha.5** remain unchanged. Scope is the Hub, its community cards and their tests/documentation. No API, blockchain, pricing, provider or custody changes.

## Audit and delivered behavior

| Priority | Finding | Delivered change |
| --- | --- | --- |
| High | Results excluded independent listings; whitespace searches behaved differently between sources. | Counts include unique complete DAO references from both sources; search normalization is consistent. Independent member counts remain unknown and are never invented. |
| High | Listing failures had no recovery action and shared error state with operator connections. | Loaded cards remain usable; Retry listings retries only the registry and restores focus to the results heading. Verification failures stay in the operator dialog. |
| High | Loading/failure and signed-out My communities could look like a genuinely empty Hub. | Distinct loading, failed-listing, guest sign-in, no-match, no-membership and empty-Hub states with useful next steps. |
| Medium — design judgment | Oversized summaries/covers, scattered controls and small metadata made discovery hard to scan. | Compact context, grouped browsing controls, smaller covers, readable titles/descriptions, purpose icons and useful identity/privacy/member details. |
| Medium | Dialog focus and close interactions were weak. | Focused review heading, native modal behavior, explicit destination/service separation, Escape/Cancel, disabled duplicate connection actions and opaque modal surface. |

Cards retain validated raster branding and recover from unavailable or undecodable imagery. Native cards have a full-card keyboard link; independent cards reserve interaction styling for their explicit actions. Unknown independent member statistics are not mixed into member sorting. External links disclose their destination and open separately with `noopener noreferrer`.

Filters retain URL query/hash bookmarks. Memberships still require an active match across chain, contract, DAO ID and interface version. Operator connections retain the existing registered-deployment verifier; a listing is not a security audit. The browser vault is not unlocked or copied merely by opening review.

`src/views/Hub.vue` owns the browser and its scoped layout; `src/components/DaoCard.vue` owns runtime cards and existing image lifecycle. Owned card rules are consolidated in `src/styles.css`; obsolete Hub strip/monogram rules are removed. Vue/Pinia, producer schemas, existing design tokens and installed Lucide icons are reused. No dependency or new configuration is added. README, changelog and the requirement/test map are updated.

## Verification

Run under Node **24.21.0** / npm **11.19.0**, with owned browser port **5358**; the user's app and private env files were left alone.

| Check | Actual result |
| --- | --- |
| Pre-change regressions | Three failures demonstrated combined-count, retry and guest-state defects (`.artifacts/hub-red.log`). |
| `npm run verify` | Passed: lint policy (5 checks), Vue templates/TypeScript and 168 unit tests across 33 files. |
| `npm run format:check` | Passed. |
| Testnet static build | Passed with `VITE_NETWORK=testnet VITE_API_TESTNET=https://testnet.api.daclify.com npm run build`. Existing large-chunk warning remains. |
| Hub + existing discovery/homepage/theme browser suites | 50 passed across desktop and mobile Chromium. |
| Axe/overflow checks | Zero reported violations in scanned states; no horizontal overflow at tested sizes, including enlarged text. This is not complete WCAG certification. |
| Visual inspection | Rendered desktop, phone, tablet, landscape, enlarged-text, empty-Hub and operator-review screenshots inspected; cramped enlarged filters and translucent dialog were corrected. |
| Final diff | Reviewed against callers, shared styles, membership helper, canonical responses and operator verifier; `git diff --check` passed. |

The preliminary integration pass was 46/48: the older directory test supplied an invalid authentication error and expected the old generic guest empty state. Its canonical fixture and expectation were corrected. An earlier duplicate `Network` icon/type import was corrected before final verification. Final runs have no failed or skipped selected tests.

Browser coverage includes both directory sources, trimmed search, purpose/member sorting, clear/reset focus, URL/hash preservation, guest return destination, full-reference membership isolation, registration deduplication, real raster decoding/fallback, independent destination/review/verification failure, retry, loading/failure/empty states, keyboard actions, 44px filter targets and reduced motion. Layouts are exercised at **1440×1100**, **375×812**, **768×1024**, **812×375**, plus the existing **320px** narrow-view regression. Each Hub layout also runs with **200% root text size**; this is text-resizing coverage, not every browser-zoom configuration.

```sh
DACLIFY_TEST_UI_PORT=5358 npx playwright test --config playwright.config.ts \
  tests/e2e/hub-experience.spec.ts tests/e2e/homepage.spec.ts \
  tests/e2e/theme.spec.ts tests/e2e/dao-directory.spec.ts
```

Local logs: `.artifacts/hub-verify-final.log`, `.artifacts/hub-browser-final.log`, `.artifacts/hub-build.log`, `.artifacts/hub-format.log`. Reproducible screenshots are under `.artifacts/browser/hub-experience-*`; artifacts are ignored rather than shipped as application assets.

## Boundaries and remaining recommendations

Synthetic canonical HTTP fixtures establish UI behavior, not public-testnet availability or a successful independent operator deployment. The original directory service error still requires backend/operator diagnosis if it persists; the Hub now reports it honestly and offers recovery. No production rollout, live chain/provider operation, Safari/Firefox qualification, physical-device/assistive-technology session or load benchmark was performed. Existing client/verifier unit tests ran, but hosted operator CORS/cookies remain an operational qualification task.

The Docs chunk remains above Vite's warning threshold. No bundle-speed improvement is claimed; measure loading on target devices before changing the broader app's chunking. Preserve the current dark brand instead of adding an unrequested theme or directory infrastructure.
