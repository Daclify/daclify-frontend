# Decide toolbar and ballot popup

The requested layout removes the duplicate Decide heading, places Ballots and Elections at the left of one toolbar and a large plus followed by help at the right. The ballot list is the default content. The plus opens the existing ballot form in a native modal dialog; election scheduling remains in Elections.

Frontend 0.14.0-alpha.11 consumes the unchanged core 0.14.0-alpha.5 and modules 0.10.0-alpha.5 packages. No contract, API, dependency or authorization changes are required. Active members can preview the form; visitors cannot create ballots. Submission preserves signer readiness, module action checks, code verification and saved DAO governance policy. Context changes close the popup.

## Verification

`npm run verify` passed lint policy, strict Vue/TypeScript and 299 unit tests in 47 files. The Decide and executive browser suites passed 26 desktop/mobile cases. Screenshots were reviewed. Browser coverage includes toolbar layout, list before creation, keyboard tab navigation, dialog focus/Escape, draft retention, visitor restrictions, percentage/duration policy controls, date/timezone conversion and accessibility without horizontal overflow.

A submission regression uses an encrypted synthetic vault, verifies genuine login and relay signatures and independently decodes the released native Decide action schema. A failed relay leaves its draft and visible error in the popup; a pending relay disables cancellation and Escape; confirmed creation closes the popup and adds its ballot to the list. No live transaction is broadcast by this fixture.

The initial toolbar regression failed against the old UI. A separate failed-relay regression demonstrated the old unconditional clearing of the title; the final implementation clears only after confirmed success. An initial accessibility failure exposed skipped heading levels after removing the Decide heading; ballot and empty-state headings now follow the DAO heading. All final browser checks pass. A final screenshot exposed the global 18-pixel button icon rule overriding the plus size; a separate desktop/mobile regression confirmed it, and scoped sizing now renders the plus at 32 pixels. The complete 26-case browser selection was repeated after that correction. Logs are retained in frontend `.artifacts/decide-popup-*.log` and the publication packet.

## Publication

Frontend 0.14.0-alpha.11 is live at https://testnet.app.daclify.com from pushed source commit `269c0ad8e196534fa3ce2758525c5fd1f7dbae6f`. Every tracked source file was compared byte-for-byte with the archived commit. The testnet build and isolated frontend publisher both completed with exit 0. The publisher retained previous hashed assets and published the entry point last.

The HTTPS index SHA-256 is `863e2ca5133eb6ccfc6753e6cd64619f96a42e3c21dda09038ed2f52aabc51e6`. The index and all 22 referenced entry assets match the tested candidate. The actual API reports core 0.14.0-alpha.5. [Machine evidence](2026-10-12-decide-ballot-popup-testnet.json) records versions, timestamp and asset hashes. The existing large-chunk build warning remains; no bundle-performance claim is made.

`npm run test:testnet-public` passed against actual HTTPS/API responses at 1440×1000 and 390×844. The live toolbar has no duplicate heading, both tabs switch correctly, the plus renders at 32 pixels, help is available and visitor creation remains disabled. Accessibility and horizontal-overflow checks passed, with no page errors, misplaced API requests or server errors. The general account, Hub, Telos, Status/Names and DAO checks passed in the same run. Authenticated popup/signing behavior is covered by the local synthetic API tests described above.

The operator packet is `/data/daclify-runtime/releases/20261012-decide-popup-icons/`, including source, candidate, installation/build/publication logs and local/public verification evidence. An initial 0.14.0-alpha.10 publication was superseded by the verified 0.14.0-alpha.11 icon correction. The backend and contracts remain on their existing deployed releases.

Actual live wallet ballot submission and the paid/native local API suites are outside this UI check. The affected existing ballot-creation callers were updated to open the popup first.
