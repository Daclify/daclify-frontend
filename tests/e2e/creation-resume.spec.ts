import { expect, test } from '@playwright/test';
import { ApiRoutes } from '@daclify/core-protocol';
import { fixtureAction } from './creation-payment';
test('checks preflight, retains immutable order review and requires explicit paid execution', async ({
  page,
}) => {
  await page.goto('/create');
  await expect(
    page.getByRole('main').getByRole('link', { name: 'Set up account', exact: true }),
  ).toHaveAttribute('href', '/account?returnTo=/create');
  await page.getByRole('main').getByRole('link', { name: 'Set up account', exact: true }).click();
  await expect(page).toHaveURL(/account\?returnTo=/);
  await page.getByLabel('Vault password', { exact: true }).fill('creation resume fixture password');
  await page.getByRole('button', { name: 'Create encrypted vault' }).click();
  await page.getByLabel('I have saved my recovery kit and credential').check();
  await page.getByRole('button', { name: 'Finish account setup' }).click();
  await expect(page).toHaveURL(/\/create$/);
  const title = 'Immutable resume ' + Date.now();
  await page.getByLabel('DAO name').fill(title);
  await page.getByLabel('Description', { exact: true }).fill('Saved public description');
  await page.getByText('Advanced governance and emergency safeguards', { exact: true }).click();
  await page.getByLabel('Human guardian account').fill('ghostguard');
  await page.getByRole('button', { name: 'Review setup payment', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('guardian account does not exist');
  await expect(page.getByLabel('DAO name')).toBeDisabled();
  await page.getByRole('button', { name: 'Start a different order', exact: true }).click();
  await page.getByLabel('Human guardian account').fill('');
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/v1/dao-orders') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Review setup payment', exact: true }).click();
  const order = ApiRoutes.creationOrder.response.parse(await (await response).json());
  await page.reload();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByText('Saved public description', { exact: true })).toBeVisible();
  await expect(page.getByText(order.creator.signingKey, { exact: false }).first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Create this paid DAO', exact: true }),
  ).not.toBeVisible();
  if (!order.tlosAmount) throw new Error('Missing fixture quote');
  fixtureAction(
    order.tokenContract,
    'transfer',
    ['alice', order.recipient, order.tlosAmount, order.memo],
    'alice',
  );
  await page.getByRole('button', { name: 'Check payment status', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Create this paid DAO', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(order.requestId));
  await page.getByRole('button', { name: 'Create this paid DAO', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Workspace overview', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Unlock account', exact: true }).click();
  await page.getByLabel('Vault password', { exact: true }).fill('creation resume fixture password');
  await page.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Workspace overview', exact: true }),
  ).toBeVisible();
});
