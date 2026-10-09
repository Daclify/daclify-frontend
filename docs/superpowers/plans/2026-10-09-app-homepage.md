# App homepage and grouped handbook implementation plan

**Goal:** Give the application a welcoming, useful starting page while retaining dedicated DAO discovery and member workspaces.

**Architecture:** A lazy Vue Home view at `/` uses the existing dark/amber design tokens, Lucide icons and account state. Hub moves to `/hub`; My DAO opens `/hub?mine=1`. Old root bookmarks containing DAO filter parameters redirect to Hub with query/hash preserved. The brand opens Home. Public introductory content remains readable without a verified API connection, while workspace gating and all authorization remain intact.

**Tech stack:** Existing Vue, Vue Router, Pinia, Lucide, Playwright and shared protocol. No dependency, backend schema or contract change.

**Design:** A concise hero explains the product and offers Explore DAOs/Create DAO. Signed-in visitors get Open my DAOs as their primary action. A decorative community illustration and three practical cards lead to modules, account setup and documentation. No invented statistics, provider-availability promises, pricing or simulated transactions appear.

## Tasks

- [x] Write browser regressions in `tests/e2e/homepage.spec.ts` for guest entry, signed-in entry, API unavailability and legacy filtered bookmarks; observe the missing-homepage failure.
- [x] Implement `src/views/Home.vue` and route changes in `src/main.ts`. Retarget existing Hub links in App, workspace, hosting, payments and resources. Preserve independent operator exit behavior, sidebar order and auth return destinations.
- [x] Group handbook guides by user task, using native expandable contents sections and a compact overview. Preserve canonical guide content, full-text search, direct links, DAO context, version checks and generated references. Test that all published guides remain visible exactly once and future unassigned guides remain discoverable.
- [x] Update Hub-specific browser callers and README, then run frontend verification/build, homepage/Hub/navigation desktop/mobile checks and deployment-network gating checks. Inspect actual desktop/mobile screenshots and the final diff. Commit on `dev`; push with the following Daxi/Status UX work.

## Acceptance boundaries

Guests can understand the app and explore before signing in. Returning users can reach their DAO filter and account without inventing membership. The static Home route is the only addition to network-unavailable rendering; a mismatched API cannot expose workspace screens or trigger identity reads. Existing filtered Hub URLs continue working. Canonical types and existing helpers remain authoritative. Provider conversations, payments and contract mutations are outside this change.
