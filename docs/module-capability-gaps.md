# Module capabilities and remaining limits

Reviewed against the current source on 16 October 2026. Package versions are owned by the repository manifests; [current status](../../daclify-backend-core/docs/current-status.md) records the live cohort. This guide describes implementation, not blanket production/provider qualification. Historical plans remain useful records but are not a current backlog.

| Module or flow | Current capability | Remaining limit |
| --- | --- | --- |
| Decide ordinary ballots | Explanation, exact supporting-document review, 3–16-choice custom polls, tallies/results, member/credit/stake weight and contract-checked definition commitments through `votecommit`. Legacy pre-definition votes retain their original path. | Two-choice ordinary ballots mean Reject/Approve. A custom winner must meet the saved majority threshold; plurality alone can fail. No ordinary abstention, replacement, ranked or secret vote. |
| Quick ballots | Separate encrypted up/down questions for all Daclify accounts or selected DAOs; optional deadline, response replacement/removal, fixed executive readers and publicly verified tally proofs. | Experimental testnet feature. Participation is public; readers can decrypt choices. Account uniqueness is not proof of one person. No governance execution. Independent cryptographic/mainnet review remains required. |
| Elections and executives | Exact rules/evidence readers, nominations, bounded seats/terms, recall and optional executive roster handover. | Election success alone does not activate native authority: successors must pair and synchronize the handover. |
| Governing documents | Official documents, amendments, pinned versions, exact commitments, acceptance and history. | Replacing a document does not replace a previously adopted or accepted version. |
| Works | Up to sixteen funded milestones, exact proposal/submission/review readers, contributor consent, independent review, protected challenge periods and conflict-excluding dispute ballots, backup deadlines and mutual settlement. Approved claims survive cancellation. | Protection follows the exact agreed policy. Scope/term changes require a successor and fresh consent. Dispute participation excludes contributor and participating reviewers. |
| Agreements and services | Exact frozen agreement terms, contributor acceptance, separate funding, and a member-service offer creation form in the catalogue. | A service listing reserves no money. Changed agreements require a new proposal and fresh consent; no in-place renewal. |
| Payroll | Fully reserved 1–12 installments, manual catch-up settlement, label/pause controls; approved claims survive removal. | No bound terms document or renewal action. Pausing the helper does not veto direct Treasury payment of an approved obligation. Limits are fixed. |
| Grants rounds | Rules/application/review readers, independent eligibility, revision-bound award votes and protected-term transfer into funded Works milestones. | Round creation reserves nothing; caps are lifetime commitments. No matching/donor pots. Amendments invalidate previous consent, review and votes. |
| Endorsement admission | Exact application-evidence review, revision-bound distinct witnesses and policy-controlled admission. | Threshold/eligibility belong to DAO policy. Distinct keys do not prove independent humans or prevent collusion. |
| Community Activity / mini apps | Scoped connection and consent, activity receipts, independent reviews, advisory ballot links and encrypted app-key epochs/grants. | Receipts do not prove a real-world task happened. Apps own evidence rendering and their operational database; connection does not supply database hosting or create payment claims. |
| External Telos governance | Native publisher/options/totals and election/producer views with live-rule checks and native-wallet signing. | Separate Telos authority and eligible weight. Missing or unsupported records cannot be reconstructed by inventing choices. |
| Connected payments | Explicit supported rails, scoped intents, reconciliation and authorized settlement. | Provider funding/finality and live qualification are rail-specific. A proposal does not integrate a payment provider. |
| Archive / retention | Bounded eligible-family export, verified backups, exact history and source-owned cleanup/restoration; protected financial/decision state is preserved. | Operator enablement is separate. A document link alone creates no retention guarantee. Original keys and surviving files remain necessary. |

## Remaining product decisions

Neutral two-option, ranked or abstention voting in ordinary Decide needs an explicit subtype and preserved funding semantics. Payroll terms/renewal would need contract-bound policy before adding UI. Mini-app database hosting remains future work; builders must follow the existing [database and account integration guide](../../daclify-backend-core/docs/connected-community-apps.md).

Completed decision-integrity, module document-reader, service-authoring and Works dispute plans must not be treated as outstanding implementation tasks. Reload older cached interfaces before voting; current clients reject unsupported or inconsistent definitions rather than guessing labels.

## Concrete sources

- [Ballots and Works](../src/components/ModulesPanel.vue), [elections](../src/components/ElectionPanel.vue), [document reader](../src/components/DocumentReview.vue).
- [Grants](../src/components/GrantsPanel.vue), [admission](../src/components/AdmissionPanel.vue), [agreements](../src/components/ContributionAgreementPanel.vue), [service catalogue](../src/components/ServiceCatalogue.vue).
- [Connected apps](../src/views/ConnectedApps.vue), [external Telos governance](../src/views/TelosGovernance.vue), [archive](../src/components/ArchivePanel.vue).
- [Producer module guides](../../daclify-backend-modules/docs/generated/reference.md), [ballot guide](ballots.md), [Quick ballots](../../daclify-backend-core/docs/quick-ballots.md).
