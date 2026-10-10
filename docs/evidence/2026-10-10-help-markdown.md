# Daxi answer formatting — 2026-10-10

## Problem and change

The assistant interpolated its entire response into a paragraph, so Markdown emphasis, bullets and source links appeared literally. Assistant replies now use `HelpAnswer.vue` and `formatHelpAnswer` to render Markdown. User questions remain escaped plain text. Stored replies keep their original text and gain formatting on reload; API and history schemas are unchanged.

Use pinned `markdown-it` 15.0.2 rather than implementing a partial Markdown parser. Raw HTML is escaped, embedded images become escaped alternative text, and link destinations require HTTPS without credentials. External links use `target="_blank"` and `rel="noopener noreferrer"`. Formatting styles cover paragraphs, emphasis, headings, lists, quotes, code and tables; long code/table content scrolls. Scope the small amber author-label style to direct children so emphasis inside an answer retains the prose style.

The parser adds seven installed packages. The final app entry is 146.33 kB minified / 59.21 kB gzip, compared with approximately 48 kB / 18 kB before adding the parser. The existing handbook chunk warning remains (513.79 kB / 74.89 kB gzip). No performance improvement is claimed. `npm install --save-exact --ignore-scripts markdown-it@15.0.2` reported zero vulnerabilities. Parser behavior was checked against installed source/types and the [primary usage documentation](https://markdown-it.github.io/markdown-it/documents/Usage_examples.html).

## Verification

- A browser regression first failed against the old UI because the answer heading was absent.
- `npm run verify`: exit 0; lint, strict TypeScript/Vue templates and **34 unit files / 179 tests passed**. Formatter cases cover emphasis, lists, code escaping, unsafe schemes, credentials, raw HTML, embedded resources and link attributes.
- `DACLIFY_TEST_UI_PORT=5199 LD_LIBRARY_PATH=/data/daclify-runtime/browser-libs/usr/lib/x86_64-linux-gnu npx playwright test tests/e2e/docs-assistant.spec.ts tests/e2e/help-experience.spec.ts tests/e2e/people-workspace.spec.ts --grep 'formats Markdown|handbook assistant|Daxi answers|starter questions|failed answer|availability failures|clearing needs|window, composer|long answers|restored history|Help can be moved' --output=.artifacts/browser/help-markdown-final`: **24 passed**, exit 0, on desktop and mobile Chromium. This broad run preceded the final restoration of bare-URL autolinking.
- After restoring autolinking, reran the entire assistant suite: `DACLIFY_TEST_UI_PORT=5199 LD_LIBRARY_PATH=/data/daclify-runtime/browser-libs/usr/lib/x86_64-linux-gnu npx playwright test tests/e2e/docs-assistant.spec.ts --output=.artifacts/browser/help-markdown-links`: **8 passed**, exit 0. The final full unit/type/lint check above also follows that change.
- Browser checks verify rendered headings/emphasis/lists/code, link attributes, preserved formatted history, zero injected elements/tracking requests/script effects, source navigation, configuration failures and Axe scans. Credential checks reject credential-bearing destinations; an invalid Markdown destination can still contain a harmless partial autolink.
- Prettier and `git diff --check` pass. Reviewed the final diff and desktop/mobile screenshots. Unrelated concurrent names/People tests and the setup/services plan are excluded.

## Live testnet

Ran `/data/daclify-runtime/bin/daclify-rebuild frontend` after the final changes: exit 0. Caddy serves the build directly at `https://testnet.app.daclify.com`.

Ran `LD_LIBRARY_PATH=/data/daclify-runtime/browser-libs/usr/lib/x86_64-linux-gnu node /data/daclify-runtime/help-markdown-live.mts` against public HTTPS without intercepting API requests: **passed, exit 0**. The real Telos question received HTTP 200. Bold text, bullets and HTTPS links render correctly. A fresh emulated Pixel 7 context restores that real answer with formatting. Help Axe scans report zero violations and both contexts report zero page errors. Reviewed `/data/daclify-runtime/help-markdown-live-desktop.png` and `help-markdown-live-mobile.png`.

An earlier live question received HTTP 502; retrying the original question succeeded. Another answer omitted bold Markdown, exposing an overly strict harness expectation; the harness now requires emphasis only when the provider emits it. The final answer did emit bold text. The formatter does not control provider availability or which Markdown a response contains.

## Limits

Mobile checks use browser emulation. Physical phone keyboards, Safari and real screen-reader clients were not checked. No backend, environment, account authority or mainnet changes are included. Test logs, live checker and screenshots remain local. GitHub push remains pending HTTPS credentials; this server's direct testnet delivery is independent of that push.
