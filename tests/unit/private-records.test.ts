import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { PrivateKey } from '@wharfkit/antelope';
import {
  AccountSchema,
  DaoContentSchema,
  DaoRefSchema,
  NetworkSchema,
  RecoveryContextSchema,
  VERSION,
  DaoSummarySchema,
  HostedUploadSchema,
  HostedDocumentSchema,
  HostedIntentSchema,
  UserMembershipSchema,
  PrivateRecordRoutes,
} from '@daclify/core-protocol';
import { readPrivateRecord, readPrivateImage } from '../../src/content/private-records';
import { publishPrivateRecord } from '../../src/content/publish-private-record';
import { BallotMetadataV4Schema } from '@daclify/modules';
import { ballotCommitment } from '@daclify/modules/sdk';
import { readPrivateBallot } from '../../src/content/private-ballots';
import { updatePrivateIdentity } from '../../src/content/dao-identity';
import { generateVaultSecrets, sha256Hex } from '../../src/auth/vault';
import {
  encryptDaoFile,
  encryptDaoJson,
  installCreatedVault,
  lockVault,
  preparePrivateEpoch,
} from '../../src/auth/session';
import { useWorkspace } from '../../src/state/workspace';
import { api, ApiFailure } from '../../src/api/client';
import { resolveApiUrl } from '../../src/api/networks';

const dao = DaoRefSchema.parse({
  chainId: 'ab'.repeat(32),
  contract: 'daclifycore1',
  daoId: '7',
  interfaceVersion: 1,
});
const expected = { kind: 'dao-identity' as const, source: dao.contract, recordId: dao.daoId };
const payload = {
  schemaVersion: 1,
  ...expected,
  body: { title: 'Secret identity canary', description: 'Secret mission canary' },
};
function storage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => map.clear(),
  };
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('sessionStorage', storage());
  vi.stubGlobal('window', { location: new URL('http://localhost:5178/account') });
});
afterEach(() => {
  lockVault();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setActivePinia(undefined);
});

async function openOriginalKeys() {
  const keys = await generateVaultSecrets(),
    privateKey = keys.encryptionPrivateKey;
  const account = AccountSchema.parse({
    id: crypto.randomUUID(),
    custody: 'user-controlled',
    signingKey: PrivateKey.from(keys.signingKey).toPublic().toString(),
    encryptionKey: { kty: privateKey.kty, crv: privateKey.crv, x: privateKey.x, y: privateKey.y },
  });
  const state = useWorkspace();
  state.account = account;
  state.network = NetworkSchema.parse({
    chainId: dao.chainId,
    runtime: dao.contract,
    environment: 'testnet',
    interfaceVersion: 1,
    coreVersion: VERSION,
    rpcUrl: 'https://rpc.example',
    hub: null,
    capabilities: [],
  });
  const context = RecoveryContextSchema.parse({
    version: 1,
    id: crypto.randomUUID(),
    accountId: account.id,
    origin: window.location.origin,
    credentialKey: 'native:fixture',
    mode: 'wallet-protected',
    signingPublicKey: account.signingKey,
    encryptionPublicKey: account.encryptionKey,
    salt: btoa('a'.repeat(32)),
  });
  await installCreatedVault(account, keys, context, () => {});
  return account;
}
async function fixture(value: unknown = payload, keyEpoch = '1') {
  const account = await openOriginalKeys();
  const epoch = await preparePrivateEpoch(dao, '1', keyEpoch);
  const records = DaoContentSchema.parse({
    dao,
    documents: [],
    epochs: [{ epoch: keyEpoch, commitment: epoch.commitment, creator: '1' }],
    keyGrants: [
      { id: '1', recipient: '1', grantor: '1', epoch: keyEpoch, envelope: epoch.selfGrant },
    ],
    members: [
      {
        id: '1',
        native_account: '',
        signing_key: account.signingKey,
        encryption_key: JSON.stringify(account.encryptionKey),
        custody: 0,
        nonce: '0',
        credits: '0',
        stake: '0',
        claim: '0',
        active: true,
        admin: true,
        reviewer: false,
        join_epoch: keyEpoch,
      },
    ],
  });
  const metadata = await encryptDaoJson(
    dao,
    '1',
    '41',
    2,
    keyEpoch,
    records,
    JSON.stringify(value),
  );
  const document = {
    id: '4',
    document_id: '41',
    version: 2,
    author: '1',
    cid: '',
    metadata,
    bytes: new TextEncoder().encode(metadata).length,
    commitment: await sha256Hex(new TextEncoder().encode(metadata)),
    envelope_version: 1,
    key_epoch: keyEpoch,
  };
  records.documents.push(document);
  return {
    account,
    records,
    document,
    reference: { documentId: '41', version: 2, commitment: document.commitment, keyEpoch },
  };
}
it('reads a private Quick question with DAO grants as a non-executive and refuses missing grants or copied contexts', async () => {
  const expected = { kind: 'quick-question' as const, source: 'quickvote', recordId: '41' };
  const value = {
    schemaVersion: 1,
    ...expected,
    body: {
      question: 'Hidden Quick question canary',
      explanation: 'Only DAO content readers may see this.',
    },
  };
  const f = await fixture(value);
  const member = f.records.members[0];
  if (!member) throw Error('fixture member missing');
  member.admin = false;
  await expect(
    readPrivateRecord(dao, '1', f.reference, { ...f.records, keyGrants: [] }, expected),
  ).rejects.toThrow();
  await expect(readPrivateRecord(dao, '1', f.reference, f.records, expected)).resolves.toEqual(
    value,
  );
  await expect(
    readPrivateRecord(dao, '1', f.reference, f.records, { ...expected, source: 'foreign' }),
  ).rejects.toThrow('PRIVATE_RECORD_CONTEXT');
  await expect(
    readPrivateRecord(dao, '1', f.reference, f.records, { ...expected, recordId: '42' }),
  ).rejects.toThrow('PRIVATE_RECORD_CONTEXT');
  lockVault();
  await expect(readPrivateRecord(dao, '1', f.reference, f.records, expected)).rejects.toThrow(
    'VAULT_LOCKED',
  );
});

