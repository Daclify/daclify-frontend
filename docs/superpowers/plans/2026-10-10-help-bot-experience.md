# Help bot experience implementation plan

> Execute inline using superpowers:executing-plans; workspace instructions prohibit delegation. The user authorizes implementation and reviews the completed result.

**Goal:** Make Daxi easier to start, read and recover from errors inside its existing floating window.

**Architecture:** Keep Vue components, warm design tokens, plain-text responses, canonical API contracts and account/network scoped browser history. No dependencies or backend changes.

**Design:** Replace the long opening block and passive suggestions with a short welcome and three selectable questions. Selection fills and focuses the question without sending it. Keep the composer visible while the transcript scrolls. Support Ctrl/Command + Enter without intercepting ordinary newlines or IME composition. Keep a visible privacy reminder and disclose existing history/AI limits on demand. Offer retries for availability and answer failures, preserving drafts and avoiding duplicate messages. Confirm clearing locally. Refine header controls, focus, mobile sizing and source links with existing tokens.

**Scope:** `DocsAssistant.vue`, `HelpWindow.vue`, the existing help CSS, assistant browser tests, and an evidence record. Preserve safe rendering, the 500-character question limit, 100-message history, isolation, dragging, resizing, expansion and minimizing. Work on `dev`; no production release.

## Execution ledger

- [x] Inspect components, callers, history, design tokens, existing tests and canonical architecture/policy.
- [x] Add failing browser regressions for selectable prompts, keyboard submission, retry/draft preservation, confirmed clearing, delayed focus and viewport bounds.
- [x] Implement the scoped UI and interaction changes.
- [x] Run lint, Vue/TypeScript checks, unit suite, build and affected desktop/mobile browser flows; inspect screenshots and accessibility results.
- [x] Review the diff, record results and limits, and prepare the Help files for the authorized `dev` commit/push.

Review focus: late responses after scope changes or clearing; typing a new draft while a request fails; duplicate sends/retries; narrow and short viewports with enlarged text; focus after opening, delayed availability and minimizing.

Rulings: keep the existing Ask label and use Ctrl/Command + Enter so ordinary Enter remains a newline. Clear confirmation applies only to this browser's scoped history. Keep plain-text model output. Observe visual-viewport and frame resizing to constrain the window. Wait for browser resize events before asserting bounds. Also fix restoration and scrolling at the 100-message limit: the old length-only watcher missed both; a dedicated browser regression failed before that fix and passes afterward.

Verification: lint, Vue/TypeScript, 168 unit tests, build, and 22 selected desktop/mobile browser cases pass. Screenshot review covers opening, replies, narrow screens and 200% text. Exact commands, earlier failures and limitations are recorded in `docs/evidence/2026-10-10-help-bot-experience.md`.

Delivery: implementation committed on local `dev` as `b765ae9`. `git push origin dev` failed because HTTPS GitHub credentials are unavailable; the container also has no GitHub CLI. Publication remains pending authentication. Unrelated workspace changes were preserved.

Live delivery: user authorized publishing the Help changes. Rebuilt the configured testnet frontend and verified matching public assets, real Daxi Telos answer/source navigation, desktop/mobile presentation, accessibility and focus. Live at `https://testnet.app.daclify.com`; public checker exits 0. See the appended delivery evidence. GitHub push remains independent and pending credentials.
