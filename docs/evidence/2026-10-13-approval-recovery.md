# Guided approval recovery

Frontend 0.15.0-alpha.31 consumes the unchanged core protocol 0.15.0-alpha.20 and modules 0.10.0-alpha.28. This is a frontend correction to [unified approval setup](2026-10-13-unified-approvals.md); no API, SQL or contract change is included.

## Cause and behavior

A paired wallet can act in a DAO where it already has a native/EVM member binding. A new binding additionally needs the member's existing signing-key consent. The old setup called activation with locked keys and displayed `VAULT_LOCKED`, despite calling the membership ready. Kit restoration also unmounted setup and discarded selections.

The primary button now opens **Account keys and recovery** inside the card before activation. It offers the saved kit, explicitly enabled full-access sign-ins (including Google), another unlocked device, or encrypted-kit restoration. Sign-in-only methods are not presented as key recovery. Kit restoration uses the existing dialog component, retains the setup component and selections, and returns focus to explicit approval after successful recovery. First-time activation still requires original keys and incoming-wallet consent; no global wallet authority or new identity is created.

The current activation helper remains authoritative: fresh membership, pairing, binding, nonce and account/network/wallet/location checks are unchanged. Already enabled selected wallets need no key recovery. Mismatched unlocked signing keys fail visibly rather than cycling through unlock.

## Verification

Before implementation, two browser regressions failed on the missing unlock status/button. The different-key case additionally reproduced an endless unlock step; the Google-only case reproduced a missing recovery control.

Final checks passed:

- `npm run lint`: five policy/register checks; strict TypeScript/Vue via `npm run typecheck` passed.
- `CHOKIDAR_USEPOLLING=1 npm test -- --maxWorkers=4`: 364 tests across 62 files passed.
- Playwright with `playwright.config.ts`: 74 desktop/mobile cases across unified approvals, account settings, fast sign-in, account entry and wallet recovery passed. This includes dialog/keyboard accessibility, wrong passwords/keys, retained selections, explicit approval, already enabled locked wallets, configured sign-ins/Google, creation/claim destinations and partial activation retry.
- Formatting of changed Vue/TypeScript/JSON and `git diff --check` passed; final diff reviewed inline under the workspace's no-delegation rule.

The browser fixtures use disposable encrypted kits, genuine K1 consent verification, synthetic HTTP responses and mocked external wallets/Google SDK. They do not prove physical-wallet or live Google qualification.

Existing account-entry checks exposed initial dialog focus and duplicate password selectors. The final form uses dialog autofocus and the existing signed-out recovery title; wallet-recovery tests scope their input to the active dialog. An early invocation incorrectly forwarded the worker limit to npm, exhausted host watchers and was stopped. The final run used polling and four Vitest workers.

## Delivery

Frontend code `f6dcf4f20f4732321bdfdb092ae7f157ba8c7ffb` was committed and pushed to dev. A clean detached checkout passed `npm ci` and its testnet-mode build. Candidate and actual hosted startup/network/page checks passed 8/8 each, on desktop and mobile, including a saved production preference and reload. The hosted HTML matched the checked candidate's SHA-256 `975da066dd24a868e3355973f1c3a832eb080691ae002da80e69e6583dfc08ae`.

Published at 2026-10-13 23:08:30 UTC to https://testnet.app.daclify.com. The previous entry and hashed assets are retained for rollback. No API restart, native upgrade or production deployment occurred. The private execution packet is `/data/daclify-runtime/approval-unlock-20261013`.
