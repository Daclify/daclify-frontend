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
import AxeBuilder from '@axe-core/playwright';
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
        '/v1/sign-in/session': { account },
        [ApiRoutes.memberships.path]: { memberships: [member] },
        '/v1/daos/1/apps': apps,
        [ApiRoutes.appJoinPreview.path.replace(':id','11111111-1111-4111-8111-111111111111')]: {app:apps[0],available:false,source:null,gateway:null,policy:null,member:{memberId:member.memberId,admin:false,executive:false,canVote:true},invitation:null},
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

test('existing DAO apps page links to the global connection guide', async ({ page }) => {
  await page.goto('/dao/1/apps');
  await expect(
    page.getByRole('link', { name: 'Mini apps connection guide ↗', exact: true }),
  ).toBeVisible();
});

test('lets administrators specify an approved cleanup endpoint without signing on field changes', async ({
  page,
}) => {
  let writes = 0;
  await page.route('**/v1/**', async (route) => {
    if (route.request().method() === 'POST') writes++;
    await route.fallback();
  });
  await page.route('**' + ApiRoutes.memberships.path, (route) =>
    route.fulfill({ json: { memberships: [{ ...member, admin: true }] } }),
  );
  await page.goto('/dao/1/apps');
  await page.getByText('Register or update an app', { exact: true }).click();
  const field = page.getByLabel('Cleanup endpoint (optional)', { exact: true });
  await expect(field).toBeVisible();
  await field.fill('https://app1.example/v1/cleanup');
  await expect(
    page.getByText(
      'Cleanup acknowledgment comes from the app operator. Required shared evidence may remain.',
    ),
  ).toBeVisible();
  expect(writes).toBe(0);
});

async function openAdminConnection(
  page: import('@playwright/test').Page,
  moduleState: unknown,
  registered: unknown = [],
) {
  await page.route('**' + ApiRoutes.memberships.path, (route) =>
    route.fulfill({ json: { memberships: [{ ...member, admin: true }] } }),
  );
  await page.route('**/v1/daos/1/apps', (route) => route.fulfill({ json: registered }));
  await page.route('**/v1/daos/1/modules*', (route) => route.fulfill({ json: moduleState }));
  await page.goto('/mini-apps#connect');
  await page.getByLabel('Choose a DAO', { exact: true }).selectOption('1');
}

test('shows the required module action before an impossible first registration', async ({
  page,
}) => {
  await openAdminConnection(
    page,
    ModuleStateSchema.parse({
      ...activity,
      modules: activity.modules.map((module) => ({ ...module, enabled: false, installed: false })),
    }),
  );
  const connection = page.getByRole('region', { name: 'Connect a mini app' });
  const enable = connection.getByRole('link', { name: 'Enable Community Activity', exact: true });
  await expect(enable).toBeVisible();
  await expect(enable).toHaveAttribute('href', '/dao/1/modules');
  await expect(connection.getByLabel('Registered app', { exact: true })).toHaveCount(0);
  await expect(
    connection.getByRole('button', { name: 'Get connection configuration', exact: true }),
  ).toHaveCount(0);
  await expect(connection.getByLabel('App name', { exact: true })).toHaveCount(0);
});

