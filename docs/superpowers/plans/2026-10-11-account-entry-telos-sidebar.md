# Account entry and Telos sidebar implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. Workspace instructions prohibit delegation; the user reviews the completed work.

**Goal:** Start Account with Login, New Account and Restore Account cards, offer four creation methods, and locate Telos governance under Telos DAO in the sidebar.

**Architecture:** Reuse Account's existing login, vault and kit-recovery flows. QuickSignup owns the four creation choices and continues using the existing assisted email/Telegram ceremony; NativeWalletPanel adds the existing verified native signup purpose. Keep `/telos` as the standalone governance route, with a sidebar entry below Daclify DAO.

**Tech stack:** Existing Vue 3, TypeScript, Vue Router, Lucide and Playwright; no new dependencies.

**Spec:** The user's precise labels/layout and screenshot in the current session. Prior native signup creates or reuses a wallet-only paired profile, with separate Daclify key attachment.

## Global constraints

- Exact labels: Login, New Account, Restore Account; Create with: E-Mail, Telegram, Telos Zero, Own Keys; Telos DAO below Daclify DAO.
- Preserve verified login, assisted consent, encrypted kit checks, saved-vault replacement acknowledgement and returnTo.
- Email/Telegram require assisted consent and configured providers. Native and Own Keys remain usable without assisted consent; native pairing alone does not grant Daclify private keys.
- Callback signup IDs resume the New Account view. Back cannot abandon an in-flight ceremony and restores keyboard focus to the originating card.
- Work inline on dev, commit/push and update the existing testnet frontend under the continuing deployment authorization. API/contracts stay on their current deployment.

## Review focus

- Pending Telegram signup redirect opens its existing ticket and preserves returnTo.
- Back and provider switching cannot accept late authentication or discard an active signing ceremony.
- Existing local vaults retain the explicit replacement acknowledgement.
- Unavailable assisted providers still show the four choices, with native/own-key alternatives enabled.
- Telos sidebar works with folded/mobile navigation and closes the menu on navigation.

## Task 1: Account choices and creation methods

**Files:** `src/views/Account.vue`, `src/components/QuickSignup.vue`, `src/components/NativeWalletPanel.vue`; account-entry, quick-signup, assisted-recovery and other affected browser callers.

**Interfaces:** QuickSignup emits `ownKeys(active: boolean)` to show Account's existing vault form. NativeWalletPanel accepts `mode: 'enter' | 'manage' | 'signup'`; signup invokes `api.nativeChallenge('signup', account)` / `api.nativeFinish('signup', id, proof)` and emits the existing authenticated Account.

- [x] Add failing browser assertions for three initial cards, isolated Login/New/Restore screens, Back/focus, four creation choices and native signup without a governance transaction.
- [x] Observe missing-card/native-signup failures against existing source.
- [x] Implement the smallest view-state change and reuse guarded native signup; preserve all existing ceremony functions.
- [x] Update affected browser journeys to select Login/New Account/Own Keys/Restore Account explicitly; verify consent, callbacks, saved vault, cancellation and restore cases.
- [x] Run relevant desktop/mobile browser checks and the complete frontend unit suite.
- [x] Commit the reviewed implementation.

## Task 2: Telos navigation and testnet delivery

**Files:** `src/App.vue`, `src/views/Hub.vue`, `tests/e2e/catalogue-navigation.spec.ts`, public browser tooling, requirements register and evidence.

**Interfaces:** Sidebar link `Telos DAO` navigates to existing `/telos`; operator navigation uses the existing leaveOperator boundary. Remove the Telos link from the shared Hub/My DAO view.

- [x] Add failing exact-order/sidebar assertions and assert My DAO contains no Telos governance shortcut.
- [x] Add the sidebar link below Daclify DAO and remove the Hub shortcut.
- [x] Verify keyboard/mobile/folded navigation, live contract-history reads and all new account screens with Axe and viewport checks.
- [x] Run lint/types/build, review the complete diff inline, update explanatory evidence and push dev.
- [x] Build a committed-source testnet frontend candidate, publish its entry last with old assets retained, and verify actual public desktop/mobile flows.


## Execution record

Completed inline. Implementation/source commit: `e98990a177eab73775f432327a79c39b9a208c54`. Unit/type/lint checks, 104 selected browser cases and actual public desktop/mobile checks passed. Build/publish used the committed standalone source. Detailed failed/corrected/unrun checks and runtime limits: [execution evidence](../../evidence/2026-10-11-account-entry-telos-sidebar.md).
