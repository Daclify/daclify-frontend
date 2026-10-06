import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { NetworkSchema } from '@daclify/core-protocol';

test('searches producer guides and opens generated references accessibly', async ({ page }) => {
  await page.goto('/docs');
  await expect(
    page.getByRole('heading', { name: 'Pay for a hosted service', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Search guides').fill('native stake');
  await expect(
    page.getByRole('heading', { name: 'Weights with an explicit snapshot', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'What encryption protects', exact: true }),
  ).not.toBeVisible();
  await page.getByLabel('Search guides').fill('no such guide phrase');
  await expect(page.getByText('No guides match your search. Try a shorter phrase.')).toBeVisible();
  await page.getByLabel('Search guides').fill('');
  await page.getByLabel('Documentation bundle').selectOption('modules');
  await expect(
    page.getByRole('heading', { name: 'Funded payroll with a clear end date', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'What encryption protects', exact: true }),
  ).not.toBeVisible();
  await page.getByRole('link', { name: 'Weights with an explicit snapshot', exact: true }).click();
  await expect(page.getByText('Deployment not verified', { exact: true })).toBeVisible();
  await page.getByText('Developer and operator references', { exact: true }).click();
  await page.getByText('decide contract reference', { exact: true }).click();
  await page.getByText('Action: vote', { exact: true }).click();
  await expect(page.getByRole('cell', { name: 'ballot_id', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('displays a connected core version mismatch', async ({ page }) => {
  await page.route('**/v1/network', async (route) => {
    const response = await route.fetch();
    const input: unknown = await response.json();
    const network = NetworkSchema.parse(input);
    await route.fulfill({ json: { ...network, coreVersion: '0.2.0' } });
  });
  await page.goto('/docs/privacy');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Documentation version mismatch' }),
  ).toBeVisible();
  await expect(page.getByText(/differs from connected core 0\.2\.0/)).toBeVisible();
  await expect(
    page.getByText(/Guide version matches the service’s reported version/),
  ).not.toBeVisible();
});
