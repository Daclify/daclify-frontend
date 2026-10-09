import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ApiRoutes, NetworkSchema, VERSION } from '@daclify/core-protocol';

test('an unknown app URL gives accessible recovery links instead of an empty workspace', async ({
  page,
}) => {
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === ApiRoutes.network.path)
      return route.fulfill({
        json: NetworkSchema.parse({
          chainId: 'ab'.repeat(32),
          rpcUrl: 'https://rpc.example',
          runtime: 'core.we',
          hub: null,
          environment: 'local',
          interfaceVersion: 1,
          coreVersion: VERSION,
          capabilities: [],
        }),
      });
    if (path === ApiRoutes.daos.path) return route.fulfill({ json: { daos: [], next: null } });
    return route.fulfill({ status: 401, json: { code: 'AUTH_REQUIRED', message: 'Sign in.' } });
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/missing-app-page');
  await expect(page.getByRole('heading', { name: 'Page not found', exact: true })).toBeVisible();
  const home = page.getByRole('link', { name: 'Go to home', exact: true });
  await expect(home).toHaveAttribute('href', '/');
  await expect(page.getByRole('link', { name: 'Browse the Hub', exact: true })).toHaveAttribute(
    'href',
    '/hub',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('not-found.png'), fullPage: true });
  await home.click();
  await expect(page).toHaveURL(/\/$/);
  expect(errors).toEqual([]);
});
