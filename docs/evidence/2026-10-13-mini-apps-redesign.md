# Mini Apps live dev delivery

Frontend `0.15.0-alpha.29` is published at https://testnet.app.daclify.com/mini-apps. Source merge: `ad292bd2f34efcd7e4639fbbb35762084cd1b89b`; Mini Apps feature commit: `c66fb17098a579a8d52c108b9edb0dcc8a6b2ef7`. Both commits are integrated into and pushed to `dev`. The concurrent document-upload commit `f020b8f` is preserved. Core protocol `0.15.0-alpha.20` and modules `0.10.0-alpha.28` remain pinned.

The page keeps app browsing visible and expands connection, AI, publishing, reporting and moderation tools only when requested. Deep links and in-page drafts remain available. The directory distinguishes loading, empty and error states; changing a listing clears its old reports and origin proof.

Verification on the integrated source passed lint, Vue template/type checks, 348 unit tests across 61 files, 16 desktop/mobile presentation regressions and the testnet build. The exact candidate and subsequently published files passed read-only checks against the real testnet API at widths 1440, 390 and 320: network lock, API routing and reads, default collapsed controls, keyboard expansion, deep links/reload, no horizontal overflow, no page exceptions and Axe checks. These live checks used no API fixtures.

The broader `npm run test:testnet-public` stopped at `Names quotes must have a fresh observation`: the Names quote endpoint returned HTTP 503. A direct read confirmed public error code `ORACLE_STALE`. This is the backend Names oracle freshness boundary; it is outside the Mini Apps frontend scope and was not changed. The full broad site check therefore did not pass. Authenticated Mini Apps/native signing, provider writes and physical client flows were not requalified; the earlier native Mini Apps runner was blocked by its missing network fixture.

Publication copied the tested static files, retained existing hashed assets and replaced the entry point atomically. Previous entry SHA-256: `52b16d1c1d967454defd112fc1dd58ea8883d7b86a03a75bcd2a208105e901f4`. Published entry SHA-256: `b2cef6cb66ec189099d94c1ec7dac2dfb7169289869346115a3434fd4ed2a853`. No API restart, database migration, native contract or authority change was performed.

The private packet `/data/daclify-runtime/mini-apps-dev-20261013` contains the tested candidate, source archive, build/test/public logs, candidate/live screenshots and JSON read results, manifest, read-only verification script and prior entry point for rollback. A separate preview was superseded before publication.
