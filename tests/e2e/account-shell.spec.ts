import { expect, test, type Page } from '@playwright/test';

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

test('folds the side menu to icons on a wide screen', async ({ page }, testInfo) => {
  await page.goto('/');
  const fold = page.getByRole('button', { name: 'Fold menu', exact: true });
  if (testInfo.project.name === 'mobile-chromium') {
    await expect(fold).toBeHidden();
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Documentation', exact: true })).toBeVisible();
    await noOverflow(page);
    return;
  }
  await fold.click();
  await expect(page.getByRole('button', { name: 'Expand menu', exact: true })).toBeVisible();
  const rail = await page.locator('.sidebar').boundingBox();
  const label = await page.locator('nav .nav-text', { hasText: 'DAO hub' }).boundingBox();
  expect(rail?.width ?? 999).toBeLessThan(90);
  expect(label?.width ?? 999).toBeLessThan(8);
  await expect(page.getByRole('link', { name: 'DAO hub', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand menu', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand menu', exact: true }).click();
  await expect(page.locator('nav .nav-text', { hasText: 'DAO hub' })).toBeVisible();
  await noOverflow(page);
});

test('shows the handbook assistant without sending a question', async ({ page }) => {
  await page.goto('/docs');
  await expect(page.getByRole('heading', { name: 'Ask the handbook', exact: true })).toBeVisible();
  await expect(
    page
      .getByText('The documentation assistant is not configured on this server.', { exact: true })
      .or(page.getByLabel('Question', { exact: true })),
  ).toBeVisible();
  await noOverflow(page);
});

test('links a Telos EVM address from the account tab', async ({ page }) => {
  await page.addInitScript(() => {
    const ethereum = {
      request(args: { method: string }) {
        if (args.method === 'eth_requestAccounts') {
          return Promise.resolve(['0x1111111111111111111111111111111111111111']);
        }
        if (args.method === 'personal_sign') return Promise.resolve(`0x${'ab'.repeat(65)}`);
        return Promise.resolve(null);
      },
    };
    Object.defineProperty(window, 'ethereum', { value: ethereum, configurable: true });
  });
  await page.goto('/account');
  await page.getByLabel('Vault password', { exact: true }).fill('local-test-password-2026');
  await page.getByRole('button', { name: 'Create encrypted vault' }).click();
  await page.getByLabel('I have saved my recovery kit and credential').check();
  await page.getByRole('button', { name: 'Finish account setup' }).click();
  await expect(page.getByRole('tab', { name: 'Keys', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.route('**/v1/account/evm**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/challenge')) {
      await route.fulfill({
        json: {
          chainId: 41,
          message: 'Link this Telos EVM address',
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        },
      });
      return;
    }
    if (url.endsWith('/link')) {
      await route.fulfill({
        json: { chainId: 41, address: '0x1111111111111111111111111111111111111111' },
      });
      return;
    }
    if (url.endsWith('/unlink')) {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fulfill({ json: { links: [] } });
  });
  await page.getByRole('tab', { name: 'Linked', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Linked accounts', exact: true })).toBeVisible();
  await page.getByLabel('Telos EVM network', { exact: true }).selectOption('41');
  await page.getByRole('button', { name: 'Link Telos EVM address', exact: true }).click();
  await expect(page.getByText('Telos EVM address linked.', { exact: true })).toBeVisible();
  await expect(page.getByText('0x1111111111111111111111111111111111111111')).toBeVisible();
  await page.getByRole('button', { name: 'Unlink', exact: true }).click();
  await expect(page.getByText('Telos EVM address unlinked.', { exact: true })).toBeVisible();
  await expect(page.getByText('No Telos EVM address is linked to this account.')).toBeVisible();
  await page.getByRole('tab', { name: 'Sign-in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign-in methods', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Service', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Service payment', exact: true })).toBeVisible();
  await noOverflow(page);
});
