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

test('reviews EVM pairing and removal using a provider fixture', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.addInitScript(() => {
    const ethereum = {
      request(args: { method: string }) {
        if (args.method === 'eth_chainId') return Promise.resolve('0x29');
        if (args.method === 'eth_requestAccounts' || args.method === 'eth_accounts') {
          return Promise.resolve(['0x1111111111111111111111111111111111111111']);
        }
        if (args.method === 'personal_sign')
          return Promise.resolve(`0x${'11'.repeat(32)}${'22'.repeat(32)}1b`);
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
  let linked = false;
  await page.route('**/v1/account/evm**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/challenge')) {
      await route.fulfill({
        json: {
          id: crypto.randomUUID(),
          chainId: 41,
          address: '0x1111111111111111111111111111111111111111',
          message: `${new URL(page.url()).origin} wants you to sign in with your Ethereum account:\n0x1111111111111111111111111111111111111111\n\nURI: ${new URL(page.url()).origin}/account\n`,
          expires: new Date(Date.now() + 300_000).toISOString(),
        },
      });
      return;
    }
    if (url.endsWith('/link')) {
      linked = true;
      await route.fulfill({
        json: { chainId: 41, address: '0x1111111111111111111111111111111111111111' },
      });
      return;
    }
    if (url.endsWith('/unlink')) {
      linked = false;
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fulfill({
      json: {
        links: linked
          ? [
              {
                chainId: 41,
                address: '0x1111111111111111111111111111111111111111',
                controlVerified: true,
              },
            ]
          : [],
      },
    });
  });
  await page.getByRole('tab', { name: 'Linked', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Linked accounts', exact: true })).toBeVisible();
  await page.getByLabel('Telos EVM network', { exact: true }).selectOption('41');
  await page.getByRole('button', { name: 'Pair Telos EVM wallet', exact: true }).click();
  await expect(
    page.getByText(
      'Wallet paired for sign-in. DAO governance authorization is activated separately in each workspace.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText('0x1111111111111111111111111111111111111111')).toBeVisible();
  await page.getByRole('button', { name: 'Remove sign-in pairing', exact: true }).click();
  await expect(
    page.getByText(
      'Sign-in pairing removed and its sessions revoked. Remove DAO wallet authorizations separately in each workspace.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove sign-in pairing' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Sign-in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign-in methods', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Service', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Service payment', exact: true })).toBeVisible();
  await noOverflow(page);
});
