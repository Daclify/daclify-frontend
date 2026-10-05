# CIQ visual alignment implementation plan

> Execute inline using the existing continuous-review workflow. No delegation,
> production deployment, contract changes, or provider calls are in scope.

**Goal:** Make Daclify visibly part of the CIQ/MIQ product family while retaining
its name, Vue implementation, dashboard layout, and governance workflows.

**Architecture:** Adapt the supplied product tokens into the frontend's shared
stylesheet. Keep layout and domain behavior intact. Use locally bundled Inter
and the Vue Lucide package, preserving the reference's typography and line icons
without React or external font requests.

**Sources:** `../docs/CIQ & MIQ Design System Oct 26/` from the standard frontend checkout:
`readme.md`, `tokens/`, `components/`, and the uploaded dashboard, remote-meeting,
and extensions screenshots. Core's canonical architecture and WP13 remain the
application ownership and accessibility requirements.

## Decisions

- Espresso background, brown-black surfaces, ivory text, amber actions, lime
  success and coral danger. Copy documented product values into semantic tokens.
- Inter for operational UI. Preserve Daclify branding; avoid claiming an actual
  CIQ integration or adopting its wordmark. Do not use marketing serif headlines,
  decorative animation, or the meeting workbench's narrow 680px layout.
- Pill buttons and badges, 14px panels, 10px fields, restrained 140ms interaction
  feedback. Strengthen field boundaries where necessary for contrast.
- Preserve keyboard focus, skip links, mobile menus, reduced motion and existing
  route/authorization behavior. Buttons, navigation entries and standalone help
  links use a minimum 44px target height.

## Execution ledger

- [x] Inspect references, Vue code, ownership, and existing working tree.
- [x] Bootstrap public SDK dependencies in a disposable source-only copy using
      Node 24.21.0/npm 11.19.0; baseline build and 33 unit tests passed.
- [x] Add browser regressions for minimum touch targets, destructive-control
      contrast, keyboard navigation, mobile forms, and network-error recovery.
- [x] Observe regressions fail against the original UI.
- [x] Implement `src/styles/ciq-tokens.css`, shared styles, local font loading,
      Vue navigation/hub icons, and the browser theme colour.
- [x] Run build, unit tests, formatting, and desktop/mobile browser regressions.
- [x] Inspect actual rendered desktop/mobile screenshots; review the final diff.
- [x] Record results and limitations in the frontend documentation/changelog.

## Results — 2026-10-05

Verified with Node 24.21.0 and npm 11.19.0 in a disposable copy bootstrapped from
the three new repositories. Producer and legacy checkouts were not modified.

- Baseline: build and all 33 unit tests passed before theme changes.
- Initial presentation regression run: 4 failed and 4 passed. Both desktop/mobile
  runs exposed 36px DAO filter targets and a shared destructive-button contrast
  ratio of 1.14:1. The keyboard/form and network-error checks passed.
- Final `npm run build`: passed, including strict Vue/TypeScript template checks.
- `npm test`: 33 tests passed across five files.
- Final `npm run format:check`: passed.
- Final `npm run test:e2e -- theme.spec.ts`: all 10 desktop/mobile Chromium cases
  passed. Includes default/hover destructive-control contrast, 320px cards and
  documentation, keyboard account entry, and reduced-motion retry controls.
- Browser startup was inspected with agent-browser: meaningful content, expected
  navigation/actions, no Vite overlay and no reported JavaScript page errors.
  The unmocked API connection displayed the expected recoverable error because
  the native backend was not running.
- Reviewed hub/account screenshots at 1440px and 390px, plus documentation at
  820px portrait and 844px landscape. Six captures reported no page errors or
  document overflow. Source provenance, dependency pins and the final diff were
  reviewed inline; no independent agent review was performed.

Screenshot review removed a fixed-background break on long mobile pages.
Diff review retained coral danger styling on hover and removed hover movement
for reduced-motion users. Help links now have their own 44px target rather than
running directly into adjacent buttons.

Frontend version: `0.1.0-alpha.2`. Core/module artifact entries and interface pins
are unchanged. New runtime dependencies are pinned local Inter and `@lucide/vue`;
the deprecated Vue icon package was not retained.

Review branch: `codex/ciq-visual-alignment`. Local screenshots and their fixture
report are under the retained worktree's ignored `.artifacts/ciq-preview/`.

Browser regressions use canonical producer schemas with labelled synthetic,
read-only API fixtures. They verify the visual layer and do not establish native
contract, custody, settlement, or live provider integration. The source-only
bootstrap is isolated so backend repositories and legacy inputs remain unchanged.
Native-chain/API journeys, custody, settlement, live providers, CIQ integration,
Safari/Firefox and actual Telegram clients were not exercised by this visual task.
