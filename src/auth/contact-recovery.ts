import { z } from 'zod';
import { Action, PrivateKey } from '@wharfkit/antelope';
import {
  ContactIdentitySchema,
  ContactRecoveryOfferSchema,
  ContactDocumentPacketSchema,
  ContactShareDeliverySchema,
  RecoveryKitSchema,
  LoginMessageSchema,
  EncryptionPublicKeySchema,
  epochGrantDomain,
  type ContactRecoveryTarget,
  type ContactRecoveryState,
  type ContactRecoveryOffer,
  type ContactDocumentPacket,
  type ContactDocumentShare,
  type ContactShareDelivery,
} from '@daclify/core-protocol';
import {
  contactRecoveryDigest,
  contactRequestCommitment,
  contactPacketCommitment,
  createContactDocumentPacket,
  openContactDocumentShare,
  sealContactDocumentShare,
  openContactShareDelivery,
  recoverContactDocumentPacket,
  makeInstruction,
  encodeAction,
  runtimeAbi,
  verifyRecoveryIdentity,
  type RuntimeActions,
} from '@daclify/core-protocol/sdk';
import { api } from '../api/client';
import { resolveApiUrl } from '../api/networks';
import { useWorkspace } from '../state/workspace';
import {
  withUnlockedVault,
  relayWithVault,
  savedVault,
  saveRestoredVault,
  unlockAndLogin,
  acceptProviderSession,
  contactEpochSecrets,
} from './session';
import { createVault, unlockVault, createEpochGrant, openCommittedEpoch } from './vault';
import { dispatchInstruction } from './action-signer';
import { nativeWallet, transactNative } from './telos-zero';

export function encodeRecoveryCode(value: unknown): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
export function decodeRecoveryCode<T>(value: string, schema: z.ZodType<T>): T {
  if (!/^[A-Za-z0-9_-]{1,60000}$/.test(value.trim()))
    throw new Error('CONTACT_RECOVERY_CODE_INVALID');
  const raw = value.trim().replaceAll('-', '+').replaceAll('_', '/');
  return schema.parse(
    JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)),
      ),
    ),
  );
}
const PendingSchema = z.strictObject({
  version: z.literal(1).default(1),
  oldKey: z.string().max(64),
  identity: z.string().max(160).optional(),
  kit: RecoveryKitSchema,
  offers: z.array(ContactRecoveryOfferSchema).max(20),
});
const storageKey = 'daclify.contact-recovery.v1';
export function pendingRecovery() {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return undefined;
  return PendingSchema.parse(JSON.parse(raw));
}
const sameTarget = (a: ContactRecoveryTarget, b: ContactRecoveryTarget) =>
  JSON.stringify(a) === JSON.stringify(b);
