import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('explains the launch status and sends app visitors to testnet without API calls', async ({
  page,
}) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/v1/')) apiRequests.push(request.url());
  });
  await page.route('**/v1/**', (route) => route.abort());
  await page.goto('/');
  await expect(page).toHaveTitle('Daclify — Production coming soon');
  await expect(
    page.getByRole('heading', { name: 'Production is coming soon.', exact: true }),
  ).toBeVisible();
  const appLinks = page.getByRole('link', { name: 'Explore the testnet app', exact: true });
  await expect(appLinks).toHaveCount(3);
  for (const link of await appLinks.all()) {
    await expect(link).toHaveAttribute('href', 'https://testnet.app.daclify.com');
  }
  await expect(page.getByText('Illustrative workspace', { exact: true })).toBeVisible();
  expect(apiRequests).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('landing-hero.png') });
});

test('supports section navigation, accessible FAQs and narrow screens', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const headerLeft = await page
    .locator('header')
    .evaluate((element) => element.getBoundingClientRect().left);
  const heroLeft = await page
    .locator('.hero')
    .evaluate((element) => element.getBoundingClientRect().left);
  expect(heroLeft).toBe(headerLeft);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Launch status' })
    .click();
  await expect(page).toHaveURL(/#launch$/);
  await page.getByText('When will production launch?', { exact: true }).click();
  await expect(
    page.getByText('A launch date has not been announced.', { exact: false }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('landing.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    await page.locator('.hero').evaluate((element) => element.getBoundingClientRect().left),
  ).toBe(await page.locator('header').evaluate((element) => element.getBoundingClientRect().left));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('old app URLs show the landing page instead of booting a production workspace', async ({
  page,
}) => {
  await page.goto('/dao/example?daclify_order=example&daclify_dao=example');
  await expect(
    page.getByRole('heading', { name: 'Production is coming soon.', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Explore the testnet app', exact: true }).first(),
  ).toHaveAttribute('href', 'https://testnet.app.daclify.com');
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);
});
