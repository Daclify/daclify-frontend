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
- Committed and pushed to dev: `8c626d0c04086f13a700d0c406689caa5d8a2839`. Frontend-only testnet publication passed from that immutable snapshot; the backend and contracts were not deployed.
- Public artifact checks passed: the entrypoint and all **25** linked assets match the tested candidate by SHA-256. Entry hash: `e943abafd6b4a3c100ed03574b178828781ef9803972784ca78d609ae3098b87`. Manifest: `2026-10-13-dao-settings-testnet.json`.
- Published compiled-app checks: **16/16 passed** on desktop/mobile, including signed name/policy updates, named executive selection, exact quorum and unsigned native ownership review. Logs and runnable config are in the immutable packet's `verification/` directory.
- The initial published native/guardian fixture run declared a local network and was correctly rejected by the app's testnet network guard. It was terminated after diagnosis. Qualification copies adapt only that fixture label and its mock RPC URL to testnet/HTTPS, and declare ES modules for SDK imports. Original and qualification file hashes are in `verification/compiled-fixtures.json`; production network checks were not changed.
- Actual public guest views: all six Identity/Governance/Services × desktop/mobile passed, with **0 Axe violations, 0 page errors and no horizontal overflow**. Screenshots and results: `verification/settings-public.json`.

Browser fixtures use synthetic API replies and disposable real signatures. They do not qualify live provider uploads or native authority execution.
