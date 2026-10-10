# Use a paired account on another device

Pairing lets an email, Telegram, passkey, Telos Zero account or Telos EVM account sign into your existing Daclify account. In **Account → Sign-in → Fast sign-in with full access**, choose which paired methods should also unlock your signing and private-document keys.

Each method starts as sign-in-only. Unlock your original vault on the current device, select an available protection option and complete setup. On another device, sign in with that enabled method. You receive your original keys and existing private-document access without a vault password or a JSON upload. Keys stay in browser memory and lock when idle; sign in again to unlock them.

The choices have different security properties:

- **Wallet-protected:** your wallet produces a separate private unlock signature. Approve this only in Daclify and keep the signature private. The wallet must reproduce it; only qualified clients can enable this option.
- **Passkey-protected:** a compatible passkey produces an unlocking secret using PRF. New passkeys request PRF support during registration; ordinary passkeys without this capability still sign in. Use a qualified authenticator available on the next device.
- **Daclify-assisted:** the recovery service can unlock the original signing and private-document keys after your selected paired method authenticates. You must explicitly consent. Anyone controlling that method could obtain full access; the service operator also has recovery authority. Assisted authority remains disclosed after disabling the method, because previously obtained keys cannot be recalled. Strict private DAOs require user-controlled identities.

Unavailable options explain the missing qualification. The prepared OpenBao service is off until independent hosting, backups and a source-loss restore have been verified.

If an existing device is unlocked, you can instead use **Account → Keys → Request approval from another device**. Open the QR/link on the unlocked device, compare the displayed verification code on both devices, recognize the receiver and approve. Transfer expires in five minutes and can be received once. The approval link contains no unlocking key. The new device needs no vault JSON or password.

Keep the encrypted JSON kit and its original vault password or separate recovery code as a fallback. No backup system can recover missing keys if every device, kit, supported unlocking method and independent service backup is lost. Recovery retains your account and existing permissions; it does not create new DAO rights.

Operators: see the [OpenBao setup and restore guide](../../../daclify-backend-core/ops/recovery/README.md).
