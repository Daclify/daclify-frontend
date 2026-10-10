# Account Settings Implementation Plan

> Execute inline with superpowers:executing-plans. The workspace forbids sub-agent delegation; the user reviews completed work.

**Goal:** Make account settings compact and intuitive while preserving all account capabilities.

**Architecture:** Reorganize existing components and native details elements. Retain canonical APIs and authentication logic.

**Tech Stack:** Vue 3, TypeScript, existing CSS tokens and Lucide, Playwright/Axe.

**Spec:** [Account settings design](../specs/2026-10-10-account-settings-design.md).

## Constraints and review focus

- Preserve vault and backup identity matching and assisted authority disclosures.
- Preserve embedded Profile default and Telegram/device/billing entry behavior.
- Keep collapsed provider controls mounted so widget and pending verification flows survive.
- Mobile, keyboard and zoom users can reach every action without horizontal overflow.
- Preserve wallet-only recovery and original-key transfer; no provider qualification claims.

## Task 1: Settings organization and presentation

Files: Account.vue, SignInMethods.vue, LinkedAccounts.vue, NativeWalletPanel.vue, DeviceApproval.vue, FastSignInMethods.vue, ProfilePanel.vue; account settings browser regression and callers in existing browser tests/public smoke.

- [x] Add a browser regression for four task-oriented tabs, collapsed public identity, all five provider controls, keyboard navigation, accessibility and narrow viewports. Run it against the current UI and record its expected failure; save baseline screenshots.
- [x] Reorganize access and device actions; consolidate EVM with other sign-in methods; use compact native disclosures and responsive profile fields. Update changed accessible labels in callers and existing tests.
- [x] Run the new regression, existing account entry/provider/wallet/paired recovery/device tests and inspect desktop/mobile screenshots. Fix issues and review the diff inline.
- [x] Run lint, typecheck, units, production build; update user guidance and evidence, commit only owned files and push dev. Deliver the checked frontend build to testnet under existing authorization.
