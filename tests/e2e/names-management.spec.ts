import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { NamesServiceSchema, NetworkSchema, VERSION } from '@daclify/core-protocol';
const names = NamesServiceSchema.parse({
  contract: 'names',
  tokenContract: 'eosio.token',
  configured: true,
  reason: null,
  cardPayments: false,
  thirdPartyBps: 500,
  firstPartyBps: 10000,
  treasury: 'treasury',
  tiers: [
    {
      kind: 'basic',
      price: '1.0000 TLOS',
      usdCents: 100,
      ramBytes: 3000,
      netStake: '0.0000 TLOS',
      cpuStake: '0.0000 TLOS',
      tlosQuote: '1.0000 TLOS',
    },
  ],
  listings: [
    { accountName: 'nice.bob', seller: 'bob', price: '1.0000 TLOS', usdCents: 0, sold: false },
  ],
  suffixes: [{ suffix: 'bob', seller: 'bob', price: '1.0000 TLOS', usdCents: 0, sales: 2 }],
  bumpBps: 2000,
  quotePremiumBps: 2000,
  oracleMedian: null,
  oraclePrecision: null,
  oracleObservedAt: null,
  daoId: '1',
});
test.beforeEach(async ({ page }) => {
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const values: Record<string, unknown> = {
      '/v1/network': NetworkSchema.parse({
        chainId: 'ab'.repeat(32),
        rpcUrl: 'http://127.0.0.1:18888',
        runtime: 'daclifycore',
        hub: null,
        environment: 'local',
        interfaceVersion: 1,
        coreVersion: VERSION,
        capabilities: [],
      }),
      '/v1/daos': { daos: [] },
      '/v1/names': names,
    };
    const body = values[path];
    return route.fulfill({
      status: body ? 200 : 401,
      json: body ?? { code: 'AUTH_REQUIRED', message: 'Fixture sign-in required' },
    });
  });
});
test('suggests valid ideas, shows DAO seller boundaries and exports narrowly scoped owner setup', async ({
  page,
}) => {
  await page.goto('/names');
  await page.getByLabel('Start with an idea', { exact: true }).fill('Ocean ! Community');
  const suggestion = page.locator('.name-suggestions button').first();
  const text = await suggestion.innerText();
  await suggestion.click();
  await expect(page.getByLabel('Telos account name', { exact: true })).toHaveValue(text.trim());
  await page
    .getByRole('group', { name: 'Names views' })
    .getByRole('button', { name: 'Manage & sell', exact: true })
    .click();
  await page.getByRole('button', { name: /DAO-controlled account/ }).click();
  await expect(page.getByText(/Shared DAO administration does not control/)).toBeVisible();
  await page.getByLabel('Native seller account', { exact: true }).fill('bob');
  await expect(page.getByRole('heading', { name: 'Seller inventory', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Update suffix price', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Remove suffix listing', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit listing', exact: true })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export owner-review setup' }).click();
  await expect((await downloaded).suggestedFilename()).toBe(
    'daclify-name-creation-permission.json',
  );
  await expect(page.getByText(/It adds namesale under active/)).toBeVisible();
  await page.getByLabel('Price in TLOS', { exact: true }).fill('1.0000');
  await page.getByRole('checkbox', { name: /I accept the platform/ }).check();
  const listing = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export for DAO approval', exact: true }).click();
  expect((await listing).suggestedFilename()).toBe('daclify-name-listing.json');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('names-manager.png'), fullPage: true });
});
