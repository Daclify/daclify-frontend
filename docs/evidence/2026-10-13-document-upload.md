# Compact document upload and approval

13 October 2026. Frontend alpha28 with the unchanged core20/modules28 public SDK cohort.

The original dialog hid its file picker whenever a signer was unavailable. It then displayed storage administration and a locked-vault message without an unlock control. The new file-picker regression failed against that behavior before implementation.

Add document now opens a 560px card with the file and editable name first. A matching saved account can unlock its keys inside the dialog without losing the selection; existing authorized wallets remain available. The single Add document action verifies the upload before signing its permanent record. A failed approval retains the verified upload, so retry does not upload another copy. Already encrypted verified records retain the existing ability to publish through an authorized wallet without unlocking decryption keys. New private uploads still require their encryption keys and current access grant.

JSON is under Other formats. Storage usage is a compact footer, while recovery, detailed usage and capacity administration remain in Resources. No backend or native permission has been broadened.

Verification passed strict Vue/TypeScript, lint and 348 unit tests across 61 files. The full workspace browser suite passed 28 desktop/mobile cases, including real disposable vault unlocking, signed payload verification, stable retries, JSON drafts and accessibility. Eight additional browser cases passed against a fresh disposable native chain and PostgreSQL database: public response-loss/reload recovery, encrypted publication and download integrity, shared-CID accounting and recovery in Resources. The recovery case uses synthetic batch responses to test that interface; the file publication/download/accounting cases use the actual local API, database and contracts. The disk provider is a fixture; these results do not qualify Pinata.

Initial local runs encountered exhausted file watchers, one DAO-setup 503, and a later native-RPC-unavailable reload while other checks ran. Polling removed the watcher problem; the final fresh native run passed all eight cases without concurrent compiler/unit/browser load. Failures and successful outputs remain in `/data/daclify-runtime/document-upload-20261013`.

Physical wallets/passkeys, live Pinata upload and an authenticated journey in the user's own account were not requalified. Native contracts, public protocol, database schemas and production deployment are unchanged.
