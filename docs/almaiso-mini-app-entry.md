# Almaiso mini-app account entry

Garden Care's `daclify` branch uses the existing registered-client OAuth flow.
Its three sign-in choices carry UI-only preferences in the authorize URL's
fragment: `daclify_method=telegram|email|passkey`, `daclify_chain`,
`daclify_runtime`, and `daclify_dao`. These are navigation preferences, never
credentials or admission authority. No OAuth query schema or public SDK
artifact changes are required. Browsers retain the fragment across the
issuer's authorize redirect to `/apps/consent`.

Consent keeps the safe local return destination and opens Account with the
requested method selected. SignInMethods uses existing Telegram, email and
passkey verification. QuickSignup retains the selected supported email or
Telegram path, explicit recovery consent and provider availability gates.
Passkeys authenticate an already paired account; new people can set up email
or Telegram and later pair a passkey in Account.

For an authenticated nonmember, consent offers the matching network's DAO
Members page and keeps the app-consent return path. Its normal native admission
policy still applies. A recheck loads current membership again. An active member
can return from Members to app sign-in. An expired app request requires a fresh
login from the original app; the seven-day Garden Care invite remains there.

Only validated enum methods are accepted. DAO hints use the public DaoRefSchema,
full chain/runtime matching and full-range decimal IDs. Duplicate or mismatched
namespace hints offer no join shortcut. The Members page displays the selected
DAO and requires its existing authorized admission operation. App access still
requires the registered client's actual current membership, regardless of hints.
No invitation token is forwarded to this UI or stored as an account credential.

Qualification is source and fixtures: 366 unit tests, lint, Vue typecheck and
build pass; 36 account-entry browser cases plus two admission/recheck cases pass
on desktop/mobile. These tests use validated owned HTTP fixtures, not live
Telegram/email delivery, real user passkeys or a registered Almaiso DAO. Existing
VM watcher-limit and bundle-size warnings remain. Source changes on `dev` are
not a production release; deployment and real provider/DAO qualification remain
separate steps.
