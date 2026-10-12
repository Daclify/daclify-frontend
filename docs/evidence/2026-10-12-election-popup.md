# Election setup and document choices

The user requested that Decide’s plus follow the selected tab: Ballots opens the existing ballot popup; Elections opens Election and term rules. They also requested a more understandable election form, particularly the rules and recall document references.

## Implementation

Frontend 0.14.0-alpha.12 consumes core 0.14.0-alpha.5 and modules 0.10.0-alpha.5 without dependency, API or contract changes. The toolbar’s accessible name, action and help destination follow the tab. Only active administrators can open election setup; ordinary active members retain ballot creation and election participation.

The native dialog groups purpose/seats, rules and local nomination/term dates. Executive elections retain their existing policy/grant and native-controller disclosures. Dates explain the device timezone, voting interval and one-year term limit. Missing governance policy, missing documents and invalid timing block scheduling with a next step.

Published document choices show available public titles, filenames or text previews and exact versions. Private or untitled documents use reference labels without decrypting metadata. Document reads are lazy, paginated through the existing API helper, checked against the complete DAO reference and discarded after unmount. Failure offers retry; the documents link opens another tab and refresh keeps the draft. The contract continues to record the selected version/commitment.

Recall reasons are isolated per term and appear beside the term under End this term early, using the same published document choices. Financial obligations, permanent roles, signing and contract authorization retain their existing semantics. Closing controls are disabled during submission; errors and selected documents remain available for retry. Confirmed scheduling closes the dialog.

## Execution and verification

The initial toolbar regression failed because Elections still exposed the ballot action. The first browser run passed 30 cases and failed two document-selection cases: implicit label text included all option labels. An explicit label/control association corrected that selector and accessibility boundary. A signed election fixture initially encountered small UInt64 values decoded as numbers, requiring the same boundary normalization already used by the ballot fixture. A separate recall regression exposed shared selection between terms; each term now retains its own reason draft.

`npm run verify` passed lint policy, strict Vue/TypeScript and 299 unit tests in 47 files. After isolating recall reason drafts, the complete lint/unit selection passed again, strict Vue/TypeScript passed through the testnet build and all 36 Decide/executive desktop/mobile browser cases passed. The final build completed with exit 0; its existing large-chunk warning remains. Formatting and whitespace checks passed. Desktop/mobile screenshots were reviewed.

The browser selection covers active-tab creation, administrator restrictions, document names and version retention, private metadata labels, read failure/empty-library recovery, per-term reason isolation, date validation, preserved drafts, pending cancellation, accessibility and overflow. Real client login/relay signatures are verified and the released Decide ABI is decoded to independently confirm that choosing Council rules version 2 sends document 42/version 2. Failed requests stay inside the popup; success closes it and reveals the created record.

Publication results will be recorded after live verification. Browser fixtures use synthetic API responses and real disposable client keys/signatures; they do not broadcast a live vote or election. The paid/native local API suites and actual live wallet scheduling remain separate qualification.
