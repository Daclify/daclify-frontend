import { expect, test } from '@playwright/test';
test('shows a recoverable page-load failure and fetches the current page on reload', async ({
  page,
}) => {
  let aborted = 0;
  await page.route('**/src/views/Workspace.vue*', (route) => {
    aborted++;
    return route.abort('failed');
  });
  await page.goto('/dao/1/decide');
  await expect(page.getByRole('heading', { name: 'This page could not load' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
  expect(aborted).toBeGreaterThan(0);
  await page.unroute('**/src/views/Workspace.vue*');
  await page.getByRole('button', { name: 'Reload page' }).click();
  await expect(page.getByRole('heading', { name: 'This page could not load' })).toHaveCount(0);
  await expect(page.locator('#main')).not.toBeEmpty();
});
