import { payCreation } from './creation-payment';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
async function openMenu(page: Page) {
  const button = page.getByRole('button', { name: 'Menu', exact: true });
  if ((await button.isVisible()) && (await button.getAttribute('aria-expanded')) === 'false')
    await button.click();
}
test('hub, versioned help, keyboard navigation and accessible layout', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your DAO hub' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await openMenu(page);
  await page.getByRole('link', { name: 'Documentation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Daclify handbook' })).toBeVisible();
  await expect(page.getByText('Core interface 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What encryption protects' })).toBeVisible();
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('generates a vault password and copies it before the vault is created', async ({ page }) => {
  await page.goto('/account');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Generate vault password', exact: true }).click();
  const generated = await page.getByLabel('Vault password', { exact: true }).inputValue();
  expect(generated).toMatch(/^[A-Za-z0-9_-]{24}$/);
  await page.getByRole('button', { name: 'Copy vault password', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy vault password' })).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(generated);
});

test('walletless account and real DAO creation flow', async ({ page }) => {
  await page.goto('/account');
  await page.getByLabel('Vault password', { exact: true }).fill('local-test-password-2026');
  await page.getByRole('button', { name: 'Create encrypted vault' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery kit' })).toBeVisible();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const credential = await page
    .getByLabel('Recovery credential — generated for this vault')
    .inputValue();
  expect(credential.length).toBeGreaterThan(20);
  await page.getByRole('button', { name: 'Copy recovery credential', exact: true }).click();
  await expect(page.getByText('Recovery credential copied.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(credential);
  await page.getByLabel('I have saved my recovery kit and credential').check();
  await page.getByRole('button', { name: 'Finish account setup' }).click();
  await expect(page.getByText('Vault unlocked', { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => localStorage.getItem('daclify.vault.v1'));
  expect(saved).not.toContain('PVT_');
  await openMenu(page);
  await page.getByRole('link', { name: 'Create DAO', exact: true }).click();
  await page.getByLabel('DAO name').fill(`Browser DAO ${Date.now()}`);
  await page
    .getByLabel('Description')
    .fill('Created with an internal account on the local native fixture.');
  await payCreation(page, 'custom');
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  await expect(page.getByText('Administrator', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  await page.getByLabel('Document ID', { exact: true }).fill('17');
  await page.getByLabel('JSON content').fill('{"text":"Browser durable document"}');
  await page.getByRole('button', { name: 'Publish JSON', exact: true }).click();
  await expect(page.getByText('Browser durable document', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Modules', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disable Decide', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Decide', exact: true }).click();
  await page.getByLabel('Public ballot title').fill('Browser governance ballot');
  await page.getByRole('button', { name: 'Open ballot', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Browser governance ballot', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Vote Approve', exact: true }).click();
  await expect(page.getByText('Your vote: Approve', { exact: true })).toBeVisible();
  await openMenu(page);
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Lock vault' }).click();
  await expect(page.getByText('Vault locked', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Daclify' })).toBeVisible();
});

test('shows card payment state without treating the return page as paid', async ({ page }) => {
  await page.goto('/account');
  await page.getByLabel('Vault password', { exact: true }).fill('billing-return-password-2026');
  await page.getByRole('button', { name: 'Create encrypted vault' }).click();
  await page.getByLabel('I have saved my recovery kit and credential').check();
  await page.getByRole('button', { name: 'Finish account setup' }).click();
  await page.getByRole('tab', { name: 'Service', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Service payment', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to card payment' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Card payments are not configured on this service.',
  );
  await page.goto('/account?billing=cancelled');
  await expect(page.getByText('The card payment was cancelled.', { exact: true })).toBeVisible();
  await expect(page.locator('.receipt-list')).toHaveCount(0);
  await page.goto('/account?billing=submitted');
  await expect(
    page.getByText(
      'The card payment is recorded when Stripe notifies this service. Refresh the receipt if it is not listed yet.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator('.receipt-list')).toHaveCount(0);
});

test('recovers the same account and DAO membership on a fresh browser', async ({
  page,
  browser,
}) => {
  await page.goto('/account');
  await page.getByLabel('Vault password', { exact: true }).fill('original vault password 2026');
  await page.getByRole('button', { name: 'Create encrypted vault' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery kit' })).toBeVisible();
  const credential = await page
    .getByLabel('Recovery credential — generated for this vault')
    .inputValue();
  await page.getByLabel('I have saved my recovery kit and credential').check();
  await page.getByRole('button', { name: 'Finish account setup' }).click();
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  const id = await page.locator('p.mono').first().textContent();
  const backup = await page.evaluate(() => localStorage.getItem('daclify.vault.v1'));
  if (!backup || !id) throw new Error('Recovery fixture unavailable');
  await openMenu(page);
  await page.getByRole('link', { name: 'Create DAO', exact: true }).click();
  const title = `Recovery DAO ${Date.now()}`;
  await page.getByLabel('DAO name').fill(title);
  await payCreation(page, 'custom');
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  const fresh = await browser.newContext();
  try {
    const recovered = await fresh.newPage();
    await recovered.goto(new URL('/account', page.url()).toString());
    await recovered.getByRole('button', { name: 'Recover from an encrypted kit' }).click();
    await recovered.getByLabel('Encrypted recovery kit').setInputFiles({
      name: 'encrypted-kit.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backup),
    });
    await recovered.getByLabel('Recovery credential', { exact: true }).fill(credential);
    await recovered.getByLabel('New vault password').fill('replacement vault password 2026');
    await recovered.getByRole('button', { name: 'Restore and sign in' }).click();
    await expect(recovered.getByRole('heading', { name: 'Your account' })).toBeVisible();
    await expect(recovered.getByText(id, { exact: true })).toBeVisible();
    await recovered.goto(new URL('/', page.url()).toString());
    await recovered
      .getByRole('link')
      .filter({ has: recovered.getByRole('heading', { name: title, exact: true }) })
      .click();
    await expect(recovered.getByText('Administrator', { exact: true })).toBeVisible();
  } finally {
    await fresh.close();
  }
});

test('keeps private JSON encrypted on chain and clears plaintext when keys lock', async ({
  page,
}) => {
  await page.goto('/account');
  await page.getByLabel('Vault password', { exact: true }).fill('private fixture password 2026');
  await page.getByRole('button', { name: 'Create encrypted vault' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery kit' })).toBeVisible();
  await page.getByLabel('I have saved my recovery kit and credential').check();
  await page.getByRole('button', { name: 'Finish account setup' }).click();
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  await openMenu(page);
  await page.getByRole('link', { name: 'Create DAO', exact: true }).click();
  await page.getByLabel('DAO name').fill(`Encrypted browser DAO ${Date.now()}`);
  await page.getByLabel('Privacy policy').selectOption('encrypted-user-controlled');
  await payCreation(page, 'custom');
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  await page.getByRole('button', { name: 'Initialize encryption epoch' }).click();
  await expect(page.getByText('Encryption epoch ready', { exact: true })).toBeVisible();
  await page.getByLabel('Document ID', { exact: true }).fill('19');
  await page.getByLabel('JSON content').fill('{"text":"private fixture payload"}');
  await page.getByRole('button', { name: 'Encrypt and publish JSON' }).click();
  await expect(page.getByRole('heading', { name: 'Document 19', exact: true })).toBeVisible();
  const match = /\/dao\/([0-9]+)/.exec(page.url());
  if (!match?.[1]) throw new Error('DAO reference unavailable');
  const response = await page.request.get(`/v1/daos/${match[1]}/content`);
  expect(response.ok()).toBe(true);
  expect(await response.text()).not.toContain('private fixture payload');
  await page.getByRole('button', { name: 'Decrypt document 19' }).click();
  await expect(page.getByText('private fixture payload', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Lock keys', exact: true }).click();
  await expect(page.getByText('private fixture payload', { exact: false })).not.toBeVisible();
  await expect(page.getByText('Vault locked', { exact: true })).toBeVisible();
});
