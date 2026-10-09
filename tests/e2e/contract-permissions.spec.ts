import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.route('**/v1/**', (route) =>
    route.fulfill({
      status: 503,
      json: { code: 'SERVICE_UNAVAILABLE', message: 'Offline documentation fixture' },
    }),
  );
});

test('permission guide loads its bundled diagram and accessible examples without an API', async ({
  page,
}, testInfo) => {
  await page.goto('/docs/contract-permissions');
  await expect(
    page.getByRole('heading', { name: 'Smart contracts and permissions', exact: true }),
  ).toBeVisible();
  const diagram = page.getByRole('img', {
    name: 'Daclify contract permissions and module interaction map',
  });
  await expect(diagram).toBeVisible();
  expect(
    await diagram.evaluate(
      (img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0,
    ),
  ).toBe(true);
  await expect(page.getByText('Shared deployments', { exact: true })).toBeVisible();
  await expect(page.getByText('Independent deployments', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open full-size diagram' })).toHaveAttribute(
    'href',
    /contract-permissions.*\.svg/,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('permissions.png'), fullPage: true });
});

test('permission examples are discoverable through documentation search', async ({ page }) => {
  await page.goto('/docs');
  await page.getByLabel('Search guides').fill('execctx');
  await expect(
    page
      .locator('.docs-content')
      .getByRole('link', { name: 'Smart contracts and permissions', exact: true }),
  ).toBeVisible();
});