it('opens only a frozen private ballot and refuses copied parents, semantics and missing definitions', async () => {
  const value = {
    schemaVersion: 1,
    kind: 'ballot-content',
    source: 'decide',
    recordId: '41',
    body: {
      title: 'Private ballot canary',
      description: 'Private explanation canary',
      semantics: 'proposal',
      options: ['Reject', 'Approve'],
    },
  };
  const f = await fixture(value);
  const ballot = {
    id: '41',
    dao_id: dao.daoId,
    creator: '1',
    kind: 0,
    choices: 2,
    closes: 1300,
    quorum: 5000,
    approval: 5001,
    denominator: '3',
    max_member: '3',
    cast: '0',
    tallies: ['0', '0'],
    status: 0,
    winner: -1,
    metadata: JSON.stringify({
      schemaVersion: 4,
      semantics: 'proposal',
      options: [0, 1],
      privateContent: f.reference,
    }),
  };
  function input(candidate = ballot, version = 3) {
    const definition = {
      ballot_id: candidate.id,
      dao_id: dao.daoId,
      version,
      purpose:
        BallotMetadataV4Schema.parse(JSON.parse(candidate.metadata)).semantics === 'poll' ? 1 : 0,
      policy_revision: '0',
      policy_hash: '00'.repeat(32),
      commitment: '00'.repeat(32),
    };
    definition.commitment = ballotCommitment({
      chainId: dao.chainId,
      runtime: dao.contract,
      decide: 'decide',
      ballot: candidate,
      definition,
    });
    return {
      dao,
      memberId: '1',
      decide: 'decide',
      ballot: candidate,
      definitions: [definition],
      records: f.records,
    };
  }
  expect((await readPrivateBallot(input())).payload).toEqual(value);
  await expect(readPrivateBallot(input({ ...ballot, id: '42' }, 1))).rejects.toThrow(
    'PRIVATE_RECORD_CONTEXT',
  );
  await expect(readPrivateBallot({ ...input(), definitions: [] })).rejects.toThrow(
    'BALLOT_DEFINITION_REQUIRED',
  );
  await expect(
    readPrivateBallot(input({ ...ballot, metadata: ballot.metadata.replace('proposal', 'poll') })),
  ).rejects.toThrow('PRIVATE_BALLOT_CONTEXT');
  lockVault();
  await expect(readPrivateBallot(input())).rejects.toThrow('VAULT_LOCKED');
});
it('opens exact ciphertext with original keys and never stores or sends its decrypted identity', async () => {
  const f = await fixture(),
    bytes = vi.spyOn(api, 'documentBytes');
  expect(await readPrivateRecord(dao, '1', f.reference, f.records, expected)).toEqual(payload);
  expect(bytes).not.toHaveBeenCalled();
  expect(f.document.metadata).not.toContain(payload.body.title);
  expect(JSON.stringify(localStorage)).not.toContain(payload.body.title);
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});
it('reconciles an already published private record without another signature and refuses changed content', async () => {
  const f = await fixture();
  vi.spyOn(api, 'content').mockResolvedValue(f.records);
  const send = vi.spyOn(api, 'relay');
  expect(
    await publishPrivateRecord(dao, '1', f.document.document_id, f.document.version, payload),
  ).toEqual(f.reference);
  expect(send).not.toHaveBeenCalled();
  await expect(
    publishPrivateRecord(dao, '1', f.document.document_id, f.document.version, {
      ...payload,
      body: { ...payload.body, title: 'Changed after lost response' },
    }),
  ).rejects.toThrow('DOCUMENT_VERSION');
  expect(send).not.toHaveBeenCalled();
});
it.each([false, true])(
  'resumes a published identity and refuses an epoch change before linking (rotation=%s)',
  async (rotated) => {
    const f = await fixture(),
      previous = { ...f.reference, version: 1 };
    const snapshot = PrivateRecordRoutes.identity.response.parse({
      dao,
      reference: previous,
      metadata: {
        schemaVersion: 4,
        title: 'Private DAO',
        description: '',
        purpose: 'custom',
        setup: null,
        privateIdentity: previous,
      },
      metadataCommitment: 'ab'.repeat(32),
    });
    vi.spyOn(api, 'privateIdentity')
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce({ ...snapshot, reference: f.reference });
    const summary = DaoSummarySchema.parse({
      reference: dao,
      title: 'Private DAO',
      description: '',
      privacy: 'encrypted-user-controlled',
      owner: 'alice',
      token: { chainId: dao.chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
      members: 1,
      available: '0',
      reserved: '0',
      claims: '0',
      keyEpoch: '1',
    });
    vi.spyOn(api, 'dao')
      .mockResolvedValueOnce(summary)
      .mockResolvedValue({ ...summary, keyEpoch: rotated ? '2' : '1' });
    vi.spyOn(api, 'content').mockResolvedValue(f.records);
    vi.spyOn(api, 'memberships').mockResolvedValue([
      UserMembershipSchema.parse({
        dao,
        memberId: '1',
        nonce: '0',
        active: true,
        admin: true,
        reviewer: false,
        credits: '0',
        claim: '0',
        stake: '0',
        nativeAccount: '',
        custody: 'user-controlled',
        signingKey: f.account.signingKey,
      }),
    ]);
    const send = vi.spyOn(api, 'relay').mockResolvedValue({ transactionId: 'ab'.repeat(32) });
    if (rotated) {
      await expect(updatePrivateIdentity(dao, '1', previous, payload.body)).rejects.toThrow(
        'PRIVATE_EPOCH_CHANGED',
      );
      expect(send).not.toHaveBeenCalled();
      return;
    }
    expect(await updatePrivateIdentity(dao, '1', previous, payload.body)).toEqual(f.reference);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].action).toBe('setmeta');
  },
);
it.each([false, true])(
  'requires replacement of a stale new image but preserves a retained image (retained=%s)',
  async (retained) => {
    const image = { documentId: '99', version: 1, commitment: 'cd'.repeat(32), keyEpoch: '1' },
      value = { ...payload, body: { ...payload.body, branding: { logo: image } } },
      f = await fixture(value, '2'),
      previous = { ...f.reference, version: 1 };
    const snapshot = PrivateRecordRoutes.identity.response.parse({
      dao,
      reference: previous,
      metadata: {
        schemaVersion: 4,
        title: 'Private DAO',
        description: '',
        purpose: 'custom',
        setup: null,
        privateIdentity: previous,
        privateAssets: retained ? [image] : [],
      },
      metadataCommitment: 'ab'.repeat(32),
    });
    vi.spyOn(api, 'privateIdentity')
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce({ ...snapshot, reference: f.reference });
    vi.spyOn(api, 'dao').mockResolvedValue(
      DaoSummarySchema.parse({
        reference: dao,
        title: 'Private DAO',
        description: '',
        privacy: 'encrypted-user-controlled',
        owner: 'alice',
        token: { chainId: dao.chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
        members: 1,
        available: '0',
        reserved: '0',
        claims: '0',
        keyEpoch: '2',
      }),
    );
    vi.spyOn(api, 'content').mockResolvedValue(f.records);
    vi.spyOn(api, 'memberships').mockResolvedValue([
      UserMembershipSchema.parse({
        dao,
        memberId: '1',
        nonce: '0',
        active: true,
        admin: true,
        reviewer: false,
        credits: '0',
        claim: '0',
        stake: '0',
        nativeAccount: '',
        custody: 'user-controlled',
        signingKey: f.account.signingKey,
      }),
    ]);
    const send = vi.spyOn(api, 'relay').mockResolvedValue({ transactionId: 'ab'.repeat(32) });
    if (!retained) {
      await expect(updatePrivateIdentity(dao, '1', previous, value.body)).rejects.toThrow(
        'PRIVATE_ASSET_EPOCH_CHANGED',
      );
      expect(send).not.toHaveBeenCalled();
      return;
    }
    await expect(updatePrivateIdentity(dao, '1', previous, value.body)).resolves.toEqual(
      f.reference,
    );
    expect(send).toHaveBeenCalledOnce();
  },
);
it('resumes the same encrypted file request when interruption happens before the server reserves it', async () => {
  const f = await fixture(),
    state = useWorkspace(),
    network = state.network;
  if (!network) throw Error('fixture network missing');
  network.capabilities.push('private-records-v1');
  const large = {
    ...payload,
    body: { ...payload.body, description: 'Private long canary '.repeat(190) },
  };
  vi.spyOn(api, 'content').mockResolvedValue(f.records);
  vi.spyOn(api, 'dao').mockResolvedValue(
    DaoSummarySchema.parse({
      reference: dao,
      title: 'Private DAO',
      description: '',
      privacy: 'encrypted-user-controlled',
      owner: 'alice',
      token: { chainId: dao.chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
      members: 1,
      available: '0',
      reserved: '0',
      claims: '0',
      keyEpoch: '1',
    }),
  );
  vi.spyOn(api, 'memberships').mockResolvedValue([
    UserMembershipSchema.parse({
      dao,
      memberId: '1',
      nonce: '0',
      active: true,
      admin: true,
      reviewer: false,
      credits: '0',
      claim: '0',
      stake: '0',
      nativeAccount: '',
      custody: 'user-controlled',
      signingKey: f.account.signingKey,
    }),
  ]);
  const upload = vi
    .spyOn(api, 'upload')
    .mockRejectedValueOnce(new TypeError('Interrupted before request'));
  vi.spyOn(api, 'reconcileUpload').mockRejectedValue(new ApiFailure('UPLOAD_UNKNOWN'));
  await expect(publishPrivateRecord(dao, '1', '42', 1, large, true)).rejects.toThrow(
    'Interrupted before request',
  );
  const first = HostedUploadSchema.parse(upload.mock.calls[0]?.[0]);
  expect(JSON.stringify(first)).not.toContain('Private long canary');
  const saved = sessionStorage.getItem(sessionStorage.key(0) ?? '');
  const send = vi.spyOn(api, 'relay');
  await expect(publishPrivateRecord(dao, '1', '42', 1, payload, true)).rejects.toThrow(
    'PENDING_UPLOAD_FINISH',
  );
  await expect(
    publishPrivateRecord(
      dao,
      '1',
      '42',
      1,
      {
        ...large,
        body: { ...large.body, title: 'Changed pending intent' },
      },
      true,
    ),
  ).rejects.toThrow('PENDING_UPLOAD_FINISH');
  expect(send).not.toHaveBeenCalled();
  expect(upload).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem(sessionStorage.key(0) ?? '')).toBe(saved);
  upload.mockImplementation(async (input) =>
    HostedDocumentSchema.parse({
      ...HostedIntentSchema.strip().parse(input),
      cid: 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    }),
  );
  vi.spyOn(api, 'documentBytes').mockResolvedValue({ content: first.content });
  send.mockImplementation(async (request) => {
    expect(request.action).toBe('putdoc');
    f.records.documents.push({
      ...f.document,
      id: '5',
      document_id: '42',
      version: 1,
      cid: 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
      metadata: first.metadata,
      bytes: first.bytes,
      commitment: first.commitment,
    });
    return { transactionId: 'ab'.repeat(32) };
  });
  expect(await publishPrivateRecord(dao, '1', '42', 1, large, true)).toMatchObject({
    documentId: '42',
    version: 1,
    commitment: first.commitment,
  });
  expect(upload.mock.calls[1]?.[0]).toEqual(first);
  expect(sessionStorage.length).toBe(0);
  const key = JSON.stringify(['daclify.pending-private-record.v1', '/', f.account.id, dao]);
  if (!saved) throw Error('pending fixture missing');
  sessionStorage.setItem(key, saved);
  await publishPrivateRecord(dao, '1', '42', 1, large, true);
  expect(upload).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenCalledTimes(1);
  expect(sessionStorage.length).toBe(0);
});

it('rejects wrong DAO, missing versions, copied epochs, commitments and public fallbacks', async () => {
  const f = await fixture();
  await expect(
    readPrivateRecord({ ...dao, daoId: '8' }, '1', f.reference, f.records, expected),
  ).rejects.toThrow();
  for (const bad of [
    { ...f.reference, version: 1 },
    { ...f.reference, keyEpoch: '2' },
    { ...f.reference, commitment: 'ff'.repeat(32) },
  ])
    await expect(readPrivateRecord(dao, '1', bad, f.records, expected)).rejects.toThrow();
  f.document.envelope_version = 0;
  await expect(readPrivateRecord(dao, '1', f.reference, f.records, expected)).rejects.toThrow();
});

it('opens verified encrypted JSON files while keeping their name and content private', async () => {
  const f = await fixture();
  const prepared = await encryptDaoFile(
    dao,
    '1',
    '41',
    2,
    '1',
    f.records,
    new TextEncoder().encode(JSON.stringify(payload)),
    { version: 1, filename: 'private-record.json', mediaType: 'application/json' },
  );
  f.document.cid = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
  f.document.metadata = prepared.metadata;
  f.document.commitment = prepared.commitment;
  f.document.bytes = prepared.bytes;
  f.reference.commitment = prepared.commitment;
  vi.spyOn(api, 'documentBytes').mockResolvedValue({ content: prepared.content });
  expect(await readPrivateRecord(dao, '1', f.reference, f.records, expected)).toEqual(payload);
  expect(prepared.metadata).toBe('{}');
  expect(prepared.content).not.toContain(payload.body.title);
});
it('opens private raster assets with exact grants and rejects active content disguised as an image', async () => {
  const f = await fixture();
  async function image(bytes: Uint8Array) {
    const prepared = await encryptDaoFile(dao, '1', '41', 2, '1', f.records, bytes, {
      version: 1,
      filename: 'hidden-logo-canary.png',
      mediaType: 'image/png',
    });
    Object.assign(f.document, {
      cid: 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
      metadata: prepared.metadata,
      bytes: prepared.bytes,
      commitment: prepared.commitment,
    });
    f.reference.commitment = prepared.commitment;
    vi.spyOn(api, 'documentBytes').mockResolvedValue({ content: prepared.content });
  }
  const png = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  await image(png);
  expect(await readPrivateImage(dao, '1', f.reference, f.records)).toEqual({
    bytes: png,
    mediaType: 'image/png',
  });
  await expect(
    readPrivateImage(dao, '1', { ...f.reference, version: 1 }, f.records),
  ).rejects.toThrow();
  await image(new TextEncoder().encode('<svg onload="alert(1)"/>'));
  await expect(readPrivateImage(dao, '1', f.reference, f.records)).rejects.toThrow('FILE_METADATA');
});

it.each([
  {
    ...payload,
    kind: 'agent-description',
    body: { operatorLabel: 'Operator', description: 'Different kind' },
  },
  { ...payload, source: 'othercore' },
  { ...payload, recordId: '8' },
])('rejects decrypted content bound to a different parent: %j', async (body) => {
  const f = await fixture(body);
  await expect(readPrivateRecord(dao, '1', f.reference, f.records, expected)).rejects.toThrow(
    'PRIVATE_RECORD_CONTEXT',
  );
});

it('rejects tampered ciphertext and keys from a replacement identity', async () => {
  const f = await fixture();
  const envelope: unknown = JSON.parse(f.document.metadata);
  expect(envelope).toHaveProperty('ciphertext');
  f.document.metadata = f.document.metadata.replace('ciphertext', 'wrongField');
  await expect(readPrivateRecord(dao, '1', f.reference, f.records, expected)).rejects.toThrow();
  const valid = await fixture();
  const replacement = await openOriginalKeys();
  if (!valid.records.members[0]) throw new Error('FIXTURE_MEMBER');
  valid.records.members[0].encryption_key = JSON.stringify(replacement.encryptionKey);
  const decrypt = vi.spyOn(crypto.subtle, 'decrypt');
  await expect(
    readPrivateRecord(dao, '1', valid.reference, valid.records, expected),
  ).rejects.toThrow();
  expect(decrypt).toHaveBeenCalled();
});

it.each(['lock', 'account', 'network', 'membership'])(
  'discards an in-flight private result after %s changes',
  async (change) => {
    const f = await fixture();
    let release: (() => void) | undefined;
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    const pending = vi.spyOn(crypto.subtle, 'decrypt').mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return decrypt(...args);
    });
    const reading = readPrivateRecord(dao, '1', f.reference, f.records, expected);
    const rejection = expect(reading).rejects.toThrow();
    await vi.waitFor(() => expect(pending).toHaveBeenCalled());
    const state = useWorkspace();
    if (change === 'lock') lockVault();
    if (change === 'account') state.account = { ...f.account, id: crypto.randomUUID() };
    if (change === 'network' && state.network) state.network.runtime = 'othercore';
    if (change === 'membership' && f.records.members[0]) f.records.members[0].active = false;
    if (!release) throw new Error('FIXTURE_NOT_PENDING');
    release();
    await rejection;
  },
);

