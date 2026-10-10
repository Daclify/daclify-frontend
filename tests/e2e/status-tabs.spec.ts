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
test('groups services by purpose and resets a filter with no matches', async ({ page }) => {
  await page.route('**/v1/platform/status', (route) =>
    route.fulfill({
      json: {
        ...status,
        services: [
          ...status.services,
          {
            id: 'google',
            name: 'Google sign-in',
            configured: false,
            qualification: 'not-qualified',
            detail: 'No Google settings.',
          },
          {
            id: 'storage',
            name: 'Pinata / hosted storage',
            configured: true,
            qualification: 'not-qualified',
            detail: 'Pinata availability is unverified.',
          },
        ],
      },
    }),
  );
  await page.goto('/status');
  await page.getByRole('tab', { name: 'Services', exact: true }).click();
  const directory = page.locator('#status-panel-services');
  await expect(
    directory.getByRole('heading', { name: 'Sign-in and accounts', exact: true }),
  ).toBeVisible();
  await expect(
    directory.getByRole('heading', { name: 'Files and storage', exact: true }),
  ).toBeVisible();
  await directory.getByLabel('Service readiness', { exact: true }).selectOption('missing');
  await expect(
    directory.getByRole('heading', { name: 'Pinata / hosted storage', exact: true }),
  ).toHaveCount(0);
  await directory
    .getByRole('searchbox', { name: 'Search services', exact: true })
    .fill('nothing matches');
  await expect(
    directory.getByText('No services match these filters.', { exact: true }),
  ).toBeVisible();
  await directory.getByRole('button', { name: 'Clear service filters', exact: true }).click();
  await expect(
    directory.getByRole('heading', { name: 'Pinata / hosted storage', exact: true }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('service-directory.png'), fullPage: true });
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
  await expect(page.getByRole('tablist')).toBeVisible();
  await expect(page.locator('#main')).toContainText('Previous readings');
});

test('keeps the selected diagnostics and disclosures through a failed refresh and recovery', async ({
  page,
}) => {
  await page.goto('/status');
  await page.getByRole('tab', { name: 'Contracts', exact: true }).click();
  await page.getByText('Public permission authorities', { exact: true }).click();
  let release = () => {};
  await page.route('**/v1/platform/status', async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE' } });
  });
  await page.getByRole('button', { name: 'Refresh status', exact: true }).focus();
  await page.keyboard.press('Enter');
  try {
    await expect(page.getByRole('button', { name: 'Checking…', exact: true })).toBeDisabled();
    await expect(page.getByText('alice@active · weight 1', { exact: true })).toBeVisible();
  } finally {
    release();
  }
  await expect(page.locator('#main')).toContainText('Previous readings');
  await expect(page.getByRole('tab', { name: 'Contracts', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Refresh status', exact: true })).toBeFocused();
  await page.route('**/v1/platform/status', (route) =>
    route.fulfill({
      json: {
        ...status,
        checkedAt: '2026-10-10T13:00:00.000Z',
      },
    }),
  );
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.locator('#main time')).toHaveAttribute('datetime', '2026-10-10T13:00:00.000Z');
  await expect(page.locator('#main')).not.toContainText('Previous readings');
  await expect(page.getByText('alice@active · weight 1', { exact: true })).toBeVisible();
});

test('shows platform readings while assistant metadata is still loading', async ({ page }) => {
  let release = () => {};
  await page.route('**/v1/docs/agent', async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({ json: { configured: false } });
  });
  await page.goto('/status');
  try {
    await expect(
      page.getByRole('heading', { name: 'What you can use here', exact: true }),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'AI Daxi Help', exact: true }).click();
    await expect(page.locator('#status-panel-ai')).toContainText('Checking Daxi settings');
  } finally {
    release();
  }
  await expect(page.locator('#status-panel-ai')).toContainText('Not configured');
});

test('does not present reachable RPC without chain evidence as verified or hide a database failure', async ({
  page,
}) => {
  await page.route('**/v1/platform/status', (route) =>
    route.fulfill({
      json: {
        ...status,
        chain: null,
        database: { state: 'unavailable', migrations: [] },
      },
    }),
  );
  await page.goto('/status');
  await expect(page.getByRole('region', { name: 'Latest checks' })).toContainText('Not verified');
  await expect(
    page
      .getByRole('region', { name: 'Latest checks' })
      .locator('article')
      .filter({ hasText: 'Database' }),
  ).toContainText('Unavailable');
  await page.getByRole('tab', { name: 'Contracts', exact: true }).click();
  await expect(page.locator('#status-panel-contracts')).toContainText(
    'Contract readings unavailable',
  );
});

