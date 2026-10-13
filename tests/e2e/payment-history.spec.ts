import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrivateKey } from '@wharfkit/antelope';
import { AccountSchema, VERSION } from '@daclify/core-protocol';
import { createRecoveryRecipient } from '@daclify/core-protocol/sdk';

test.beforeEach(async ({ page }) => {
  const encryption = await createRecoveryRecipient();
  const account = AccountSchema.parse({
    id: crypto.randomUUID(),
    custody: 'user-controlled',
    signingKey: PrivateKey.generate('K1').toPublic().toString(),
    encryptionKey: encryption.publicKey,
  });
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      '/v1/network': {
        chainId: 'ab'.repeat(32),
        rpcUrl: 'https://rpc.example.test',
        runtime: 'daclifycore',
        hub: null,
        environment: 'testnet',
        interfaceVersion: 1,
        coreVersion: VERSION,
        capabilities: [],
      },
      '/v1/daos': { daos: [], next: null },
      '/v1/sign-in/session': { account },
      '/v1/me/memberships': { memberships: [] },
      '/v1/account/recovery': {
        configured: false,
        assistedEver: false,
        reason: 'RECOVERY_UNAVAILABLE',
        methods: [],
      },
      '/v1/billing/receipts': { receipts: [] },
    };
    await route.fulfill(
      responses[path]
        ? { json: responses[path] }
        : {
            status: 503,
            json: { code: 'SERVICE_UNAVAILABLE', message: 'Fixture endpoint unavailable' },
          },
    );
  });
});

test('reads recorded payments and refreshes without starting checkout', async ({ page }) => {
  const checkoutRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/v1/billing/checkout')
      checkoutRequests.push(request.method());
  });
  await page.route('**/v1/billing/receipts', (route) =>
    route.fulfill({
      json: {
        receipts: [
          { status: 'paid', currency: 'usd', amountMinor: 1250, paymentStatus: 'paid' },
          { status: 'failed', currency: 'usd', amountMinor: 2500, paymentStatus: 'unpaid' },
        ],
      },
    }),
  );
  await page.goto('/account');
  await page.getByRole('tab', { name: 'Payment history', exact: true }).click();
  const history = page.getByRole('tabpanel', { name: 'Payment history', exact: true });
  await expect(history.getByRole('listitem')).toHaveText([
    'Paid · USD 12.50',
    'Failed · USD 25.00',
  ]);
  await expect(history.getByRole('button')).toHaveCount(1);
  await history.getByRole('button', { name: 'Refresh history', exact: true }).click();
  await expect(history.getByRole('listitem')).toHaveCount(2);
  await expect(page).toHaveURL(/\/account$/);
  expect(checkoutRequests).toEqual([]);
  expect((await new AxeBuilder({ page }).include('#main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('payment-history.png'), fullPage: true });
});

for (const billing of ['submitted', 'cancelled']) {
  test(`keeps an empty history after a ${billing} checkout return`, async ({ page }) => {
    await page.goto(`/account?billing=${billing}`);
    await expect(page.getByRole('tab', { name: 'Payment history', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const history = page.getByRole('tabpanel', { name: 'Payment history', exact: true });
    await expect(
      history.getByText('No service payment receipts yet.', { exact: true }),
    ).toBeVisible();
    await expect(history.getByRole('listitem')).toHaveCount(0);
    await expect(history.getByRole('button')).toHaveCount(1);
  });
}

test('shows an unavailable history and retries the receipt lookup', async ({ page }) => {
  await page.route('**/v1/billing/receipts', (route) =>
    route.fulfill({
      status: 503,
      json: { code: 'STRIPE_NOT_CONFIGURED', message: 'Service unavailable' },
    }),
  );
  await page.goto('/account');
  await page.getByRole('tab', { name: 'Payment history', exact: true }).click();
  const history = page.getByRole('tabpanel', { name: 'Payment history', exact: true });
  await expect(history.getByRole('alert')).toContainText('Payment history is unavailable');
  await expect(history.getByText('No service payment receipts yet.', { exact: true })).toHaveCount(
    0,
  );
  await page.route('**/v1/billing/receipts', (route) => route.fulfill({ json: { receipts: [] } }));
  await history.getByRole('button', { name: 'Refresh history', exact: true }).click();
  await expect(history.getByRole('alert')).toHaveCount(0);
  await expect(
    history.getByText('No service payment receipts yet.', { exact: true }),
  ).toBeVisible();
});
