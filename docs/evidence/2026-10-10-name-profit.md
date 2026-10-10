# Names dynamic prices

Names now explains that account resources and payment costs determine its current totals. Card and native amounts are separate. Checkout keeps name/context validation, key backup and explicit payment confirmation; Stripe returns to Names and shows that account creation follows verification. An unavailable fee reference hides card payment while preserving native checkout.

Pinned development producers: core protocol 0.10.0-alpha.2 and module SDK 0.9.0-alpha.9. The module contract version is unchanged. Frontend version 0.10.0-alpha.8.

Validation: lint and type/template checks passed; 179 unit tests passed with two workers. All 12 desktop/mobile Names browser cases passed, including backup, context-race and seller accessibility checks. A testnet-mode build was staged and inspected before deployment. Initial crypto tests timed out under concurrent full-suite/build load and passed when rerun with bounded workers.

Financial calculations, actual Stripe sandbox fees, signed real-chain read-only qualification and activation evidence are owned by core: [Names profit evidence](https://github.com/Daclify/daclify-backend-core/blob/dev/docs/evidence/2026-10-10-name-profit.md).
