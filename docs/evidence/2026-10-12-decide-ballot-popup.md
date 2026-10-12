# Decide toolbar and ballot popup

The requested layout removes the duplicate Decide heading, places Ballots and Elections at the left of one toolbar and a large plus followed by help at the right. The ballot list is the default content. The plus opens the existing ballot form in a native modal dialog; election scheduling remains in Elections.

Frontend 0.14.0-alpha.10 consumes the unchanged core 0.14.0-alpha.5 and modules 0.10.0-alpha.5 packages. No contract, API, dependency or authorization changes are required. Active members can preview the form; visitors cannot create ballots. Submission preserves signer readiness, module action checks, code verification and saved DAO governance policy. Context changes close the popup.

## Verification

`npm run verify` passed lint policy, strict Vue/TypeScript and 299 unit tests in 47 files. The Decide and executive browser suites passed 26 desktop/mobile cases. Screenshots were reviewed. Browser coverage includes toolbar layout, list before creation, keyboard tab navigation, dialog focus/Escape, draft retention, visitor restrictions, percentage/duration policy controls, date/timezone conversion and accessibility without horizontal overflow.

A submission regression uses an encrypted synthetic vault, verifies genuine login and relay signatures and independently decodes the released native Decide action schema. A failed relay leaves its draft and visible error in the popup; a pending relay disables cancellation and Escape; confirmed creation closes the popup and adds its ballot to the list. No live transaction is broadcast by this fixture.

The initial toolbar regression failed against the old UI. A separate failed-relay regression demonstrated the old unconditional clearing of the title; the final implementation clears only after confirmed success. An initial accessibility failure exposed skipped heading levels after removing the Decide heading; ballot and empty-state headings now follow the DAO heading. All final browser checks pass. Logs are retained in frontend `.artifacts/decide-popup-*.log` and the publication packet.

## Publication

The reviewed frontend candidate will be archived from pushed dev and published using the existing entry-point-last frontend publisher. Publication results and public asset hashes will be recorded here after verification. The backend and contracts remain on their existing deployed releases.

Actual live wallet ballot submission and the paid/native local API suites are outside this UI check. The affected existing ballot-creation callers were updated to open the popup first.
