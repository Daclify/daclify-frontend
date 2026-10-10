# Account entry experience

Goal: Make returning sign-in, new account creation and recovery understandable without displaying every provider form and technical caveat at once.

Scope: frontend `dev`, starting at fetched `daee47c`; existing account/vault/session APIs, wallet authorization, recovery envelopes and paired-identity rules stay unchanged. No provider credentials, public URLs, custody backend or on-chain authority changes. User's design brief authorizes routine implementation; repository rules require inline work without delegation.

Design: Use the existing dark/amber identity and tokens. A responsive Welcome back area offers local vault unlock first when present and a grid of paired sign-in methods. Selecting a method reveals its existing controls. New to Daclify contains user-controlled vault creation; unavailable managed signup is a secondary disclosure. Recovery is a distinct accessible destination below both areas. Keep the current authenticated account tabs and embedded profile behavior.

Alternatives considered: a page-level Sign in/Create tab would hide creation and break established entry journeys; showing every form in a card grid would retain the current overload. A two-purpose layout with progressive provider disclosure keeps both primary intentions visible with less text.

## Tasks

- [x] Add canonical synthetic account-entry browser fixtures and reproduce missing method selection, clear setup separation and provider-load recovery.
- [x] Refine `Account.vue` entry/restore/backup presentation; preserve local-vault precedence, generation/copy/backup acknowledgment, return destinations, wallet-only restoration and authenticated sections.
- [x] Refine `SignInMethods.vue` enter-mode chooser, configuration loading/retry, selected provider form, email-code feedback and third-party widget lifecycle. Management remains fully available. Reuse `NativeWalletPanel` and `LinkedAccounts`, with concise first-use copy and recoverability details.
- [x] Update affected passkey entry expectations and extend browser tests for options failure, unavailable/local-only providers, no eager Telegram embed, OIDC/Mini App choices, email pending/retry/identity consistency, saved-vault precedence and real cryptographic creation/unlock/recovery.
- [x] Exercise desktop/phone/tablet/landscape, narrow and enlarged text, keyboard, reduced motion and Axe; inspect actual renders. Run relevant existing recovery/workspace/theme/help suites and frontend checks.
- [x] Review connected auth boundaries; update README/changelog/test map/evidence and frontend-only development version; commit/push `dev`.

Telegram's official login documentation requires pre-registered origins/redirects; the legacy widget requires a bot-linked domain. Configuration cannot be repaired by restyling. Provider login does not unlock user-controlled keys. Wallet recovery does not create a new DAO membership or recover document decryption keys. These distinctions must remain visible at the relevant step.

Tests use disposable browser vaults and canonical synthetic HTTP responses. They cannot qualify live Telegram, email, Anchor/EVM wallets or managed recovery.

Verification: frontend 0.10.0-alpha.4; 168 unit and 104 selected browser tests passed, with Vue/TypeScript, lint, formatting and a fixed-testnet build. Evidence and limits: [account entry report](../../evidence/2026-10-10-account-entry-experience.md). Delivery is to frontend dev; backend repos remain unchanged.
