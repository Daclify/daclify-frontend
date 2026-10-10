# Account entry and recovery — 10 October 2026

Frontend development release **0.10.0-alpha.4**, starting from fetched `dev` **daee47c**. Core protocol **0.10.0-alpha.1**, modules SDK/help **0.9.0-alpha.8** and module contracts **0.9.0-alpha.5** remain pinned. The backend repositories are clean and unchanged. No API/schema, provider credentials, environment files, custody services, contract permissions or dependencies changed.

## Findings and delivered experience

| Priority | Evidence or design judgment | Delivered behavior |
| --- | --- | --- |
| High | All provider forms preceded creation; technical recovery caveats and unavailable managed signup competed with primary choices. | Responsive Welcome back/New to Daclify areas, one selected provider form, secondary managed disclosure and separate kit recovery. Top shortcuts reach creation/recovery on a phone without losing `returnTo`. |
| High | An email request in flight still left Create encrypted vault and recovery enabled; reproduced by a failing assertion. | Provider/wallet busy state disables competing entry flows. The native/EVM panels report busy state; method changes wait until completion/cancellation. Vault creation also has a submission guard. |
| High | Public-options failure looked like unconfigured providers, with no focused retry. | Explicit checking, failed lookup, unavailable and configured states; retry preserves creation and wallet choices. |
| Medium | A legacy Telegram username could mount the widget despite `configured: false`; the old mount watched username alone. | Honor the producer's configured flag and watch both username and the live host. Enter mode mounts only after selection; switching/unmounting removes its script host and global callback. Mini App proof remains untrusted until backend verification. |
| Medium | Email address and code forms appeared together, allowing a confusing recipient change. | Separate address/code steps, fixed recipient during verification, pending labels, resend and change-address actions. Backend proof, account-control confirmation and code checks remain authoritative. |
| Medium | Recovery replaced the entry page without moving keyboard focus. | Focus the file input when recovery opens and return focus to the appropriate entry action or authenticated Keys tab on cancel. Disable recovery inputs/cancel while restoring. |
| Medium | Narrow/enlarged text cramped fixed columns and password actions. | Content-based wrapping grids, scalable headings/labels, wrapping password tools and 44px control targets. Existing tokens, Inter and installed Lucide icons are reused. |

Saved vaults appear before alternative methods and cannot be overwritten by new-account creation. Creation still generates real signing/encryption keys and requires acknowledgment of the encrypted kit and separate recovery credential before finishing. Provider sessions do not unlock user-controlled keys. Linked wallets can authorize supported DAO actions; recovery creates no membership and does not recover document-decryption keys. Authenticated Keys/Sign-in/Profile/Linked/Service tabs remain available, including the embedded self-profile editor.

Telegram's [OIDC setup](https://core.telegram.org/bots/telegram-login) requires registered origins/redirects; the [legacy login widget](https://core.telegram.org/widgets/login-legacy) requires a bot-linked domain. The screenshot's “Bot domain invalid” is an operator/provider setup issue. This update explains it; it does not claim to register or repair that domain.

## Actual verification

Node **24.21.0**, npm **11.19.0**. Disposable HTTP fixtures use producer schemas. Existing local frontend/testnet services were left running; no real account or provider was modified.

| Check | Result |
| --- | --- |
| Initial red tests | Three failures reproduced missing method selection, setup separation and provider-lookup recovery. |
| Recovery focus | One failing assertion reproduced the missing file-input focus, then passed with the fix. |
| Pending email | One failing assertion reproduced enabled creation during a pending email request, then passed with coordinated busy state. |
| `npm run verify` | Passed lint policy (5 checks), Vue/TypeScript and **168 unit tests** across 33 files. |
| `npm run format:check` | Passed. |
| Fixed testnet static build | Passed. Existing >500 kB chunk warning remains; no performance improvement is claimed. |
| Expanded account + wallet recovery browser check | **30 passed** across desktop/mobile Chromium, before the additional authenticated-management case. |
| Final account/workspace/people/module/theme/recovery integration | **104 passed** across desktop/mobile Chromium on port **5359**, including authenticated method management. No final selected tests failed or were skipped. |
| Accessibility/layout | Zero Axe violations in scanned entry/selected-method states; no horizontal overflow at tested sizes or 200% root text. This is not full WCAG qualification. |
| Visual review | Desktop, phone, tablet, landscape, 320px, selected EVM and 200% text screenshots inspected. |
| Final review | Connected callers, public producer schemas, challenge validation, key/session separation, widget lifetime, pending-flow guards, responsive controls and documentation reviewed. `git diff --check` passed. |

The new account suite covers keyboard selection, configured/unavailable/local-only providers, provider retry, no eager Telegram embed, callback cleanup/reopening, Mini App rejection, pending email, fixed-recipient code retry/resend, successful provider session with locked keys, complete return destinations, saved-vault precedence, actual password generation/clipboard/visibility and native anchor focus. A held synthetic EVM wallet request checks the entry interlock and cancellation recovery. Authenticated management keeps all existing paired-method controls and key backup/lock actions visible.

Creation/unlock/recovery checks use actual browser encryption and real Antelope signatures. The HTTP fixture verifies the login signature and both keys against the canonical login v3 message. A fresh browser restores the same signing/encryption identity from the downloaded encrypted kit and separate credential. The wallet-only attachment test verifies the new vault signature and a canonical account-control proof envelope; its EVM signature is synthetic and does not qualify EVM verification.

The first broader run passed **96/98**; two failures came from old wallet-recovery fixtures using v1 messages without the required API audience. Those fixtures now use the existing producer v2 schemas. An extra management test initially supplied the public-options `passkey` field to the strict methods schema, then requested a recovery button that is absent for an already-unlocked account. Both test assumptions were corrected. A later rerun overlapped a still-running test server and was interrupted after connection failures; its results are discarded. Final integration uses its own **5359** port after the earlier runner stopped.

```sh
DACLIFY_TEST_UI_PORT=5359 npx playwright test \
  tests/e2e/account-entry-experience.spec.ts tests/e2e/dao-workspace-experience.spec.ts \
  tests/e2e/people-workspace.spec.ts tests/e2e/module-cards.spec.ts \
  tests/e2e/theme.spec.ts tests/e2e/wallet-recovery.spec.ts \
  --config playwright.config.ts
npm run verify
npm run format:check
VITE_NETWORK=testnet VITE_API_TESTNET=https://testnet.api.daclify.com npm run build
```

Ignored local logs: `.artifacts/account-entry-red.log`, `.artifacts/account-entry-focus-red.log`, `.artifacts/account-entry-busy-red.log`, `.artifacts/account-entry-recovery-green.log`, `.artifacts/account-entry-integration-final.log`, `.artifacts/account-entry-verify.log`, `.artifacts/account-entry-format.log`, `.artifacts/account-entry-build.log`. Screenshots are reproducible under `.artifacts/browser/account-entry-experience-*`.

## Limits

Live Telegram OIDC/widget registration, mail delivery, Anchor/EVM wallets, managed custody and native-chain execution were not exercised. `sign-in-methods.spec.ts` was updated for method selection but was not run; it requires its owned API/native fixture. Public configuration flags and synthetic responses do not establish live readiness. Safari/Firefox, physical assistive technology, load and bundle performance remain unqualified. No production deployment or main-branch release occurred.
