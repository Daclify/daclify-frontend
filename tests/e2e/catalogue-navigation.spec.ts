import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  ApiRoutes,
  ErrorSchema,
  MarketplaceSchema,
  NameQuoteSchema,
  NamesServiceSchema,
  NetworkSchema,
  VERSION,
} from '@daclify/core-protocol';

// Synthetic HTTP fixtures exercise navigation and presentation, without a chain or checkout.
const catalogue = MarketplaceSchema.parse({
  configured: true,
  reason: null,
  thirdPartyBps: 500,
  firstPartyBps: 10000,
  treasury: 'treasury',
  modules: [
    {
      account: 'decide',
      publisher: 'daclify',
      party: 'first-party',
      price: '0.0000 TLOS',
      title: 'Decide',
      codeHash: 'ab'.repeat(32),
      summary: 'Ballots and proposals for a DAO.',
      detail: '',
    },
  ],
});
const names = NamesServiceSchema.parse({
  configured: true,
  reason: null,
  cardPayments: false,
  thirdPartyBps: 500,
  firstPartyBps: 10000,
  treasury: 'treasury',
  tiers: [
    {
      kind: 'basic',
      price: '5.0000 TLOS',
      usdCents: 500,
      ramBytes: 30720,
      netStake: '0.1000 TLOS',
      cpuStake: '0.1000 TLOS',
      tlosQuote: null,
    },
  ],
  listings: [],
  suffixes: [],
  bumpBps: 500,
  quotePremiumBps: 500,
  oracleMedian: null,
  oraclePrecision: null,
  oracleObservedAt: null,
  daoId: null,
});

async function openMenu(page: Page) {
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
}

