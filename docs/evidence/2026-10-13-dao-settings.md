# DAO Settings usability

Scope: the existing Settings workspace, following the established tabs, contextual popups, readable labels and inline implementation workflow. Base: `8bcef05`, current pushed dev, including the completed Mini apps integration. No backend or contract changes.

## Design and execution

- Keep Identity, Governance and Services as URL-addressable keyboard tabs with help at the right. Remove the repeated DAO Settings heading.
- Identity shows the saved name and public card. Edit each in a native dialog. Keep cancelled/failed drafts; block editing and closing during signing/upload. Preserve public-image consent, upload resumption and the existing signed metadata.
- Governance shows saved voting rules first, with percentages, human durations and token-labelled limits. Edit in a dialog. Show executives and voting eligibility separately; select actual members rather than typing IDs. Keep native ownership and automation controls under Advanced with their existing authority disclosures.
- Services keeps distinct member capacity, module access, storage and merchant payment destinations, using compact cards with matching help.
- Preserve existing policy revisions, ballot locks, fixed guardian/participant policy, signing permissions, native ownership verification and accounting. Settings edits do not appoint a wallet or change a native authority automatically.

## Verification ledger

- Implemented saved-value panels, keyboard/URL tabs and focused name, branding, policy, executive and voting-eligibility dialogs. Existing signing and public-image upload workflows remain. Advanced controls retain native ownership and guardian disclosures.
- Test first: the settings flow failed on missing tabs. Visual review then found help below the tabs; a geometry regression failed before the toolbar fix and passed afterward.
- `npm run verify`: passed on final source; lint, Vue/TypeScript checks and all **342 tests in 58 files**. Log: `.artifacts/dao-settings-final-verify.log`.
- `npm run build -- --mode testnet`: passed. Existing large-chunk warning remains. Log: `.artifacts/dao-settings-build.log`.
- The broad five-file desktop/mobile diagnostic run passed 96/100. Four failures were two assertions still expecting the inline ballot form and previous visitor wording. Both assertions were updated and passed in the focused final run.
- Focused final desktop/mobile run: 15 passed; the multi-viewport/enlarged-text mobile case hit its existing 60-second total timeout during concurrent verification. The timeout occurred during a browser read, without an assertion failure. Its isolated rerun **passed in 49.4 seconds** without a source or timeout change, completing all 16 targeted cases. Logs: `.artifacts/dao-settings-final-browser.log`, `.artifacts/dao-settings-isolated-mobile.log`.
- Exact signed policy payloads retain failed edits, block pending close/edit/duplicate writes and preserve token base units. Named executive selection prepares the correct member IDs and exact **75.89%** quorum; excluded members start with their current voting status. Visitor/inactive-member and native ownership checks remain.
- Final inline diff review and formatting checks passed. The public-image provider test was adapted to the new dialog and remains unrun; only its target journey was changed.
- Immutable frontend packet: `/data/daclify-runtime/releases/20261013-dao-settings/`. Frontend `0.15.0-alpha.20`, retaining Core SDK `0.15.0-alpha.17` and Modules SDK `0.10.0-alpha.24`. Scope is this frontend usability change; the inherited Mini apps candidate and its external qualification ledger are separate.
- Pending: dev commit/push and verified frontend-only testnet publication.

Browser fixtures use synthetic API replies and disposable real signatures. They do not qualify live provider uploads or native authority execution.
