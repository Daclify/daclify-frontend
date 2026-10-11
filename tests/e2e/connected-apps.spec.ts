import { test, expect } from '@playwright/test';
import { PrivateKey } from '@wharfkit/antelope';
import { generateKeyPairSync } from 'node:crypto';
import {
  AccountSchema,
  NetworkSchema,
  DaoSummarySchema,
  UserMembershipSchema,
  ConnectedAppConfigSchema,
  appConfigurationHash,
  ApiRoutes,
  VERSION,
} from '@daclify/core-protocol';
import { Catalog, ModuleStateSchema, ModulePermissions } from '@daclify/modules';
import { ModuleCodeHashes } from '@daclify/modules/sdk';
const network = NetworkSchema.parse({
    chainId: 'ab'.repeat(32),
    rpcUrl: 'http://127.0.0.1:18888',
    runtime: 'daclifycore',
    hub: null,
    environment: 'local',
    interfaceVersion: 1,
    coreVersion: VERSION,
    capabilities: [],
  }),
  dao = { chainId: network.chainId, contract: network.runtime, daoId: '1', interfaceVersion: 1 },
  publicKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
    format: 'jwk',
  }),
  account = AccountSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    custody: 'user-controlled',
    signingKey: PrivateKey.generate('K1').toPublic().toString(),
    encryptionKey: publicKey,
  }),
  member = UserMembershipSchema.parse({
    dao,
    memberId: '3',
    nonce: '0',
    active: true,
    admin: false,
    reviewer: false,
    credits: '0',
    claim: '0',
    stake: '0',
    nativeAccount: '',
    custody: 'user-controlled',
    signingKey: account.signingKey,
  }),
  summary = DaoSummarySchema.parse({
    reference: dao,
    title: 'Community garden',
    description: 'One DAO, several apps',
    privacy: 'encrypted-user-controlled',
    owner: 'alice',
    token: { chainId: network.chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
    members: 7,
    available: '0',
    reserved: '0',
    claims: '0',
    keyEpoch: '1',
  });
const apps = [1, 2].map((id) => {
  const config = ConnectedAppConfigSchema.parse({
    dao,
    appId: String(id),
    revision: '1',
    name: id === 1 ? 'Garden' : 'Equipment',
    origins: [`https://app${id}.example`],
    redirectUris: [`https://app${id}.example/callback`],
    activityAccount: 'activity',
    enabled: true,
  });
  return {
    clientId: `11111111-1111-4111-8111-11111111111${id}`,
    config,
    configHash: appConfigurationHash(config),
    native: {
      id: String(id),
      target: 'activity',
      revision: '1',
      config_hash: appConfigurationHash(config),
      enabled: true,
      security_epoch: '1',
    },
  };
});
const manifest = Catalog.find((module) => module.id === 'activity');
if (!manifest) throw new Error('ACTIVITY_REQUIRED');
const activity = ModuleStateSchema.parse({
  dao,
  modules: [
    {
      deployment: {
        id: 'activity',
        version: manifest.version,
        account: 'activity',
        codeHash: ModuleCodeHashes.activity,
      },
      manifest,
      enabled: true,
      installed: true,
      compatible: true,
      codeVerified: true,
      actions: ModulePermissions.activity.actions,
      grants: [],
    },
  ],
  projects: [],
  milestones: [],
  schedules: [],
  controls: [],
  executions: [],
  ballots: [],
  votes: [],
  entries: [],
  activities: [
    {
      id: '1',
      dao_id: '1',
      app_id: '1',
      actor: '3',
      kind: 2,
      source_id: 'aa'.repeat(32),
      source_revision: 'bb'.repeat(32),
      event_id: 'cc'.repeat(32),
      evidence_cid: '',
      evidence_hash: '00'.repeat(32),
      key_epoch: '0',
      created_at: 1,
      status: 1,
    },
  ],
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('daclify.csrf', 'a'.repeat(43)));
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname,
      values: Record<string, unknown> = {
        '/v1/network': network,
        '/v1/daos': { daos: [summary] },
        '/v1/me': { account },
        [ApiRoutes.memberships.path]: { memberships: [member] },
        '/v1/daos/1/apps': apps,
        '/v1/daos/1/modules': activity,
        '/v1/daos/1/governance': {
          dao,
          policy: null,
          actors: [],
          sessions: [],
          guardian: null,
          budget: null,
        },
        [ApiRoutes.appConsent.path.replace(':id', '11111111-1111-4111-8111-111111111111')]: {
          id: '11111111-1111-4111-8111-111111111111',
          app: apps[0],
          member: {
            sub: account.id,
            dao,
            memberId: member.memberId,
            admin: false,
            reviewer: false,
            nonce: '0',
            appId: '1',
            appRevision: '1',
            sessionId: null,
            sessionExpires: null,
          },
          expires: new Date(Date.now() + 300000).toISOString(),
          signingKey: PrivateKey.generate('K1').toPublic().toString(),
          grantExpires: Math.floor(Date.now() / 1000) + 600,
        },
      };
    return route.fulfill({
      status: values[path] ? 200 : 404,
      json: values[path] ?? { code: 'NOT_FOUND', message: 'UI fixture unavailable' },
    });
  });
});
test('one membership shows two protected apps without manager controls or self review', async ({
  page,
}) => {
  await page.goto('/dao/1/apps');
  await expect(page.getByRole('heading', { name: 'Connected apps', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Garden', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Equipment', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit registration' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('paired account sign-in cannot silently approve an app recording credential', async ({
  page,
}) => {
  await page.goto('/apps/consent?request=11111111-1111-4111-8111-111111111111');
  await expect(page.getByRole('heading', { name: 'Garden', exact: true })).toBeVisible();
  await expect(
    page.getByText('Independent reviews and DAO decisions still use your Daclify signer.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Approve sign-in and recording', exact: true }),
  ).toBeDisabled();
});
test('nonmembers cannot read connected apps', async ({ page }) => {
  await page.route('**' + ApiRoutes.memberships.path, (route) =>
    route.fulfill({ json: { memberships: [] } }),
  );
  await page.goto('/dao/1/apps');
  await expect(
    page.getByText('Sign in as an active DAO member to use connected apps.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Garden', exact: true })).toHaveCount(0);
});
