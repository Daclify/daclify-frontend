import { test, expect } from '@playwright/test';
import { ApiRoutes, ErrorSchema, NetworkSchema } from '@daclify/core-protocol';

test('built app is installable from a deep link with usable branded icons', async ({ page }) => {
  await page.route('**/v1/**', (route) => route.abort());
  await page.route(`**${ApiRoutes.network.path}`, (route) =>
    route.fulfill({
      json: NetworkSchema.parse({
        chainId: '11'.repeat(32),
        rpcUrl: 'http://127.0.0.1:18888',
        runtime: 'daclifycore',
        hub: null,
        environment: 'local',
        interfaceVersion: 1,
        coreVersion: '0.9.0-alpha.1',
        capabilities: [],
      }),
    }),
  );
  await page.route(`**${ApiRoutes.daos.path}`, (route) =>
    route.fulfill({ json: ApiRoutes.daos.response.parse({ daos: [] }) }),
  );
  await page.route(`**${ApiRoutes.me.path}`, (route) =>
    route.fulfill({
      status: 401,
      json: ErrorSchema.parse({ code: 'AUTH_REQUIRED', message: 'Sign in to continue.' }),
    }),
  );
  await page.goto('/docs/recovery?returnTo=%2Fdao%2F1');
  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveAttribute('href', '/manifest.webmanifest');
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);

  const cdp = await page.context().newCDPSession(page);
  const result = await cdp.send('Page.getAppManifest');
  expect(result.errors).toEqual([]);
  expect(result.url).toBe(new URL('/manifest.webmanifest', page.url()).href);
  const source: unknown = JSON.parse(result.data ?? '{}');
  expect(source).toMatchObject({
    id: '/',
    short_name: 'Daclify',
    display: 'standalone',
    start_url: '/',
    scope: '/',
    icons: [
      { sizes: '192x192', type: 'image/png', purpose: 'any' },
      { sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  });
  expect(result.manifest).toMatchObject({
    name: 'Daclify',
    display: 'kStandalone',
    id: new URL('/', page.url()).href,
    startUrl: new URL('/', page.url()).href,
    scope: new URL('/', page.url()).href,
    backgroundColor: 'rgba(8,7,10,1)',
    themeColor: 'rgba(8,7,10,1)',
  });
  expect(result.manifest?.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', type: 'image/png' }),
      expect.objectContaining({ sizes: '512x512', type: 'image/png' }),
    ]),
  );
  expect((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([]);

  for (const icon of result.manifest?.icons ?? []) {
    const dimensions = await page.evaluate(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      return `${image.naturalWidth}x${image.naturalHeight}`;
    }, icon.url);
    expect(dimensions).toBe(icon.sizes);
  }
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    'content',
    'Daclify',
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
    'content',
    'yes',
  );
  const appleIcon = page.locator('link[rel="apple-touch-icon"]');
  await expect(appleIcon).toHaveAttribute('sizes', '180x180');
  expect(
    await appleIcon.evaluate(async (link) => {
      const image = new Image();
      image.src = link.getAttribute('href') ?? '';
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    }),
  ).toEqual([180, 180]);
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations())).toEqual([]);
});
