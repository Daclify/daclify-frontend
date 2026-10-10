# Status experience — 10 October 2026

Frontend development **0.10.0-alpha.6**; core protocol **0.10.0-alpha.1**, module SDK **0.9.0-alpha.8** and module contracts **0.9.0-alpha.5** remain pinned. Status work began at clean `dev` **91bd794**. Concurrent Help changes were preserved, then included after their commits **b765ae9 / 18cc198**. No backend, API/schema, provider credentials, contracts, authority, fees or dependencies changed.

## Prioritized findings and changes

| Priority | Evidence | Result |
| --- | --- | --- |
| High | Refresh cleared all readings/tabs and waited for unrelated assistant metadata. | Independently settle platform and assistant results. Preserve readings, selection and disclosures on same-context refresh; label previous data after failure and offer retry. |
| High | Live RPC/database reads succeeded while rates were stale and integrations were unqualified. Database health was absent from the overview. | Separate chain identity, database, shared configuration and quote freshness. A wrong/missing chain cannot claim verified reads, usable shared setup or current rates. No aggregate provider-health claim. |
| Medium | Native disabled Refresh lost keyboard focus. | Keep the button focusable with `aria-disabled` and guard duplicate requests in the handler. Maintain sequence guards on unmount and clear data on network/runtime/RPC/environment changes. |
| Medium | Contracts claimed runtime/hub lacked release pins despite a real runtime pin; an empty contract list had no recovery explanation. | Show actual per-account release status, unknown reads and explicit empty diagnostics; retain hashes, RAM and every public authority. |
| Medium | Screenshot/design judgment: large prose panels and small wrapped tabs obscured scanning. | Four check cards, grouped overview, compact service cards, 44px tabs, responsive grid and readable enlarged text. Native disclosures retain deployment/gateway explanations. |

All six tabs, existing fee values, operator limitations, exact gateway counters, service limits and Daxi metadata/help remain available. Services distinguish configuration from live qualification; local fixtures remain explicitly labelled. Missing Telegram metadata is unknown rather than inferred as disabled. Quote cards distinguish missing observations from stale/current rates. No new imagery, dependencies, polling or provider checks were introduced.

## Actual verification

- Four initial regressions failed against the original page: lost refresh context, delayed Daxi blocking platform readings, absent chain/database verification states and initial-failure recovery. An intermediate run exposed native-disabled focus loss. The new rate distinction also failed before implementation. Final covered behavior passes.
- Isolated Status snapshot: `npm run verify` passed lint, Vue templates/strict TypeScript and **168 unit tests / 33 files**. Formatting and the testnet build passed. **42 desktop/mobile browser cases** passed across Status, Daxi and theme.
- Final combined snapshot includes the committed Help work: verify again passed **168 / 33**, formatting passed and `npm run build -- --mode testnet` passed. **56 desktop/mobile browser cases** passed across Status, existing assistant tests, new Help tests and theme. A strengthened database-card assertion was then rerun on both projects: **2 passed**; these repeat an existing scenario rather than adding distinct cases.
- Browser coverage includes partial/initial/refresh errors and recovery, selected-tab/disclosure/focus retention, delayed assistant metadata, same-chain runtime change with a late response, mismatched/missing chain, missing contracts/services, exact uint64 gateway counters above JavaScript's safe integer limit, allowance states, keyboard arrows/Home/End, all six sections, reduced motion, 320/390/768/1440px widths and 200% root text. Inter font loading is asserted. Selected WCAG 2/2.1/2.2 AA Axe scans reported no violations.
- Reviewed desktop/phone/tablet screenshots using actual public status data, plus enlarged-text and narrow screenshots from the browser suites. Review was performed inline as required by workspace instructions; no independent reviewer was delegated.
- First snapshot browser run used symlinked dependencies, which prevented Vite from serving Inter. It had **39 passes / 1 existing Daxi mobile reload timing failure** and is not the final visual qualification. A local dependency copy fixed the font harness; later 42-case and combined 56-case runs passed. The first standalone public Axe attempt used Playwright's convenience `browser.newPage()` and failed; explicit `browser.newContext()` corrected the harness and the complete public checks below passed.
- The existing handbook chunk warning remains: approximately **514 kB minified / 75 kB gzip**. No loading, bundle-size or performance improvement is claimed.

```sh
npm run verify
npm run format:check
npm run build -- --mode testnet
DACLIFY_TEST_UI_PORT=5364 npx playwright test \
  tests/e2e/status-tabs.spec.ts tests/e2e/docs-assistant.spec.ts \
  tests/e2e/help-experience.spec.ts tests/e2e/theme.spec.ts \
  --config playwright.config.ts
```

Checks used Node 24.21.0 and the server's Playwright browser libraries. The isolated checked snapshot/logs/screenshots are under `/data/daclify-runtime/status-review.O8pyJq`; they are not committed. The existing requirement register already owns `tests/e2e/status-tabs.spec.ts`.

## Testnet delivery

Published **92 checked files** to the existing Caddy frontend on **9091**. Assets were copied before atomically replacing the HTML entry; older hashed assets remain available for open tabs. The build uses the supplied frontend-only testnet environment and preserves the committed Help work.

Real public HTTPS checks against **https://testnet.app.daclify.com/status**, without API interception, passed on desktop and phone through the external HAProxy. Saved production preference cannot override the Testnet deployment. The real chain/database cards read Reachable. All six sections pass selected Axe and width checks; refresh preserves the selected Contracts tab, expanded authorities and keyboard focus. Open Daxi Help works without submitting a question. **28 loaded public assets** match the checked build byte-for-byte; no browser errors or HTTP 5xx were observed. API/frontend/PostgreSQL user services are active. A bundle scan checked **12 configured credential values** and found zero matches.

Implementation is committed locally on `dev` as **65649cb**. `git push origin dev` failed because the server could not obtain GitHub credentials (`could not read Username ... No such device or address`). GitHub publication requires write authentication. The deployment is testnet; no production/main release occurred.

## Remaining limits

HTTP fixtures verify frontend behavior, not model/provider availability, payment settlement or native signing. Public checks verify real read-only API access and routing, not integration qualification. Safari/Firefox, physical screen readers and provider/load testing were not run. Full WCAG conformance is not claimed. Existing core contract-build/documentation qualification is outside this UI patch.
