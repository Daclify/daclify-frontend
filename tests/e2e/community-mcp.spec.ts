import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { PrivateKey } from '@wharfkit/antelope';
import AxeBuilder from '@axe-core/playwright';
import { z } from 'zod';
import {
  RecoveryKitSchema,
  DaoRefSchema,
  ApiRoutes,
  daoPaymentKey,
  McpLocalConfigurationSchema,
} from '@daclify/core-protocol';
import { createVault, unlockVault } from '../../src/auth/vault';
for (const { reauthenticate, popup } of [
  { reauthenticate: false, popup: false },
  { reauthenticate: true, popup: false },
  { reauthenticate: false, popup: true },
]) {
  test(
    (reauthenticate ? 'renews' : 'approves') +
      ' a hosted connection with a paired email login while the vault stays locked' +
      (popup ? ' in a popup' : ''),
    async ({ page: initial }) => {
      let page = initial;
      const browserErrors: string[] = [];
      initial.context().on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') {
          const source = message.location().url;
          browserErrors.push(message.type() + ':' + (source ? new URL(source).pathname : 'none'));
        }
      });
      initial.context().on('weberror', (event) => browserErrors.push(event.error().name));
      const api = 'http://127.0.0.1:' + (process.env.DACLIFY_TEST_API_PORT ?? '3008'),
        origin = 'http://127.0.0.1:' + (process.env.DACLIFY_TEST_UI_PORT ?? '5178'),
        password = 'owned paired email MCP password',
        vault = await createVault(password),
        root = PrivateKey.from((await unlockVault(vault.localEnvelope, password)).signingKey),
        email = 'mcp-' + randomBytes(12).toString('hex') + '@example.com';
      // This native fixture has no billing provider; receipts are outside this consent journey.
      await initial
        .context()
        .route('**/v1/billing/receipts', (route) => route.fulfill({ json: { receipts: [] } }));
      const owner = z
        .object({ token: z.string() })
        .parse(
          JSON.parse(
            await readFile('../daclify-backend-core/.artifacts/native/browser-owner.json', 'utf8'),
          ),
        );
      const created = await page.request.post(api + '/fixture/dao', {
        headers: { 'x-fixture-token': owner.token, origin },
        data: { signingKey: vault.signingPublicKey, encryptionKey: vault.encryptionPublicKey },
      });
      expect(created.status(), await created.text()).toBe(200);
      const context = z
        .object({ dao: DaoRefSchema, memberId: z.string() })
        .parse(await created.json());
      const challengeResponse = await page.request.post(api + ApiRoutes.challenge.path, {
        headers: { origin },
        data: { signingKey: vault.signingPublicKey, encryptionKey: vault.encryptionPublicKey },
      });
      const challenge = ApiRoutes.challenge.response.parse(await challengeResponse.json());
      const login = await page.request.post(api + ApiRoutes.login.path, {
        headers: { origin },
        data: {
          challengeId: challenge.id,
          signature: root.signMessage(new TextEncoder().encode(challenge.message)).toString(),
          encryptionKey: vault.encryptionPublicKey,
        },
      });
      expect(login.status(), await login.text()).toBe(200);
      const session = ApiRoutes.login.response.parse(await login.json()),
        headers = { origin, 'x-csrf-token': session.csrfToken };
      const started = await page.request.post(api + '/v1/sign-in/email/start', {
        headers,
        data: { email },
      });
      expect(started.status(), await started.text()).toBe(200);
      const delivered = await page.request.post(api + '/fixture/email-code', {
        headers: { 'x-fixture-token': owner.token, origin },
        data: { email },
      });
      const confirmation = {
          email,
          code: z.object({ code: z.string() }).parse(await delivered.json()).code,
        },
        body = JSON.stringify(confirmation);
      const controlResponse = await page.request.post(api + '/v1/account/control', {
        headers,
        data: {
          path: '/v1/sign-in/email/confirm',
          bodyHash: createHash('sha256').update(body).digest('hex'),
        },
      });
      const control = z
        .object({ id: z.string(), message: z.string() })
        .parse(await controlResponse.json());
      const paired = await page.request.post(api + '/v1/sign-in/email/confirm', {
        headers: {
          ...headers,
          'content-type': 'application/json',
          'x-account-intent-id': control.id,
          'x-account-signature': root
            .signMessage(new TextEncoder().encode(control.message))
            .toString(),
        },
        data: body,
      });
      expect(paired.status(), await paired.text()).toBe(200);
      expect(
        (await page.request.post(api + '/v1/auth/logout', { headers, data: {} })).status(),
      ).toBe(204);
      const verifier = randomBytes(32).toString('base64url'),
        parameters = new URLSearchParams({
          response_type: 'code',
          client_id: 'browser-fixture',
          redirect_uri: 'https://client.example/callback',
          resource: api + '/mcp',
          scope: 'daclify:read daclify:prepare daclify:submit',
          state: 'owned-email-preview',
          code_challenge: createHash('sha256').update(verifier).digest('base64url'),
          code_challenge_method: 'S256',
        });
      const authorization = await page.request.get(api + '/mcp/oauth/authorize?' + parameters, {
        maxRedirects: 0,
      });
      expect(authorization.status()).toBe(302);
      const destination = new URL(z.url().parse(authorization.headers()['location']));
      if (popup) {
        await initial.route('https://client.example/connect', (route) =>
          route.fulfill({
            contentType: 'text/html',
            body:
              '<!doctype html><title>Owned OAuth client</title><button>Connect Daclify</button><p id="result"></p><script>document.querySelector("button").onclick=()=>window.open(' +
              JSON.stringify(destination.toString()) +
              ',"daclify-consent");addEventListener("message",event=>{if(event.origin===location.origin&&event.data==="connected")document.querySelector("#result").textContent="Connection completed";});</script>',
          }),
        );
        await initial.goto('https://client.example/connect');
        const opened = initial.waitForEvent('popup');
        await initial.getByRole('button', { name: 'Connect Daclify', exact: true }).click();
        page = await opened;
      }
      await page.goto(
        '/account?returnTo=' + encodeURIComponent(destination.pathname + destination.search),
      );
      const main = page.getByRole('main');
      await main.getByRole('button', { name: 'Login', exact: true }).click();
      await main.getByRole('button', { name: 'E-Mail', exact: true }).click();
      await main.getByLabel('Sign-in email', { exact: true }).fill(email);
      await main.getByRole('button', { name: 'Send code', exact: true }).click();
      await expect(main.getByLabel('Email code', { exact: true })).toBeVisible();
      const mailed = await page.request.post(api + '/fixture/email-code', {
        headers: { 'x-fixture-token': owner.token, origin },
        data: { email },
      });
      await main
        .getByLabel('Email code', { exact: true })
        .fill(z.object({ code: z.string() }).parse(await mailed.json()).code);
      await main.getByRole('button', { name: 'Sign in with email', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Connect a hosted AI harness' }),
      ).toBeVisible();
      await page
        .getByRole('combobox', { name: 'Community membership', exact: true })
        .selectOption({ label: 'DAO ' + context.dao.daoId + ', member ' + context.memberId });
      await expect(page.getByLabel('review', { exact: true })).toBeDisabled();
      await expect(page.getByLabel('review', { exact: true })).not.toBeChecked();
      await expect(page.getByText('Review preparation requires the reviewer role.')).toBeVisible();
      await page.getByLabel('vote', { exact: true }).check();
      const approve = page.getByRole('button', { name: 'Approve hosted connection', exact: true });
      await expect(approve).toBeEnabled();
      if (reauthenticate) {
        const expired = await page.request.post(api + '/fixture/expire-mcp-sign-in', {
          headers: { 'x-fixture-token': owner.token, origin },
          data: {},
        });
        expect(expired.status(), await expired.text()).toBe(200);
        await page.reload();
        await page
          .getByRole('combobox', { name: 'Community membership', exact: true })
          .selectOption({ label: 'DAO ' + context.dao.daoId + ', member ' + context.memberId });
        await page.getByLabel('vote', { exact: true }).check();
        await expect(approve).toBeDisabled();
        await page.getByRole('button', { name: 'Sign in again', exact: true }).click();
        await main.getByRole('button', { name: 'E-Mail', exact: true }).click();
        await main.getByLabel('Sign-in email', { exact: true }).fill(email);
        await main.getByRole('button', { name: 'Send code', exact: true }).click();
        await expect(main.getByLabel('Email code', { exact: true })).toBeVisible();
        const freshCode = await page.request.post(api + '/fixture/email-code', {
          headers: { 'x-fixture-token': owner.token, origin },
          data: { email },
        });
        await main
          .getByLabel('Email code', { exact: true })
          .fill(z.object({ code: z.string() }).parse(await freshCode.json()).code);
        await main.getByRole('button', { name: 'Sign in with email', exact: true }).click();
        await expect(approve).toBeEnabled();
        await expect(
          page.getByRole('combobox', { name: 'Community membership', exact: true }),
        ).toHaveValue(daoPaymentKey(context.dao) + ':' + context.memberId);
      }
      expect(await page.evaluate(() => localStorage.getItem('daclify.vault.v1'))).toBeNull();
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      await page.route('https://client.example/callback*', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: popup
            ? '<!doctype html><title>Owned OAuth callback</title><script>opener.postMessage("connected",location.origin);close();</script>'
            : 'Owned callback captured',
        }),
      );
      const approved = page.waitForRequest(
          (request) =>
            request.url().endsWith('/v1/mcp/oauth/approve') && request.method() === 'POST',
        ),
        callback = page.waitForRequest((request) =>
          request.url().startsWith('https://client.example/callback?'),
        );
      const closed = popup ? page.waitForEvent('close') : undefined;
      await approve.click();
      const request = await approved;
      expect(request.headers()['x-account-signature']).toBeUndefined();
      expect(JSON.parse(z.string().parse(request.headers()['x-account-proof']))).toEqual({
        kind: 'sign-in',
      });
      const redirected = new URL((await callback).url());
      expect(redirected.searchParams.get('state')).toBe('owned-email-preview');
      expect(redirected.searchParams.get('iss')).toBe(api + '/mcp/oauth');
      if (closed) {
        await closed;
        await expect(initial.getByText('Connection completed', { exact: true })).toBeVisible();
        expect(initial.url()).toBe('https://client.example/connect');
      }
      const exchange = {
        grant_type: 'authorization_code',
        client_id: 'browser-fixture',
        redirect_uri: 'https://client.example/callback',
        resource: api + '/mcp',
        code: z.string().parse(redirected.searchParams.get('code')),
        code_verifier: verifier,
      };
      const exchanged = await page.request.post(api + '/mcp/oauth/token', { form: exchange });
      expect(exchanged.status(), await exchanged.text()).toBe(200);
      expect(z.object({ scope: z.string() }).parse(await exchanged.json()).scope).toBe(
        'daclify:read daclify:prepare',
      );
      expect((await page.request.post(api + '/mcp/oauth/token', { form: exchange })).status()).toBe(
        400,
      );
      expect(browserErrors).toEqual([]);
    },
  );
}
test('downloads public setup and retires a real native connection', async ({ page }) => {
  test.setTimeout(120000);
  const api = 'http://127.0.0.1:' + (process.env.DACLIFY_TEST_API_PORT ?? '3008'),
    origin = 'http://127.0.0.1:' + (process.env.DACLIFY_TEST_UI_PORT ?? '5178'),
    password = 'owned MCP browser account password',
    vault = await createVault(password),
    kit = RecoveryKitSchema.parse({
      version: 1,
      localEnvelope: vault.localEnvelope,
      recoveryEnvelope: vault.recoveryEnvelope,
      signingPublicKey: vault.signingPublicKey,
      encryptionPublicKey: vault.encryptionPublicKey,
    });
  const { token } = z
    .strictObject({ token: z.string().regex(/^[a-f0-9]{64}$/) })
    .parse(
      JSON.parse(
        await readFile('../daclify-backend-core/.artifacts/native/browser-owner.json', 'utf8'),
      ),
    );
  const created = await page.request.post(api + '/fixture/dao', {
    headers: { 'x-fixture-token': token, origin },
    data: {
      signingKey: vault.signingPublicKey,
      encryptionKey: vault.encryptionPublicKey,
      admin: true,
    },
  });
  expect(created.status(), await created.text()).toBe(200);
  const context = z
    .strictObject({ dao: DaoRefSchema, memberId: z.string() })
    .parse(await created.json());
  const delegate = PrivateKey.generate('K1'),
    verifier = randomBytes(32).toString('base64url');
  const response = await page.request.post(api + ApiRoutes.mcpPair.path, {
    data: {
      ...context,
      scopes: ['vote'],
      delegatePublicKey: delegate.toPublic().toString(),
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  const pairing = ApiRoutes.mcpPair.response.parse(await response.json());
  await page.addInitScript(
    (record) => localStorage.setItem('daclify.vault.v1', JSON.stringify(record)),
    kit,
  );
  await page.goto('/account?returnTo=' + encodeURIComponent('/mcp/consent?request=' + pairing.id));
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Login', exact: true }).click();
  await main.getByLabel('Vault password', { exact: true }).fill(password);
  await main.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect an AI harness' })).toBeVisible();
  await expect(page.getByText(delegate.toPublic().toString(), { exact: true })).toBeVisible();
  await page
    .getByRole('radio', { name: 'Allow the harness to perform these scoped actions automatically' })
    .check();
  await page.getByRole('button', { name: 'Approve connection', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Connection approved');
  const redeemed = await page.request.post(
    api + ApiRoutes.mcpRedeem.path.replace(':id', pairing.id),
    { data: { codeVerifier: verifier } },
  );
  expect(redeemed.status(), await redeemed.text()).toBe(200);
  const result = ApiRoutes.mcpRedeem.response.parse(await redeemed.json());
  expect(result.grant.delegatePublicKey).toBe(delegate.toPublic().toString());
  expect(result.grant.mode).toBe('autonomous');
  expect(JSON.stringify(result)).not.toContain(
    (await unlockVault(vault.localEnvelope, password)).signingKey,
  );
  expect(JSON.stringify(result)).not.toContain(delegate.toString());
  const replay = await page.request.post(
    api + ApiRoutes.mcpRedeem.path.replace(':id', pairing.id),
    { data: { codeVerifier: verifier } },
  );
  expect(replay.status()).toBe(403);
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name: 'Mini apps', exact: true }).click();
  const setup = page.getByRole('region', { name: 'AI connection setup' });
  await setup.getByLabel('AI community membership').selectOption({
    label: 'DAO ' + context.dao.daoId + ', member ' + context.memberId,
  });
  const downloaded = page.waitForEvent('download');
  await setup.getByRole('button', { name: 'Download public MCP configuration' }).click();
  const file = await downloaded,
    path = await file.path();
  if (!path) throw Error('Owned configuration download missing');
  const text = await readFile(path, 'utf8'),
    configuration = McpLocalConfigurationSchema.parse(JSON.parse(text));
  expect(configuration).toMatchObject({
    dao: context.dao,
    memberId: context.memberId,
    scopes: ['vote'],
  });
  expect(text).not.toContain(delegate.toString());
  expect(text).not.toContain(result.token);
  const manifestResponse = await page.request.get(api + ApiRoutes.mcpRelease.path);
  expect(manifestResponse.status()).toBe(200);
  const manifest = ApiRoutes.mcpRelease.response.parse(await manifestResponse.json());
  for (const artifact of manifest.files) {
    const link = setup.getByRole('link', { name: 'Download ' + artifact.name, exact: true });
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    if (!href) throw Error('Archive URL missing');
    const response = await page.request.get(new URL(href, origin).toString());
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('immutable');
    const bytes = await response.body();
    expect(bytes.length).toBe(artifact.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
  }
  await expect(
    setup.getByText('session ' + result.grant.sessionId, { exact: false }),
  ).toBeVisible();
  await setup.getByRole('button', { name: 'Revoke service access', exact: true }).click();
  await expect(setup.getByText('Service access revoked.', { exact: false })).toBeVisible();
  const retired = page.waitForResponse(
    (response) => response.url().includes('/v1/relay') && response.request().method() === 'POST',
  );
  await setup.getByRole('button', { name: 'Retire native signing session' }).click();
  expect((await retired).status()).toBe(200);
  const governanceResponse = await page.request.get(
    api + ApiRoutes.governance.path.replace(':id', context.dao.daoId),
  );
  expect(governanceResponse.status()).toBe(200);
  const governance = ApiRoutes.governance.response.parse(await governanceResponse.json());
  expect(governance.sessions.some((session) => session.id === result.grant.sessionId)).toBe(false);

  const inventoryResponse = await page.request.get(api + ApiRoutes.mcpConnections.path);
  const inventory = ApiRoutes.mcpConnections.response.parse(await inventoryResponse.json());
  expect(inventory.local.find((item) => item.grant.id === result.grant.id)?.revoked).toBe(true);
});

test('approves read and preview without a companion when the client requests every OAuth scope', async ({
  page,
}) => {
  const api = 'http://127.0.0.1:' + (process.env.DACLIFY_TEST_API_PORT ?? '3008'),
    origin = 'http://127.0.0.1:' + (process.env.DACLIFY_TEST_UI_PORT ?? '5178'),
    password = 'owned hosted preview password',
    vault = await createVault(password);
  const kit = RecoveryKitSchema.parse({
    version: 1,
    localEnvelope: vault.localEnvelope,
    recoveryEnvelope: vault.recoveryEnvelope,
    signingPublicKey: vault.signingPublicKey,
    encryptionPublicKey: vault.encryptionPublicKey,
  });
  const owner = z
    .object({ token: z.string() })
    .parse(
      JSON.parse(
        await readFile('../daclify-backend-core/.artifacts/native/browser-owner.json', 'utf8'),
      ),
    );
  const created = await page.request.post(api + '/fixture/dao', {
    headers: { 'x-fixture-token': owner.token, origin },
    data: {
      signingKey: vault.signingPublicKey,
      encryptionKey: vault.encryptionPublicKey,
      admin: true,
    },
  });
  expect(created.status()).toBe(200);
  const context = z.object({ dao: DaoRefSchema, memberId: z.string() }).parse(await created.json());
  const verifier = randomBytes(32).toString('base64url');
  const parameters = new URLSearchParams({
    response_type: 'code',
    client_id: 'browser-fixture',
    redirect_uri: 'https://client.example/callback',
    resource: api + '/mcp',
    scope: 'daclify:read daclify:prepare daclify:submit',
    state: 'owned-preview',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  });
  const authorization = await page.request.get(api + '/mcp/oauth/authorize?' + parameters, {
    maxRedirects: 0,
  });
  expect(authorization.status()).toBe(302);
  const consentUrl = z.url().parse(authorization.headers()['location']);
  await page.addInitScript(
    (record) => localStorage.setItem('daclify.vault.v1', JSON.stringify(record)),
    kit,
  );
  await page.goto(
    '/account?returnTo=' +
      encodeURIComponent(new URL(consentUrl).pathname + new URL(consentUrl).search),
  );
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Login', exact: true }).click();
  await main.getByLabel('Vault password', { exact: true }).fill(password);
  await main.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect a hosted AI harness' })).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Community membership', exact: true })
    .selectOption({ label: 'DAO ' + context.dao.daoId + ', member ' + context.memberId });
  await page.getByLabel('vote', { exact: true }).check();
  const permissions = page.getByRole('region', { name: 'Hosted connection permissions' });
  const bounds = await permissions.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.width).toBeLessThanOrEqual(560);
  for (const checkbox of await permissions.getByRole('checkbox').all()) {
    const bounds = await checkbox.boundingBox();
    expect(bounds?.width).toBeLessThanOrEqual(24);
    expect(bounds?.height).toBeLessThanOrEqual(24);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  await permissions.locator('..').screenshot({
    path: '.artifacts/browser/compact-consent-' + test.info().project.name + '.png',
  });
  const approve = page.getByRole('button', { name: 'Approve hosted connection', exact: true });
  await expect(approve).toBeEnabled();
  await expect(
    page.getByText('This connection will receive read and preview access only.', { exact: false }),
  ).toBeVisible();
  await page.route('https://client.example/callback*', (route) =>
    route.fulfill({ body: 'Owned callback captured' }),
  );
  const callback = page.waitForRequest((request) =>
    request.url().startsWith('https://client.example/callback?'),
  );
  await approve.click();
  const redirected = new URL((await callback).url());
  expect(redirected.searchParams.get('state')).toBe('owned-preview');
  expect(redirected.searchParams.get('iss')).toBe(api + '/mcp/oauth');
  const code = z.string().min(1).parse(redirected.searchParams.get('code'));
  const exchanged = await page.request.post(api + '/mcp/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      client_id: 'browser-fixture',
      redirect_uri: 'https://client.example/callback',
      resource: api + '/mcp',
      code,
      code_verifier: verifier,
    },
  });
  expect(exchanged.status()).toBe(200);
  const token = z
    .object({ access_token: z.string(), scope: z.string() })
    .parse(await exchanged.json());
  expect(token.scope.split(' ')).toEqual(['daclify:read', 'daclify:prepare']);
  const replay = await page.request.post(api + '/mcp/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      client_id: 'browser-fixture',
      redirect_uri: 'https://client.example/callback',
      resource: api + '/mcp',
      code,
      code_verifier: verifier,
    },
  });
  expect(replay.status()).toBe(400);
});
