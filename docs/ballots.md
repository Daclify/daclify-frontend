# Publish and understand a DAO ballot

Open **Decide > Ballots > Open a ballot**. Give the decision a title and a short explanation so members know what they are voting on. Both are public on chain, including in private DAOs. Put confidential detail in an encrypted DAO document and select its exact version as the optional supporting document.

Choose **Approve or reject a proposal** for fixed Reject/Approve choices. Choose **Choose one option** for a poll with three to sixteen distinct choices. The current contract does not support a neutral two-option poll. A member makes one selection; its weight follows the DAO's saved member, credit or deposited-stake policy.

Review the displayed voting weight, duration, quorum and approval threshold before opening. Saved DAO rules cannot be changed for one ballot. A unique leading poll choice must reach the same approval threshold: a plurality with less than the required approval does not pass. Ordinary ballots are advisory; funding, amendments and executive elections use their own authorized flows.

The ballot card shows the explanation, every choice and tally, your recorded choice, the closing time and the finalized result. An attachment opens its recorded document version and commitment, rather than substituting the latest version. If that version is unavailable, the reader explains this. An attachment link alone creates no archive-retention guarantee.

The serialized metadata is limited to 4,096 UTF-8 bytes. Titles are limited to 160 characters, explanations to 2,000 characters and labels to 80 characters. Unicode and JSON escaping may reach the byte limit earlier; move longer material into a document.

Reload the current portal before voting on custom polls; older cached interfaces may display binary labels. Existing binary ballots keep their original meaning. Unsupported or inconsistent choice metadata prevents voting in the current interface. Current ballots use `votecommit`, which binds the vote to the contract-checked definition shown to the member. A changed definition rejects the stale vote. Legacy pre-definition ballots retain their original vote path and meaning; funding, election and dispute ballots retain their typed execution rules. See the [module capability review](module-capability-gaps.md).
