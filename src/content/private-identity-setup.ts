import {
  CreateDaoSchema,
  DaoRefSchema,
  PrivateDaoSetupSchema,
  PrivateFounderSetupSchema,
  PrivateRecordPayloadSchema,
  PrivateIdentityBodySchema,
  EncryptionPublicKeySchema,
  epochGrantDomain,
  privateCreationCommitment,
  type DaoRef,
  type PrivateDaoSetup,
  type PrivateFounderSetup,
} from '@daclify/core-protocol';
import { z } from 'zod';
import { useWorkspace } from '../state/workspace';
import { withUnlockedVault } from '../auth/session';
import {
  createEpochGrant,
  openCommittedEpoch,
  sealContent,
  openContent,
  sha256Hex,
} from '../auth/vault';
import { encodeStoredBytes } from './files';
import { newPrivateRecordId } from './private-records';

type Creation = z.infer<typeof CreateDaoSchema>;
const text = new TextEncoder();
function setupDomain(
  dao: DaoRef,
  setup: Pick<PrivateDaoSetup, 'daoId' | 'documentId' | 'contextCommitment' | 'stage'>,
) {
  if (dao.daoId !== setup.daoId) throw Error('DAO_REFERENCE');
  return JSON.stringify({
    domain:
      setup.stage === 'invitation' ? 'daclify.private-invitation.v1' : 'daclify.private-founder.v1',
    dao: DaoRefSchema.parse(dao),
    document: setup.documentId,
    version: 1,
    contextCommitment: setup.contextCommitment,
  });
}
function verifySetup(dao: DaoRef, setup: PrivateDaoSetup, request: Creation) {
  if (
    dao.daoId !== setup.daoId ||
    privateCreationCommitment(dao, request) !== setup.contextCommitment
  )
    throw Error('PRIVATE_SETUP_CHANGED');
}
function identity(bytes: Uint8Array, dao: DaoRef) {
  const value = PrivateRecordPayloadSchema.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
  );
  if (
    value.kind !== 'dao-identity' ||
    value.source !== dao.contract ||
    value.recordId !== dao.daoId
  )
    throw Error('PRIVATE_RECORD_CONTEXT');
  return value;
}
async function sealFounder(
  dao: DaoRef,
  documentId: string,
  bytes: Uint8Array,
  contextCommitment: string,
): Promise<PrivateFounderSetup> {
  const account = useWorkspace().account;
  if (!account?.encryptionKey) throw Error('AUTH_REQUIRED');
  const recipient = EncryptionPublicKeySchema.parse(account.encryptionKey);
  return withUnlockedVault(account, async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    try {
      const selfGrant = await createEpochGrant(recipient, key, epochGrantDomain(dao, '1', '1'));
      const pending = {
        schemaVersion: 1,
        stage: 'founder' as const,
        daoId: dao.daoId,
        documentId,
        contextCommitment,
      };
      return PrivateFounderSetupSchema.parse({
        ...pending,
        epochCommitment: await sha256Hex(key),
        selfGrant,
        envelope: await sealContent(bytes, key, setupDomain(dao, pending)),
      });
    } finally {
      key.fill(0);
    }
  });
}
export async function openPrivateFounder(
  dao: DaoRef,
  setup: PrivateFounderSetup,
  request: Creation,
) {
  setup = PrivateFounderSetupSchema.parse(setup);
  verifySetup(dao, setup, request);
  const account = useWorkspace().account;
  if (!account) throw Error('AUTH_REQUIRED');
  return withUnlockedVault(account, async (keys) => {
    const key = await openCommittedEpoch(
      keys.encryptionPrivateKey,
      setup.selfGrant,
      epochGrantDomain(dao, '1', '1'),
      setup.epochCommitment,
    );
    try {
      return identity(await openContent(setup.envelope, key, setupDomain(dao, setup)), dao);
    } finally {
      key.fill(0);
    }
  });
}
export async function openPrivateInvitation(
  dao: DaoRef,
  setup: PrivateDaoSetup,
  contentKey: string,
  request: Creation,
) {
  setup = PrivateDaoSetupSchema.parse(setup);
  if (setup.stage !== 'invitation' || !/^[A-Za-z0-9_-]{43}$/.test(contentKey))
    throw Error('PRIVATE_INVITATION_REQUIRED');
  verifySetup(dao, setup, request);
  const key = Uint8Array.from(atob(contentKey.replace(/-/g, '+').replace(/_/g, '/') + '='), (c) =>
    c.charCodeAt(0),
  );
  try {
    if (
      encodeStoredBytes(key).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !==
      contentKey
    )
      throw Error('PRIVATE_INVITATION_REQUIRED');
    return identity(await openContent(setup.envelope, key, setupDomain(dao, setup)), dao);
  } finally {
    key.fill(0);
  }
}
export async function resealPrivateInvitation(
  dao: DaoRef,
  setup: PrivateDaoSetup,
  contentKey: string,
  request: Creation,
) {
  const opened = await openPrivateInvitation(dao, setup, contentKey, request);
  return sealFounder(
    dao,
    setup.documentId,
    text.encode(JSON.stringify(opened)),
    setup.contextCommitment,
  );
}
export async function sealPrivateCreation(
  input: Creation,
  stage: 'invitation' | 'founder',
  privateBody?: z.infer<typeof PrivateIdentityBodySchema>,
): Promise<{ request: Creation; contentKey?: string }> {
  const network = useWorkspace().network;
  if (input.privacy === 'public' || !network || network.chainId !== input.token.chainId)
    throw Error('DAO_REFERENCE');
  if (
    !network.capabilities.includes(
      stage === 'invitation' ? 'private-claim-content-v1' : 'private-dao-identity-v1',
    )
  )
    throw Error('PRIVATE_IDENTITY_UNSUPPORTED');
  if (input.foundingAgent) throw Error('PRIVATE_FOUNDER_IDENTITY');
  const dao = DaoRefSchema.parse({
    chainId: network.chainId,
    contract: network.runtime,
    daoId: newPrivateRecordId(),
    interfaceVersion: 1,
  });
  const body = privateBody
    ? PrivateIdentityBodySchema.parse(privateBody)
    : input.metadata.schemaVersion === 4
      ? input.privateSetup?.stage === 'founder'
        ? (
            await openPrivateFounder(
              { ...dao, daoId: input.privateSetup.daoId },
              input.privateSetup,
              input,
            )
          ).body
        : (() => {
            throw Error('PRIVATE_FOUNDER_REQUIRED');
          })()
      : { title: input.metadata.title, description: input.metadata.description };
  const payload = PrivateRecordPayloadSchema.parse({
    schemaVersion: 1,
    kind: 'dao-identity',
    source: dao.contract,
    recordId: dao.daoId,
    body,
  });
  const bytes = text.encode(JSON.stringify(payload)),
    documentId = newPrivateRecordId();
  const metadata = {
    schemaVersion: 4,
    title: 'Private DAO',
    description: '',
    purpose: input.setup?.presetId ?? 'custom',
    setup: input.setup ?? null,
    privateIdentity: null,
  };
  const contextCommitment = privateCreationCommitment(dao, { ...input, metadata });
  let privateSetup: PrivateDaoSetup, contentKey: string | undefined;
  if (stage === 'invitation') {
    const key = crypto.getRandomValues(new Uint8Array(32));
    try {
      const pending = { schemaVersion: 1, stage, daoId: dao.daoId, documentId, contextCommitment };
      privateSetup = PrivateDaoSetupSchema.parse({
        ...pending,
        envelope: await sealContent(bytes, key, setupDomain(dao, pending)),
      });
      contentKey = encodeStoredBytes(key)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    } finally {
      key.fill(0);
    }
  } else privateSetup = await sealFounder(dao, documentId, bytes, contextCommitment);
  return {
    request: CreateDaoSchema.parse({ ...input, metadata, privateSetup }),
    ...(contentKey ? { contentKey } : {}),
  };
}
