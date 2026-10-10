# Compact account settings

The user requests a slick, compact and intuitive account settings screen, with the supplied principal designer brief authorizing implementation and ordinary design decisions inline.

Verified friction: the default Keys screen exposes service IDs and public keys ahead of useful actions; EVM pairing lives in a separate Linked tab; all other pairing forms and credential history expand together; the profile is one long column. These obscure the distinction between signing in and opening existing private documents.

Use the existing Vue components, warm dark palette, tokens and native accessible disclosures. Keep four sections: Access & recovery (default), Sign-in methods, Profile and Billing. Access & recovery shows this device's key status, unlock/lock/backup actions and device approval together; public identity is a separate disclosure. Put all five paired methods in Sign-in methods, with one compact expandable row per provider and full-access choices below. Keep consent and assisted authority disclosures visible with their controls. Group profile basics in a responsive two-column form and put optional social/image fields in disclosures.

Preserve all authentication, original keys, recovery, fresh account-control proof, wallet authority, backup-matching, profile publishing, payment and embedded profile behavior. No API/schema, custody or provider policy changes. Hosted recovery availability remains truthful. Sign out stays discoverable from every settings section. Tab keyboard navigation and deep-linked device/Telegram/billing flows continue working. Use 44px controls, existing focus styles, bounded content width, mobile wrapping and no horizontal overflow.

Acceptance: desktop/mobile browser checks cover default locked state, all provider controls, public identity disclosure, tab keyboard navigation, embedded settings and accessibility. Existing full-key restoration and real two-device crypto transfer regressions pass. Inspect actual desktop/mobile screenshots; run lint, types, unit tests and testnet build. Preserve concurrent contract-map edits.
