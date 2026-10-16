import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { PrivateKey } from '@wharfkit/antelope';
import {
  AccountSchema,
  CreateDaoSchema,
  DaoRefSchema,
  NetworkSchema,
  RecoveryContextSchema,
  defaultDaoSetup,
  VERSION,
} from '@daclify/core-protocol';
import {
  sealPrivateCreation,
  openPrivateInvitation,
  openPrivateFounder,
  resealPrivateInvitation,
} from '../../src/content/private-identity-setup';
import { generateVaultSecrets } from '../../src/auth/vault';
import { installCreatedVault, lockVault } from '../../src/auth/session';
import { useWorkspace } from '../../src/state/workspace';

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
const input = CreateDaoSchema.parse({
  metadata: {
    schemaVersion: 1,
    title: 'Private identity canary',
    description: 'Private mission canary',
  },
  privacy: 'encrypted-user-controlled',
  token: { chainId: 'ab'.repeat(32), contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
  setup: defaultDaoSetup(),
});
const scope = (daoId: string) =>
  DaoRefSchema.parse({
    chainId: input.token.chainId,
    contract: 'daclifycore1',
    daoId,
    interfaceVersion: 1,
  });
beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('sessionStorage', storage());
  vi.stubGlobal('window', { location: new URL('http://localhost:5178/create') });
  useWorkspace().network = NetworkSchema.parse({
    chainId: input.token.chainId,
    runtime: 'daclifycore1',
    environment: 'testnet',
    rpcUrl: 'https://rpc.example',
    hub: null,
    coreVersion: VERSION,
    interfaceVersion: 1,
    capabilities: ['private-dao-identity-v1', 'private-claim-content-v1'],
  });
});
afterEach(() => {
  lockVault();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setActivePinia(undefined);
});
async function unlockOriginal() {
  const keys = await generateVaultSecrets(),
    k = keys.encryptionPrivateKey;
  const account = AccountSchema.parse({
    id: crypto.randomUUID(),
    custody: 'user-controlled',
    signingKey: PrivateKey.from(keys.signingKey).toPublic().toString(),
    encryptionKey: { kty: k.kty, crv: k.crv, x: k.x, y: k.y },
  });
  useWorkspace().account = account;
  await installCreatedVault(
    account,
    keys,
    RecoveryContextSchema.parse({
      version: 1,
      id: crypto.randomUUID(),
      accountId: account.id,
      origin: window.location.origin,
      credentialKey: 'native:fixture',
      mode: 'wallet-protected',
      signingPublicKey: account.signingKey,
      encryptionPublicKey: account.encryptionKey,
      salt: btoa('s'.repeat(32)),
    }),
    () => {},
  );
  return account;
}
it('seals an invitation before any request is built and binds it to its prospective deployment', async () => {
  const sealed = await sealPrivateCreation(input, 'invitation'),
    setup = sealed.request.privateSetup;
  if (!setup || !sealed.contentKey) throw Error('sealed invitation missing');
  expect(JSON.stringify(sealed.request)).not.toContain(input.metadata.title);
  expect(JSON.stringify(sealed.request)).not.toContain(input.metadata.description);
  expect(JSON.stringify(sealed.request)).not.toContain(sealed.contentKey);
  const dao = scope(setup.daoId),
    opened = await openPrivateInvitation(dao, setup, sealed.contentKey, sealed.request);
  expect(opened.body).toEqual({
    title: input.metadata.title,
    description: input.metadata.description,
  });
  await expect(
    openPrivateInvitation({ ...dao, daoId: '8' }, setup, sealed.contentKey, sealed.request),
  ).rejects.toThrow();
  await expect(
    openPrivateInvitation(
      { ...dao, contract: 'otherdao' },
      setup,
      sealed.contentKey,
      sealed.request,
    ),
  ).rejects.toThrow();
  await expect(openPrivateInvitation(dao, setup, 'A'.repeat(43), sealed.request)).rejects.toThrow();
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

it('seals a private guarded founder with its selected original agent identity and no public operator name', async () => {
  const account = await unlockOriginal();
  const setup = defaultDaoSetup('custom');
  const request = CreateDaoSchema.parse({
    ...input,
    setup: {
      ...setup,
      participantMode: 'agents-guarded',
      governance: {
        ...setup.governance,
        guardian: 'guardian',
        governedWorks: true,
        maxCommitment: '10000',
        dailyCommitment: '20000',
      },
    },
    foundingAgent: {
      signingKey: account.signingKey,
      encryptionKey: account.encryptionKey,
      operator: 'Secret agent operator canary',
    },
  });
  const sealed = await sealPrivateCreation(request, 'founder');
  expect(sealed.request.foundingAgent).toEqual({ ...request.foundingAgent, operator: 'Agent' });
  expect(JSON.stringify(sealed.request)).not.toContain('Secret agent operator canary');
  expect(sealed.request.privateSetup).toHaveProperty('agentDescription.envelope');
  if (!sealed.request.privateSetup || sealed.request.privateSetup.stage !== 'founder')
    throw Error('fixture founder seal');
  expect(
    (
      await openPrivateFounder(
        scope(sealed.request.privateSetup.daoId),
        sealed.request.privateSetup,
        sealed.request,
      )
    ).body.title,
  ).toBe(input.metadata.title);
  const other = PrivateKey.generate('K1').toPublic().toString();
  const founder = request.foundingAgent;
  if (!founder) throw Error('fixture founding agent');
  await expect(
    sealPrivateCreation(
      { ...request, foundingAgent: { ...founder, signingKey: other } },
      'founder',
    ),
  ).rejects.toThrow('PRIVATE_FOUNDER_IDENTITY');
  lockVault();
  await expect(sealPrivateCreation(request, 'founder')).rejects.toThrow();
});
it('reseals the reviewed question with fresh founder keys so the issuer key cannot open DAO content', async () => {
  const invitation = await sealPrivateCreation(input, 'invitation'),
    draft = invitation.request.privateSetup;
  if (!draft || !invitation.contentKey) throw Error('missing fixture');
  await unlockOriginal();
  const dao = scope(draft.daoId),
    founder = await resealPrivateInvitation(dao, draft, invitation.contentKey, invitation.request);
  expect((await openPrivateFounder(dao, founder, invitation.request)).body).toEqual({
    title: input.metadata.title,
    description: input.metadata.description,
  });
  await expect(
    openPrivateInvitation(dao, founder, invitation.contentKey, invitation.request),
  ).rejects.toThrow();
  lockVault();
  await expect(openPrivateFounder(dao, founder, invitation.request)).rejects.toThrow();
  await unlockOriginal();
  await expect(openPrivateFounder(dao, founder, invitation.request)).rejects.toThrow();
});
it('refuses unsupported or locked private creation without a plaintext fallback', async () => {
  await expect(sealPrivateCreation(input, 'founder')).rejects.toThrow();
  const network = useWorkspace().network;
  if (!network) throw Error('missing network');
  network.capabilities = [];
  await expect(sealPrivateCreation(input, 'invitation')).rejects.toThrow(
    'PRIVATE_IDENTITY_UNSUPPORTED',
  );
});
it('accepts bounded private Unicode prose larger than native inline metadata without a public intermediate', async () => {
  const metadata = {
    schemaVersion: 1 as const,
    title: 'Private Unicode canary',
    description: '🌿'.repeat(1800),
  };
  const result = await sealPrivateCreation({ ...input, metadata }, 'invitation'),
    setup = result.request.privateSetup;
  if (!setup || !result.contentKey) throw Error('missing invitation');
  expect(
    (await openPrivateInvitation(scope(setup.daoId), setup, result.contentKey, result.request)).body
      .description,
  ).toBe(metadata.description);
  expect(JSON.stringify(result.request)).not.toContain('🌿');
});
it('refuses a sealed invitation when its reviewed custody or governance setup is substituted', async () => {
  const result = await sealPrivateCreation(input, 'invitation'),
    setup = result.request.privateSetup;
  if (!setup || !result.contentKey) throw Error('missing invitation');
  await expect(
    openPrivateInvitation(scope(setup.daoId), setup, result.contentKey, {
      ...result.request,
      privacy: 'encrypted-managed-allowed',
    }),
  ).rejects.toThrow('PRIVATE_SETUP_CHANGED');
});
