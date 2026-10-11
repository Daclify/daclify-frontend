# Telos ballot vote controls

Frontend `0.14.0-alpha.5`, 11 October 2026.

The reported ballot `1n44ph2kvcep` still has the contract status `voting`, but its voting period ended on 22 April 2023. The form used that raw status while the page label and eligibility guard already checked its dates. The public browser reproduced a 934.84-pixel-wide checkbox input with a 44-pixel height at a 1440-pixel viewport; native rendering placed its square far from the label.

The form now uses the existing effective `Open` status. Ended and scheduled ballots keep their contract totals and rules without vote options, account-creation guidance or a submit button. Pending-transaction confirmation remains outside the form. Open read-only connections retain the disabled controls and their availability explanation.

Vote labels reuse the existing `.checkbox` style, with a 44-pixel minimum clickable row height. Signing guards, wallet pairing, transaction preparation and confirmation behavior retain their existing paths. No dependency, API or contract changes were required.

## Verification

- Before implementation, all six desktop/mobile regression cases failed on the expected oversized checkbox or unwanted ended/scheduled form.
- After implementation, all eight focused cases passed, including compact adjacent checkboxes, label clicks, ended/scheduled records and pending confirmation after an ended period. Browser fixtures exercise the actual Vue app and disposable native cryptography; they do not qualify a live wallet or governance action.
- `npm run verify` passed lint, Vue/TypeScript checks and all 44 unit files / 280 tests.
- The complete Telos browser suite passed all 32 desktop/mobile cases on an owned Vite server at port 5268. This includes existing native signup, actual disposable signing, registration/cast batching, context guards, retained history, election pagination and producer schedule checks.
- Changed-file formatting, public-check syntax and `git diff --check` passed. The public checker now also requires history details to omit vote controls and account-creation guidance while retaining recorded totals.
- `npm run build` passed. Vite retained its existing large-chunk warning.
- Testnet publication and the actual public checks are recorded below when completed. Live wallet approval and a governance mutation remain unqualified by this frontend fix.