test.beforeEach(async ({ page }) => {
  await page.route(`**${ApiRoutes.network.path}`, (route) =>
    route.fulfill({
      json: NetworkSchema.parse({
        chainId: '11'.repeat(32),
        rpcUrl: 'http://127.0.0.1:18888',
        runtime: 'daclifycore',
        hub: null,
        environment: 'local',
        interfaceVersion: 1,
        coreVersion: VERSION,
        capabilities: [],
      }),
    }),
  );
  await page.route(`**${ApiRoutes.daos.path}`, (route) =>
    route.fulfill({ json: ApiRoutes.daos.response.parse({ daos: [] }) }),
  );
  await page.route(`**${ApiRoutes.me.path}`, (route) =>
    route.fulfill({
      status: 401,
      json: ErrorSchema.parse({ code: 'AUTH_REQUIRED', message: 'Sign in to continue.' }),
    }),
  );
  await page.route('**/v1/marketplace', (route) => route.fulfill({ json: catalogue }));
  await page.route('**/v1/names', (route) => route.fulfill({ json: names }));
});
test('sidebar order and icon fold control match the workspace navigation', async ({ page }) => {
  await page.goto('/');
  await openMenu(page);
  const navigation = page
    .getByRole('complementary', { name: 'Primary navigation' })
    .getByRole('navigation');
  await expect(navigation.locator(':scope > a, :scope > button')).toHaveText([
    'My DAO',
    'Hub',
    'Create',
    'Modules',
    'Users',
    'Documentation',
    'Status',
    'Daclify DAO',
    'Names',
    'Help',
  ]);
  await expect(navigation.getByText('RESOURCES', { exact: true })).toHaveCount(0);
  await expect(navigation.getByText('WORKSPACE', { exact: true })).toHaveCount(0);
  await expect(page.locator('.nav-fold + .sidebar-footer')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Fold menu', exact: true, includeHidden: true }),
  ).toHaveText('');
  await navigation.getByRole('link', { name: 'My DAO', exact: true }).click();
  await expect(page).toHaveURL(/\/\?mine=1$/);
  await expect(page.getByRole('button', { name: 'My communities', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await openMenu(page);
  await expect(navigation.getByRole('link', { name: 'My DAO', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(navigation.getByRole('link', { name: 'Hub', exact: true })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
  await navigation.getByRole('link', { name: 'Hub', exact: true }).click();
  await expect(page.getByRole('button', { name: 'All DAOs', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await openMenu(page);
  await expect(navigation.getByRole('link', { name: 'Hub', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(navigation.getByRole('link', { name: 'My DAO', exact: true })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('opens separate Modules and Names pages from the sidebar', async ({ page }) => {
  const reads: string[] = [];
  page.on('request', (request) => reads.push(new URL(request.url()).pathname));
  await page.goto('/modules');
  await expect(page.getByRole('heading', { name: 'Modules', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Decide', exact: true })).toBeVisible();
  expect(reads).not.toContain('/v1/names');
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByLabel('Telos account name', { exact: true })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await openMenu(page);
  await page.screenshot({ path: test.info().outputPath('modules.png'), fullPage: true });
  const navigation = page.getByRole('navigation');
  await expect(navigation.getByRole('link', { name: 'Marketplace', exact: true })).toHaveCount(0);
  await expect(navigation.getByRole('link', { name: 'Modules', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await navigation.getByRole('link', { name: 'Names', exact: true }).click();
  await expect(page).toHaveURL(/\/names$/);
  await expect(page.getByRole('heading', { name: 'Names', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Basic name', exact: true })).toBeVisible();
  await expect(page.getByLabel('Find a module', { exact: true })).toHaveCount(0);
  expect(reads.filter((path) => path === '/v1/marketplace')).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Basic name', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('names.png'), fullPage: true });
  expect(reads.filter((path) => path === '/v1/marketplace')).toHaveLength(1);
  await openMenu(page);
  await expect(navigation.getByRole('link', { name: 'Names', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await navigation.getByRole('link', { name: 'Modules', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Decide', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('keeps name validation and quotes on the Names page', async ({ page }) => {
  await page.route('**/v1/names/quote?*', (route) =>
    route.fulfill({
      json: NameQuoteSchema.parse({
        accountName: new URL(route.request().url()).searchParams.get('name'),
        kind: 'basic',
        listed: false,
        seller: 'daclify',
        party: 'first-party',
        price: '5.0000 TLOS',
        usdCents: 500,
        platformBps: 10000,
        suffix: null,
        bumpBps: 500,
        quotePremiumBps: 500,
        ramBytes: 30720,
        netStake: '0.1000 TLOS',
        cpuStake: '0.1000 TLOS',
        priceFromOracle: false,
        sales: 0,
        nextPrice: null,
        nextUsdCents: null,
      }),
    }),
  );
  await page.goto('/names');
  await page.getByLabel('Telos account name', { exact: true }).fill('BAD');
  await expect(page.getByRole('status')).toContainText(
    'A Telos name uses a to z, 1 to 5, and dots.',
  );
  await page.getByLabel('Telos account name', { exact: true }).fill('basicname111');
  await expect(page.locator('.quote-card')).toContainText('5.0000 TLOS');
  await expect(page.locator('.quote-card')).toContainText('$5.00 by card');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('redirects old catalogue bookmarks and preserves their query and hash', async ({ page }) => {
  await page.goto('/marketplace?source=bookmark#catalogue');
  await expect(page).toHaveURL(/\/modules\?source=bookmark#catalogue$/);
  await expect(page.getByRole('button', { name: 'Decide', exact: true })).toBeVisible();
});

test('leaving Names cancels a queued price check', async ({ page }) => {
  await page.clock.install();
  let quotes = 0;
  await page.route('**/v1/names/quote?*', (route) => {
    quotes++;
    return route.abort();
  });
  await page.goto('/names');
  await openMenu(page);
  await page.getByLabel('Telos account name', { exact: true }).fill('basicname111');
  await page.getByRole('navigation').getByRole('link', { name: 'Modules', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Decide', exact: true })).toBeVisible();
  await page.clock.fastForward(1000);
  expect(quotes).toBe(0);
});

for (const status of ['submitted', 'cancelled']) {
  test(`redirects legacy ${status} name-payment returns to Names`, async ({ page }) => {
    await page.goto(`/marketplace?names=${status}&source=checkout`);
    await expect(page).toHaveURL(new RegExp(`/names\\?names=${status}&source=checkout$`));
    await expect(page.getByRole('heading', { name: 'Names', exact: true })).toBeVisible();
    await expect(page.locator('.alert[role="status"]')).toContainText(
      `The card payment was ${status}.`,
    );
  });
}

test('a Names outage does not prevent browsing Modules', async ({ page }) => {
  await page.route('**/v1/names', (route) =>
    route.fulfill({
      status: 503,
      json: ErrorSchema.parse({ code: 'CHAIN_UNAVAILABLE', message: 'Fixture unavailable.' }),
    }),
  );
  await page.goto('/modules');
  await expect(page.getByRole('button', { name: 'Decide', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
