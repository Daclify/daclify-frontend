# Daxi Help experience — 2026-10-10

## Issues and resulting behavior

The original window could extend below a short viewport, open with focus on the move control, and restore history at its oldest message. Its scroll watcher stopped updating at the 100-message limit. These are verified behavior problems. The dense opening paragraph, passive example questions and disconnected action row also made starting a question harder to discover.

The opening now has a short welcome and three selectable questions. Selecting one fills and focuses the composer without sending. The composer stays visible while answers scroll. Ctrl/Command + Enter submits; ordinary Enter and IME composition remain intact. Replies retain safe plain-text rendering and have distinct source links. History opens at its latest messages and continues scrolling at the existing limit.

Failures offer an in-place connection or answer retry. Retrying an answer preserves any newly typed draft and does not duplicate the user message. Clearing requires confirmation, restores input focus and invalidates a pending reply. Cancel retains the conversation. The API, source topic IDs, stateless question semantics and account/network/service scoped history remain intact.

Header controls keep dragging, keyboard movement, desktop resizing, expansion, position reset and minimizing. Frame/viewport changes constrain the window; narrow headers wrap rather than truncating the title. Opening focuses the question when availability settles. Escape minimizes and returns focus to Help or the mobile menu.

## Using Help

Open Help from navigation, choose a suggested question or type your own, then use Ask or Ctrl/Command + Enter. Questions have the existing 500-character limit. Each answer uses the current question rather than the transcript. Follow the source guide to check an answer. Browse guides remains available when the assistant is unavailable.

Never include secrets or private content. Daxi cannot see your vault or live DAO records. About Daxi & this conversation explains the AI limitations and storage: the latest 100 messages remain in this browser, separately for each account and network. Clear conversation → Confirm clear removes that scoped local transcript.

## Verification

- `npm run verify`: source lint, Vue templates/strict TypeScript, **33 unit files / 168 tests passed**, exit 0.
- `npm run build`: passed, exit 0. The existing large-chunk warning remains: the handbook route is approximately **514 kB minified / 75 kB gzip**. No performance improvement is claimed.
- `DACLIFY_TEST_UI_PORT=5199 LD_LIBRARY_PATH=/data/daclify-runtime/browser-libs/usr/lib/x86_64-linux-gnu npx playwright test tests/e2e/help-experience.spec.ts tests/e2e/docs-assistant.spec.ts tests/e2e/people-workspace.spec.ts --output=.artifacts/browser/help-final --grep 'starter questions|failed answer|availability failures|clearing needs|window, composer|long answers|restored history|handbook assistant|Daxi answers|Help can be moved'`: **22 passed**, exit 0, across desktop and mobile Chromium.
- Browser checks cover selection without sending, Ctrl/Command shortcuts, IME/newlines, duplicate prevention, draft-preserving retries, status recovery, confirmed/canceled clearing, late replies, long replies, restored/capped history, safe response text, source navigation, account isolation and existing window controls.
- Viewports: 1440×1000, 320×568, 375×812, 768×1024, 812×375 and 812×280; 200% text and reduced motion. Axe reports no violations in the selected Help scans and the existing whole-page window test. Reviewed opening, narrow, enlarged-text and reply screenshots. Local artifacts remain uncommitted.
- Initial five new regressions failed against the old UI as expected. An additional header-width assertion exposed title clipping and the history regression exposed the missing initial scroll. An intermediate browser run had 18 passes / 2 bounds failures at 812×280: tests now wait for asynchronous resize handling and the frame minimum respects available height. The first 18-case green summary ended with a harness termination code 143; the final complete 22-case run above exits 0.
- Final diff review stays within Help components, Help CSS and its tests/docs. Unrelated concurrent Status/release edits are excluded from this change.

## Limits

Browser HTTP fixtures exercise real frontend components; they do not qualify a model provider or Telegram delivery. Physical phone keyboards, Safari and real screen-reader clients were not exercised. No backend, chain, custody, permissions, dependency or production-release work is included.

## Authorized live testnet delivery — 2026-10-10

After the user requested applying the changes live, ran `/data/daclify-runtime/bin/daclify-rebuild frontend`: Vue/TypeScript and the testnet-mode build pass, exit 0. Caddy serves the built files directly; no API/environment change or restart was required. Public HTML and entry JavaScript were compared byte-for-byte with the build at `https://testnet.app.daclify.com`. Entry: `/assets/index-QJyHmB4i.js`, SHA-256 `47ed25909403e9a8226345cb56a3e266a693309c8edc8c2e1a958c6ed64a632c`.

Ran `LD_LIBRARY_PATH=/data/daclify-runtime/browser-libs/usr/lib/x86_64-linux-gnu node /data/daclify-runtime/help-live-check.mts` against actual public HTTPS, without intercepting requests: **passed, exit 0**. Verified the Testnet lock, opening/focus, selectable questions without sending, the real `/v1/docs/ask` HTTP 200 Telos answer, `/docs/telos` navigation, minimizing/reopening and Escape focus restoration. Desktop and emulated Pixel 7 Help scans have no Axe violations; both contexts report zero page errors. Reviewed live answer/mobile screenshots. Logs, checker and screenshots are in `/data/daclify-runtime/help-live-*`.

The check waits for the app's initial network connection before choosing a question: initial network hydration changes the existing scoped history and resets the draft. The first harness attempts were corrected to use explicit browser contexts for Axe and to wait for that connection. No application code changed during this delivery.

The live provider answer is verified for this question, not general provider reliability or Telegram delivery. Mobile checks remain browser emulation. GitHub publication remains separately pending credentials; it is not required by this server's direct static-file delivery. No mainnet release or chain transaction was performed.
