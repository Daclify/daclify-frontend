import { test, expect, type Page } from '@playwright/test';
import { ErrorSchema, NetworkSchema, VERSION } from '@daclify/core-protocol';

const origin = 'http://127.0.0.1:5308';
const apiOrigin = 'https://testnet-api.example';
async function serve(page: Page, environment: 'testnet' | 'mainnet') {
  const network = NetworkSchema.parse({
    chainId: 'ab'.repeat(32),
    rpcUrl: 'https://rpc.example',
    runtime: 'core.we',
    hub: 'hub.we',
    environment,
    interfaceVersion: 1,
    coreVersion: VERSION,
    capabilities: [],
  });
  const signedOut = ErrorSchema.parse({ code: 'AUTH_REQUIRED', message: 'Sign in to continue.' });
  await page.route(apiOrigin + '/**', async (route) => {
    const headers = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'content-type,x-csrf-token',
      'access-control-allow-methods': 'GET,POST',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    const path = new URL(route.request().url()).pathname;
    const body = path === '/v1/network' ? network : path === '/v1/daos' ? { daos: [] } : signedOut;
    await route.fulfill({ status: path === '/v1/me' ? 401 : 200, headers, json: body });
  });
}

test('locks testnet, hides the switch and ignores a saved production choice after reload', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('daclify.network', 'production'));
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await serve(page, 'testnet');
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Deployment network' })).toHaveText('Testnet');
  await expect(page.getByRole('group', { name: 'Service network' })).toHaveCount(0);
  await expect(page.getByText('testnet network', { exact: true })).toBeAttached();
  await page.reload();
  await expect(page.getByText('testnet network', { exact: true })).toBeAttached();
  expect(requests.some((url) => url.startsWith(apiOrigin + '/v1/'))).toBe(true);
  expect(requests.some((url) => url.startsWith('https://api.example/'))).toBe(false);
  expect(requests.some((url) => new URL(url).pathname === '/networks.json')).toBe(false);
});

test('blocks workspace screens and identity reads when the API reports mainnet', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await serve(page, 'mainnet');
  await page.goto('/create');
  await expect(page.getByRole('alert')).toContainText('different network');
  await expect(page.getByRole('heading', { name: 'Create a DAO' })).toHaveCount(0);
  expect(requests.some((url) => new URL(url).pathname === '/v1/me')).toBe(false);
});

test('keeps the welcome page readable without opening a wrong-network workspace', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await serve(page, 'mainnet');
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'A home for your community.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('different network');
  expect(requests).not.toContain('/v1/me');
  await page.locator('#main').getByRole('link', { name: 'Create a DAO', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create a DAO', exact: true })).toHaveCount(0);
  expect(requests).not.toContain('/v1/me');
});
