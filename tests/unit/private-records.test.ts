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
} from '@daclify/core-protocol';
import { readPrivateRecord } from '../../src/content/private-records';
import { generateVaultSecrets, sha256Hex } from '../../src/auth/vault';
import {
  encryptDaoFile,
  encryptDaoJson,
  installCreatedVault,
  lockVault,
  preparePrivateEpoch,
} from '../../src/auth/session';
import { useWorkspace } from '../../src/state/workspace';
import { api } from '../../src/api/client';

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
async function fixture(value: unknown = payload) {
  const account = await openOriginalKeys();
  const epoch = await preparePrivateEpoch(dao, '1', '1');
  const records = DaoContentSchema.parse({
    dao,
    documents: [],
    epochs: [{ epoch: '1', commitment: epoch.commitment, creator: '1' }],
    keyGrants: [{ id: '1', recipient: '1', grantor: '1', epoch: '1', envelope: epoch.selfGrant }],
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
        join_epoch: '1',
      },
    ],
  });
  const metadata = await encryptDaoJson(dao, '1', '41', 2, '1', records, JSON.stringify(value));
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
    key_epoch: '1',
  };
  records.documents.push(document);
  return {
    account,
    records,
    document,
    reference: { documentId: '41', version: 2, commitment: document.commitment, keyEpoch: '1' },
  };
}

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