function checkTarget(target: ContactRecoveryTarget) {
  const network = useWorkspace().network;
  if (!network || target.dao.chainId !== network.chainId || target.dao.contract !== network.runtime)
    throw new Error('DAO_REFERENCE');
}
function contextGuard(target: ContactRecoveryTarget) {
  checkTarget(target);
  const state = useWorkspace(),
    account = state.account,
    url = resolveApiUrl('/v1');
  return () => {
    checkTarget(target);
    if (account !== state.account || url !== resolveApiUrl('/v1'))
      throw new Error('ACCOUNT_KEY_MISMATCH');
  };
}
export async function recoveryState(target: ContactRecoveryTarget): Promise<ContactRecoveryState> {
  checkTarget(target);
  const result = await api.contactRecoveryState({ target });
  let after = result.next;
  while (after !== null) {
    const page = await api.contactRecoveryState({ target, after });
    if (page.next !== null && BigInt(page.next) <= BigInt(after))
      throw new Error('CHAIN_RESPONSE_INVALID');
    if (
      JSON.stringify(page.policy) !== JSON.stringify(result.policy) ||
      JSON.stringify(page.pending) !== JSON.stringify(result.pending)
    )
      throw new Error('CONTACT_RECOVERY_CHANGED');
    result.packets.push(...page.packets);
    after = page.next;
    if (result.packets.length > 2000) throw new Error('CONTACT_RECOVERY_HISTORY_LIMIT');
  }
  return result;
}
export function clearRecoverySetup(backedUp = false) {
  const pending = pendingRecovery();
  if (!pending || (!backedUp && savedVault()?.signingPublicKey !== pending.kit.signingPublicKey))
    throw new Error('CONTACT_RECOVERY_BACKUP_REQUIRED');
  localStorage.removeItem(storageKey);
}
export async function resumeRecoverySetup(
  state: ContactRecoveryState,
  input: unknown,
  password: string,
) {
  const check = contextGuard(state.target),
    backup = z.union([PendingSchema, RecoveryKitSchema]).parse(input),
    current = pendingRecovery();
  const identity = state.identity
    ? JSON.stringify([state.target.dao.chainId, state.target.dao.contract, state.identity.id])
    : undefined;
  if (!('kit' in backup) && state.result?.request.signing_key !== backup.signingPublicKey)
    throw new Error('CONTACT_RECOVERY_BACKUP_PENDING');
  const imported =
    'kit' in backup
      ? backup
      : PendingSchema.parse({
          oldKey: state.result?.old_signing_key,
          identity,
          kit: backup,
          offers: [],
        });
  if (current && current.kit.signingPublicKey !== imported.kit.signingPublicKey)
    throw new Error('CONTACT_RECOVERY_SETUP_EXISTS');
  const completed =
    state.result?.old_signing_key === imported.oldKey &&
    state.result.request.signing_key === imported.kit.signingPublicKey;
  if (
    imported.oldKey !== state.member?.signing_key &&
    (!identity || imported.identity !== identity) &&
    !completed
  )
    throw new Error('CONTACT_RECOVERY_BACKUP_IDENTITY');
  if (state.pending && state.pending.request.signing_key !== imported.kit.signingPublicKey)
    throw new Error('CONTACT_RECOVERY_BACKUP_PENDING');
  await verifyRecoveryIdentity(await unlockVault(imported.kit.localEnvelope, password), {
    signingPublicKey: imported.kit.signingPublicKey,
    encryptionPublicKey: imported.kit.encryptionPublicKey,
  });
  check();
  localStorage.setItem(
    storageKey,
    JSON.stringify(PendingSchema.parse({ ...imported, identity: identity ?? imported.identity })),
  );
}
export async function myContactCode(): Promise<string> {
  const account = useWorkspace().account;
  if (!account?.signingKey || !account.encryptionKey) throw new Error('VAULT_LOCKED');
  return withUnlockedVault(account, async () =>
    encodeRecoveryCode(
      ContactIdentitySchema.parse({
        signingKey: account.signingKey,
        encryptionKey: account.encryptionKey,
      }),
    ),
  );
}
type OwnerAction =
  'setcontacts' | 'cancelrec' | 'setrecpolicy' | 'putrecpack' | 'recovergrant' | 'ackrecgrant';
