import { expect, test } from '@playwright/test';
import {
  DaoSummarySchema,
  DirectoryRoutes,
  ErrorSchema,
  NetworkSchema,
} from '@daclify/core-protocol';
test('pages the directory, restores URL filters, and keeps readable cards when imagery is unavailable', async ({
  page,
}) => {
  const chainId = 'ab'.repeat(32),
    network = NetworkSchema.parse({
      chainId,
      rpcUrl: 'http://127.0.0.1:20188',
      runtime: 'daclifycore',
      hub: null,
      environment: 'local',
      interfaceVersion: 1,
      coreVersion: '0.4.0-alpha.1',
      capabilities: [],
    });
  await page.route('**/v1/**', (route) =>
    route.fulfill({
      status: 503,
      json: ErrorSchema.parse({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Synthetic fixture unavailable.',
      }),
    }),
  );
  await page.route('**/v1/hub/directory', (route) =>
    route.fulfill({
      json: DirectoryRoutes.hubDirectory.response.parse({ entries: [], next: null, skipped: 0 }),
    }),
  );
  const base = {
    reference: { chainId, contract: 'daclifycore', daoId: '1', interfaceVersion: 1 },
    privacy: 'public',
    owner: 'alice',
    token: { chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
    members: 3,
    available: '0',
    reserved: '0',
    claims: '0',
    keyEpoch: '0',
  };
  const first = DaoSummarySchema.parse({
      ...base,
      title: 'An older DAO',
      description: 'Unfiltered',
      purpose: 'community',
    }),
    second = DaoSummarySchema.parse({
      ...base,
      reference: { ...base.reference, daoId: '2' },
      title: 'Ocean ' + 'Commons'.repeat(15),
      description: 'Shared conservation',
      purpose: 'ngo-grants',
      branding: {
        summary: 'Support coastal communities',
        logo: {
          cid: 'bafkreigh2akiscaildc46y7w5q5b5lzd2nmf34jshfeh7g7qy6uxy5yzlm',
          bytes: 8,
          mediaType: 'image/png',
          commitment: 'ab'.repeat(32),
        },
      },
    });
  await page.route('**/v1/network', (r) => r.fulfill({ json: network }));
  await page.route('**/v1/me', (r) =>
    r.fulfill({
      status: 401,
      json: ErrorSchema.parse({ code: 'AUTH_REQUIRED', message: 'Sign in to continue.' }),
    }),
  );
  await page.route(/\/v1\/daos(?:\?.*)?$/, (r) =>
    r.fulfill({
      json: r.request().url().includes('after=')
        ? { daos: [second], next: null }
        : { daos: [first], next: '1' },
    }),
  );
  await page.route('**/v1/daos/2/branding/*', (r) =>
    r.fulfill({ status: 503, json: { code: 'CONTENT_UNAVAILABLE' } }),
  );
  await page.goto('/?q=coastal&purpose=ngo-grants&sort=members');
  await expect(page.getByRole('heading', { name: second.title })).toBeVisible();
  await expect(page.locator('.dao-card')).toHaveCount(1);
  await expect(page.getByRole('searchbox', { name: 'Search DAOs' })).toHaveValue('coastal');
  await expect(page.getByText('View DAO', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.dao-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'My communities' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sign in to see your communities' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('.dao-card')).toHaveCount(2);
  const card = page
    .locator('.dao-card')
    .filter({ has: page.getByRole('heading', { name: second.title }) });
  await card.focus();
  await expect(card).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await card.click();
  await expect(page).toHaveURL(/\/dao\/2$/);
});
