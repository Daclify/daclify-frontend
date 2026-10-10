# Hub experience implementation plan

**Goal:** Make the Hub a clear, accessible community browser using Daclify's current dark/amber design system.

**Architecture:** Keep Vue/Pinia and canonical core schemas. Refine Hub presentation and the existing DAO card; preserve URL filters, complete membership-reference matching, image validation, independent API verification and external-portal disclosure. No backend/protocol/contract changes or new dependencies.

**Scope:** User's principal UI/UX brief authorizes direct improvements and independent routine design decisions. Preserve commercial and authorization behavior. Implement inline on latest `dev`; no delegated agents.

## Audit and direction

- Verified: result text counts only configured-runtime DAOs, despite independent listings sharing its filters. Search trimming differs between sources.
- Verified: registry errors have no retry control and share state with connection errors. Selecting an operator can erase a load failure.
- Verified: signed-out My communities presents a generic search empty state. Loading/failure can be mistaken for an empty directory.
- Design judgment: oversized summary panels and monogram covers delay browsing; disconnected controls and 10–12px card metadata make scanning harder.
- Use a compact heading/context row, grouped tabs/search/purpose/sort, honest combined result counts, clear reset/retry/sign-in states and consistent community cards. Retain explicit operator review and provider separation.
- Keep real cover/logo imagery with safe fallbacks; purpose icons replace large repeated monograms. Cards show useful identity/description/membership/privacy details. Move repeated network/runtime context to the page and retain public references in accessible card context.

## Execution

- [x] Add and run failing Hub browser regressions using synthetic canonical fixtures: combined counts/filtering, partial-failure retry, guest My communities.
- [x] Update `src/views/Hub.vue`: grouping, source-aware counts/loading/failure/empty states, URL/hash preservation, independent search normalization, separate connection error and accessible review dialog.
- [x] Update `src/components/DaoCard.vue` and its owned rules in `src/styles.css`: hierarchy, compact imagery/fallback, readable metadata, full-card keyboard link and singular member text.
- [x] Extend browser coverage for membership isolation, reset/bookmarks, external links/operator consent, imagery failure, responsive layouts, keyboard/focus, reduced motion and enlarged text.
- [x] Inspect desktop/small-phone/tablet/landscape screenshots; run Axe and overflow checks. Preserve Homepage and existing theme flows.
- [x] Run frontend verify, formatting and build. Record outcomes/limitations, review final diff and increment frontend development version only.

Delivery uses `dev`; do not merge `main` for this UI patch. [Execution evidence](../../evidence/2026-10-10-hub-experience.md) records actual checks and remaining operational/browser limits.

## Verification boundary

Browser fixtures test presentation and interactions, not live provider/native signing or availability. Independent listing errors remain honest; UI repair does not qualify the server/indexer. Product remains dark-themed; do not invent a light theme. No production deployment or backend policy changes.
