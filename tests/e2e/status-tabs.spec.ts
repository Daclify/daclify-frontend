import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ApiRoutes, NetworkSchema, VERSION } from '@daclify/core-protocol';

const network = NetworkSchema.parse({
  chainId: 'ab'.repeat(32),
  rpcUrl: 'https://rpc.example',
  runtime: 'core.we',
  hub: null,
  environment: 'local',
  interfaceVersion: 1,
  coreVersion: VERSION,
  capabilities: [],
});
const status = ApiRoutes.status.response.parse({
  checkedAt: '2026-10-09T12:00:00.000Z',
  apiVersion: VERSION,
  moduleVersion: VERSION,
  rpc: 'reachable',
  chain: {
    network,
    chainId: network.chainId,
    chainMatches: true,
    headBlock: 100,
    irreversibleBlock: 90,
    headTime: '2026-10-09T12:00:00',
    contracts: [
      {
        account: 'core.we',
        moduleId: null,
        codeHash: 'ab'.repeat(32),
        expectedHash: null,
        verified: false,
        ramBytes: 4096,
        ramUsed: 1024,
        permissions: [
          {
            name: 'owner',
            parent: '',
            threshold: 2,
            keys: [],
            accounts: [
              { actor: 'alice', permission: 'active', weight: 1 },
              { actor: 'bob', permission: 'active', weight: 1 },
            ],
            waits: [],
          },
        ],
      },
    ],
    catalogue: [],
    fees: null,
    market: null,
    creation: null,
    runtimeSettings: null,
    rateFresh: false,
    platformDao: null,
    sharedAvailable: true,
    independentAvailable: false,
  },
  database: {
    state: 'reachable',
    migrations: [
      {
        namespace: 'core',
        name: 'private_operator_migration.sql',
        appliedAt: '2026-10-09T12:00:00.000Z',
      },
    ],
  },
  services: [
    {
      id: 'docs',
      name: 'AI Daxi Help',
      configured: true,
      qualification: 'not-qualified',
      detail: 'Configuration does not prove provider availability.',
    },
    {
      id: 'telegram-docs',
      name: 'Daxi on Telegram',
      configured: false,
      qualification: 'not-qualified',
      detail: 'Telegram chat is not enabled.',
    },
  ],
  limits: {
    sponsoredWritesPerAccount: 10,
    sponsoredWritesGlobal: 100,
    windowMs: 60000,
    uploadBytes: 2000000,
  },
  defaults: { sharedUsdCents: 0, independentUsdCents: 5000, tlosPremiumBps: 2000 },
});
test.beforeEach(async ({ page }) => {
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      status: path === '/v1/me' ? 401 : 200,
      json:
        path === '/v1/network'
          ? network
          : path === '/v1/platform/status'
            ? status
            : path === '/v1/docs/agent'
              ? {
                  configured: true,
                  profile: {
                    name: 'Daxi',
                    scope: ['Daclify', 'Telos', 'DAOs'],
                    answerModel: 'fixture/answer',
                    decisionsModel: 'fixture/decisions',
                    knowledgeVersion: VERSION,
                  },
                }
              : path === '/v1/daos'
                ? { daos: [] }
                : { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' },
    });
  });
});

test('organises status into accessible tabs and keeps migrations out of the UI', async ({
  page,
}) => {
  await page.goto('/status');
  const tabs = page.getByRole('tablist', { name: 'Status sections' });
  await expect(tabs.getByRole('tab')).toHaveText([
    'Overview',
    'Network',
    'Contracts',
    'Fees',
    'Services',
    'AI Daxi Help',
  ]);
  await expect(
    page.getByRole('heading', { name: 'What you can use here', exact: true }),
  ).toBeVisible();
  await tabs.getByRole('tab', { name: 'Overview', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Network', exact: true })).toBeFocused();
  await expect(
    page.getByRole('heading', { name: 'Network and versions', exact: true }),
  ).toBeVisible();
  await tabs.getByRole('tab', { name: 'Contracts', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Contracts and authorities', exact: true }),
  ).toBeVisible();
  await page.getByText('Public permission authorities', { exact: true }).click();
  await expect(page.getByText('alice@active · weight 1', { exact: true })).toBeVisible();
  await tabs.getByRole('tab', { name: 'Fees', exact: true }).click();
  await expect(page.getByText('Contact for pricing', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Unconfigured · defaults $20 / $50 + resources', { exact: true }),
  ).toHaveCount(0);
  await tabs.getByRole('tab', { name: 'AI Daxi Help', exact: true }).click();
  await expect(page.getByText('fixture/answer', { exact: true })).toBeVisible();
  await expect(page.getByText('fixture/decisions', { exact: true })).toBeVisible();
  await expect(page.getByText('Daclify, Telos, DAOs', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Database migrations', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText('private_operator_migration.sql', { exact: true })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('status-daxi.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open Daxi Help', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Daxi Help', exact: true })).toBeVisible();
});

test('an AI status failure is distinct from missing configuration and does not hide platform status', async ({
  page,
}) => {
  await page.route('**/v1/docs/agent', (route) =>
    route.fulfill({
      status: 503,
      json: { code: 'SERVICE_UNAVAILABLE', message: 'Temporarily unavailable.' },
    }),
  );
  await page.goto('/status');
  await expect(
    page.getByRole('heading', { name: 'What you can use here', exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'AI Daxi Help', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('tab', { name: 'Overview', exact: true }).focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'AI Daxi Help', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeFocused();
  await page.route('**/v1/platform/status', (route) =>
    route.fulfill({
      status: 503,
      json: { code: 'SERVICE_UNAVAILABLE', message: 'Temporarily unavailable.' },
    }),
  );
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
});
