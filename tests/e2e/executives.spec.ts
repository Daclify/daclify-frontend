import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrivateKey } from '@wharfkit/antelope';
import {
  ApiRoutes,
  TreasurySchema,
  AccountSchema,
  DaoSummarySchema,
  GovernanceStateSchema,
  NetworkSchema,
  UserMembershipSchema,
  VERSION,
} from '@daclify/core-protocol';
import { ModuleCodeHashes } from '@daclify/modules/sdk';
import { RuntimeActionSchemas } from '@daclify/core-protocol/sdk';
import { Catalog, ModulePermissions, ModuleStateSchema } from '@daclify/modules';

async function serve(page: Page, handedOver = true, ordinary = false) {
  // HTTP fixtures check UI access and copy; native tests check the actual authority changes.
  const key = PrivateKey.generate('K1').toPublic().toString();
  const chainId = 'ab'.repeat(32);
  const reference = { chainId, contract: 'daclifycore', daoId: '1', interfaceVersion: 1 };
  const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
    format: 'jwk',
  });
  const account = AccountSchema.parse({
    id: randomUUID(),
    custody: 'user-controlled',
    signingKey: key,
    encryptionKey: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
  });
  const dao = DaoSummarySchema.parse({
    reference,
    title: 'Executive fixture DAO',
    description: 'Local UI fixture',
    privacy: 'public',
    owner: 'daclifycore',
    token: { chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
    members: 3,
    available: '0',
    reserved: '0',
    claims: '0',
    keyEpoch: '0',
  });
  const member = UserMembershipSchema.parse({
    dao: reference,
    memberId: ordinary ? '3' : '1',
    nonce: '0',
    active: true,
    admin: !ordinary,
    reviewer: false,
    credits: '0',
    claim: '0',
    stake: '0',
    nativeAccount: ordinary ? 'bob' : 'alice',
    custody: 'user-controlled',
    signingKey: key,
  });
  const governance = GovernanceStateSchema.parse({
    dao: reference,
    policy: null,
    actors: [],
    sessions: [],
    guardian: null,
    budget: null,
    executivePolicy: {
      dao_id: '1',
      inactivity_seconds: 2592000,
      quorum_bps: 10000,
      revision: '1',
      last_election_start: 0,
    },
    executives: [
      {
        member_id: '1',
        last_active: Math.floor(Date.now() / 1000),
        office_epoch: '1',
        election_id: '0',
      },
    ],
    executiveMembers: [
      {
        id: '1',
        native_account: 'alice',
        signing_key: key,
        encryption_key: 'key',
        custody: 0,
        nonce: '0',
        credits: '0',
        active: true,
        admin: true,
        reviewer: false,
        stake: '0',
        claim: '0',
        join_epoch: '1',
      },
    ],
    nativeGovernance: {
      dao_id: '1',
      contracts: ['decide'],
      service_key: key,
      handed_over: handedOver,
      signers: handedOver ? ['alice'] : [],
      threshold: handedOver ? 1 : 0,
      admin_members: handedOver ? ['1'] : [],
    },
  });
  const manifest = Catalog.find((m) => m.id === 'decide');
  if (!manifest) throw new Error('Fixture Decide manifest missing');
  const modules = ModuleStateSchema.parse({
    dao: reference,
    modules: [
      {
        deployment: {
          id: 'decide',
          account: 'decide',
          version: manifest.version,
          codeHash: ModuleCodeHashes.decide,
        },
        manifest,
        enabled: true,
        installed: true,
        compatible: true,
        codeVerified: true,
        actions: ModulePermissions.decide.actions,
        grants: ModulePermissions.decide.grants,
      },
    ],
    ballots: [],
    votes: [],
    projects: [],
    milestones: [],
    schedules: [],
    entries: [],
    controls: [],
  });
  const treasury = TreasurySchema.parse({ dao: reference, obligations: [], evidence: [] });
  const network = NetworkSchema.parse({
    chainId,
    rpcUrl: 'http://127.0.0.1:20888',
    runtime: 'daclifycore',
    hub: null,
    environment: 'local',
    interfaceVersion: 1,
    coreVersion: VERSION,
    capabilities: ['governance-policy', 'executive-authority'],
  });
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === '/v1/network'
        ? network
        : path === '/v1/daos'
          ? { daos: [dao], next: null }
          : path === '/v1/me'
            ? { account }
            : path === ApiRoutes.memberships.path
              ? { memberships: [member] }
              : path === '/v1/daos/1/governance'
                ? governance
                : path === '/v1/daos/1/modules'
                  ? modules
                  : path === '/v1/daos/1/treasury'
                    ? treasury
                    : undefined;
    await route.fulfill({
      status: body ? 200 : 404,
      json: body ?? { code: 'NOT_FOUND', message: 'Unavailable fixture service.' },
    });
  });
}

test('protects the last paired controller and prepares an unsigned quorum appointment', async ({
  page,
}, info) => {
  await serve(page);
  await page.goto('/dao/1/settings');
  await expect(page.getByRole('heading', { name: 'Executives and voting rights' })).toBeVisible();
  await expect(
    page.getByText(
      'You are the last paired native executive. Replace your wallet atomically; unlinking is blocked.',
    ),
  ).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Prepare native appointment transaction' }).click();
  const path = await (await download).path();
  if (!path) throw new Error('Unsigned fixture download missing');
  const payload: unknown = JSON.parse(await readFile(path, 'utf8'));
  expect(payload).toMatchObject({
    chainId: 'ab'.repeat(32),
    unsigned: true,
    actions: [
      {
        account: 'daclifycore',
        name: 'appoint',
        authorization: [{ actor: 'daclifycore', permission: 'govern' }],
        data: RuntimeActionSchemas.appoint.parse({
          dao_id: '1',
          member_ids: ['1'],
          inactivity_seconds: 2592000,
          quorum_bps: 10000,
        }),
      },
    ],
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('executives.png'), fullPage: true });
});
test('explains bootstrap owner consent and keeps ordinary paired members outside executive powers', async ({
  page,
}) => {
  await serve(page, false, true);
  await page.goto('/dao/1/settings');
  await expect(page.getByText(/Bootstrap owner still controls the contracts/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm executive activity' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Appoint executives' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign voting eligibility change' })).toHaveCount(0);
});
test('makes executive elections explicit and keeps signing disabled while the vault is locked', async ({
  page,
}) => {
  await serve(page);
  await page.goto('/dao/1/decide');
  await expect(page.getByRole('heading', { name: 'DAO elections', exact: true })).toBeVisible();
  await page.getByText('Schedule an election', { exact: true }).click();
  await page.getByLabel('Election purpose').selectOption('executive');
  await expect(
    page.getByText(/This election replaces the executive roster at term start/),
  ).toBeVisible();
  await expect(page.getByLabel('Representative title')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign and schedule election' })).toBeDisabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
