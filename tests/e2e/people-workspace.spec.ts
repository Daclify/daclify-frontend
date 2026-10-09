import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { generateKeyPairSync } from 'node:crypto';
import { PrivateKey } from '@wharfkit/antelope';
import {
  AccountSchema,
  ApiRoutes,
  DaoSummarySchema,
  DaoContentSchema,
  GovernanceStateSchema,
  NetworkSchema,
  PeopleRoutes,
  PlatformStatusSchema,
  UserMembershipSchema,
  VERSION,
} from '@daclify/core-protocol';
import { ModuleStateSchema } from '@daclify/modules';
const key = PrivateKey.generate('K1').toPublic().toString(),
  jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' });
const network = NetworkSchema.parse({
  chainId: 'ab'.repeat(32),
  rpcUrl: 'http://127.0.0.1:18888',
  runtime: 'daclifycore',
  hub: null,
  environment: 'local',
  interfaceVersion: 1,
  coreVersion: VERSION,
  capabilities: [],
});
const reference = {
  chainId: network.chainId,
  contract: network.runtime,
  daoId: '1',
  interfaceVersion: 1,
};
const account = AccountSchema.parse({
  id: '11111111-1111-4111-8111-111111111111',
  custody: 'user-controlled',
  signingKey: key,
  encryptionKey: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
});
const dao = DaoSummarySchema.parse({
  reference,
  title: 'Daclify DAO',
  description: 'Platform community',
  privacy: 'public',
  owner: 'alice',
  token: { chainId: network.chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
  members: 2,
  available: '0',
  reserved: '0',
  claims: '0',
  keyEpoch: '0',
});
const member = UserMembershipSchema.parse({
  dao: reference,
  memberId: '2',
  nonce: '0',
  active: true,
  admin: false,
  reviewer: false,
  credits: '0',
  claim: '0',
  stake: '0',
  nativeAccount: 'bob',
  custody: 'user-controlled',
  signingKey: key,
});
const profiles = PeopleRoutes.list.response.parse({
  profiles: [
    {
      id: '0',
      dao: reference,
      memberId: '1',
      accountName: 'alice',
      profile: {
        name: 'alice',
        fullName: 'Alice Adams',
        motto: 'Building better communities',
        location: 'Warsaw',
      },
    },
    {
      id: '1',
      dao: reference,
      memberId: '2',
      accountName: 'bob',
      profile: { name: 'bob', fullName: 'Bob Builder', motto: 'Let’s make things' },
    },
  ],
  next: null,
});
const content = DaoContentSchema.parse({
  dao: reference,
  members: ['1', '2'].map((id) => ({
    id,
    native_account: id === '1' ? 'alice' : 'bob',
    signing_key: key,
    encryption_key: 'key',
    custody: 0,
    nonce: '0',
    credits: '0',
    active: true,
    admin: id === '1',
    reviewer: false,
    stake: '0',
    claim: '0',
    join_epoch: '1',
  })),
  documents: [],
  keyGrants: [],
  epochs: [],
});
const governance = GovernanceStateSchema.parse({
  dao: reference,
  policy: null,
  actors: [],
  sessions: [],
  guardian: null,
  budget: null,
  excludedVoters: [{ member_id: '2' }],
});
const platform = PlatformStatusSchema.parse({
  checkedAt: new Date().toISOString(),
  apiVersion: VERSION,
  moduleVersion: VERSION,
  rpc: 'reachable',
  database: { state: 'reachable', migrations: [] },
  limits: {
    sponsoredWritesPerAccount: 10,
    sponsoredWritesGlobal: 100,
    windowMs: 60000,
    uploadBytes: 0,
  },
  services: [],
  defaults: { sharedUsdCents: 0, independentUsdCents: 5000, tlosPremiumBps: 2000 },
  chain: {
    network,
    chainId: network.chainId,
    chainMatches: true,
    headBlock: 1,
    irreversibleBlock: 1,
    headTime: 'fixture',
    contracts: [],
    catalogue: [],
    fees: null,
    market: null,
    creation: null,
    runtimeSettings: null,
    rateFresh: false,
    platformDao: reference,
    sharedAvailable: true,
    independentAvailable: false,
  },
});
async function menu(page: Page) {
  const button = page.getByRole('button', { name: 'Menu', exact: true });
  if (await button.isVisible()) await button.click();
}
test.beforeEach(async ({ page }) => {
  await page.route('**/v1/**', (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    const values: Record<string, unknown> = {
      '/v1/network': network,
      '/v1/daos': { daos: [dao] },
      '/v1/me': { account },
      [ApiRoutes.memberships.path]: { memberships: [member] },
      '/v1/people': profiles,
      '/v1/people/members': {
        members: content.members.map((row) => ({
          dao: reference,
          id: row.id,
          native_account: row.native_account,
          active: row.active,
          profile: profiles.profiles.find((person) => person.memberId === row.id)?.profile ?? null,
        })),
        next: null,
      },
      '/v1/platform/status': platform,
      '/v1/daos/1/content': content,
      '/v1/daos/1/governance': governance,
      '/v1/daos/1/modules': ModuleStateSchema.parse({
        dao: reference,
        modules: [],
        projects: [],
        milestones: [],
        schedules: [],
        controls: [],
        executions: [],
        ballots: [],
        votes: [],
        entries: [],
      }),
      '/v1/profile': { accountName: 'bob', profile: JSON.stringify(profiles.profiles[1]?.profile) },
    };
    const body = values[path];
    return route.fulfill({
      status: body ? 200 : 404,
      json: body ?? { code: 'NOT_FOUND', message: 'Unavailable UI fixture' },
    });
  });
});
test('signed-out Users shows existing members before they publish profiles', async ({ page }) => {
  await page.route('**/v1/people?*', (route) =>
    route.fulfill({ json: { profiles: [], next: null } }),
  );
  await page.route('**/v1/me', (route) =>
    route.fulfill({ status: 401, json: { code: 'AUTH_REQUIRED', message: 'Sign in' } }),
  );
  await page.route('**/v1/people/members?*', (route) =>
    route.fulfill({
      json: {
        members: [
          { dao: reference, id: '1', native_account: 'alice', active: true, profile: null },
          { dao: reference, id: '2', native_account: '', active: true, profile: null },
          {
            dao: { ...reference, daoId: '4' },
            id: '1',
            native_account: 'alice',
            active: true,
            profile: null,
          },
        ],
        next: null,
      },
    }),
  );
  await page.goto('/users');
  await expect(page.locator('.person-card')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'alice', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Member 2', exact: true })).toBeVisible();
  await page.getByRole('link', { name: /alice/ }).click();
  await expect(
    page.getByText('This member has not published a profile.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit profile & account' })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('Users loads the next DAO and replaces a native fallback with its published profile', async ({
  page,
}) => {
  await page.route('**/v1/me', (route) =>
    route.fulfill({ status: 401, json: { code: 'AUTH_REQUIRED', message: 'Sign in' } }),
  );
  await page.route(
    (url) => url.pathname === PeopleRoutes.members.path,
    (route) => {
      const later = new URL(route.request().url()).searchParams.get('daoId') === '4';
      return route.fulfill({
        json: later
          ? {
              members: [
                {
                  dao: { ...reference, daoId: '4' },
                  id: '1',
                  native_account: 'alice',
                  active: true,
                  profile: { name: 'alice', fullName: 'Alice Adams' },
                },
                {
                  dao: { ...reference, daoId: '4' },
                  id: '2',
                  native_account: '',
                  active: true,
                  profile: null,
                },
              ],
              next: null,
            }
          : {
              members: [
                { dao: reference, id: '1', native_account: 'alice', active: true, profile: null },
              ],
              next: { daoId: '4', after: '0' },
            },
      });
    },
  );
  await page.goto('/users');
  await expect(page.getByRole('heading', { name: 'alice', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load more users' }).click();
  await expect(page.locator('.person-card')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Alice Adams', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'alice', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Member 2', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more users' })).toHaveCount(0);
});
test('sidebar and hub open the same DAO; members have shared public profiles and view controls', async ({
  page,
}) => {
  await page.goto('/daclify');
  await expect(page).toHaveURL(/\/dao\/1$/);
  await expect(page.getByRole('heading', { name: 'Daclify DAO', exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'DAO sections' })
    .getByRole('link', { name: 'Members', exact: true })
    .click();
  await expect(page.getByRole('link', { name: /Alice Adams/ })).toBeVisible();
  await expect(page.getByText('Non-voting member', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(page.locator('.people-list')).toBeVisible();
  await page.getByRole('link', { name: /Alice Adams/ }).click();
  await expect(page.getByRole('heading', { name: 'Alice Adams', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit profile & account' })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('member-profile.png'), fullPage: true });
  await page.goto('/hub');
  await page.locator('.dao-card').click();
  await expect(page).toHaveURL(/\/dao\/1$/);
});
test('Users replaces Account; your profile is first, and only your detail has editing and pairing', async ({
  page,
}) => {
  await page.goto('/users');
  await expect(page.locator('.person-card').first()).toContainText('Bob Builder');
  await expect(page.locator('.person-card').first()).toContainText('You');
  await menu(page);
  const nav = page.getByRole('complementary', { name: 'Primary navigation' });
  await expect(nav.getByRole('link', { name: 'Account', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Users', exact: true })).toBeVisible();
  await page.locator('.person-card').first().click();
  await expect(page).toHaveURL(/\/users\/me$/);
  await expect(page.getByRole('heading', { name: 'Bob Builder', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit profile & account' }).click();
  await expect(page.getByRole('heading', { name: 'Public profile', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Profile', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Linked', exact: true })).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Pair Telos EVM wallet', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('self-account.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('Help can be moved, resized, minimized and reopened without exposing another account history', async ({
  page,
}) => {
  await page.route('**/v1/docs/agent', (route) => route.fulfill({ json: { configured: true } }));
  await page.route('**/v1/docs/ask', (route) =>
    route.fulfill({
      json: {
        status: 'answered',
        topicId: 'accounts',
        title: 'Accounts',
        answer: 'Pair wallets from your own account controls.',
      },
    }),
  );
  await page.goto('/users');
  await menu(page);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const help = page.getByRole('complementary', { name: 'Daclify Help', exact: true });
  await help.getByLabel('Question', { exact: true }).fill('How do I pair a wallet?');
  await help.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(
    help.getByText('Pair wallets from your own account controls.', { exact: true }),
  ).toBeVisible();
  const drag = help.getByRole('button', { name: 'Move help window with arrow keys or drag' });
  await drag.focus();
  await page.keyboard.press('ArrowLeft');
  if (test.info().project.name === 'chromium') {
    const before = await help.boundingBox();
    if (!before) throw new Error('HELP_BOUNDS');
    await drag.dragTo(drag, { sourcePosition: { x: 12, y: 12 }, targetPosition: { x: 40, y: 32 } });
    const after = await help.boundingBox();
    expect(after?.x).not.toBe(before.x);
  }
  await help.getByRole('button', { name: 'Expand help window' }).click();
  await expect(help).toHaveClass(/expanded/);
  await help.getByRole('button', { name: 'Reset help position' }).click();
  await expect(help).not.toHaveClass(/expanded/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await help.getByRole('button', { name: 'Minimize help' }).click();
  await expect(help).toBeHidden();
  await menu(page);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(
    help.getByText('Pair wallets from your own account controls.', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('floating-help.png'), fullPage: true });
  await page.route('**/v1/me', (route) =>
    route.fulfill({
      json: { account: { ...account, id: '22222222-2222-4222-8222-222222222222' } },
    }),
  );
  await page.reload();
  await menu(page);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(
    help.getByText('Pair wallets from your own account controls.', { exact: true }),
  ).toHaveCount(0);
});

test('unavailable IPFS avatars keep the readable profile fallback', async ({ page }) => {
  const cid = 'bafkreiehxpuhtr5f6v4eu4byjo2j7kkrhjvd7psmfu4imnpdzb3bdqb7vy';
  await page.route('https://ipfs.io/ipfs/**', (route) =>
    route.fulfill({ status: 404, body: 'Unavailable image fixture' }),
  );
  await page.route('**/v1/people?*', (route) =>
    route.fulfill({
      json: {
        ...profiles,
        profiles: profiles.profiles.map((person) => ({
          ...person,
          profile: { ...person.profile, avatar: cid, background: cid },
        })),
      },
    }),
  );
  await page.goto('/users/1/1');
  await expect(page.getByRole('heading', { name: 'Alice Adams', exact: true })).toBeVisible();
  await expect(page.locator('.profile-identity .person-avatar')).toHaveText('AL');
  await expect(page.locator('.profile-hero img')).toHaveCount(0);
});
