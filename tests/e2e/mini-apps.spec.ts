import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { PrivateKey } from '@wharfkit/antelope';
import { makeInstruction, instructionDigest } from '@daclify/core-protocol/sdk';
import { encodeActivity } from '@daclify/modules/sdk';
import { z } from 'zod';
import {
  RecoveryKitSchema,
  MiniAppConnectionSchema,
  DaoRefSchema,
  ApiRoutes,
  AppTokenSchema,
  AppAuthorizationSchema,
} from '@daclify/core-protocol';
import { createVault } from '../../src/auth/vault';
const password = 'owned mini app browser vault';
const owner = async () =>
  z
    .strictObject({ token: z.string().regex(/^[0-9a-f]{64}$/) })
    .parse(
      JSON.parse(
        await readFile('../daclify-backend-core/.artifacts/native/browser-owner.json', 'utf8'),
      ),
    );
async function signIn(page: Page, admin = true) {
  const vault = await createVault(password),
    kit = RecoveryKitSchema.parse({
      version: 1,
      localEnvelope: vault.localEnvelope,
      recoveryEnvelope: vault.recoveryEnvelope,
      signingPublicKey: vault.signingPublicKey,
      encryptionPublicKey: vault.encryptionPublicKey,
    });
  const response = await page.request.post(
    'http://127.0.0.1:' + (process.env.DACLIFY_TEST_API_PORT ?? '3008') + '/fixture/dao',
    {
      headers: {
        'x-fixture-token': (await owner()).token,
        origin: 'http://127.0.0.1:' + (process.env.DACLIFY_TEST_UI_PORT ?? '5178'),
      },
      data: { signingKey: vault.signingPublicKey, encryptionKey: vault.encryptionPublicKey, admin },
    },
  );
  expect(response.status(), await response.text()).toBe(200);
  const fixture = z
    .strictObject({ dao: DaoRefSchema, memberId: z.string() })
    .parse(await response.json());
  await page.addInitScript(
    (record) => localStorage.setItem('daclify.vault.v1', JSON.stringify(record)),
    kit,
  );
  await page.goto('/account?returnTo=' + encodeURIComponent('/mini-apps#connect'));
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Login', exact: true }).click();
  await main.getByLabel('Vault password', { exact: true }).fill(password);
  await main.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/mini-apps#connect$/);
  await page.getByLabel('Choose a DAO', { exact: true }).selectOption(fixture.dao.daoId);
  return fixture;
}

const apiUrl = 'http://127.0.0.1:' + (process.env.DACLIFY_TEST_API_PORT ?? '3008');
const uiOrigin = 'http://127.0.0.1:' + (process.env.DACLIFY_TEST_UI_PORT ?? '5178');
async function openSaved(page: Page, destination: string) {
  await page.goto('/account?returnTo=' + encodeURIComponent(destination));
  const main = page.getByRole('main');
  const login = main.getByRole('button', { name: 'Login', exact: true });
  if (await login.isVisible()) await login.click();
  await main.getByLabel('Vault password', { exact: true }).fill(password);
  await main.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(page).toHaveURL(uiOrigin + destination);
}
async function authorize(
  page: Page,
  bundle: z.infer<typeof MiniAppConnectionSchema>,
  delegate: PrivateKey,
) {
  const verifier = randomBytes(32).toString('base64url'),
    state = randomBytes(20).toString('hex');
  const input = AppAuthorizationSchema.parse({
    client_id: bundle.binding.clientId,
    redirect_uri: bundle.callbackUrl,
    response_type: 'code',
    scope: 'openid membership',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state,
    nonce: randomBytes(20).toString('hex'),
    signing_key: delegate.toPublic().toString(),
    grant_seconds: 600,
  });
  const query = new URLSearchParams(
    Object.entries(input).map(([key, value]) => [key, String(value)]),
  );
  const response = await page.request.get(apiUrl + '/v1/connected-apps/authorize?' + query, {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(302);
  const location = new URL(z.string().parse(response.headers()['location']));
  expect(location.origin).toBe(uiOrigin);
  return {
    verifier,
    state,
    destination: location.pathname + location.search,
    id: location.searchParams.get('request'),
  };
}
async function approve(
  page: Page,
  bundle: z.infer<typeof MiniAppConnectionSchema>,
  delegate: PrivateKey,
) {
  const request = await authorize(page, bundle, delegate);
  await openSaved(page, request.destination);
  await expect(
    page.getByRole('heading', { name: 'Allow selected activity recording', exact: true }),
  ).toBeVisible();
  await page.route('https://garden.example/login/callback?**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Owned app callback</h1>' }),
  );
  const approved = page.waitForResponse(
    (r) => r.url().endsWith('/approve') && r.request().method() === 'POST',
  );
  const button = page.getByRole('button', { name: 'Approve sign-in and recording', exact: true });
  // Two dispatches in one turn exercise the duplicate-submit guard without waiting for navigation.
  await button.evaluate((element) => {
    if (!(element instanceof HTMLButtonElement)) throw new Error('EXPECTED_APPROVAL_BUTTON');
    element.click();
    element.click();
  });
  const response = await approved;
  expect(response.status()).toBe(200);
  await page.waitForURL('https://garden.example/login/callback?**');
  const callback = new URL(page.url());
  expect(callback.origin + callback.pathname).toBe(bundle.callbackUrl);
  expect(callback.searchParams.get('state')).toBe(request.state);
  const token = await page.request.post(apiUrl + '/v1/connected-apps/token', {
    headers: { origin: 'https://garden.example' },
    data: {
      grant_type: 'authorization_code',
      client_id: bundle.binding.clientId,
      redirect_uri: bundle.callbackUrl,
      code: callback.searchParams.get('code'),
      code_verifier: request.verifier,
    },
  });
  expect(token.status()).toBe(200);
  const value = AppTokenSchema.parse(await token.json());
  const access = await page.request.get(
    apiUrl + ApiRoutes.appMembership.path + '?clientId=' + bundle.binding.clientId,
    {
      headers: { authorization: 'Bearer ' + value.access_token, origin: 'https://garden.example' },
    },
  );
  expect(access.status()).toBe(200);
  return {
    token: value.access_token,
    claims: ApiRoutes.appMembership.response.parse(await access.json()),
  };
}

