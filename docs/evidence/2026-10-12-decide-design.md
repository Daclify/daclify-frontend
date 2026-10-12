# Decide design and human governance settings

The user requested duration choices in hours, days and weeks, percentage quorum/approval, and separate Ballots and Elections within Decide. This is a frontend change consuming the existing core 0.14.0-alpha.5 and module 0.10.0-alpha.5 packages.

## Implementation

- Ballots and Elections have accessible tabs, arrow/Home/End navigation, 44-pixel buttons and retained drafts. Election records stay in Elections.
- Shared duration controls cover ballot creation, governance policy editing and DAO setup/review. Minutes preserve supported short ballots; normal durations use hours, days or weeks. The duration control uses a full row on phones so unit labels remain readable.
- Custom ballot timing permits a device-local closing date with timezone preview. Invalid/elapsed/out-of-range dates cannot submit. Cancelling date entry restores the previous duration. Saved DAO policy remains authoritative and disables per-ballot overrides.
- Shared percentage controls retain two decimal places exactly, validate the released schema's thresholds and block invalid submissions. 50% and 50.01% encode as 5000 and 5001. Invalid drafts never display NaN in the setup summary.
- No dependency, action ABI, contract, API or persisted policy changes are needed. [User guide](../users/decide.md) and the requirement register cover the new controls.

## Execution and verification

The original UI failed all three initial desktop regressions for missing tabs, human duration controls and percentages. A separate invalid-duration browser regression failed on desktop and mobile before its guard was added. The invalid-summary unit assertion also failed before formatting was corrected. Logs are under frontend `.artifacts/`.

`npm run verify` passed: lint policy, strict Vue/TypeScript and all 299 tests across 47 unit files. The unit coverage includes boundaries, decimal precision, date-relative duration and decoding the actual released native ballot ABI to independently check the encoded values.

Broader browser verification initially stopped after two stale setup fixtures could not reach the creation form. They supplied a public identity without unlocking a vault, predating the existing full-access requirement. The fixtures now decrypt a synthetic encrypted kit and verify its actual login signature; they preserve the production access gate. Interrupted browser tests are not counted as results.

The five-file desktop/mobile regression run passed 62 cases; two date-input cases failed because Playwright rejects a redundant zero-second suffix that the browser normalizes away. A direct Chromium input check confirmed the normalization. After correcting that fixture, all ten new Decide cases passed on desktop/mobile, including Atlantic/Canary daylight-saving conversion, elapsed dates and cancellation. In total, all 64 unique cases were verified across the runs. Browser logs are `.artifacts/decide-design-browser.log` and `.artifacts/decide-design-green.log`; screenshots were reviewed.

The final `npm run build -- --mode testnet` completed with exit 0 for frontend 0.14.0-alpha.9. An earlier build wrapper ended with signal status 143 after emitting its build output; that run was not accepted as a completed check. Strict Vue/TypeScript also passed after the fixture update. The existing large-chunk warning remains.

The final phone layout was checked again: all five mobile Decide cases passed after widening the duration row. The production build passed again, and the matching candidate was archived from pushed frontend commit `6ced704251389ed88ae252f7e5fb266f4a387b16`. Every tracked source file was compared byte-for-byte with that archive before publication.

## Testnet publication

Frontend 0.14.0-alpha.9 is live at https://testnet.app.daclify.com. The existing frontend publisher built the isolated archived source, retained previous hashed assets and published the entry point last. No API restart or contract operation was performed.

Public index SHA-256 is `e76c94d5db02cdecf46bb0f8b21b63e2c993e065c0353d764053561941ac80bc`. HTTPS index bytes and all 22 referenced entry assets match the tested candidate. The actual API still reports core 0.14.0-alpha.5. [Machine evidence](2026-10-12-decide-design-testnet.json) records the source, versions, timestamp and asset hashes.

`npm run test:testnet-public` passed against real HTTPS pages/API responses at 1440×1000 and 390×844. Both Decide tabs render and switch correctly; visitors have no scheduling controls. Accessibility and horizontal-overflow checks passed, with zero page errors, misplaced API requests or server errors. The existing general account, Hub, Telos, Status/Names and DAO checks passed in the same run.

The operator packet is `/data/daclify-runtime/releases/20261012-decide-design/`, with archived source, candidate build, installation/build/publication logs, local verification logs and public asset evidence. The documentation follow-up changes only this evidence; deployed application source remains the recorded commit.

The paid local API/native research suites and an actual live wallet vote are not part of this UI verification. Their affected label/tab callers were updated; canonical action encoding is checked separately.
