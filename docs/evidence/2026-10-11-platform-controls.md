# Compact platform management — 2026-10-11

Create → **Pricing** now navigates in the same tab. Browser Back returns to Create; the link no longer announces a new window.

The [testnet Platform page](https://testnet.app.daclify.com/dao/1/platform) now has three keyboard-accessible sections:

- **Pricing:** compact monthly module rows, graduated membership prices, RAM and pinned storage settings.
- **Catalogue:** search by module name or account, compact entries, and Edit to fill that exact module's registration and description fields.
- **Policies:** shared hosting, Connect commission, module commissions/names and an authority disclosure.

Configured membership/storage allowances, monthly module total and catalogue count appear above the sections. Typed values survive section changes. Related settings use two columns on desktop and stack on mobile. All original input bounds, units, validation and signed action callbacks are preserved; a source comparison confirmed the existing load and signing functions are byte-for-byte unchanged. Every change still requires an active platform administrator and an authorized signer.

## Verification actually run

- Observed five missing-feature browser failures before implementation; the three existing pricing checks passed.
- Final desktop/mobile browser suite: **16 passed**. Covers same-tab navigation and Back, keyboard arrows/Home/End, draft retention, exact catalogue edit fields, locked-signer controls, missing pricing, main-region Axe and horizontal width.
- Frontend `npm run verify`: lint, Vue/TypeScript checks and **43 files / 276 tests passed**. Final lint passed after the requirement-register update.
- Testnet-mode build passed both in the worktree and from a clean committed source archive installed with `npm ci`. The existing large-bundle warning remains.
- Core pricing-navigation documentation was updated; `npm run docs:check` passed.
- The existing native browser journey was updated to navigate the new sections. Its Docker-dependent native fixture was **not run** for this UI-only rollout. Mocked browser signer readiness is not a new native-governance qualification.

The first layout verification found an input label that included the displayed account and an invalid definition-list child. Both were corrected using the failure evidence; the final suite passed without accessibility violations.

## Actual deployed browser and measured size

At **2026-10-11T19:27:23.480Z**, the real HTTPS frontend/API passed on 1440×1000 and 390×844 viewports. Each checked the same-tab Pricing click, one browser page, Back to Create, configured $12 monthly module total, all three Platform sections, catalogue search/edit, disabled visitor signing actions, zero main-region Axe violations, no horizontal overflow and no page errors. No live governance setting was submitted.

| Section | Desktop page height | Mobile page height |
| --- | ---: | ---: |
| Pricing | 2,246 px | 3,915 px |
| Catalogue | 2,226 px | 3,633 px |
| Policies | 1,932 px | 2,987 px |

The original desktop page measured **7,222 px** with all thirteen forms visible. Default Pricing is approximately **69% shorter**, including the unchanged workspace/header/footer.

## Exact testnet delivery

Frontend **0.13.0-alpha.10**, source `cddac91fe86a1baaf0e1125f8db77dec2d7c8d7f`, was built from an immutable archive under `/data/daclify-runtime/releases/20261011-platform-controls/daclify-frontend`. Assets were copied before atomically replacing the static index; old assets and a private index backup were retained. Published index SHA-256: `6f4d6e3c4f51f82f8a6d6e7df6ac804d2b62936b791db7ca32ae9f9408b2b097`.

Core remains **0.13.0-alpha.7**, modules SDK **0.9.0-alpha.23**, and existing module contracts **0.9.0-alpha.5**. The pinned consumer archives remain unchanged: core SHA-256 `0b6c96964c433c8179c98085d51eab7967844417f8faaf91c1f98034f2f5e789`, modules `eed82d21355668e02874d6705a987c7bf9a6207f4fd4f27627715b7217d55d04`. No API restart, native transaction, provider purchase, fee change, credential or recovery alteration was required.

Frontend changes and the core guide update were fast-forwarded into remote **dev**; main was untouched. Original repository checkouts and their separate Telos-governance commits were preserved. This report qualifies the requested testnet UI; it does not qualify new mainnet or real-money behavior.