test('signed-out learning is reachable from the keyboard and mobile menu', async ({
  page,
}, testInfo) => {
  await page.goto('/mini-apps');
  if (testInfo.project.name === 'mobile-chromium')
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const navigation = page.getByRole('link', { name: 'Mini apps', exact: true });
  await expect(navigation).toBeVisible();
  await navigation.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Mini apps', exact: true })).toBeVisible();
  await page.getByText('How mini apps work', { exact: true }).click();
  await expect(page.getByText('Register the app', { exact: true })).toBeVisible();
  await page.locator('#ai-connections > summary').click();
  await expect(page.getByRole('link', { name: /MCP connection guide/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('native member sees consent guidance and no administrator registration', async ({ page }) => {
  await signIn(page, false);
  await expect(
    page.getByText('Your community administrator registers apps.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Register app', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Get connection configuration', exact: true }),
  ).toHaveCount(0);
});
test('native administrator registers exact callbacks and downloads bound configuration', async ({
  page,
}) => {
  test.setTimeout(90000);
  const fixture = await signIn(page);
  await page.getByText('Register or update an app', { exact: true }).click();
  await page
    .locator('details')
    .filter({ has: page.getByText('Register or update an app', { exact: true }) })
    .getByLabel('App ID', { exact: true })
    .fill('7');
  await page.getByLabel('App name', { exact: true }).fill('Browser Garden');
  await page.getByLabel('Approved HTTPS origins', { exact: true }).fill('https://garden.example');
  await page
    .getByLabel('Exact HTTPS login callbacks', { exact: true })
    .fill('https://garden.example/login/callback');
  const signed = page.waitForResponse(
    (r) => r.url().endsWith(ApiRoutes.relay.path) && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Register app', exact: true }).click();
  expect((await signed).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Browser Garden', exact: true })).toBeVisible();
  await page.getByLabel('Registered app', { exact: true }).selectOption('7');
  await page.getByRole('button', { name: 'Get connection configuration', exact: true }).click();
  await expect(
    page.getByText('Exact login callback: https://garden.example/login/callback', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Member login: Not checked', { exact: false })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download configuration', exact: true }).click();
  const path = await (await downloaded).path();
  if (!path) throw new Error('CONNECTION_DOWNLOAD_MISSING');
  const bundle = MiniAppConnectionSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  expect(bundle.binding.daoId).toBe(fixture.dao.daoId);
  expect(bundle.binding.chainId).toBe(fixture.dao.chainId);
  expect(bundle.binding.appId).toBe('7');
  expect(bundle.callbackUrl).toBe('https://garden.example/login/callback');
  await page.screenshot({
    path: '.artifacts/browser/paid/mini-app-connection-' + test.info().project.name + '.png',
    fullPage: true,
  });
  const connectionPath = '**/v1/mini-apps/connections/' + fixture.dao.daoId + '/7';
  await page.route(connectionPath, (route) =>
    route.fulfill({
      status: 503,
      json: { code: 'MINI_APP_RELEASE_UNAVAILABLE', message: 'redacted' },
    }),
  );
  await page.getByRole('button', { name: 'Get connection configuration', exact: true }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'This deployment has no verified mini app starter.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Download configuration', exact: true }),
  ).toHaveCount(0);
  await page.unroute(connectionPath);
  // Cancel before signing: the native session table stays unchanged.
  const delegate = PrivateKey.generate('K1'),
    cancelled = await authorize(page, bundle, delegate);
  await openSaved(page, cancelled.destination);
  let signedWhileCancelling = 0;
  const onRequest = (request: import('@playwright/test').Request) => {
    if (request.url().endsWith(ApiRoutes.relay.path)) signedWhileCancelling++;
  };
  page.on('request', onRequest);
  await page.route('https://garden.example/login/callback?**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Owned cancelled callback</h1>' }),
  );
  const declined = page.waitForResponse(
    (r) => r.url().endsWith('/reject') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  expect((await declined).status()).toBe(200);
  await expect(
    page.getByRole('heading', { name: 'Owned cancelled callback', exact: true }),
  ).toBeVisible();
  expect(signedWhileCancelling).toBe(0);
  page.off('request', onRequest);
  const access = await approve(page, bundle, delegate);
  expect(access.claims.memberId).toBe(fixture.memberId);
  expect(access.claims.dao).toEqual(fixture.dao);
  const event = randomBytes(32).toString('hex');
  const instruction = makeInstruction(
    fixture.dao,
    fixture.memberId,
    access.claims.nonce,
    Math.floor(Date.now() / 1000) + 120,
    'activity',
    'recordact',
    encodeActivity('recordact', {
      runtime: fixture.dao.contract,
      dao_id: fixture.dao.daoId,
      member_id: fixture.memberId,
      app_id: '7',
      source_id: randomBytes(32).toString('hex'),
      source_revision: randomBytes(32).toString('hex'),
      event_id: event,
      evidence_cid: '',
      evidence_hash: '00'.repeat(32),
      key_epoch: '0',
    }),
  );
  const recorded = await page.request.post(apiUrl + ApiRoutes.appRelay.path, {
    headers: { authorization: 'Bearer ' + access.token, origin: 'https://garden.example' },
    data: {
      request: instruction,
      signature: delegate.signDigest(instructionDigest(instruction)).toString(),
    },
  });
  expect(recorded.status()).toBe(200);
  expect(ApiRoutes.appRelay.response.parse(await recorded.json()).transactionId).toMatch(
    /^[a-f0-9]{64}$/,
  );
  await openSaved(page, '/mini-apps#connect');
  await page.getByLabel('Choose a DAO', { exact: true }).selectOption(fixture.dao.daoId);
  await expect(page.getByRole('heading', { name: /Browser Garden · Receipt/ })).toBeVisible();
  await page.getByText('Your app recording grants', { exact: true }).click();
  const revoked = page.waitForResponse(
    (r) => r.url().endsWith(ApiRoutes.relay.path) && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  expect((await revoked).status()).toBe(200);
  const old = await page.request.get(apiUrl + ApiRoutes.appMembership.path, {
    headers: { authorization: 'Bearer ' + access.token, origin: 'https://garden.example' },
  });
  expect(old.status()).toBe(403);
  const renewed = await approve(page, bundle, PrivateKey.generate('K1'));
  expect(renewed.claims.sub).toBe(access.claims.sub);
  expect(renewed.claims.sessionId).not.toBe(access.claims.sessionId);
  const expired = await authorize(page, bundle, PrivateKey.generate('K1'));
  const expiration = await page.request.post(apiUrl + '/fixture/expire-consent', {
    headers: { 'x-fixture-token': (await owner()).token, origin: uiOrigin },
    data: { id: expired.id },
  });
  expect(expiration.status()).toBe(200);
  await openSaved(page, expired.destination);
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'This consent request expired. Return to the app and sign in again.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Approve sign-in and recording', exact: true }),
  ).toHaveCount(0);
});
