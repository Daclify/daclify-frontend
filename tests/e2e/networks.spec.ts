import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { test, expect, type Route } from '@playwright/test';
import { PrivateKey } from '@wharfkit/antelope';
import { AccountSchema, ErrorSchema, NetworkSchema } from '@daclify/core-protocol';

const origin = 'http://127.0.0.1:5178';
const productionOrigin = 'https://api.example';
const testnetOrigin = 'https://testnet-api.example';
const signedOut = ErrorSchema.parse({ code: 'AUTH_REQUIRED', message: 'Sign in to continue.' });
const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
  format: 'jwk',
});
const account = AccountSchema.parse({
  id: randomUUID(),
  custody: 'user-controlled',
  signingKey: PrivateKey.generate('K1').toPublic().toString(),
  encryptionKey: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
});

function network(environment: 'mainnet' | 'testnet', rpcUrl: string) {
  return NetworkSchema.parse({
    chainId: environment === 'mainnet' ? 'ab'.repeat(32) : 'cd'.repeat(32),
    rpcUrl,
    runtime: 'core.we',
    hub: 'hub.we',
    environment,
    interfaceVersion: 1,
    coreVersion: '0.1.0-alpha.1',
    capabilities: [],
  });
}

const cors = {
  'access-control-allow-origin': origin,
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type,x-csrf-token',
  'access-control-allow-methods': 'GET,POST',
};

test('local mode keeps the proxy and hides the public network switch', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('group', { name: 'Service network' })).toHaveCount(0);
});

test('a deployed build switches production and testnet and starts card checkout', async ({
  page,
}) => {
  const production = network('mainnet', 'https://telos.caleos.io');
  const testnet = network('testnet', 'https://testnet.telos.caleos.io');
  await page.route('**/networks.json', (route) =>
    route.fulfill({
      json: { production: productionOrigin, testnet: testnetOrigin },
    }),
  );
  async function serve(route: Route, environment: 'mainnet' | 'testnet') {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const url = new URL(route.request().url());
    const body =
      url.pathname === '/v1/network'
        ? environment === 'mainnet'
          ? production
          : testnet
        : url.pathname === '/v1/daos'
          ? { daos: [] }
          : url.pathname === '/v1/me'
            ? { account }
            : url.pathname === '/v1/me/memberships'
              ? { memberships: [] }
              : url.pathname === '/v1/billing/receipts'
                ? { receipts: [] }
                : url.pathname === '/v1/billing/checkout'
                  ? { url: 'https://checkout.stripe.com/c/pay/cs_test_fixture' }
                  : signedOut;
    await route.fulfill({ status: 200, headers: cors, json: body });
  }
  await page.route(`${productionOrigin}/**`, (route) => serve(route, 'mainnet'));
  await page.route(`${testnetOrigin}/**`, (route) => serve(route, 'testnet'));
  await page.route('https://checkout.stripe.com/**', (route) =>
    route.fulfill({ status: 200, body: 'checkout', contentType: 'text/html' }),
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Production' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('mainnet network', { exact: true })).toBeAttached();
  await page.goto('/account');
  await page.getByRole('tab', { name: 'Service', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Service payment' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to card payment' }).click();
  await expect(page).toHaveURL(/checkout\.stripe\.com/);
  await page.goto('/');
  await page.getByRole('button', { name: 'Testnet' }).click();
  await expect(page.getByRole('button', { name: 'Testnet' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('testnet network', { exact: true })).toBeAttached();
});