it.each([
  { ...payload },
  {
    schemaVersion: 1,
    kind: 'ballot-content',
    source: 'decide',
    recordId: '41',
    body: {
      title: 'Recovered private ballot',
      description: 'Original choices',
      semantics: 'poll',
      options: ['No', 'Yes', 'Later'],
    },
  },
  {
    schemaVersion: 1,
    kind: 'payroll-label',
    source: 'payroll',
    recordId: '41',
    body: { purpose: 'agreed', label: 'Recovered agreed name' },
  },
  {
    schemaVersion: 1,
    kind: 'payroll-label',
    source: 'payroll',
    recordId: '41',
    body: { purpose: 'display', label: 'Recovered display name' },
  },
  {
    schemaVersion: 1,
    kind: 'agent-description',
    source: dao.contract,
    recordId: '41',
    body: { operatorLabel: 'Recovered operator', description: 'Original operating details' },
  },
  {
    schemaVersion: 1,
    kind: 'quick-question',
    source: 'quickvote',
    recordId: '41',
    body: { question: 'Recovered private question', explanation: 'Separate vote readers' },
  },
])(
  'preserves permitted original encrypted history for another device and refuses missing or inactive grants: $kind',
  async (value) => {
    const { PrivateRecordPayloadSchema } = await import('@daclify/core-protocol');
    const { grantPrivateEpoch } = await import('../../src/auth/session');
    const { planPrivateAccess } = await import('../../src/auth/private-access');
    const payload = PrivateRecordPayloadSchema.parse(value),
      f = await fixture(payload);
    const keys = await generateVaultSecrets(),
      privateKey = keys.encryptionPrivateKey;
    const account = AccountSchema.parse({
      id: crypto.randomUUID(),
      custody: 'user-controlled',
      signingKey: PrivateKey.from(keys.signingKey).toPublic().toString(),
      encryptionKey: { kty: privateKey.kty, crv: privateKey.crv, x: privateKey.x, y: privateKey.y },
    });
    const original = f.records.members[0];
    if (!original) throw Error('Fixture member missing');
    const recipient = {
      ...original,
      id: '2',
      admin: false,
      signing_key: PrivateKey.from(keys.signingKey).toPublic().toString(),
      encryption_key: JSON.stringify(account.encryptionKey),
      join_epoch: '2',
    };
    f.records.members.push(recipient);
    expect(
      planPrivateAccess(f.records, '1', 'from-join', 'encrypted-user-controlled').grants,
    ).toHaveLength(0);
    expect(
      planPrivateAccess(f.records, '1', 'full-history', 'encrypted-user-controlled').grants,
    ).toMatchObject([{ epoch: '1', recipient: { id: '2' } }]);
    const envelope = await grantPrivateEpoch(dao, '1', recipient, '1', f.records);
    lockVault();
    useWorkspace().account = account;
    const context = RecoveryContextSchema.parse({
      version: 1,
      id: crypto.randomUUID(),
      accountId: account.id,
      origin: window.location.origin,
      credentialKey: 'native:fixture',
      mode: 'wallet-protected',
      signingPublicKey: account.signingKey,
      encryptionPublicKey: account.encryptionKey,
      salt: btoa('a'.repeat(32)),
    });
    await installCreatedVault(account, keys, context, () => {});
    await expect(readPrivateRecord(dao, '2', f.reference, f.records, payload)).rejects.toThrow(
      'EPOCH_UNAVAILABLE',
    );
    f.records.keyGrants.push({ id: '2', recipient: '2', grantor: '1', epoch: '1', envelope });
    original.active = false;
    expect(await readPrivateRecord(dao, '2', f.reference, f.records, payload)).toEqual(payload);
    lockVault();
    await installCreatedVault(account, keys, context, () => {});
    expect(await readPrivateRecord(dao, '2', f.reference, f.records, payload)).toEqual(payload);
    recipient.active = false;
    await expect(readPrivateRecord(dao, '2', f.reference, f.records, payload)).rejects.toThrow(
      'MEMBER_REQUIRED',
    );
  },
);