test('makes an initial failure recoverable without implying absent configuration', async ({
  page,
}) => {
  await page.route('**/v1/platform/status', (route) =>
    route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE' } }),
  );
  await page.goto('/status');
  await expect(page.locator('#main [role="alert"]')).toContainText(
    'Could not check platform status',
  );
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await page.route('**/v1/platform/status', (route) => route.fulfill({ json: status }));
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Latest checks' })).toBeVisible();
});

test('a wrong chain cannot report shared setup or quotes as usable', async ({ page }) => {
  if (!status.chain) throw new Error('Fixture requires chain metadata');
  await page.route('**/v1/platform/status', (route) =>
    route.fulfill({
      json: ApiRoutes.status.response.parse({
        ...status,
        chain: { ...status.chain, chainId: 'cd'.repeat(32), chainMatches: false, rateFresh: true },
      }),
    }),
  );
  await page.goto('/status');
  const checks = page.getByRole('region', { name: 'Latest checks' });
  await expect(checks.locator('article').filter({ hasText: 'Chain RPC' })).toContainText(
    'Wrong chain',
  );
  await expect(checks.locator('article').filter({ hasText: 'Shared setup' })).toContainText(
    'Unavailable',
  );
  await expect(checks.locator('article').filter({ hasText: 'TLOS quotes' })).not.toContainText(
    'Current',
  );
  await page.getByRole('tab', { name: 'Network', exact: true }).click();
  await expect(page.locator('#status-panel-network')).toContainText('MISMATCH');
});

test('quote checks distinguish an absent observation from a stale or current rate', async ({
  page,
}) => {
  if (!status.chain) throw new Error('Fixture requires chain metadata');
  let quoteStatus = status;
  await page.route('**/v1/platform/status', (route) => route.fulfill({ json: quoteStatus }));
  await page.goto('/status');
  const quote = page
    .getByRole('region', { name: 'Latest checks' })
    .locator('article')
    .filter({ hasText: 'TLOS quotes' });
  await expect(quote.locator('.check-value')).toHaveText('Unavailable');
  for (const [rateFresh, label] of [
    [false, 'Stale'],
    [true, 'Current'],
  ] as const) {
    quoteStatus = ApiRoutes.status.response.parse({
      ...status,
      chain: {
        ...status.chain,
        rateFresh,
        creation: {
          shared_usd: 2000,
          independent_usd: 5000,
          premium_bps: 2000,
          settler: 'relay',
          median: '176',
          precision: 4,
          observed_at: 1791548722,
        },
      },
    });
    await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await expect(quote.locator('.check-value')).toHaveText(label);
  }
});

test('empty contract and service readings stay explicit rather than implying verification', async ({
  page,
}) => {
  if (!status.chain) throw new Error('Fixture requires chain metadata');
  await page.route('**/v1/platform/status', (route) =>
    route.fulfill({
      json: {
        ...status,
        chain: { ...status.chain, contracts: [] },
        services: [],
      },
    }),
  );
  await page.goto('/status');
  await page.getByRole('tab', { name: 'Contracts', exact: true }).click();
  await expect(page.locator('#status-panel-contracts')).toContainText(
    'Contract readings unavailable',
  );
  await page.getByRole('tab', { name: 'Services', exact: true }).click();
  await expect(page.locator('#status-panel-services')).toContainText(
    'No other integrations reported',
  );
  await page.getByRole('button', { name: 'Daxi configuration', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'AI Daxi Help', exact: true })).toBeFocused();
  await expect(page.locator('#status-panel-ai')).toContainText(
    'Telegram support configuration was not reported',
  );
});

