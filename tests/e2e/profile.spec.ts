import { payCreation } from './creation-payment';
import { expect, test, type Page } from '@playwright/test';

const cid = 'bafkreiehxpuhtr5f6v4eu4byjo2j7kkrhjvd7psmfu4imnpdzb3bdqb7vy';

function accountName(worker: number): string {
  const symbols = 'abcdefghijklmnopqrstuvwxyz12345';
  let n = Date.now();
  let out = symbols[worker % symbols.length] ?? 'm';
  while (n > 0 && out.length < 12) {
    out += symbols[n % symbols.length] ?? 'a';
    n = Math.floor(n / symbols.length);
  }
  return out;
}
async function openMenu(page: Page) {
  const button = page.getByRole('button', { name: 'Menu', exact: true });
  if ((await button.isVisible()) && (await button.getAttribute('aria-expanded')) === 'false')
    await button.click();
}

test('publishes a public profile from the unlocked vault', async ({ page }, testInfo) => {
  const name = accountName(testInfo.workerIndex);
  await page.goto('/account');
  await page.getByLabel('Vault password', { exact: true }).fill('local-test-password-2026');
  await page.getByRole('button', { name: 'Create encrypted vault' }).click();
  await page.getByLabel('I have saved my recovery kit and credential').check();
  await page.getByRole('button', { name: 'Finish account setup' }).click();
  await expect(page.getByText('Vault unlocked', { exact: true })).toBeVisible();
  await openMenu(page);
  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await page.getByLabel('DAO name').fill(`Profile DAO ${name}`);
  await page.getByLabel('Description').fill('A DAO used to publish a member profile.');
  await payCreation(page);
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  await page.getByRole('link', { name: 'Your account', exact: true }).click();
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Public profile' })).toBeVisible();
  await page.getByLabel('Account name', { exact: true }).fill(name);
  await page.getByLabel('Motto', { exact: true }).fill('Build in public');
  await page.getByLabel('Avatar CID', { exact: true }).fill(cid);
  await page.getByRole('button', { name: 'Publish profile', exact: true }).click();
  await expect(page.getByText('Profile published.', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await page.reload();
  await page.getByLabel('Vault password', { exact: true }).fill('local-test-password-2026');
  await page.getByRole('button', { name: 'Unlock and sign in' }).click();
  await expect(
    page.getByRole('heading', { name: 'Workspace overview', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Your account', exact: true }).click();
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await expect(page.getByLabel('Account name', { exact: true })).toHaveValue(name);
  await expect(page.getByLabel('Motto', { exact: true })).toHaveValue('Build in public');
  await expect(page.getByLabel('Avatar CID', { exact: true })).toHaveValue(cid);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
