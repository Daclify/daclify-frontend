import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { NetworkSchema } from '@daclify/core-protocol';

test('searches producer guides and opens generated references accessibly', async ({ page }) => {
  await page.goto('/docs');
  await expect(page.getByRole('heading', { name: 'Costs & storage', exact: true })).toBeVisible();
  await page.getByLabel('Search guides').fill('native stake');
  await expect(
    page
      .locator('.docs-content')
      .getByRole('link', { name: 'Weights with an explicit snapshot', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'What encryption protects', exact: true }),
  ).not.toBeVisible();
  await page.getByLabel('Search guides').fill('no such guide phrase');
  await expect(page.getByText('No guides match your search. Try a shorter phrase.')).toBeVisible();
  await page.getByLabel('Search guides').fill('');
  await page.getByLabel('Guide collection').selectOption('modules');
  await page
    .locator('.guide-collection')
    .filter({ hasText: 'Modules & treasury' })
    .locator('summary')
    .click();
  await expect(
    page
      .locator('.docs-content')
      .getByRole('link', { name: 'Funded payroll with a clear end date', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'What encryption protects', exact: true }),
  ).not.toBeVisible();
  await page
    .locator('.docs-content')
    .getByRole('link', { name: 'Weights with an explicit snapshot', exact: true })
    .click();
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

test('groups guides, supports keyboard folding and keeps the current guide open', async ({
  page,
}, testInfo) => {
  await page.goto('/docs');
  const navigation = page.getByRole('navigation', {
    name: 'Documentation topics',
    includeHidden: true,
  });
  const gettingStarted = navigation.locator('details').filter({ hasText: 'Getting started' });
  const operators = navigation.locator('details').filter({ hasText: 'Operators & reference' });
  await expect(navigation.locator('details')).toHaveCount(6);
  await expect(gettingStarted).toHaveAttribute('open', '');
  await expect(operators).not.toHaveAttribute('open', '');
  if (testInfo.project.name === 'mobile-chromium') {
    await expect(navigation).toBeHidden();
  } else {
    await operators.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(operators).toHaveAttribute('open', '');
    await page.keyboard.press('Enter');
    await expect(operators).not.toHaveAttribute('open', '');
  }
  await expect(page.locator('.docs-content').getByRole('heading', { level: 2 })).toHaveCount(6);
  await page.getByLabel('Search guides').fill('execctx');
  await expect(operators).toHaveAttribute('open', '');
  await expect(
    page
      .locator('.docs-content')
      .getByRole('link', { name: 'Smart contracts and permissions', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Search guides').fill('');
  const collection = page.locator('.guide-collection').filter({ hasText: 'Operators & reference' });
  await collection.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(collection.locator('details')).toHaveAttribute('open', '');
  await page
    .locator('.docs-content')
    .getByRole('link', { name: 'Smart contracts and permissions', exact: true })
    .click();
  await expect(operators).toHaveAttribute('open', '');
  await expect(navigation).toBeVisible();
  await expect(
    navigation.getByRole('link', { name: 'Smart contracts and permissions', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('heading', { name: 'Smart contracts and permissions', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('handbook-guide.png'), fullPage: true });
  await page.goto('/docs/privacy?dao=1');
  const privacy = navigation.locator('details').filter({ hasText: 'Privacy & recovery' });
  await expect(privacy).toHaveAttribute('open', '');
  await expect(
    navigation.getByRole('link', { name: 'Recover keys and blockchain access', exact: true }),
  ).toHaveAttribute('href', '/docs/recovery?dao=1');
  await navigation.getByRole('link', { name: 'Handbook overview', exact: true }).click();
  await expect(page).toHaveURL(/\/docs\?dao=1$/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('handbook-overview.png'), fullPage: true });
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