test('gateway counters keep integer precision and disclose each allowance state', async ({
  page,
}) => {
  let state = 'available';
  await page.route('**/v1/platform/status', (route) =>
    route.fulfill({
      json: ApiRoutes.status.response.parse({
        ...status,
        gatewayAllowance: {
          state,
          startsAt: '2026-10-01T00:00:00.000Z',
          endsAt: '2026-11-01T00:00:00.000Z',
          byteLimit: '18446744073709551615',
          reservedBytes: '9007199254740993',
          requestLimit: '100',
          requests: '1',
          fundingQualification: 'operator-attested',
        },
      }),
    }),
  );
  await page.goto('/status');
  const allowance = page
    .locator('#status-panel-overview .panel')
    .filter({ has: page.getByRole('heading', { name: 'Shared gateway allowance' }) });
  await expect(allowance).toContainText('9007199254740993 / 18446744073709551615 bytes reserved');
  await allowance.getByText('How this allowance works', { exact: true }).click();
  await expect(allowance).toContainText('Failed reads retain their reservation');
  for (const [value, label] of [
    ['scheduled', 'Scheduled'],
    ['expired', 'Expired'],
    ['exhausted', 'Exhausted'],
  ]) {
    if (!value || !label) throw new Error('Fixture requires allowance state and label');
    state = value;
    await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await expect(allowance.locator('.pill')).toHaveText(label);
    await expect(allowance.locator('.pill.success')).toHaveCount(0);
  }
});

test('a same-chain runtime change clears old readings and rejects its delayed refresh', async ({
  page,
}) => {
  if (!status.chain) throw new Error('Fixture requires chain metadata');
  const nextNetwork = NetworkSchema.parse({ ...network, runtime: 'nextcore' });
  const nextStatus = ApiRoutes.status.response.parse({
    ...status,
    checkedAt: '2026-10-10T15:00:00.000Z',
    chain: { ...status.chain, network: nextNetwork, contracts: [] },
  });
  await page.route('**/networks.json', (route) =>
    route.fulfill({
      json: {
        production: 'https://production.example',
        testnet: 'https://testnet.example',
      },
    }),
  );
  await page.route('**/v1/network', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).hostname === 'testnet.example' ? nextNetwork : network,
    }),
  );
  await page.goto('/status');
  await page.getByRole('tab', { name: 'Contracts', exact: true }).click();
  await page.getByText('Public permission authorities', { exact: true }).click();
  let release = () => {};
  await page.route('**/v1/platform/status', async (route) => {
    if (new URL(route.request().url()).hostname === 'testnet.example')
      return route.fulfill({ json: nextStatus });
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return route.fulfill({ json: status });
  });
  const delayed = page.waitForResponse('https://production.example/v1/platform/status');
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  try {
    await page.getByRole('button', { name: 'Testnet', exact: true }).click();
    await expect(page.locator('#main time')).toHaveAttribute(
      'datetime',
      '2026-10-10T15:00:00.000Z',
    );
    await expect(page.getByText('alice@active · weight 1', { exact: true })).toHaveCount(0);
  } finally {
    release();
  }
  await delayed;
  await expect(page.getByRole('button', { name: 'Refresh status', exact: true })).toBeEnabled();
  await expect(page.locator('#main time')).toHaveAttribute('datetime', '2026-10-10T15:00:00.000Z');
  await expect(page.locator('#status-panel-contracts')).toContainText(
    'Contract readings unavailable',
  );
});

test('all status sections fit small screens and enlarged text with accessible controls', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/status');
  await expect(page.getByRole('region', { name: 'Latest checks' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() =>
      [...document.fonts].some(
        (font) => font.family.includes('Inter Variable') && font.status === 'loaded',
      ),
    ),
  ).toBe(true);
  for (const [width, height] of [
    [320, 740],
    [390, 844],
    [768, 1024],
    [1440, 1000],
  ]) {
    if (!width || !height) throw new Error('Fixture requires viewport dimensions');
    await page.setViewportSize({ width, height });
    for (const name of ['Overview', 'Network', 'Contracts', 'Fees', 'Services', 'AI Daxi Help']) {
      const tab = page.getByRole('tab', { name, exact: true });
      await tab.click();
      expect((await tab.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.getByRole('tab', { name: 'Overview', exact: true }).click();
    await page.screenshot({ path: test.info().outputPath(`status-${width}.png`), fullPage: true });
  }
  for (const name of ['Overview', 'Network', 'Contracts', 'Fees', 'Services', 'AI Daxi Help']) {
    await page.getByRole('tab', { name, exact: true }).click();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  for (const name of ['Overview', 'Network', 'Contracts', 'Fees', 'Services', 'AI Daxi Help']) {
    await page.getByRole('tab', { name, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('status-enlarged.png'), fullPage: true });
});
