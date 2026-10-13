# Grants

Grants has **Rounds** and **Applications** tabs. Search and status filters share the toolbar with **+** and **Grants rules and help**. Rounds use the selected rules document's readable title; applications use their proposal document's title and the applicant's published name or wallet name. **View applications** filters the exact selected round; **Show all rounds** clears that filter. Untitled, encrypted or unavailable metadata uses stable reference labels. Private titles are not decrypted by this screen.

In **Rounds**, an active administrator selects **+** to open **Create grant round**:

1. **Rules:** select a published DAO document version explaining the programme and eligibility. Human members can apply; active AI agents are optional.
2. **Funding and dates:** enter an explicit positive whole-token lifetime funding limit and three deadlines: applications, eligibility reviews and funding decisions. Dates use the device timezone, must be ordered, and finish within one year. Allow enough time for the DAO's saved voting period.
3. **Review:** check the document version, eligibility, limit and dates before signing.

Creating a round reserves no Treasury funds. Awarded is the cumulative committed amount, not a cash balance. Cancellation does not restore the lifetime award capacity. Closing a round leaves previously approved liabilities payable.

In **Applications**, **+** opens **Apply for a grant**. You can also apply from an open round. Choose a published proposal document version describing the work, contribution term and review rules. Enter each milestone separately with a positive whole-token amount and its own due date. Up to 16 milestones fit within a term of at most one year. The requested total is calculated in exact integer base units and cannot exceed the round's limit. No amounts are rounded. Existing fractional payments remain visible when edited; explicitly replace them with whole-token amounts to save an amendment.

**Save draft** does not submit consent or fund anything. **Review and submit** shows the exact frozen proposal version, payments, dates, independent review and cancellation terms before you sign your consent. Editing removes previous consent and eligibility; submit and request review again.

An administrator opens **Review application**, chooses a published **Review record** explaining the eligibility decision, and records whether the proposal qualifies for a funding vote. Eligibility approves no spending. There is no separate global decision-document field.

Eligible applications can **Propose funding vote** under the DAO's saved governance policy. The popup shows human-readable voting duration and quorum/approval percentages. Vote, finalize and execute in Decide before the round deadline and contribution term end. Execution verifies the exact application revision and commitment, current identity/policy/code pins, remaining lifetime cap and real Treasury backing. A failed check awards and reserves nothing. After an award, **Continue in Works** takes you to delivery, independent milestone review and settlement.

**Open DAO documents** opens another tab for publishing or checking rules, proposals and review records. **Refresh documents and names** loads new versions without discarding the form. Unavailable or foreign document metadata blocks document selection while the existing grants remain readable. You can retry. Cancelled and failed drafts stay available in the current workspace; a confirmed successful save clears that draft. Creation retries keep the same round, application or vote references so a lost response cannot create a second intent within that draft. Pending signing disables edits, closing and Escape. Reloading or leaving the Grants workspace clears unsaved browser drafts.
