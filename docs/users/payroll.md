# Adding payroll

Open your DAO’s **Payroll** tab. Search and **Ongoing schedules** share a compact toolbar with **+** and help on the right, above the list. The toolbar wraps on smaller screens. The **+** opens **Add payroll**; the help icon beside it opens the matching **Rules & help** with your DAO context.

Active administrators can prepare a payroll. Choose an active recipient by their public profile or wallet name. Members without either use a stable member reference. Missing member records offer retry; optional profile-name failures fall back to wallet/member references. Records from another DAO cannot supply a recipient.

Enter a positive **whole-token** amount per installment, such as **10 TLOS**. Amounts start empty and decimals, grouped numbers, zero and exponent notation are rejected rather than rounded. Choose **1–12 installments**, paid every **1–31 days**, and a future first due date within **31 days**. The date field is explicitly in **UTC**. Review the exact total and check **I checked the recipient, installments and total**. Editing any recipient, amount, term or date clears that confirmation.

**Commit funded payroll** reserves and approves the entire term immediately, so approved installments cannot be cancelled. Choose only a term the DAO intends to honor. An authorized signer, installed commit permission and a verified compatible deployment are required to submit. The contract remains authoritative for recipient eligibility, treasury backing and payment obligations.

Cancel, the close button and Escape preserve the draft. A failed submission also preserves it for retry. While submission is pending, editing and closing are disabled. Confirmed success closes the popup and clears the recipient and amount; changing DAO or account clears scoped drafts. Existing scheduled payments, settlement and pause behavior continue to follow the approved obligations.
