import { ref } from 'vue';
import { csrfStorageKey } from '../api/networks';
import { PrivateKey } from '@wharfkit/antelope';
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
  AccountControlMessageSchema,
} from '@daclify/core-protocol';
import { instructionDigest, type instruction } from '@daclify/core-protocol/sdk';
import { api, setAccountControlSigner } from '../api/client';
import {
  unlockVault,
  createEpochGrant,
  openCommittedEpoch,
  sealContent,
  openContent,
  sha256Hex,
  type CreatedVault,
} from './vault';
import {
  preparePrivateFile,
  openPrivateFile,
  verifyStoredFile,
  type PreparedFile,
  type FileMetadata,
} from '../content/files';
export type SavedVault = RecoveryKit;
let generation = 0;
let secrets: VaultSecrets | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
export const vaultUnlocked = ref(false);
setAccountControlSigner(async (challenge) => {
  const message = AccountControlMessageSchema.parse(JSON.parse(challenge.message));
  const { useWorkspace } = await import('../state/workspace');
  if (message.origin !== window.location.origin || message.accountId !== useWorkspace().account?.id)
    throw new Error('ACCOUNT_KEY_MISMATCH');
  const { selectedSigner } = await import('./action-signer');
  if (selectedSigner.value === 'native') {
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
  if (selectedSigner.value === 'evm') {
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
export function lockVault(): void {
  generation++;
  secrets = undefined;
  vaultUnlocked.value = false;
  if (timer) clearTimeout(timer);
  timer = undefined;
}
function touch() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(lockVault, 10 * 60_000);
}
export function acceptProviderSession(account: Account, csrfToken: string): Account {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(csrfToken)) throw new Error('CSRF_REQUIRED');
  sessionStorage.setItem(csrfStorageKey(), csrfToken);
  const saved = savedVault();
  if (secrets && saved && saved.signingPublicKey !== account.signingKey) lockVault();
  return account;
}
export async function unlockAndLogin(password: string): Promise<Account> {
  const started = generation;
  const vault = savedVault();
  if (!vault) throw new Error('VAULT_UNLOCK_FAILED');
  const opened = await unlockVault(vault.localEnvelope, password);
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
  const challenge = await api.challenge(vault.signingPublicKey);
  const account = await api.login(
    challenge.id,
    signing.signMessage(new TextEncoder().encode(challenge.message)).toString(),
    vault.encryptionPublicKey,
  );
  if (started !== generation) throw new Error('VAULT_LOCKED');
  secrets = opened;
  (await import('./action-signer')).selectedSigner.value = 'vault';
  vaultUnlocked.value = true;
  touch();
  return account;
}
export async function relayInstruction(request: instruction): Promise<string> {
  return (await import('./action-signer')).dispatchInstruction(request);
}
export function canUseVaultKey(signingKey: string | undefined): boolean {
  return (
    vaultUnlocked.value &&
    (!signingKey ||
      (!!secrets && PrivateKey.from(secrets.signingKey).toPublic().toString() === signingKey))
  );
}
export function signInstruction(request: instruction): string {
  if (!secrets) throw new Error('VAULT_LOCKED');
  touch();
  return PrivateKey.from(secrets.signingKey).signDigest(instructionDigest(request)).toString();
}
export async function relayWithVault(request: instruction): Promise<string> {
  if (!secrets) throw new Error('VAULT_LOCKED');
  touch();
  return (
    await api.relay(
      request,
      PrivateKey.from(secrets.signingKey).signDigest(instructionDigest(request)).toString(),
    )
  ).transactionId;
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
  if (!secrets || generation !== started) throw new Error('VAULT_LOCKED');
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
  const grant = content.keyGrants.find((g) => g.recipient === member && g.epoch === epoch);
  const commitment = content.epochs.find((c) => c.epoch === epoch);
  if (!grant || !commitment) throw new Error('EPOCH_UNAVAILABLE');
  const key = await openCommittedEpoch(
    opened.encryptionPrivateKey,
    EpochGrantSchema.parse(JSON.parse(grant.envelope)),
    epochGrantDomain(dao, epoch, member),
    commitment.commitment,
  );
  guardEpochAccess(started);
  return key;
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