it('reprepares a verified obsolete upload with original grants and keeps its old request tracked without releasing storage', async () => {
  const { repreparePrivateRecord } = await import('../../src/content/reprepare-private-record');
  const f = await fixture(),
    network = useWorkspace().network;
  if (!network) throw Error('fixture network missing');
  network.capabilities.push('private-records-v1');
  const large = {
    ...payload,
    body: { ...payload.body, description: 'Original private content '.repeat(150) },
  };
  const summary = DaoSummarySchema.parse({
    reference: dao,
    title: 'Private DAO',
    description: '',
    privacy: 'encrypted-user-controlled',
    owner: 'alice',
    token: { chainId: dao.chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
    members: 1,
    available: '0',
    reserved: '0',
    claims: '0',
    keyEpoch: '1',
  });
  const daoRead = vi.spyOn(api, 'dao').mockImplementation(async () => ({ ...summary }));
  vi.spyOn(api, 'content').mockResolvedValue(f.records);
  vi.spyOn(api, 'memberships').mockResolvedValue([
    UserMembershipSchema.parse({
      dao,
      memberId: '1',
      nonce: '0',
      active: true,
      admin: true,
      reviewer: false,
      credits: '0',
      claim: '0',
      stake: '0',
      nativeAccount: '',
      custody: 'user-controlled',
      signingKey: f.account.signingKey,
    }),
  ]);
  const upload = vi.spyOn(api, 'upload').mockRejectedValueOnce(Error('Lost upload confirmation'));
  await expect(publishPrivateRecord(dao, '1', '42', 1, large, true)).rejects.toThrow(
    'Lost upload confirmation',
  );
  const first = HostedUploadSchema.parse(upload.mock.calls[0]?.[0]);
  summary.keyEpoch = '2';
  const epoch = await preparePrivateEpoch(dao, '1', '2');
  f.records.epochs.push({ epoch: '2', commitment: epoch.commitment, creator: '1' });
  f.records.keyGrants.push({
    id: '2',
    recipient: '1',
    grantor: '1',
    epoch: '2',
    envelope: epoch.selfGrant,
  });
  const cid = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
  const receipt = (input: typeof first) =>
    HostedDocumentSchema.parse({ ...HostedIntentSchema.strip().parse(input), cid });
  const reconcile = vi
    .spyOn(api, 'reconcileUpload')
    .mockResolvedValue({ requestId: first.requestId, state: 'reserved' });
  const pendingBefore = [...Array(sessionStorage.length)].map((_, i) =>
    sessionStorage.getItem(sessionStorage.key(i) ?? ''),
  );
  await expect(repreparePrivateRecord(dao, '1', expected, '42')).rejects.toThrow('UPLOAD_PENDING');
  expect(upload).toHaveBeenCalledTimes(1);
  expect(
    [...Array(sessionStorage.length)].map((_, i) =>
      sessionStorage.getItem(sessionStorage.key(i) ?? ''),
    ),
  ).toEqual(pendingBefore);
  reconcile.mockResolvedValue({
    requestId: first.requestId,
    state: 'verified',
    document: receipt(first),
  });
  upload.mockImplementation(async (input) => receipt(input));
  vi.spyOn(api, 'documentBytes').mockImplementation(async () => {
    const input = upload.mock.calls.at(-1)?.[0];
    if (!input) throw Error('fixture upload missing');
    return { content: input.content };
  });
  const relay = vi.spyOn(api, 'relay').mockImplementation(async (request) => {
    expect(request.action).toBe('putdoc');
    const input = HostedUploadSchema.parse(upload.mock.calls.at(-1)?.[0]);
    f.records.documents.push({
      id: '5',
      document_id: input.documentId,
      version: input.version,
      author: '1',
      cid,
      metadata: input.metadata,
      bytes: input.bytes,
      commitment: input.commitment,
      envelope_version: 1,
      key_epoch: input.keyEpoch,
    });
    return { transactionId: 'ab'.repeat(32) };
  });
  const pendingKey = [...Array(sessionStorage.length)]
    .map((_, i) => sessionStorage.key(i))
    .find((key) => key?.includes('daclify.pending-private-record.v1'));
  if (!pendingKey) throw Error('fixture pending missing');
  const originalCiphertext = sessionStorage.getItem(pendingKey);
  daoRead
    .mockResolvedValueOnce({ ...summary })
    .mockRejectedValueOnce(Error('Read interrupted before replacement'));
  await expect(repreparePrivateRecord(dao, '1', expected, '42')).rejects.toThrow(
    'Read interrupted before replacement',
  );
  expect(sessionStorage.getItem(pendingKey)).toBe(originalCiphertext);
  expect(upload).toHaveBeenCalledTimes(1);
  const retiredKey = JSON.stringify([
    'daclify.retired-private-uploads.v1',
    resolveApiUrl('/'),
    f.account.id,
    dao,
  ]);
  const previousRequests = Array.from({ length: 25 }, () => crypto.randomUUID());
  sessionStorage.setItem(retiredKey, JSON.stringify(previousRequests));
  const result = await repreparePrivateRecord(dao, '1', expected, '42');
  const retired = JSON.parse(sessionStorage.getItem(retiredKey) ?? '[]');
  expect(retired).toHaveLength(25);
  expect(retired).not.toContain(previousRequests[0]);
  expect(retired).toContain(first.requestId);
  expect(result.payload).toEqual(large);
  expect(result.reference).toMatchObject({ documentId: '42', version: 1, keyEpoch: '2' });
  expect(upload.mock.calls[1]?.[0].requestId).not.toBe(first.requestId);
  expect(relay).toHaveBeenCalledTimes(1);
  expect(
    [...Array(sessionStorage.length)]
      .map((_, i) => sessionStorage.getItem(sessionStorage.key(i) ?? ''))
      .join(''),
  ).toContain(first.requestId);
  expect(f.records.members[0]?.signing_key).toBe(f.account.signingKey);
});