test('reveals first registration with an actionable locked-signer setup', async ({ page }) => {
  await openAdminConnection(page, activity);
  const connection = page.getByRole('region', { name: 'Connect a mini app' });
  await expect(connection.getByLabel('App name', { exact: true })).toBeVisible();
  await expect(
    connection.getByRole('button', { name: 'Register app', exact: true }),
  ).toBeDisabled();
  const setup = connection.getByRole('link', { name: 'Set up approvals', exact: true });
  await expect(setup).toBeVisible();
  const href = await setup.getAttribute('href');
  const destination = new URL(href ?? '', 'http://127.0.0.1');
  expect(destination.pathname).toBe('/account');
  expect(destination.searchParams.get('setup')).toBe('approvals');
  expect(destination.searchParams.get('dao')).toBe('1');
  expect(destination.searchParams.get('returnTo')).toBe('/mini-apps#connect');
  await expect(connection.getByLabel('Registered app', { exact: true })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('keeps existing app configuration after registration and preserves its app choices', async ({
  page,
}) => {
  await openAdminConnection(page, activity, apps);
  const connection = page.getByRole('region', { name: 'Connect a mini app' });
  const registered = connection.getByLabel('Registered app', { exact: true });
  await expect(registered).toBeVisible();
  await expect(registered.locator('option')).toHaveText(['Choose an app', 'Garden', 'Equipment']);
  await expect(
    connection.getByRole('button', { name: 'Get connection configuration', exact: true }),
  ).toBeEnabled();
  const ordered = await connection.locator('summary, label').allTextContents();
  expect(ordered.findIndex((text) => text.trim() === 'Register or update an app')).toBeLessThan(
    ordered.findIndex((text) => text.trim() === 'Registered app'),
  );
});

test('offers a retry for a failed setup read without claiming the module is disabled', async ({
  page,
}) => {
  await openAdminConnection(page, activity);
  await page.route('**/v1/daos/1/modules*', (route) =>
    route.fulfill({
      status: 503,
      json: { code: 'CHAIN_UNAVAILABLE', message: 'CHAIN_UNAVAILABLE' },
    }),
  );
  await page.reload();
  await page.getByLabel('Choose a DAO', { exact: true }).selectOption('1');
  const connection = page.getByRole('region', { name: 'Connect a mini app' });
  await expect(
    connection.getByRole('button', { name: 'Retry app setup', exact: true }),
  ).toBeVisible();
  await expect(
    connection.getByRole('link', { name: 'Enable Community Activity', exact: true }),
  ).toHaveCount(0);
  await page.route('**/v1/daos/1/modules*', (route) => route.fulfill({ json: activity }));
  await connection.getByRole('button', { name: 'Retry app setup', exact: true }).click();
  await expect(connection.getByLabel('App name', { exact: true })).toBeVisible();
});

for (const flag of ['codeVerified', 'compatible'] as const) {
  test(`guides admins to review enabled Activity when ${flag} is false`, async ({ page }) => {
    await openAdminConnection(
      page,
      ModuleStateSchema.parse({
        ...activity,
        modules: activity.modules.map((module) => ({ ...module, [flag]: false })),
      }),
    );
    const connection = page.getByRole('region', { name: 'Connect a mini app' });
    await expect(
      connection.getByRole('link', { name: 'Review Community Activity', exact: true }),
    ).toHaveAttribute('href', '/dao/1/modules');
    await expect(
      connection.getByRole('link', { name: 'Enable Community Activity', exact: true }),
    ).toHaveCount(0);
    await expect(connection.getByLabel('App name', { exact: true })).toHaveCount(0);
    await expect(connection.getByLabel('Registered app', { exact: true })).toHaveCount(0);
  });
}

test('keeps setup loading distinct from a disabled module', async ({ page }) => {
  await openAdminConnection(page, activity);
  let finishRead = () => {};
  const pending = new Promise<void>((resolve) => {
    finishRead = resolve;
  });
  await page.route('**/v1/daos/1/modules*', async (route) => {
    await pending;
    await route.fulfill({ json: activity });
  });
  try {
    await page.reload();
    await page.getByLabel('Choose a DAO', { exact: true }).selectOption('1');
    const connection = page.getByRole('region', { name: 'Connect a mini app' });
    await expect(connection.getByText('Checking app setup…', { exact: true })).toBeVisible();
    await expect(
      connection.getByRole('link', { name: 'Enable Community Activity', exact: true }),
    ).toHaveCount(0);
    await expect(connection.getByLabel('App name', { exact: true })).toHaveCount(0);
    finishRead();
    await expect(connection.getByLabel('App name', { exact: true })).toBeVisible();
  } finally {
    finishRead();
  }
});

test('new app users see non-voting admission and accept before app consent',async({page})=>{
 const id='11111111-1111-4111-8111-111111111111';let joined=false;
 await page.route('**'+ApiRoutes.memberships.path,route=>route.fulfill({json:{memberships:joined?[member]:[]}}));
 await page.route('**'+ApiRoutes.appJoinPreview.path.replace(':id',id),route=>route.fulfill({json:{app:apps[0],available:true,source:'appjoin',gateway:{account:'relay',permission:'active'},policy:{id:'1',dao_id:'1',app_id:'1',app_revision:'1',revision:'1',gateway:'relay',gateway_permission:'active',public_join:true,enabled:true},member:null,invitation:null}}));
 await page.route('**'+ApiRoutes.joinApp.path.replace(':id',id),async route=>{expect(route.request().postDataJSON()).toEqual({});joined=true;await route.fulfill({json:{memberId:'3',admin:false,executive:false,canVote:false}});});
 await page.goto('/apps/consent?request='+id);
 await expect(page.getByText('You will join this DAO as a normal member without voting rights. You can use its shared app.')).toBeVisible();
 await page.getByRole('button',{name:'Join and continue',exact:true}).click();
 await expect(page.getByRole('button',{name:'Approve sign-in and recording'})).toBeVisible();expect(joined).toBe(true);
});
test('existing members must explicitly accept an admin invitation and send a private-link signature',async({page})=>{
 const id='11111111-1111-4111-8111-111111111111';let accepted=false;
 await page.route('**'+ApiRoutes.appJoinPreview.path.replace(':id',id),route=>route.fulfill({json:{app:apps[0],available:true,source:'appjoin',gateway:{account:'relay',permission:'active'},policy:{id:'1',dao_id:'1',app_id:'1',app_revision:'1',revision:'1',gateway:'relay',gateway_permission:'active',public_join:true,enabled:true},member:{memberId:'3',admin:false,executive:false,canVote:false},invitation:{role:'admin',expires:Math.floor(Date.now()/1000)+600}}}));
 await page.route('**'+ApiRoutes.joinApp.path.replace(':id',id),async route=>{const input=ApiRoutes.joinApp.input.parse(route.request().postDataJSON());expect('signature' in input&&input.signature?.startsWith('SIG_K1_')).toBe(true);expect('token' in input).toBe(false);accepted=true;await route.fulfill({json:{memberId:'3',admin:true,executive:true,canVote:true}});});
 await page.goto('/apps/consent?request='+id+'#daclify_invitation=7&daclify_token='+'a'.repeat(43));
 await expect(page.getByText(/This invitation makes you a DAO administrator and executive/)).toBeVisible();expect(accepted).toBe(false);
 await page.getByRole('button',{name:'Accept administrator invitation'}).click();await expect(page.getByRole('button',{name:'Approve sign-in and recording'})).toBeVisible();expect(accepted).toBe(true);
});
