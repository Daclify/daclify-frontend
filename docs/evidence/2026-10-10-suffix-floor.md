# Suffix account minimum price UX

Names seller forms show the current basic-account native minimum and USD reference minimum. New forms start at the native minimum. Both suffix offers and dotted exact-name registrations/edits reject a supplied nonzero price below that rail's minimum, using the canonical contract error. The USD field is an optional seller reference; third-party card checkout remains disabled. Public catalogue and seller inventory values are labelled seller references; check a name for its current payable quote. The contract applies the same floor and clamps legacy offers at fulfillment.

Core public SDK 0.10.0-alpha.3 and module metadata 0.9.0-alpha.10 are pinned by verified tarball integrity in frontend 0.10.0-alpha.9. Names code hash is 76714f4a8980b8405fb79e64a127c7492558960ebe63a79185ce6d3cb0a38c8a.

Validation passed: 179 unit tests, lint, strict Vue template/TypeScript checks, testnet build and all 14 desktop/mobile Names browser tests. A 390px mobile test reproduced the existing seller-guide target at 20px; its target was expanded to 44px and the regression passed, including WCAG 2.2 AA checks.

[Public live browser evidence](2026-10-10-suffix-floor-public-browser.json) uses the deployed HTTPS frontend and real API at desktop 1440px and mobile 390px. Both show default 71.5910 TLOS and USD reference minimum 142 cents, reject a below-minimum unsigned export and accept an exact-minimum export. There are zero accessibility violations, page errors and horizontal overflow. Exports were unsigned; no seller wallet was signed or account purchased. [Contract and server evidence](../../../daclify-backend-core/docs/evidence/2026-10-10-suffix-floor.md) records compatible deployment and native simulations.

Integrated into local dev. Remote publication requires GitHub server authentication; production/main release remains outside this change.
