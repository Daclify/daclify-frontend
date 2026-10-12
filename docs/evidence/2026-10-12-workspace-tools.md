# Treasury, Documents and Members experience

Frontend 0.15.0-alpha.13; pinned Core SDK 0.15.0-alpha.7 and Modules SDK 0.10.0-alpha.14. The user requested these three remaining workspace screens follow the toolbar/list/popup improvements already established for the other modules. Work proceeded inline on dev. The separate unfinished account-erasure worktrees were excluded.

Treasury separates Payments, Your balances and Reports, with named payment search, status filters, deposit and withdrawal popups, contextual external statements, and named report recipients. Amounts and fractional exit rights remain exact. Document Library and Constitution & legal use readable titles, retained versions, internally generated identities and publishing/registration popups. New-document and revision drafts are separate. The legal register labels its adopted version rather than a newer library draft. Members uses Directory/Applications, role/status filters, named management popups initialized from current state, policy-dependent admission, and document/version choices for endorsements. Private grants and handover checks remain intact.

The small shared native dialog blocks edits, cancellation and Escape while pending. Cancelled/failed drafts are retained, including signed admission identities. Public profile failures retain records and fallback labels; foreign DAO profiles cannot supply names. Encrypted metadata remains opaque. No dependencies, backend schemas, contracts, membership policies or new financial actions were introduced.

## Final source verification

- `npm run verify`: PASS, lint, strict Vue/TypeScript and all 335 tests across 56 unit files.
- `npm run build -- --mode testnet`: PASS. Existing large-chunk warning remains.
- Playwright `workspace-tools-design.spec.ts`, `governing-documents.spec.ts`, `private-access-continuity.spec.ts`, `people-workspace.spec.ts`: PASS, all 48 cases on desktop Chromium and Pixel 7, including accessibility and overflow assertions.
- Changed-file Prettier check and `git diff --check`: PASS.
- Review performed inline under the workspace's no-delegation instructions.

The final source logs are `.artifacts/workspace-tools-{verify-final-source,build-final-source,final-source}.log`. They supersede earlier diagnostic runs, some of which were interrupted after identifying failures. The reproducible RED checks covered missing screens, uint64 identities/collisions, independent document drafts, malformed renewal identities, navigation retaining the wrong subtab, and the register incorrectly naming a newer draft as its adopted version. Fixture corrections use the canonical relay route, normalize decoded integer fields and scope errors to the current popup. The admission test requires an observed relay rather than passing solely on a generic API error.

The private-access browser flow uses real disposable keys, encrypted history and signatures: it refuses departure without an eligible successor, grants and verifies history on another device, rechecks fresh records, then preserves decryption and prepares the next epoch after the creator leaves. API responses are synthetic; this is a browser/crypto regression test, not native-chain certification.

The three affected hosted-file browser workflows were updated for generated identities, publishing popups and retained upload recovery. Their live/native paid-provider suite was not run. Live Treasury settlement/withdrawal, real hosted-file storage and external login providers were not exercised.

## Delivery

Pending immutable snapshot publication and checks of the published artifacts and compiled UI. Only the previously authorized testnet frontend will be published.
