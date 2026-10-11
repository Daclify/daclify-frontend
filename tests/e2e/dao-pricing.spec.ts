import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  ApiRoutes,
  NetworkSchema,
  VERSION,
  STORAGE_GRACE_SECONDS,
  ModuleFeePricingSchema,
} from '@daclify/core-protocol';
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
  checkedAt: '2026-10-11T15:00:00Z',
  apiVersion: VERSION,
  moduleVersion: '0.9.0-alpha.22',
  rpc: 'reachable',
  chain: {
    network,
    chainId: network.chainId,
    chainMatches: true,
    headBlock: 100,
    irreversibleBlock: 90,
    headTime: '2026-10-11T15:00:00',
    contracts: [
      {
        account: network.runtime,
        moduleId: null,
        codeHash: 'ab'.repeat(32),
        expectedHash: 'ab'.repeat(32),
        verified: true,
        ramBytes: 4096,
        ramUsed: 1024,
        permissions: [],
      },
    ],
    catalogue: [
      {
        account: 'decide',
        publisher: 'publisher',
        party: 0,
        complies: 1,
        price: '1.2500 TLOS',
        code_hash: 'ab'.repeat(32),
        title: 'Decide',
      },
    ],
    fees: {
      third_party_bps: 650,
      first_party_bps: 10000,
      treasury: 'fees',
      token_contract: 'eosio.token',
      token_symbol: '4,TLOS',
      names: 'names',
    },
    market: null,
    creation: {
      shared_usd: 0,
      independent_usd: 6500,
      premium_bps: 2300,
      settler: 'relay',
      median: '176',
      precision: 4,
      observed_at: 1,
    },
    hosting: { free_members: 12, settler: 'relay' },
    seatPricing: { first_usd: 175, next_usd: 55, rest_usd: 21, revision: '2' },
    paymentPolicy: { bps: 625, revision: '2' },
    resourcePolicy: {
      schemaVersion: 1,
      revision: '2',
      nativeRamBps: 2500,
      cardRamBps: 4000,
      includedActivityBytes: '125000',
      identityBytesPerSlot: '12000',
      quoteLifetimeSeconds: 900,
      graceSeconds: STORAGE_GRACE_SECONDS,
      storage: {
        schemaVersion: 1,
        revision: '2',
        freeBytes: '123000000',
        unitBytes: '2000000000',
        monthlyUnitUsdCents: 750,
      },
    },
    runtimeSettings: null,
    rateFresh: false,
    platformDao: null,
    sharedAvailable: true,
    independentAvailable: false,
  },
  database: { state: 'reachable', migrations: [] },
  services: [],
  limits: {
    sponsoredWritesPerAccount: 10,
    sponsoredWritesGlobal: 100,
    windowMs: 60000,
    uploadBytes: 2000000,
  },
  defaults: { sharedUsdCents: 0, independentUsdCents: 5000, tlosPremiumBps: 2000 },
});
const modulePricing = ModuleFeePricingSchema.parse({
  chainId: network.chainId,
  runtime: network.runtime,
  interfaceVersion: 1,
  freeMembers: 10,
  plans: [
    {
      pricing: {
        account: 'decide',
        revision: '1',
        monthlyUsdCents: 200,
        actions: ['open', 'newelect'],
      },
      title: 'Decide',
      codeHash: 'ab'.repeat(32),
    },
  ],
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
            : path === '/v1/modules/pricing'
              ? modulePricing
              : path === '/v1/daos'
                ? { daos: [] }
                : { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' },
    });
  });
});
test('opens all current DAO prices from Create a DAO without requiring an account', async ({
  page,
}) => {
  await page.goto('/create');
  const link = page.getByRole('main').getByRole('link', { name: /Pricing/ });
  await expect(link).toHaveAttribute('href', '/pricing');
  await expect(link).not.toHaveAttribute('target', '_blank');
  await link.click();
  await expect(page).toHaveURL('/pricing');
  expect(page.context().pages()).toHaveLength(1);
  await expect(page.getByRole('heading', { name: 'DAO pricing', exact: true })).toBeVisible();
  const main = page.getByRole('main');
  for (const text of [
    'Up to 12 members free',
    '$1.75',
    '$0.55',
    '$0.21',
    '123 MB',
    '$7.50',
    '2 GB',
    '25%',
    '40%',
    '6.25%',
    '6.5%',
    '1.2500 TLOS',
  ])
    await expect(main).toContainText(text);
  await expect(main).toContainText('Contact for pricing');
  await expect(main.getByRole('region', { name: 'Module prices' })).toContainText(
    'All existing modules free through 10 active members',
  );
  await expect(main.getByRole('region', { name: 'Module prices' })).toContainText(
    '$2.00 / DAO / month',
  );
  await expect(main).toContainText('stale');
  await expect(main).not.toContainText('$1.00');
  expect((await new AxeBuilder({ page }).include('#main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Create a DAO', exact: true })).toBeVisible();
});
test('uses total member numbers and adds tier prices in monthly examples', async ({ page }) => {
  await page.goto('/pricing');
  const membership = page.getByRole('region', { name: 'Monthly membership pricing' });
  for (const range of ['Members 13–52', 'Members 53–252', 'Members 253+'])
    await expect(membership).toContainText(range);
  const examples = membership.getByRole('table', { name: 'Example monthly totals' });
  for (const [members, total] of [
    ['52', '$70.00'],
    ['102', '$97.50'],
    ['302', '$190.50'],
  ] as const)
    await expect(
      examples
        .getByRole('row')
        .filter({ has: page.getByRole('cell', { name: members, exact: true }) }),
    ).toContainText(total);
  await expect(membership).toContainText('including empty places');
});
test('keeps missing and wrong-chain pricing unavailable rather than showing free rates', async ({
  page,
}) => {
  await page.route('**/v1/platform/status', (route) =>
    route.fulfill({
      json: {
        ...status,
        chain: {
          ...status.chain,
          hosting: null,
          seatPricing: null,
          paymentPolicy: null,
          resourcePolicy: null,
          fees: null,
          catalogue: [],
        },
      },
    }),
  );
  await page.goto('/pricing');
  await expect(page.getByRole('main')).toContainText('Member pricing is not reported');
  await expect(page.getByRole('main')).toContainText('Storage pricing is not configured');
  await page.route('**/v1/platform/status', (route) =>
    route.fulfill({ json: { ...status, chain: { ...status.chain, chainMatches: false } } }),
  );
  await page.getByRole('button', { name: 'Refresh prices', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Pricing could not be verified');
  await expect(page.getByRole('main')).not.toContainText('$1.75');
});
test('offers retry after a pricing read fails', async ({ page }) => {
  await page.route('**/v1/platform/status', (route) =>
    route.fulfill({ status: 503, json: { code: 'CHAIN_UNAVAILABLE', message: 'Unavailable' } }),
  );
  await page.goto('/pricing');
  await expect(page.getByRole('alert')).toContainText('Could not load DAO pricing');
  await page.unroute('**/v1/platform/status');
  await page.getByRole('button', { name: 'Refresh prices', exact: true }).click();
  await expect(page.getByRole('main')).toContainText('$1.75');
});
