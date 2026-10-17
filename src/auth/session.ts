import { QuickAccountPreparedSchema } from '@daclify/core-protocol';
import { quickAccountDigest, quickAccountRoot } from '@daclify/core-protocol/sdk';
import { openBallotGrant } from '../quick-ballots/keys';
import { openAccountReceipt } from '../quick-ballots/receipts';
import { assertOperatorDao } from '../api/networks';
import { ref, watch } from 'vue';
import { useWorkspace } from '../state/workspace';
import { csrfStorageKey } from '../api/networks';
import { PrivateKey, Serializer } from '@wharfkit/antelope';
import {
  contentDomain,
  epochGrantDomain,
  EpochGrantSchema,
  ContentEnvelopeSchema,
  type DaoContent,
  type DaoRef,
  RecoveryKitSchema,
  type RecoveryKit,
  EncryptionPublicKeySchema,
  type VaultSecrets,
  type Account,
  type NativeProof,
  ApiRoutes,
  AccountControlMessageSchema,
  VaultAttachMessageSchema,
  AccountReconnectMessageSchema,
  RecoveryContextSchema,
  VaultSecretsSchema,
  type RecoveryContext,
  DeviceRecoveryRequestSchema,
  type DeviceRecoveryRequest,
  type ProfileContext,
  type EncryptedProfile,
  type ProfileKeyGrant,
  type EncryptionPublicKey,
  HostedUploadSchema,
} from '@daclify/core-protocol';
import {
  instructionDigest,
  exitInstructionDigest,
  exitOperationCommitment,
  exitStepCommitment,
  verifyRecoveryIdentity,
  type instruction,
} from '@daclify/core-protocol/sdk';
import {
  api,
  setAccountControlSigner,
  takeRecoveryGrant,
  setSessionExpiryListener,
  SIGN_IN_DURATION_MS,
} from '../api/client';
import {
  AppSnapshotEnvelopeSchema,
  appEvidenceDomain,
  appKeyGrantDomain,
  type AppEvidenceContextSchema,
} from '@daclify/core-protocol';
import type { ActivityTableSchemas } from '@daclify/modules/sdk';
import { z } from 'zod';
import {
  unlockVault,
  createEpochGrant,
  openCommittedEpoch,
  sealContent,
  openContent,
  sha256Hex,
  type CreatedVault,
  sealProfileForAudience,
  openProfileWithGrant,
} from './vault';
import {
  preparePrivateFile,
  openPrivateFile,
  verifyStoredFile,
  decodeStoredBytes,
  type PreparedFile,
  type FileMetadata,
} from '../content/files';
export type SavedVault = RecoveryKit;
let generation = 0;
let secrets: VaultSecrets | undefined;
let vaultAccountId: string | undefined;
let idleExpires: number | undefined;
let sessionExpiry: { accountId: string; scope: string; expires: number } | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
export const vaultUnlocked = ref(false);
setSessionExpiryListener((accountId, scope, expires) => {
  sessionExpiry = { accountId, scope, expires };
  scheduleLock();
});
setAccountControlSigner(async (challenge) => {
  const message = AccountControlMessageSchema.parse(JSON.parse(challenge.message));
  const { useWorkspace } = await import('../state/workspace');
  if (message.origin !== window.location.origin || message.accountId !== useWorkspace().account?.id)
    throw new Error('ACCOUNT_KEY_MISMATCH');
  const { selectedSigner } = await import('./action-signer');
  const rootRequired = [
    ApiRoutes.accountReconnectNative.path,
    ApiRoutes.profileKeysShare.path,
    ApiRoutes.profileKeysRemove.path,
  ].some((path) => path === message.path);
  if (!rootRequired && selectedSigner.value === 'native') {
    const { nativeIdentity, nativeIntentProof } = await import('./telos-zero');
    const identity = nativeIdentity(),
      network = await api.network(),
      links = await api.nativeLinks();
    if (
      !links.links.some(
        (link) => link.chainId === identity.chainId && link.account === identity.account,
      ) ||
      identity.chainId !== network.chainId
    )
      throw new Error('NATIVE_UNLINKED');
    return {
      kind: 'native',
      chainId: identity.chainId,
      account: identity.account,
      proof: await nativeIntentProof(network.runtime, challenge.message),
    };
  }
  if (!rootRequired && selectedSigner.value === 'evm') {
    const { evmWallet, signEvmMessage } = await import('./telos-evm');
    const wallet = evmWallet.value;
    if (!wallet) throw new Error('EVM_WALLET_MISSING');
    const links = await api.evmLinks();
    if (
      !links.links.some(
        (link) =>
          link.controlVerified &&
          link.chainId === wallet.chainId &&
          link.address.toLowerCase() === wallet.address.toLowerCase(),
      )
    )
      throw new Error('EVM_LINKED_REQUIRED');
    return {
      kind: 'evm',
      chainId: wallet.chainId,
      address: wallet.address,
      signature: await signEvmMessage(challenge.message),
    };
  }
  if (!secrets) throw new Error('VAULT_LOCKED');
  const key = PrivateKey.from(secrets.signingKey);
  if (message.origin !== window.location.origin || message.signingKey !== key.toPublic().toString())
    throw new Error('ACCOUNT_KEY_MISMATCH');
  touch();
  return {
    kind: 'root',
    signature: key.signMessage(new TextEncoder().encode(challenge.message)).toString(),
  };
});
export function savedVault(): SavedVault | undefined {
  const raw = localStorage.getItem('daclify.vault.v1');
  if (!raw) return undefined;
  try {
    return RecoveryKitSchema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}
export function saveVault(created: CreatedVault): void {
  const record = RecoveryKitSchema.parse({
    version: 1,
    localEnvelope: created.localEnvelope,
    recoveryEnvelope: created.recoveryEnvelope,
    signingPublicKey: created.signingPublicKey,
    encryptionPublicKey: created.encryptionPublicKey,
  });
  localStorage.setItem('daclify.vault.v1', JSON.stringify(record));
}
export function saveRestoredVault(record: RecoveryKit): void {
  lockVault();
  localStorage.setItem('daclify.vault.v1', JSON.stringify(RecoveryKitSchema.parse(record)));
}
function clearVault(): void {
  generation++;
  secrets = undefined;
  vaultAccountId = undefined;
  idleExpires = undefined;
  vaultUnlocked.value = false;
  if (timer) clearTimeout(timer);
  timer = undefined;
}
let publishSessionEvent: ((type: 'lock' | 'logout', accountId?: string) => void) | undefined;
const SessionEventSchema = z.strictObject({
  type: z.enum(['lock', 'logout']),
  accountId: z.uuid(),
  scope: z.string().min(1).max(512),
});
export function startSessionSecurity(): () => void {
  const state = useWorkspace();
  const storageKey = 'daclify.session-event.v1';
  let channel: BroadcastChannel | undefined;
  try {
    if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(storageKey);
  } catch {
    // Storage events also support browsers that deny BroadcastChannel access.
  }
  let receiving = false;
  function receive(raw: unknown) {
    if (typeof raw !== 'string' || raw.length > 1024) return;
    let signal: z.infer<typeof SessionEventSchema>;
    try {
      signal = SessionEventSchema.parse(JSON.parse(raw));
    } catch {
      return;
    }
    if (signal.scope !== csrfStorageKey() || signal.accountId !== state.account?.id) return;
    receiving = true;
    try {
      clearVault();
      if (signal.type === 'logout') {
        takeRecoveryGrant(signal.accountId);
        sessionStorage.removeItem(csrfStorageKey());
        state.account = undefined;
        state.memberships = [];
      }
    } finally {
      receiving = false;
    }
  }
  function publish(type: 'lock' | 'logout', accountId = state.account?.id) {
    if (receiving || !accountId) return;
    const value = JSON.stringify({ type, accountId, scope: csrfStorageKey() });
    try {
      if (channel) channel.postMessage(value);
      else {
        localStorage.setItem(storageKey, value);
        localStorage.removeItem(storageKey);
      }
    } catch {
      // A browser messaging failure must never prevent the local key lock.
    }
  }
  const onMessage = (event: MessageEvent<unknown>) => receive(event.data);
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === localStorage && event.key === storageKey) receive(event.newValue);
  };
  channel?.addEventListener('message', onMessage);
  window.addEventListener('storage', onStorage);
  const onActivity = () => {
    if (document.visibilityState === 'visible' && !expired()) touch();
  };
  const onVisibility = () => {
    expired();
  };
  const activityEvents = ['pointerdown', 'pointermove', 'keydown', 'scroll'];
  for (const type of activityEvents)
    window.addEventListener(type, onActivity, { capture: true, passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  publishSessionEvent = publish;
  const stop = watch(
    () => [
      state.account?.id,
      state.account?.signingKey,
      state.account?.encryptionKey?.x,
      state.account?.encryptionKey?.y,
    ],
    (_next, previous) => {
      if (
        secrets &&
        (state.account?.id !== vaultAccountId ||
          state.account?.signingKey !== PrivateKey.from(secrets.signingKey).toPublic().toString() ||
          state.account?.encryptionKey?.x !== secrets.encryptionPrivateKey.x ||
          state.account?.encryptionKey?.y !== secrets.encryptionPrivateKey.y)
      )
        clearVault();
      if (previous[0] && !state.account) {
        takeRecoveryGrant(previous[0]);
        sessionStorage.removeItem(csrfStorageKey());
        publish('logout', previous[0]);
      }
    },
    { flush: 'sync' },
  );
  return () => {
    stop();
    channel?.close();
    window.removeEventListener('storage', onStorage);
    for (const type of activityEvents) window.removeEventListener(type, onActivity, true);
    document.removeEventListener('visibilitychange', onVisibility);
    if (publishSessionEvent === publish) publishSessionEvent = undefined;
  };
}
export function lockVault(): void {
  clearVault();
  publishSessionEvent?.('lock');
}
export async function logoutAccount(): Promise<void> {
  const state = useWorkspace(),
    accountId = state.account?.id,
    scope = csrfStorageKey();
  clearVault();
  publishSessionEvent?.('logout');
  await api.logout();
  if (state.account?.id !== accountId || csrfStorageKey() !== scope) return;
  state.account = undefined;
  state.memberships = [];
}
function keyDeadline(): number {
  const session = sessionExpiry;
  return Math.min(
    idleExpires ?? Infinity,
    session && session.accountId === vaultAccountId && session.scope === csrfStorageKey()
      ? session.expires
      : Infinity,
  );
}
function expired(): boolean {
  if (secrets && Date.now() >= keyDeadline()) clearVault();
  return !secrets;
}
function scheduleLock(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!expired()) timer = setTimeout(scheduleLock, Math.max(0, keyDeadline() - Date.now()));
}
function touch(): void {
  if (expired()) throw new Error('VAULT_LOCKED');
  idleExpires = Date.now() + SIGN_IN_DURATION_MS;
  scheduleLock();
}
export function acceptProviderSession(account: Account, csrfToken: string): Account {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(csrfToken)) throw new Error('CSRF_REQUIRED');
  sessionStorage.setItem(csrfStorageKey(), csrfToken);
  if (
    secrets &&
    (PrivateKey.from(secrets.signingKey).toPublic().toString() !== account.signingKey ||
      secrets.encryptionPrivateKey.x !== account.encryptionKey?.x ||
      secrets.encryptionPrivateKey.y !== account.encryptionKey?.y)
  )
    lockVault();
  return account;
}
export async function completeNativeReconnect(
  current: Account,
  id: string,
  proof: NativeProof,
  check: () => void,
): Promise<Account> {
  const guard = recoveryContextGuard(current);
  guard();
  check();
  if (!current.signingKey || !canUseVaultKey(current.signingKey)) throw new Error('VAULT_LOCKED');
  const session = await api.reconnectNativeAccount(id, proof);
  guard();
  check();
  if (
    session.account.id !== current.id ||
    session.account.signingKey !== current.signingKey ||
    JSON.stringify(session.account.encryptionKey) !== JSON.stringify(current.encryptionKey) ||
    session.account.custody !== current.custody
  )
    throw new Error('ACCOUNT_KEY_MISMATCH');
  return acceptProviderSession(session.account, session.csrfToken);
}
export function recoveryContextGuard(account: Account): () => void {
  const state = useWorkspace(),
    started = generation,
    scope = csrfStorageKey(),
    location = globalThis.location?.href,
    network = JSON.stringify([state.network?.chainId, state.network?.runtime]);
  return () => {
    expired();
    if (
      started !== generation ||
      scope !== csrfStorageKey() ||
      location !== globalThis.location?.href ||
      state.account?.id !== account.id ||
      state.account.signingKey !== account.signingKey ||
      JSON.stringify(state.account.encryptionKey) !== JSON.stringify(account.encryptionKey) ||
      network !== JSON.stringify([state.network?.chainId, state.network?.runtime])
    )
      throw new Error('WALLET_CONTEXT_CHANGED');
  };
}
async function checkRecoveryAccount(account: Account): Promise<void> {
  const state = (await import('../state/workspace')).useWorkspace();
  if (
    state.account?.id !== account.id ||
    state.account.signingKey !== account.signingKey ||
    JSON.stringify(state.account.encryptionKey) !== JSON.stringify(account.encryptionKey)
  )
    throw new Error('ACCOUNT_KEY_MISMATCH');
}
export async function withUnlockedVault<T>(
  account: Account,
  work: (keys: VaultSecrets) => Promise<T>,
): Promise<T> {
  const check = recoveryContextGuard(account);
  check();
  await checkRecoveryAccount(account);
  check();
  if (
    !secrets ||
    !canUseVaultKey(account.signingKey ?? undefined) ||
    secrets.encryptionPrivateKey.x !== account.encryptionKey?.x ||
    secrets.encryptionPrivateKey.y !== account.encryptionKey?.y
  )
    throw new Error('VAULT_LOCKED');
  touch();
  const result = await work(VaultSecretsSchema.parse(secrets));
  check();
  await checkRecoveryAccount(account);
  check();
  return result;
}
export async function installRecoveredVault(
  account: Account,
  input: unknown,
  identity: RecoveryContext | DeviceRecoveryRequest,
  check: () => void,
): Promise<void> {
  check();
  await checkRecoveryAccount(account);
  check();
  const parsed = RecoveryContextSchema.safeParse(identity);
  const context = parsed.success ? parsed.data : DeviceRecoveryRequestSchema.parse(identity);
  if (
    context.origin !== window.location.origin ||
    context.accountId !== account.id ||
    context.signingPublicKey !== account.signingKey ||
    JSON.stringify(context.encryptionPublicKey) !== JSON.stringify(account.encryptionKey)
  )
    throw new Error('ACCOUNT_KEY_MISMATCH');
  const opened = await verifyRecoveryIdentity(input, context),
    approval = await import('./approval-preference');
  check();
  await checkRecoveryAccount(account);
  check();
  secrets = opened;
  vaultAccountId = account.id;
  approval.restorePreferredSigner();
  vaultUnlocked.value = true;
  touch();
}
export async function installCreatedVault(
  account: Account,
  input: VaultSecrets,
  context: RecoveryContext,
  check: () => void,
): Promise<void> {
  check();
  if (
    context.origin !== window.location.origin ||
    context.accountId !== account.id ||
    context.signingPublicKey !== account.signingKey ||
    JSON.stringify(context.encryptionPublicKey) !== JSON.stringify(account.encryptionKey)
  )
    throw new Error('ACCOUNT_KEY_MISMATCH');
  const opened = await verifyRecoveryIdentity(input, context),
    approval = await import('./approval-preference');
  check();
  secrets = opened;
  vaultAccountId = account.id;
  approval.restorePreferredSigner();
  vaultUnlocked.value = true;
  touch();
}
export async function unlockAndLogin(
  password: string,
  current?: Account,
  mode: 'attach' | 'recover' | 'reconnect' = 'attach',
): Promise<Account> {
  const started = generation;
  const check = current && mode !== 'attach' ? recoveryContextGuard(current) : undefined;
  check?.();
  const vault = savedVault();
  if (!vault) throw new Error('VAULT_UNLOCK_FAILED');
  const opened = await unlockVault(vault.localEnvelope, password);
  check?.();
  const signing = PrivateKey.from(opened.signingKey);
  const encryption = EncryptionPublicKeySchema.parse({
    kty: opened.encryptionPrivateKey.kty,
    crv: opened.encryptionPrivateKey.crv,
    x: opened.encryptionPrivateKey.x,
    y: opened.encryptionPrivateKey.y,
  });
  if (
    signing.toPublic().toString() !== vault.signingPublicKey ||
    JSON.stringify(encryption) !== JSON.stringify(vault.encryptionPublicKey)
  )
    throw new Error('VAULT_UNLOCK_FAILED');
  let account: Account;
  if (mode === 'reconnect' && current?.signingKey !== null) throw new Error('ACCOUNT_KEY_MISMATCH');
  if (current?.signingKey === null && mode !== 'recover') {
    const { useWorkspace } = await import('../state/workspace');
    const identity = {
      signingKey: vault.signingPublicKey,
      encryptionKey: vault.encryptionPublicKey,
    };
    const challenge =
      mode === 'reconnect'
        ? await api.accountReconnectChallenge(identity)
        : await api.vaultAttachChallenge(identity);
    check?.();
    const message =
      mode === 'reconnect'
        ? AccountReconnectMessageSchema.parse(JSON.parse(challenge.message))
        : VaultAttachMessageSchema.parse(JSON.parse(challenge.message));
    const targetId = 'targetAccountId' in message ? message.targetAccountId : current.id;
    if (
      message.origin !== window.location.origin ||
      message.accountId !== current.id ||
      message.signingKey !== vault.signingPublicKey ||
      JSON.stringify(message.encryptionKey) !== JSON.stringify(vault.encryptionPublicKey) ||
      message.id !== challenge.id ||
      message.expires !== challenge.expires ||
      useWorkspace().account?.id !== current.id ||
      started !== generation
    )
      throw new Error('ACCOUNT_KEY_MISMATCH');
    const signature = signing.signMessage(new TextEncoder().encode(challenge.message)).toString();
    const session =
      mode === 'reconnect'
        ? await api.reconnectAccount(challenge.id, signature)
        : await api.attachVault(challenge.id, signature);
    check?.();
    if (
      useWorkspace().account?.id !== current.id ||
      started !== generation ||
      session.account.id !== targetId ||
      session.account.signingKey !== vault.signingPublicKey ||
      JSON.stringify(session.account.encryptionKey) !== JSON.stringify(vault.encryptionPublicKey)
    )
      throw new Error('ACCOUNT_KEY_MISMATCH');
    account = acceptProviderSession(session.account, session.csrfToken);
  } else {
    const challenge = await api.challenge({
      signingKey: vault.signingPublicKey,
      encryptionKey: vault.encryptionPublicKey,
    });
    check?.();
    account = await api.login(
      challenge.id,
      signing.signMessage(new TextEncoder().encode(challenge.message)).toString(),
      vault.encryptionPublicKey,
      (recovered) => {
        check?.();
        if (
          started !== generation ||
          recovered.signingKey !== vault.signingPublicKey ||
          JSON.stringify(recovered.encryptionKey) !== JSON.stringify(vault.encryptionPublicKey)
        )
          throw new Error('ACCOUNT_KEY_MISMATCH');
      },
    );
  }
  check?.();
  if (started !== generation) throw new Error('VAULT_LOCKED');
  if (
    account.signingKey !== vault.signingPublicKey ||
    JSON.stringify(account.encryptionKey) !== JSON.stringify(vault.encryptionPublicKey)
  )
    throw new Error('ACCOUNT_KEY_MISMATCH');
  secrets = opened;
  vaultAccountId = account.id;
  (await import('./approval-preference')).restorePreferredSigner();
  vaultUnlocked.value = true;
  touch();
  return account;
}
export async function relayInstruction(request: instruction): Promise<string> {
  return (await import('./action-signer')).dispatchInstruction(request);
}
export function canUseVaultKey(signingKey: string | undefined): boolean {
  return (
    !expired() &&
    vaultUnlocked.value &&
    (!signingKey ||
      (!!secrets && PrivateKey.from(secrets.signingKey).toPublic().toString() === signingKey))
  );
}
export function signQuickApproval(value: unknown): string {
  const prepared = QuickAccountPreparedSchema.parse(value);
  if (!secrets) throw Error('VAULT_LOCKED');
  const key = PrivateKey.from(secrets.signingKey);
  const approval = quickAccountRoot(prepared.context);
  if (approval.kind !== 'key' || approval.publicKey !== key.toPublic().toString())
    throw Error('ACCOUNT_KEY_MISMATCH');
  touch();
  return Serializer.encode({
    object: key.signDigest(quickAccountDigest(prepared.action, prepared.request)),
  }).hexString;
}
export async function openQuickGrant(context: unknown, ciphertext: string): Promise<string> {
  const started = generation;
  if (!secrets) throw Error('VAULT_LOCKED');
  touch();
  const secret = await openBallotGrant(context, secrets.encryptionPrivateKey, ciphertext);
  guardEpochAccess(started);
  return secret;
}
export async function readQuickReceipt(context: unknown, receipt: string): Promise<0 | 1> {
  const started = generation;
  if (!secrets) throw Error('VAULT_LOCKED');
  touch();
  const choice = await openAccountReceipt(context, secrets.encryptionPrivateKey, receipt);
  guardEpochAccess(started);
  return choice;
}
export function signInstruction(request: instruction): string {
  assertOperatorDao({
    chainId: request.chain_id,
    contract: request.deployment,
    daoId: request.dao_id,
    interfaceVersion: 1,
  });
  if (!secrets) throw new Error('VAULT_LOCKED');
  touch();
  return PrivateKey.from(secrets.signingKey).signDigest(instructionDigest(request)).toString();
}
export function signExitInstruction(operationId: string, stepId: string, request: instruction) {
  assertOperatorDao({
    chainId: request.chain_id,
    contract: request.deployment,
    daoId: request.dao_id,
    interfaceVersion: 1,
  });
  if (!secrets) throw Error('VAULT_LOCKED');
  touch();
  const operation = exitOperationCommitment(operationId),
    step_digest = exitStepCommitment(operationId, stepId, request);
  return {
    operation,
    step_digest,
    request,
    sig: PrivateKey.from(secrets.signingKey)
      .signDigest(exitInstructionDigest(operation, step_digest, request))
      .toString(),
  };
}
export async function signSavedExitInstruction(
  input: SavedVault,
  password: string,
  operationId: string,
  stepId: string,
  request: instruction,
) {
  assertOperatorDao({
    chainId: request.chain_id,
    contract: request.deployment,
    daoId: request.dao_id,
    interfaceVersion: 1,
  });
  const operation = exitOperationCommitment(operationId),
    step_digest = exitStepCommitment(operationId, stepId, request),
    digest = exitInstructionDigest(operation, step_digest, request),
    kit = RecoveryKitSchema.parse(input);
  const context = JSON.stringify([
    useWorkspace().account?.id,
    useWorkspace().network?.chainId,
    useWorkspace().network?.runtime,
    globalThis.location?.href,
  ]);
  const opened = await unlockVault(kit.localEnvelope, password),
    key = PrivateKey.from(opened.signingKey);
  if (
    context !==
    JSON.stringify([
      useWorkspace().account?.id,
      useWorkspace().network?.chainId,
      useWorkspace().network?.runtime,
      globalThis.location?.href,
    ])
  )
    throw Error('WALLET_CONTEXT_CHANGED');
  if (
    key.toPublic().toString() !== kit.signingPublicKey ||
    opened.encryptionPrivateKey.x !== kit.encryptionPublicKey.x ||
    opened.encryptionPrivateKey.y !== kit.encryptionPublicKey.y
  )
    throw Error('ACCOUNT_KEY_MISMATCH');
  return { operation, step_digest, request, sig: key.signDigest(digest).toString() };
}
export async function relayWithVault(request: instruction): Promise<string> {
  if (!secrets) throw new Error('VAULT_LOCKED');
  touch();
  return (await api.relay(request, signInstruction(request))).transactionId;
}
export function downloadBackup(record: SavedVault): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'daclify-encrypted-recovery-kit.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function guardEpochAccess(started: number): void {
  if (expired() || generation !== started) throw new Error('VAULT_LOCKED');
}
export async function preparePrivateProfile(
  plaintext: Uint8Array,
  context: ProfileContext,
  audience: EncryptionPublicKey[] = [],
) {
  const started = generation,
    opened = secrets;
  if (!opened) throw new Error('VAULT_LOCKED');
  touch();
  const privateKey = opened.encryptionPrivateKey;
  const owner = EncryptionPublicKeySchema.parse({
    kty: privateKey.kty,
    crv: privateKey.crv,
    x: privateKey.x,
    y: privateKey.y,
  });
  const prepared = await sealProfileForAudience(plaintext, context, owner, audience);
  guardEpochAccess(started);
  return prepared;
}
export async function openPrivateProfile(
  cipher: EncryptedProfile,
  grant: ProfileKeyGrant | undefined,
) {
  const started = generation,
    opened = secrets;
  if (!opened) throw new Error('VAULT_LOCKED');
  touch();
  const plaintext = await openProfileWithGrant(cipher, grant, opened.encryptionPrivateKey);
  try {
    guardEpochAccess(started);
    return plaintext;
  } catch (error) {
    plaintext.fill(0);
    throw error;
  }
}
export async function prepareAppEpoch(
  dao: DaoRef,
  appId: string,
  epoch: string,
  recipients: DaoContent['members'],
) {
  const started = generation;
  if (!secrets) throw new Error('VAULT_LOCKED');
  if (!recipients.length || recipients.length > 100) throw new Error('APP_GRANT_BATCH');
  const key = crypto.getRandomValues(new Uint8Array(32)),
    commitment = await sha256Hex(key),
    grants = [];
  for (const recipient of recipients) {
    if (!recipient.active) throw new Error('MEMBER_INACTIVE');
    const publicKey = EncryptionPublicKeySchema.parse(JSON.parse(recipient.encryption_key));
    grants.push({
      recipient: recipient.id,
      encryptionKey: recipient.encryption_key,
      envelope: JSON.stringify(
        await createEpochGrant(publicKey, key, appKeyGrantDomain(dao, appId, epoch, recipient.id)),
      ),
    });
  }
  guardEpochAccess(started);
  return { commitment, grants };
}
async function appEpochKey(
  dao: DaoRef,
  appId: string,
  memberId: string,
  key: z.infer<typeof ActivityTableSchemas.appkeys>,
  grant: z.infer<typeof ActivityTableSchemas.appgrants>,
) {
  const started = generation,
    opened = secrets;
  if (!opened) throw new Error('VAULT_LOCKED');
  if (
    key.dao_id !== dao.daoId ||
    key.app_id !== appId ||
    grant.dao_id !== dao.daoId ||
    grant.key_epoch !== key.id ||
    grant.recipient !== memberId
  )
    throw new Error('APP_KEY_SCOPE');
  const bytes = await openCommittedEpoch(
    opened.encryptionPrivateKey,
    EpochGrantSchema.parse(JSON.parse(grant.envelope)),
    appKeyGrantDomain(dao, appId, key.id, memberId),
    key.key_commitment,
  );
  guardEpochAccess(started);
  return bytes;
}
export async function grantAppEpoch(
  dao: DaoRef,
  appId: string,
  memberId: string,
  key: z.infer<typeof ActivityTableSchemas.appkeys>,
  grant: z.infer<typeof ActivityTableSchemas.appgrants>,
  recipient: DaoContent['members'][number],
) {
  const started = generation;
  if (!recipient.active) throw new Error('MEMBER_INACTIVE');
  const bytes = await appEpochKey(dao, appId, memberId, key, grant);
  const envelope = await createEpochGrant(
    EncryptionPublicKeySchema.parse(JSON.parse(recipient.encryption_key)),
    bytes,
    appKeyGrantDomain(dao, appId, key.id, recipient.id),
  );
  guardEpochAccess(started);
  return JSON.stringify(envelope);
}
export async function encryptAppSnapshot(
  context: z.infer<typeof AppEvidenceContextSchema>,
  memberId: string,
  key: z.infer<typeof ActivityTableSchemas.appkeys>,
  grant: z.infer<typeof ActivityTableSchemas.appgrants>,
  plaintext: Uint8Array,
) {
  const started = generation;
  if (plaintext.length > 3 * 1024 * 1024) throw new Error('FILE_TOO_LARGE');
  if (key.id !== context.keyEpoch) throw new Error('APP_KEY_SCOPE');
  const epoch = await appEpochKey(context.dao, context.appId, memberId, key, grant);
  const snapshot = AppSnapshotEnvelopeSchema.parse({
    version: 1,
    context,
    envelope: await sealContent(plaintext, epoch, appEvidenceDomain(context)),
  });
  guardEpochAccess(started);
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  return { bytes, commitment: await sha256Hex(bytes) };
}
export async function decryptAppSnapshot(
  context: z.infer<typeof AppEvidenceContextSchema>,
  memberId: string,
  key: z.infer<typeof ActivityTableSchemas.appkeys>,
  grant: z.infer<typeof ActivityTableSchemas.appgrants>,
  bytes: Uint8Array,
  commitment: string,
) {
  const started = generation;
  if (bytes.length > 5 * 1024 * 1024 || (await sha256Hex(bytes)) !== commitment)
    throw new Error('DOCUMENT_INTEGRITY');
  const snapshot = AppSnapshotEnvelopeSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  if (
    appEvidenceDomain(snapshot.context) !== appEvidenceDomain(context) ||
    key.id !== context.keyEpoch
  )
    throw new Error('APP_KEY_SCOPE');
  const epoch = await appEpochKey(context.dao, context.appId, memberId, key, grant),
    plaintext = await openContent(snapshot.envelope, epoch, appEvidenceDomain(context));
  guardEpochAccess(started);
  return plaintext;
}
async function epochKey(
  dao: DaoRef,
  member: string,
  epoch: string,
  content: DaoContent,
): Promise<Uint8Array> {
  const started = generation;
  const opened = secrets;
  if (!opened) throw new Error('VAULT_LOCKED');
  const original = content.keyGrants.find((g) => g.recipient === member && g.epoch === epoch);
  const commitment = content.epochs.find((c) => c.epoch === epoch);
  if (!commitment) throw new Error('EPOCH_UNAVAILABLE');
  if (original) {
    try {
      const key = await openCommittedEpoch(
        opened.encryptionPrivateKey,
        EpochGrantSchema.parse(JSON.parse(original.envelope)),
        epochGrantDomain(dao, epoch, member),
        commitment.commitment,
      );
      guardEpochAccess(started);
      return key;
    } catch (error) {
      guardEpochAccess(started);
      if (error instanceof Error && error.message === 'EPOCH_KEY_MISMATCH') throw error;
      if (!useWorkspace().network?.capabilities.includes('trusted-contact-recovery-v1'))
        throw error;
    }
  }
  if (!useWorkspace().network?.capabilities.includes('trusted-contact-recovery-v1'))
    throw new Error('EPOCH_UNAVAILABLE');
  const { grant } = await api.contactRecoveryGrant({ target: { dao, memberId: member }, epoch });
  guardEpochAccess(started);
  if (!grant) throw new Error('EPOCH_UNAVAILABLE');
  const key = await openCommittedEpoch(
    opened.encryptionPrivateKey,
    grant,
    epochGrantDomain(dao, epoch, member),
    commitment.commitment,
  );
  guardEpochAccess(started);
  return key;
}
export async function contactEpochSecrets(
  dao: DaoRef,
  member: string,
  epochs: string[],
  content: DaoContent,
) {
  if (!epochs.length || epochs.length > 16) throw new Error('KEY_CHECK_LIMIT');
  const result = [];
  for (const epoch of epochs) {
    const key = await epochKey(dao, member, epoch, content);
    try {
      result.push({
        epoch,
        commitment: await sha256Hex(key),
        key: btoa(String.fromCharCode(...key)),
      });
    } finally {
      key.fill(0);
    }
  }
  return result;
}
export async function verifyPrivateEpochs(
  dao: DaoRef,
  member: string,
  epochs: string[],
  content: DaoContent,
): Promise<void> {
  if (epochs.length > 20) throw new Error('KEY_CHECK_LIMIT');
  const started = generation;
  for (const epoch of epochs) {
    const key = await epochKey(dao, member, epoch, content);
    key.fill(0);
  }
  guardEpochAccess(started);
}
export async function preparePrivateEpoch(
  dao: DaoRef,
  member: string,
  epoch: string,
): Promise<{ commitment: string; selfGrant: string }> {
  const started = generation;
  const opened = secrets;
  if (!opened) throw new Error('VAULT_LOCKED');
  const recipient = EncryptionPublicKeySchema.parse({
    kty: opened.encryptionPrivateKey.kty,
    crv: opened.encryptionPrivateKey.crv,
    x: opened.encryptionPrivateKey.x,
    y: opened.encryptionPrivateKey.y,
  });
  const key = crypto.getRandomValues(new Uint8Array(32));
  const selfGrant = JSON.stringify(
    await createEpochGrant(recipient, key, epochGrantDomain(dao, epoch, member)),
  );
  const commitment = await sha256Hex(key);
  guardEpochAccess(started);
  return { commitment, selfGrant };
}
export async function encryptDaoJson(
  dao: DaoRef,
  member: string,
  document: string,
  version: number,
  epoch: string,
  content: DaoContent,
  json: string,
): Promise<string> {
  const started = generation;
  const key = await epochKey(dao, member, epoch, content);
  const encrypted = JSON.stringify(
    await sealContent(
      new TextEncoder().encode(json),
      key,
      contentDomain(dao, document, version, epoch),
    ),
  );
  guardEpochAccess(started);
  return encrypted;
}
export async function decryptDaoJson(
  dao: DaoRef,
  member: string,
  document: DaoContent['documents'][number],
  content: DaoContent,
): Promise<string> {
  const started = generation;
  if (document.cid || document.envelope_version !== 1) throw new Error('DOCUMENT_FORMAT');
  if ((await sha256Hex(new TextEncoder().encode(document.metadata))) !== document.commitment)
    throw new Error('DOCUMENT_INTEGRITY');
  const key = await epochKey(dao, member, document.key_epoch, content);
  const plaintext = await openContent(
    ContentEnvelopeSchema.parse(JSON.parse(document.metadata)),
    key,
    contentDomain(dao, document.document_id, document.version, document.key_epoch),
  );
  guardEpochAccess(started);
  return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
}
export async function grantPrivateEpoch(
  dao: DaoRef,
  member: string,
  recipient: DaoContent['members'][number],
  epoch: string,
  content: DaoContent,
): Promise<string> {
  const started = generation;
  const key = await epochKey(dao, member, epoch, content);
  const publicKey = EncryptionPublicKeySchema.parse(JSON.parse(recipient.encryption_key));
  const envelope = JSON.stringify(
    await createEpochGrant(publicKey, key, epochGrantDomain(dao, epoch, recipient.id)),
  );
  guardEpochAccess(started);
  return envelope;
}
export async function encryptDaoFile(
  dao: DaoRef,
  member: string,
  document: string,
  version: number,
  epoch: string,
  content: DaoContent,
  bytes: Uint8Array,
  metadata: FileMetadata,
): Promise<PreparedFile> {
  const started = generation;
  const key = await epochKey(dao, member, epoch, content);
  const prepared = await preparePrivateFile(
    bytes,
    metadata,
    key,
    contentDomain(dao, document, version, epoch),
  );
  guardEpochAccess(started);
  return prepared;
}
export async function decryptDaoFile(
  dao: DaoRef,
  member: string,
  document: DaoContent['documents'][number],
  content: DaoContent,
  stored: Uint8Array,
): Promise<{ metadata: FileMetadata; bytes: Uint8Array }> {
  const started = generation;
  if (!document.cid || document.envelope_version !== 1) throw new Error('DOCUMENT_FORMAT');
  await verifyStoredFile(document, stored);
  const key = await epochKey(dao, member, document.key_epoch, content);
  const opened = await openPrivateFile(
    stored,
    key,
    contentDomain(dao, document.document_id, document.version, document.key_epoch),
  );
  guardEpochAccess(started);
  return opened;
}
export async function openPreparedDaoFile(member: string, content: DaoContent, input: unknown) {
  const upload = HostedUploadSchema.parse(input),
    started = generation;
  if (upload.envelopeVersion !== 1) throw Error('DOCUMENT_FORMAT');
  const stored = decodeStoredBytes(upload.content);
  await verifyStoredFile(upload, stored);
  const key = await epochKey(upload.dao, member, upload.keyEpoch, content);
  const opened = await openPrivateFile(
    stored,
    key,
    contentDomain(upload.dao, upload.documentId, upload.version, upload.keyEpoch),
  );
  guardEpochAccess(started);
  return opened;
}
