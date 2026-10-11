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

## Testnet publication

- Committed source `9a159ba302ef307fc448dcfac3d204a6500a9a3d` was pushed to dev, archived into `/data/daclify-runtime/releases/20261011-telos-vote-controls/daclify-frontend`, installed with `npm ci --ignore-scripts` and published using the existing frontend helper in testnet mode. Installation reported zero vulnerabilities; the build passed with the existing large-chunk warning. Existing hashed assets and the previous index were retained.
- The public index matched the published build with SHA-256 `b7acfd289dc5d2c5b9922fe29ee35560b99fba490dede04bd8ad6a507d822d60`.
- The complete committed public check passed at 1440×1000 and 390×844, covering account entry, Telos ballot history, Foundation elections, producer standings, navigation and platform details. The checked screens had no Axe violations or horizontal overflow; no page errors, misplaced API requests or server-error responses were recorded.
- A separate read-only public check visited the exact reported ballot `1n44ph2kvcep` at both viewports. Its `36040.0000 VOTE` total and ended-period notice remained visible; vote controls and account-creation guidance were absent. No authentication request, browser error, Axe violation or horizontal overflow occurred.
- Release manifest, prior/public index, build/install/check logs and desktop/mobile screenshots are retained in `/data/daclify-runtime/releases/20261011-telos-vote-controls/`. The original-ballot checker is retained in the archived frontend's `.artifacts/check-telos-vote-controls.mjs` and runs with the same browser library path as the public checker.

Only the existing testnet frontend was published. API, contract, account authorities and recovery configuration were not changed. Actual live wallet approval and a governance mutation remain unqualified; this connection continues to show read-only ballot history.
