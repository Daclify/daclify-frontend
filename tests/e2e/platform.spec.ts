import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixtureAction, payCreation } from './creation-payment';
import { ApiRoutes } from '@daclify/core-protocol';
import { ModuleCodeHashes } from '@daclify/modules/sdk';
async function account(page: Parameters<typeof payCreation>[0]) {
  await page.goto('/account');
  await page.getByLabel('Vault password', { exact: true }).fill('synthetic-platform-password-2026');
  await page.getByRole('button', { name: 'Create encrypted vault' }).click();
  await page.getByLabel('I have saved my recovery kit and credential').check();
  await page.getByRole('button', { name: 'Finish account setup' }).click();
  await expect(page.getByText('Vault unlocked', { exact: true })).toBeVisible();
}
test('shows safe platform setup and keeps module help in Documentation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/status');
  await expect(page.getByRole('heading', { name: 'What you can use here' })).toBeVisible();
  await page.getByText('Technical setup, versions and operating details', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Network and versions' })).toBeVisible();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Daclify DAO', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Module guide', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Status', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const response = await page.request.get(ApiRoutes.status.path);
  const status = ApiRoutes.status.response.parse(await response.json());
  expect(status.chain?.chainMatches).toBe(true);
  expect(status.chain?.creation?.independent_usd).toBe(5000);
  expect(status.services.find((s) => s.id === 'card')?.configured).toBe(false);
  expect(status.database.migrations.some((m) => m.name === '006_creation_orders.sql')).toBe(true);
  await nav.getByRole('link', { name: 'Daclify DAO', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign setup fee policy' })).toBeDisabled();
  await page.goto('/docs/modules');
  await expect(
    page.getByRole('heading', { name: 'Configure modules, keep core rights', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({
    path: '.artifacts/browser/platform-status-' + test.info().project.name + '.png',
  });
});
test('pays shared setup and administers only the linked platform DAO', async ({ page }) => {
  test.setTimeout(60000);
  await account(page);
  await page.goto('/create');
  await page.getByLabel('DAO name').fill('Browser Daclify DAO ' + Date.now());
  await expect(page.getByText('Shared contract · $20.00', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Independent contract · $50.00 + resources', { exact: true }),
  ).toBeVisible();
  await page.getByRole('radio', { name: /Independent contract/ }).check();
  await expect(page.getByRole('button', { name: 'Review setup payment' })).toBeDisabled();
  await page.getByRole('radio', { name: /Shared contract/ }).check();
  const order = await payCreation(page);
  const daoId = new URL(page.url()).pathname.split('/')[2];
  if (!daoId) throw new Error('Missing DAO');
  await page.goto('/daclify');
  await expect(page.getByRole('button', { name: 'Sign setup fee policy' })).toBeDisabled();
  fixtureAction('daclifycore', 'setgov', [daoId], 'daclifycore');
  await page.goto('/account');
  await page.getByLabel('Vault password', { exact: true }).fill('synthetic-platform-password-2026');
  await page.getByRole('button', { name: 'Unlock and sign in' }).click();
  await expect(page.getByText('Vault unlocked', { exact: true })).toBeVisible();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Daclify DAO', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Sign setup fee policy' })).toBeEnabled();
  await page.getByLabel('Shared fee (USD cents)').fill('2000');
  await page.getByRole('button', { name: 'Sign setup fee policy' }).click();
  await expect(
    page.getByText('Platform configuration updated on chain.', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Native module account', { exact: true }).first().fill('works');
  await page.getByLabel('Title', { exact: true }).fill('Works');
  await page.getByLabel('Verified deployed WASM hash').fill(ModuleCodeHashes.works);
  await page.getByRole('button', { name: 'Sign module registration' }).click();
  await expect(
    page.getByText('Platform configuration updated on chain.', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Summary', { exact: true }).fill('Platform-controlled milestone module.');
  await page.getByLabel('Details', { exact: true }).fill('Synthetic native browser acceptance.');
  await page.getByRole('button', { name: 'Sign description update' }).click();
  await expect(
    page.getByText('Platform configuration updated on chain.', { exact: true }),
  ).toBeVisible();
  const paid = ApiRoutes.creationOrderStatus.response.parse(
    await (
      await page.request.get(ApiRoutes.creationOrderStatus.path.replace(':id', order.requestId))
    ).json(),
  );
  expect(paid.state).toBe('created');
  expect(paid.dao?.daoId).toBe(daoId);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: '.artifacts/browser/platform-dao-' + test.info().project.name + '.png',
  });
});