export async function recoveryOwnerAction<A extends OwnerAction>(
  target: ContactRecoveryTarget,
  action: A,
  data: RuntimeActions[A],
): Promise<void> {
  const check = contextGuard(target);
  const member = (await api.memberships()).find((m) =>
    sameTarget({ dao: m.dao, memberId: m.memberId }, target),
  );
  check();
  if (!member) throw new Error('AUTH_REQUIRED');
  const request = makeInstruction(
    target.dao,
    target.memberId,
    member.nonce,
    Math.floor(Date.now() / 1000) + 120,
    target.dao.contract,
    action,
    encodeAction(action, data),
  );
  if (action === 'setcontacts') {
    const account = useWorkspace().account;
    if (!account?.signingKey || account.signingKey !== member.signingKey)
      throw new Error('RECOVERY_ROOT_PROOF_REQUIRED');
    await withUnlockedVault(account, async () => {
      check();
      await relayWithVault(request);
    });
  } else await dispatchInstruction(request);
  check();
}
export async function createRecoveryOffer(
  state: ContactRecoveryState,
  password: string,
  nativeAccount: string,
  useCurrentVault = false,
): Promise<ContactRecoveryOffer> {
  const check = contextGuard(state.target),
    policy = state.policy,
    member = state.member;
  if (!policy || !member || policy.accepted !== 7 || policy.owner_key !== member.signing_key)
    throw new Error('RECOVERY_CONTACTS_PENDING');
  const identity = state.identity
    ? JSON.stringify([state.target.dao.chainId, state.target.dao.contract, state.identity.id])
    : undefined;
  let pending = pendingRecovery();
  const currentKit = savedVault();
  if (useCurrentVault) {
    if (
      !currentKit ||
      useWorkspace().account?.signingKey !== currentKit.signingPublicKey ||
      currentKit.signingPublicKey === member.signing_key ||
      state.identity?.signing_key !== currentKit.signingPublicKey
    )
      throw new Error('CONTACT_RECOVERY_CURRENT_VAULT_REQUIRED');
    if (pending && pending.kit.signingPublicKey !== currentKit.signingPublicKey)
      throw new Error('CONTACT_RECOVERY_SETUP_EXISTS');
    pending = PendingSchema.parse({
      oldKey: member.signing_key,
      identity,
      kit: currentKit,
      offers: [],
    });
  } else if (pending?.kit.signingPublicKey === member.signing_key) {
    if (
      currentKit?.signingPublicKey !== member.signing_key ||
      useWorkspace().account?.signingKey !== member.signing_key
    )
      throw new Error('CONTACT_RECOVERY_SIGNIN_REQUIRED');
    pending = undefined;
  }
  if (
    pending &&
    pending.oldKey !== member.signing_key &&
    (!identity || identity !== pending.identity)
  )
    throw new Error('CONTACT_RECOVERY_SETUP_EXISTS');
  if (!pending) {
    const created = await createVault(password);
    check();
    pending = PendingSchema.parse({
      oldKey: member.signing_key,
      identity,
      kit: {
        version: 1,
        localEnvelope: created.localEnvelope,
        recoveryEnvelope: created.recoveryEnvelope,
        signingPublicKey: created.signingPublicKey,
        encryptionPublicKey: created.encryptionPublicKey,
      },
      offers: [],
    });
  }
  const secrets = await verifyRecoveryIdentity(
    await unlockVault(pending.kit.localEnvelope, password),
    {
      signingPublicKey: pending.kit.signingPublicKey,
      encryptionPublicKey: pending.kit.encryptionPublicKey,
    },
  );
  check();
  const proposed = {
    action: 'startrecover',
    chain_id: state.target.dao.chainId,
    runtime: state.target.dao.contract,
    dao_id: state.target.dao.daoId,
    member_id: state.target.memberId,
    revision: policy.revision,
    request_id: String(BigInt(policy.next_request) + 1n),
    signing_key: pending.kit.signingPublicKey,
    encryption_key: JSON.stringify(pending.kit.encryptionPublicKey),
    native_account: nativeAccount,
    expires: Math.floor(Date.now() / 1000) + 604800,
  };
  const livePending =
    state.pending && state.pending.request.expires > Math.floor(Date.now() / 1000)
      ? state.pending.request
      : undefined;
  if (
    livePending &&
    (livePending.signing_key !== pending.kit.signingPublicKey ||
      livePending.encryption_key !== JSON.stringify(pending.kit.encryptionPublicKey))
  )
    throw new Error('CONTACT_RECOVERY_BACKUP_PENDING');
  const request = livePending ?? proposed;
  const offer = ContactRecoveryOfferSchema.parse({
    version: 1,
    request,
    newSignature: PrivateKey.from(secrets.signingKey)
      .signDigest(contactRequestCommitment(request))
      .toString(),
  });
  localStorage.setItem(
    storageKey,
    JSON.stringify(PendingSchema.parse({ ...pending, offers: [offer] })),
  );
  return offer;
}
export async function contactApproval(
  state: ContactRecoveryState,
  action: 'acceptcont' | 'startrecover' | 'approverec' | 'ackrecpack',
  offer?: ContactRecoveryOffer,
  packet?: ContactDocumentPacket,
) {
  const check = contextGuard(state.target),
    account = useWorkspace().account,
    policy = state.policy;
  if (!account || !policy || policy.owner_key !== state.member?.signing_key)
    throw new Error('CONTACT_RECOVERY_CHANGED');
  const index = policy.contacts.findIndex((c) => c.signing_key === account.signingKey);
  if (index < 0) throw new Error('CONTACT_RECOVERY_CONTACT_REQUIRED');
  const pending = state.pending;
  if (
    packet &&
    (!sameTarget(packet.context.target, state.target) ||
      packet.context.revision !== policy.revision)
  )
    throw new Error('DAO_REFERENCE');
  if (
    offer &&
    (!sameTarget(
      {
        dao: {
          chainId: offer.request.chain_id,
          contract: offer.request.runtime,
          daoId: offer.request.dao_id,
          interfaceVersion: 1,
        },
        memberId: offer.request.member_id,
      },
      state.target,
    ) ||
      offer.request.revision !== policy.revision)
  )
    throw new Error('DAO_REFERENCE');
  const requestId =
    action === 'acceptcont'
      ? '0'
      : action === 'ackrecpack'
        ? packet?.context.packetId
        : (pending?.request.request_id ?? offer?.request.request_id);
  const recoveryRequest = pending?.request ?? offer?.request;
  if (!recoveryRequest && action !== 'acceptcont' && action !== 'ackrecpack')
    throw new Error('CONTACT_RECOVERY_OFFER_REQUIRED');
  const hash =
    action === 'acceptcont'
      ? '00'.repeat(32)
      : action === 'ackrecpack' && packet
        ? await contactPacketCommitment(packet)
        : contactRequestCommitment(
            ContactRecoveryOfferSchema.shape.request.parse(recoveryRequest),
          ).toString();
  if (!requestId) throw new Error('RECOVERY_REQUEST_UNKNOWN');
  const proof = {
    action,
    chain_id: state.target.dao.chainId,
    runtime: state.target.dao.contract,
    dao_id: state.target.dao.daoId,
    member_id: state.target.memberId,
    revision: policy.revision,
    request_id: requestId,
    contact: index,
    data_hash: hash,
    expires: Math.floor(Date.now() / 1000) + 300,
  };
  await withUnlockedVault(account, async (keys) => {
    check();
    if (action === 'ackrecpack' && packet)
      await openContactDocumentShare(packet, index, keys.encryptionPrivateKey);
    const sig = PrivateKey.from(keys.signingKey)
      .signDigest(contactRecoveryDigest(proof))
      .toString();
    if (action === 'startrecover') {
      if (!offer) throw new Error('CONTACT_RECOVERY_OFFER_REQUIRED');
      await api.contactRecoverySubmit({
        action,
        data: { request: offer.request, new_sig: offer.newSignature, proof, sig },
      });
    } else await api.contactRecoverySubmit({ action, data: { proof, sig } });
  });
  check();
}
export async function completeRecovery(state: ContactRecoveryState) {
  const check = contextGuard(state.target),
    pending = state.pending;
  if (!pending) throw new Error('RECOVERY_REQUEST_UNKNOWN');
  const data = {
    dao_id: state.target.dao.daoId,
    member_id: state.target.memberId,
    request_id: pending.request.request_id,
  };
  if (pending.request.native_account) {
    const wallet = nativeWallet.value;
    if (!wallet || wallet.actor.toString() !== pending.request.native_account)
      throw new Error('RECOVERY_NATIVE_WALLET_REQUIRED');
    await transactNative(
      Action.from(
        {
          account: state.target.dao.contract,
          name: 'finishrec',
          authorization: [wallet.permissionLevel],
          data,
        },
        runtimeAbi,
      ),
      true,
      check,
    );
  } else await api.contactRecoverySubmit({ action: 'finishrec', data });
  check();
}
export async function claimRecovery(
  state: ContactRecoveryState,
  password: string,
  replaceExisting: boolean,
) {
  const check = contextGuard(state.target),
    pending = pendingRecovery(),
    result = state.result;
  if (!pending || !result || result.request.signing_key !== pending.kit.signingPublicKey)
    throw new Error('CONTACT_RECOVERY_BACKUP_PENDING');
  const existing = savedVault();
  if (existing && existing.signingPublicKey !== pending.kit.signingPublicKey && !replaceExisting)
    throw new Error('CONTACT_RECOVERY_VAULT_OVERWRITE');
  const keys = await unlockVault(pending.kit.localEnvelope, password);
  check();
  const challenge = await api.challenge({
    signingKey: pending.kit.signingPublicKey,
    encryptionKey: pending.kit.encryptionPublicKey,
  });
  check();
  const message = LoginMessageSchema.parse(JSON.parse(challenge.message));
  if (
    message.origin !== location.origin ||
    message.audience !== new URL(resolveApiUrl('/v1')).origin ||
    message.challenge !== challenge.id ||
    message.signingKey !== pending.kit.signingPublicKey ||
    JSON.stringify(message.encryptionKey) !== JSON.stringify(pending.kit.encryptionPublicKey) ||
    message.expires !== challenge.expires ||
    Date.parse(message.expires) <= Date.now()
  )
    throw new Error('ACCOUNT_KEY_MISMATCH');
  const session = await api.contactRecoveryClaim({
    target: state.target,
    requestId: result.request.request_id,
    challengeId: challenge.id,
    signature: PrivateKey.from(keys.signingKey)
      .signMessage(new TextEncoder().encode(challenge.message))
      .toString(),
    encryptionKey: pending.kit.encryptionPublicKey,
  });
  check();
  if (
    session.account.signingKey !== pending.kit.signingPublicKey ||
    JSON.stringify(session.account.encryptionKey) !==
      JSON.stringify(pending.kit.encryptionPublicKey)
  )
    throw new Error('ACCOUNT_KEY_MISMATCH');
  if (state.identity)
    localStorage.setItem(
      storageKey,
      JSON.stringify(
        PendingSchema.parse({
          ...pending,
          identity: JSON.stringify([
            state.target.dao.chainId,
            state.target.dao.contract,
            state.identity.id,
          ]),
        }),
      ),
    );
  saveRestoredVault(pending.kit);
  const workspace = useWorkspace();
  workspace.account = acceptProviderSession(session.account, session.csrfToken);
  workspace.account = await unlockAndLogin(password);
  await workspace.refresh();
}
export function parsedPacket(value: string): ContactDocumentPacket {
  return ContactDocumentPacketSchema.parse(JSON.parse(value));
}
export async function backupDocumentPacket(state: ContactRecoveryState) {
  const check = contextGuard(state.target),
    policy = state.policy;
  if (!state.documentsAllowed || !policy?.documents || policy.accepted !== 7)
    throw new Error('RECOVERY_DOCUMENT_POLICY');
  const content = await api.content(state.target.dao.daoId);
  check();
  if (JSON.stringify(content.dao) !== JSON.stringify(state.target.dao))
    throw new Error('DAO_REFERENCE');
  const covered = new Set(
    state.packets
      .filter((p) => p.revision === policy.revision)
      .flatMap((p) => {
        try {
          return parsedPacket(p.packet).context.epochs.map((e) => e.epoch);
        } catch {
          return [];
        }
      }),
  );
  const epochs = content.keyGrants
    .filter((g) => g.recipient === state.target.memberId && !covered.has(g.epoch))
    .map((g) => g.epoch)
    .slice(0, 16);
  if (!epochs.length) throw new Error('CONTACT_RECOVERY_EPOCHS_COVERED');
  const secrets = await contactEpochSecrets(
    state.target.dao,
    state.target.memberId,
    epochs,
    content,
  );
  check();
  const packet = await createContactDocumentPacket(
    { target: state.target, revision: policy.revision, packetId: state.nextPacketId },
    secrets,
    policy.contacts.map((c) => ({
      signingKey: c.signing_key,
      encryptionKey: JSON.parse(c.encryption_key),
    })),
  );
  check();
  await recoveryOwnerAction(state.target, 'putrecpack', {
    runtime: state.target.dao.contract,
    dao_id: state.target.dao.daoId,
    member_id: state.target.memberId,
    packet_id: state.nextPacketId,
    packet: JSON.stringify(packet),
  });
  return packet;
}
export async function deliverDocumentShare(
  state: ContactRecoveryState,
  packet: ContactDocumentPacket,
): Promise<ContactShareDelivery> {
  const account = useWorkspace().account,
    result = state.result;
  if (
    !account ||
    !result ||
    !state.documentsAllowed ||
    !result.documents_approved ||
    !sameTarget(packet.context.target, state.target)
  )
    throw new Error('RECOVERY_DOCUMENT_POLICY');
  const index = packet.context.contacts.findIndex((c) => c.signingKey === account.signingKey);
  if (index < 0) throw new Error('CONTACT_RECOVERY_CONTACT_REQUIRED');
  return withUnlockedVault(account, async (keys) => {
    const share = await openContactDocumentShare(packet, index, keys.encryptionPrivateKey);
    return sealContactDocumentShare(share, {
      target: state.target,
      requestId: result.request.request_id,
      packetCommitment: await contactPacketCommitment(packet),
      recipient: EncryptionPublicKeySchema.parse(JSON.parse(result.request.encryption_key)),
    });
  });
}
export async function restoreDocumentPacket(
  state: ContactRecoveryState,
  packet: ContactDocumentPacket,
  deliveries: ContactShareDelivery[],
) {
  const check = contextGuard(state.target),
    account = useWorkspace().account,
    result = state.result;
  if (
    !account ||
    !result ||
    result.request.signing_key !== account.signingKey ||
    !state.documentsAllowed ||
    !result.documents_approved ||
    !sameTarget(packet.context.target, state.target)
  )
    throw new Error('RECOVERY_DOCUMENT_POLICY');
  const context = {
    target: state.target,
    requestId: result.request.request_id,
    packetCommitment: await contactPacketCommitment(packet),
    recipient: EncryptionPublicKeySchema.parse(account.encryptionKey),
  };
  const epochs = await withUnlockedVault(account, async (keys) => {
    const shares: ContactDocumentShare[] = [];
    for (const delivery of deliveries)
      shares.push(
        await openContactShareDelivery(
          ContactShareDeliverySchema.parse(delivery),
          context,
          keys.encryptionPrivateKey,
        ),
      );
    return recoverContactDocumentPacket(packet, shares);
  });
  check();
  for (const epoch of epochs) {
    const existing = await api.contactRecoveryGrant({
      target: state.target,
      requestId: result.request.request_id,
      epoch: epoch.epoch,
    });
    check();
    const existingGrant = existing.grant;
    if (existingGrant) {
      await withUnlockedVault(account, async (keys) => {
        const opened = await openCommittedEpoch(
          keys.encryptionPrivateKey,
          existingGrant,
          epochGrantDomain(state.target.dao, epoch.epoch, state.target.memberId),
          epoch.commitment,
        );
        opened.fill(0);
      });
      continue;
    }
    const raw = Uint8Array.from(atob(epoch.key), (c) => c.charCodeAt(0));
    try {
      const grant = await createEpochGrant(
        context.recipient,
        raw,
        epochGrantDomain(state.target.dao, epoch.epoch, state.target.memberId),
      );
      check();
      await recoveryOwnerAction(state.target, 'recovergrant', {
        runtime: state.target.dao.contract,
        dao_id: state.target.dao.daoId,
        member_id: state.target.memberId,
        request_id: result.request.request_id,
        epoch: epoch.epoch,
        envelope: JSON.stringify(grant),
      });
    } finally {
      raw.fill(0);
    }
  }
}
