# Account settings design evidence

## Outcome and review

Reorganized the existing settings UI under the user's compact/intuitive design brief. No account permissions, custody policies, key formats or APIs changed. Review performed inline under the workspace's prohibition on sub-agent delegation.

| Impact | Verified issue | Implemented change |
| --- | --- | --- |
| High | Keys and IDs lead the page and push recovery actions down. | Device status and recovery actions together; public identity in a disclosure. |
| High | EVM pairing is separate from other sign-in methods. | Four task-oriented sections; all five methods in one expandable list. |
| Medium | Every provider form and credential history opens at once. | Native keyboard-accessible details rows; verification steps open their relevant row. |
| Medium | Long profile form mixes basics, social links and IPFS fields. | Responsive basics grid and optional disclosures; drafts survive closing them. |
| Medium | Recovery authority lookup failure is indistinguishable from loading. | Explicit unavailable status; sharing join identity remains disabled until authority is known. |

Preserved embedded Profile default, billing/Telegram/device entry points, keyboard tab navigation, wallet-only recovery, kit account matching, original signing/document keys, recovery consent and permanent assisted authority disclosures. Prevented overlapping wallet/provider actions after consolidating wallet controls.

## Verification

- Baseline new settings test failed as expected: five tabs rather than four. Inspected its actual desktop screenshot.
- Frontend lint and Vue/TypeScript checks passed. Final unit run: `npm test -- --maxWorkers=2 --testTimeout=20000`, 209/209 across 38 files.
- Browser command prefix: `LD_LIBRARY_PATH=/data/daclify-runtime/browser-libs/usr/lib/x86_64-linux-gnu DACLIFY_TEST_UI_PORT=5189 node_modules/.bin/playwright test --config playwright.config.ts`.
- Account entry, device recovery, fast sign-in, people/embedded settings and wallet recovery: 54/60 initially passed; six old selectors expected always-visible IDs or an unambiguous email label. Updated selectors to use the public identity disclosure and paired method row. Focused rerun passed all six plus the two new settings cases (8/8).
- Fast sign-in and wallet/profile checks passed desktop/mobile (10 cases in the final related run). The added overlapping-wallet check initially dismissed the existing pairing confirmation in its browser fixture; accepting the confirmation let it exercise the pending wallet request. Final settings checks passed 2/2, including cancellation, disabled sibling controls, authority lookup failure, 320px viewport, keyboard navigation and zero Axe violations.
- Inspected rendered desktop/mobile access screens, desktop compact methods and desktop/mobile profile forms. Screenshots come from Playwright, not mockup generation.
- Core help labels updated from canonical `docs/guides/topics.json`; generated documentation check, TypeScript build and 10 documentation/permission documentation tests passed. Producer documentation commit: `773c2a1`.
- Refreshed the explicitly development-only core artifact at existing `0.12.0-alpha.1`; no immutable release/tag was published. Frontend lock integrity updated. Artifact SHA-256: `6a67c4b2fcf9e506bbefd06b185575514fc6dcaa4e65e7b3ce35e8ab11291e66`. Installed help bundle checked for the new labels and absence of the old Keys path.

Final clean snapshot `5cb853a` passed Vue/TypeScript checking and the testnet Vite build, then was delivered to https://testnet.app.daclify.com/account. The first build exposed a missing Google label in the producer recovery-kind enum; the complete typed label map fixed it. A final 200% text check at 320px found the absolutely positioned help link overlapping the heading; placing the link in normal flow fixed it, with both desktop/mobile regressions passing (2/2). Wallet-only account IDs remain available under Account details (4/4 wallet recovery checks). The API was restarted to load the matching canonical help bundle. Live HTTP and browser transfer passed at 2026-10-10T18:33:02Z, including real proof verification, preserved original identity, no password/JSON or plaintext keys on the receiver, replay/old-session denial and zero Axe/browser errors. See `2026-10-10-passwordless-public.json`. The disposable private fixture was deleted and its sessions logged out. Hosted recovery remains disabled pending independent infrastructure qualification. Tests use synthetic provider fixtures; wallet/passkey hardware qualification and Safari were not performed. Concurrent contract-map work was preserved.
