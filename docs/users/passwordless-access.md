# Use a paired account on another device

Open **Your account** at the top of the side menu, above **My DAO**. On mobile, open **Menu** first. **All users**, **Sign out** and **Edit profile & account** are icons in the top-right corner of your profile card, with tooltips naming each action. Account settings also keeps sign-out available in every section. Signing out locks your local keys and ends this browser's Daclify session.

Signing out immediately locks keys in other open tabs for the same account and service/network, even if the logout request is delayed or fails. **Lock keys** also locks matching tabs without signing out. If the service confirms your session has ended, the portal clears its account state and keys. The ten-minute inactivity timer remains local to each tab. These controls do not revoke keys already copied to another device. After a portal security update, reload any tabs opened before the update so they use the current locking behavior.

Account settings orders its sections as **Profile**, **Sign-in methods**, **Access & recovery**, then **Payment history**. Opening settings while already signed in starts with Profile, which groups your public details and optional links/images. Sign-in methods brings all five pairing options together; expand a method to manage it. Access & recovery lets you check this device’s key status, unlock or lock keys, download a matching backup, and approve another device. Public IDs and keys are inside **Public join identity**. Links for unlocking, approval setup or device approval open Access & recovery directly; payment returns open Payment history. Account entry still shows access setup. Payment history shows your Daclify service payment receipts and lets you refresh their status. Start checkout from the relevant purchase screen, where the item and price are shown. Sign out is available in every section.

Pairing lets an email, Telegram, passkey, Telos Zero account or Telos EVM account sign into your existing Daclify account. In **Account → Sign-in methods → Fast sign-in with full access**, choose which paired methods should also unlock your signing and private-document keys.

Each method starts as sign-in-only. Unlock your original vault on the current device, select an available protection option and complete setup. On another device, sign in with that enabled method. You receive your original keys and existing private-document access without a vault password or a JSON upload. Keys stay in browser memory and lock when idle; sign in again to unlock them.

The choices have different security properties:

- **Wallet-protected:** your wallet produces a separate private unlock signature. Approve this only in Daclify and keep the signature private. The wallet must reproduce it; only qualified clients can enable this option.
- **Passkey-protected:** a compatible passkey produces an unlocking secret using PRF. New passkeys request PRF support during registration; ordinary passkeys without this capability still sign in. Use a qualified authenticator available on the next device.
- **Daclify-assisted:** the recovery service can unlock the original signing and private-document keys after your selected paired method authenticates. You must explicitly consent. Anyone controlling that method could obtain full access; the service operator also has recovery authority. Assisted authority remains disclosed after disabling the method, because previously obtained keys cannot be recalled. Strict private DAOs require user-controlled identities.

Unavailable options explain the missing qualification. The current shared testnet explicitly offers same-VM assisted recovery with verified TLS and a local restore. That mode does not protect against losing the VM or qualify wallet/passkey protected unlocks. Independent production recovery still requires separate hosting, backups and source-loss qualification; use only the options the connected service actually enables.

If an existing device is unlocked, you can instead use **Account → Access & recovery → Request approval from another device**. Open the QR/link on the unlocked device, compare the displayed verification code on both devices, recognize the receiver and approve. Transfer expires in five minutes and can be received once. The approval link contains no unlocking key. The new device needs no vault JSON or password.

Keep the encrypted JSON kit and its original vault password or separate recovery code as a fallback. No backup system can recover missing keys if every device, kit, supported unlocking method and independent service backup is lost. Recovery retains your account and existing permissions; it does not create new DAO rights.

Operators: see the [OpenBao setup and restore guide](../../../daclify-backend-core/ops/recovery/README.md).
