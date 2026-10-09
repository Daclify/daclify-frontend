import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { generateKeyPairSync } from 'node:crypto';
import { PrivateKey } from '@wharfkit/antelope';
import { AccountSchema, ErrorSchema, NetworkSchema, VERSION } from '@daclify/core-protocol';

const network = NetworkSchema.parse({
  chainId: 'ab'.repeat(32),
  rpcUrl: 'http://127.0.0.1:18888',
  runtime: 'daclifycore',
  hub: null,
  environment: 'local',
  interfaceVersion: 1,
  coreVersion: VERSION,
  capabilities: [],
});
const signedOut = ErrorSchema.parse({ code: 'AUTH_REQUIRED', message: 'Sign in to continue.' });
test.beforeEach(async ({ page }) => {
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      status: path === '/v1/me' ? 401 : 200,
      json:
        path === '/v1/network'
          ? network
          : path === '/v1/daos'
            ? { daos: [] }
            : path === '/v1/me/memberships'
              ? { memberships: [] }
              : path === '/v1/hub/directory'
                ? { entries: [], next: null, skipped: 0 }
                : signedOut,
    });
  });
});

test('welcomes guests with clear next steps and a separate Hub', async ({ page }) => {
  await page.goto('/');
  const main = page.locator('#main');
  await expect(
    main.getByRole('heading', { name: 'A home for your community.', exact: true }),
  ).toBeVisible();
  await expect(main.getByRole('link', { name: 'Explore DAOs', exact: true })).toHaveAttribute(
    'href',
    '/hub',
  );
  await expect(main.getByRole('link', { name: 'Create a DAO', exact: true })).toHaveAttribute(
    'href',
    '/create',
  );
  await expect(main.getByRole('link', { name: /Set up your account/ })).toHaveAttribute(
    'href',
    '/account',
  );
  await expect(main.getByRole('link', { name: /Get a little guidance/ })).toHaveAttribute(
    'href',
    '/docs',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('home-guest.png'), fullPage: true });
  await main.getByRole('link', { name: 'Explore DAOs', exact: true }).click();
  await expect(page).toHaveURL(/\/hub$/);
  await expect(page.getByRole('heading', { name: 'Your DAO hub', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Daclify home', exact: true }).click();
  await expect(
    main.getByRole('heading', { name: 'A home for your community.', exact: true }),
  ).toBeVisible();
});

test('returning users get their communities and account shortcuts', async ({ page }) => {
  const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
    format: 'jwk',
  });
  const account = AccountSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    custody: 'user-controlled',
    signingKey: PrivateKey.generate('K1').toPublic().toString(),
    encryptionKey: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
  });
  await page.route('**/v1/me', (route) => route.fulfill({ json: { account } }));
  await page.goto('/');
  await expect(
    page.locator('#main').getByRole('link', { name: 'Open my DAOs', exact: true }),
  ).toHaveAttribute('href', '/hub?mine=1');
  await expect(page.locator('#main').getByRole('link', { name: /Your account/ })).toHaveAttribute(
    'href',
    '/users/me',
  );
  await page.locator('#main').getByRole('link', { name: 'Open my DAOs', exact: true }).click();
  await expect(page.getByRole('button', { name: 'My communities', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('the introductory homepage remains readable when the API is unavailable', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.route('**/v1/network', (route) =>
    route.fulfill({
      status: 503,
      json: ErrorSchema.parse({ code: 'CHAIN_UNAVAILABLE', message: 'Node unavailable.' }),
    }),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'A home for your community.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('The blockchain node is unavailable.');
  expect(requests).not.toContain('/v1/me');
  await expect(page.locator('#main').getByRole('link', { name: 'Explore DAOs' })).toBeVisible();
});

test('old filtered Hub bookmarks keep their query and hash', async ({ page }) => {
  await page.goto('/?mine=1&q=ocean&sort=members#communities');
  await expect(page).toHaveURL(/\/hub\?mine=1&q=ocean&sort=members#communities$/);
  await expect(page.getByRole('button', { name: 'My communities' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('searchbox', { name: 'Search DAOs' })).toHaveValue('ocean');
});
