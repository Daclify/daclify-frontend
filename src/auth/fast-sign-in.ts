import {
  RecoveryContextSchema,
  recoveryVaultDomain,
  type Account,
  type RecoveryMethod,
  type RecoveryContext,
} from '@daclify/core-protocol';
import {
  createRecoveryBackup,
  createRecoveryPayload,
  createRecoveryRecipient,
  openRecoveryBackup,
  openRecoveryPayload,
  openRecoveryDelivery,
  sealRecoveryDelivery,
} from '@daclify/core-protocol/sdk';
import { api, takeRecoveryGrant } from '../api/client';
import {
  recoveryContextGuard,
  installRecoveredVault,
  withUnlockedVault,
  acceptProviderSession,
} from './session';
import { evmRecoveryMaterial, connectEvm, evmWallet } from './telos-evm';
import { nativeRecoveryMaterial, connectNative, nativeWallet } from './telos-zero';
import { requestOptions, passkeyRecoveryMaterial, assertionProof } from './webauthn';
let passkeyMaterial: { credentialKey: string; material: Uint8Array } | null = null;
export function rememberPasskeyRecovery(value: ReturnType<typeof passkeyRecoveryMaterial>): void {
  passkeyMaterial?.material.fill(0);
  passkeyMaterial = value
    ? { credentialKey: value.credentialKey, material: Uint8Array.from(value.material) }
    : null;
}
async function material(context: RecoveryContext): Promise<Uint8Array> {
  if (context.credentialKey.startsWith('evm:')) {
    const chain = Number(context.credentialKey.split(':')[1]);
    if (chain !== 40 && chain !== 41) throw new Error('RECOVERY_METHOD_UNAVAILABLE');
    if (!evmWallet.value) await connectEvm(chain);
    return evmRecoveryMaterial(context);
  }
  if (context.credentialKey.startsWith('native:')) {
    if (!nativeWallet.value) await connectNative();
    return nativeRecoveryMaterial(context);
  }
  if (context.mode === 'passkey-protected') {
    const value = passkeyMaterial;
    passkeyMaterial = null;
    if (!value || value.credentialKey !== context.credentialKey) {
      value?.material.fill(0);
      throw new Error('PASSKEY_PRF_UNAVAILABLE');
    }
    return value.material;
  }
  throw new Error('RECOVERY_METHOD_UNAVAILABLE');
}
export async function restoreFastSignIn(account: Account): Promise<boolean> {
  const grant = takeRecoveryGrant(account.id);
  if (!grant) {
    rememberPasskeyRecovery(null);
    return false;
  }
  const check = recoveryContextGuard(account),
    recipient = await createRecoveryRecipient();
  check();
  const response = await api.claimRecovery({ grant, recipient: recipient.publicKey });
  check();
  const { backup, keyGrant } = response;
  if (
    backup.context.accountId !== account.id ||
    backup.context.origin !== window.location.origin ||
    backup.context.signingPublicKey !== account.signingKey ||
    JSON.stringify(backup.context.encryptionPublicKey) !== JSON.stringify(account.encryptionKey)
  )
    throw new Error('ACCOUNT_KEY_MISMATCH');
  let unlock: Uint8Array | undefined;
  try {
    let secrets;
    if (backup.keyWrap.kind === 'service') {
      if (!keyGrant) throw new Error('RECOVERY_GRANT_INVALID');
      unlock = await openRecoveryDelivery(
        keyGrant,
        recipient.privateKey,
        'claim:' + recoveryVaultDomain(backup.context),
      );
      secrets = await openRecoveryPayload(backup, unlock);
    } else {
      unlock = await material(backup.context);
      check();
      secrets = await openRecoveryBackup(backup, unlock);
    }
    check();
    await installRecoveredVault(account, secrets, backup.context, check);
    return true;
  } finally {
    unlock?.fill(0);
    rememberPasskeyRecovery(null);
  }
}
export async function enableFastSignIn(
  account: Account,
  method: RecoveryMethod,
  mode: RecoveryContext['mode'],
  consent: boolean,
) {
  const check = recoveryContextGuard(account);
  const context = RecoveryContextSchema.parse({
    version: 1,
    id: crypto.randomUUID(),
    accountId: account.id,
    origin: window.location.origin,
    credentialKey: method.credentialKey,
    mode,
    signingPublicKey: account.signingKey,
    encryptionPublicKey: account.encryptionKey,
    salt: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
  });
  if (!method.availableModes.includes(mode)) throw new Error('RECOVERY_METHOD_UNAVAILABLE');
  if (mode === 'passkey-protected') {
    const options = requestOptions(await api.passkeyLoginOptions());
    options.allowCredentials = [
      {
        type: 'public-key',
        id: Uint8Array.from(atob(method.subject.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
          c.charCodeAt(0),
        ),
      },
    ];
    const asserted = await navigator.credentials.get({ publicKey: options });
    check();
    const value = passkeyRecoveryMaterial(asserted);
    if (!value || value.credentialKey !== method.credentialKey) {
      value?.material.fill(0);
      throw new Error('PASSKEY_PRF_UNAVAILABLE');
    }
    // Finish the login challenge to verify the credential; PRF material remains private.
    try {
      const session = await api.loginWithPasskey(assertionProof(asserted));
      check();
      if (
        session.account.id !== account.id ||
        session.account.signingKey !== account.signingKey ||
        JSON.stringify(session.account.encryptionKey) !== JSON.stringify(account.encryptionKey)
      )
        throw new Error('ACCOUNT_KEY_MISMATCH');
      acceptProviderSession(session.account, session.csrfToken);
      rememberPasskeyRecovery(value);
    } finally {
      value.material.fill(0);
    }
  }
  return withUnlockedVault(account, async (secrets) => {
    if (mode === 'daclify-assisted') {
      if (!consent) throw new Error('RECOVERY_CONSENT_REQUIRED');
      const handoff = await api.recoveryAssistedOptions({ context, assistedConsent: true });
      check();
      const payload = await createRecoveryPayload(secrets, context);
      try {
        const keyGrant = await sealRecoveryDelivery(
          payload.key,
          handoff.recipient,
          `enroll:${handoff.id}:${recoveryVaultDomain(context)}`,
        );
        check();
        return await api.enableRecovery({
          context,
          envelope: payload.envelope,
          assistedHandoff: { id: handoff.id, keyGrant },
          assistedConsent: true,
        });
      } finally {
        payload.key.fill(0);
      }
    }
    const first = await material(context);
    let second: Uint8Array | undefined;
    try {
      if (mode === 'wallet-protected') {
        second = await material(context);
        check();
        if (first.length !== second.length || first.some((byte, index) => byte !== second?.[index]))
          throw new Error('RECOVERY_WALLET_UNSUPPORTED');
      }
      const backup = await createRecoveryBackup(secrets, context, first);
      check();
      await openRecoveryBackup(backup, first);
      check();
      if (backup.keyWrap.kind !== 'client') throw new Error('RECOVERY_METHOD_INVALID');
      return await api.enableRecovery({
        context,
        envelope: backup.envelope,
        clientKeyWrap: backup.keyWrap.envelope,
        assistedConsent: false,
      });
    } finally {
      first.fill(0);
      second?.fill(0);
      rememberPasskeyRecovery(null);
    }
  });
}
