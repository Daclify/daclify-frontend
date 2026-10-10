# Users, Names, Create DAO and Services review — 2026-10-10

Development frontend **0.10.0-alpha.7**; Vue 3/Vite/Pinia and existing design tokens retained. Core **0.10.0-alpha.1**, modules SDK **0.9.0-alpha.8** and module contracts **0.9.0-alpha.5** remain pinned. The separately completed safe-Markdown Help work is preserved.

## Findings ranked by user impact

1. **Verified correctness failures:** stale name quotes could reappear after input changes; a response for a different name could reach purchase UI; directory/profile matching omitted part of the DAO reference. Regression cases reproduced the failures before changes.
2. **Verified recovery failures:** profile request errors looked like missing users, name discovery errors retained “Reading the chain,” and failed DAO availability lookup had no focused recovery. Own cards ignored search; there was no filter reset.
3. **Verified live prerequisites:** Telegram widget rejects the domain, free creation disagrees with current on-chain settings, and Names has no tiers/offers. Service credentials alone cannot establish working payments or funded uploads.
4. **Design judgments:** Names buried its main search behind a large inspiration panel and placed key backup after listings; DAO setup needed a readable summary; Services repeated a long undifferentiated list; empty profile covers consumed space.

## Implemented

- **Users / PeopleGrid:** result counts, explicit loaded search scope, consistent filtering including the own card, reset, guarded pagination, contextual failure and retained results. Directory/member/profile labels use current complete DAO references. An own profile lookup cannot settle over a changed membership. The optional privacy explanation remains available.
- **User details:** compact header when there is no cover, public membership status/context, external-link announcement, a retryable error state and guarded own editing. Failed reads no longer assert that a member is missing. Existing profile publication/account controls and image fallbacks remain.
- **Names:** search first; quoted account/price → key backup → payment in sequence; optional suggestions and catalogue. Input/context changes immediately invalidate old requests, quote names must match, service discovery can retry, blocked copying has recovery guidance, and delayed clipboard completion cannot label replacement keys as copied. Card-only pricing is not presented as a usable checkout when disabled. Existing signing, saved-key acknowledgement and fresh-price/context checks remain authoritative.
- **Create DAO:** numbered sections, live purpose/participants/privacy/asset/voting summary, separate readiness errors/retry and concrete operator prerequisites. Native disclosures keep optional governance/treasury settings accessible. Orders remain immutable, resumable and explicitly executed; prices, governance, custody and settlement are preserved.
- **Status Services:** all reported services grouped into Sign-in/accounts, Payments/hosting, Files/storage, Help/learning and a fallback group. Search/readiness filters, counts/reset, useful guide destinations and optional operator details. Configuration remains distinct from live qualification.

Changed components: `PeopleGrid.vue`, new `ServiceDirectory.vue`, `Users.vue`, `UserDetail.vue`, `Names.vue`, `CreateDao.vue`, `Status.vue`; targeted browser regressions and development metadata/documentation updated. No dependencies or producer schemas added.

## Verification and review

- `npm run verify`: lint policy, Vue/TypeScript and **179 unit tests passed**. Later page changes also passed fresh Vue checks through the testnet build and final lint/format checks.
- Browser regressions cover directory filtering and pagination, profile retry/foreign references, name races and purchase sequence, DAO readiness/guarded-agent policy, every Status tab, keyboard controls, enlarged text, accessibility and recovery. The dedicated payment and network-lock configurations are used for their respective fixtures.
- Initial tests were observed failing before each meaningful behavior fix. One first quote fixture omitted required producer fields and was corrected before its race test was rerun red. A profile assertion was made specific to its level-one heading so a prior member-card heading could not satisfy navigation. Duplicate unlabeled notice landmarks were replaced with ordinary notices; a service label/button name was corrected after browser failures.
- An initial network-lock selection used the generic config and failed against an absent local API; the dedicated network-lock config subsequently passed all six cases. Synthetic browser/payment tests do not establish real consent or settlement.
- Baseline public desktop/390px phone screenshots and selected WCAG 2.2 AA Axe scans had zero reported violations/overflow. Actual changed screens were rendered and inspected at desktop/mobile sizes, including profile, name purchase, DAO form and service directory. No physical screen-reader qualification is claimed.
- Build uses `--mode testnet` into a staging directory, followed by assets-first delivery and atomic index replacement. Existing hashed assets are retained for open tabs. The existing large documentation chunk warning remains; no bundle-performance improvement is claimed.

Artifact scripts/logs/screenshots are ignored under `.artifacts/user-setup`; source tests are reproducible. The final diff is reviewed inline; workspace instructions prohibit delegation, so this is not an independent reviewer assessment.

## Operational limits and next actions

See the [backend service qualification](../../../daclify-backend-core/docs/evidence/2026-10-10-service-qualification.md) for the real sign-in/provider checks, sandbox products/webhooks, mail and private Telegram setup, and the complete 14-service inventory.

Physical wallets/passkeys, human email/Telegram approval, real invoice/native settlement, funded gateway budget, guarded cleanup and managed custody remain unqualified. BotFather domain setup, shared-creation policy and basic-name pricing decisions are pending with the user. These are not presented as completed service work.

GitHub publication requires credentials on this server; local development commits and deployed assets are recorded after delivery.

## Verified testnet delivery

The public app was checked directly through HAProxy/TLS at 1440px and 390px after deployment: Users, Names, Create DAO and Services produced no page errors, no horizontal overflow and zero reported violations in the selected WCAG Axe rules. A public member detail also passed the scan and layout check. Forty-nine loaded public assets matched local deployed bytes by SHA-256. The secret scan checked 13 distinct configured secrets against 93 text artifacts with zero matches before delivery. The final compact Services rendering is checked separately below.

The final browser evidence comprises the 60-case page selection plus updated complete People (20) and Names (10) selections; additional clipboard/own-profile cases (6), Services/enlarged-text selection (4), dedicated payment consent/presentation (4) and network lock (6) pass. Counts overlap across reruns; they are not a sum of unique cases. Core targeted tests total 91, with exact selections in backend logs.

Two generated disposable private keys in a deliberately failing clipboard test's diagnostic snapshot were redacted locally; those artifacts are ignored and are not source or delivery files. The final diff contains no configured secrets.

Final delivery retained old hashes and verified 113 staged files. The final scan covered 96 text artifacts against 13 configured secrets with zero matches. All eight public desktop/phone page scans passed again after the compact Services adjustment. Public index SHA-256 matches the final local index. Services details carry the repeated readiness explanation inside native disclosures; the live phone panel height is recorded in the final browser artifact.
