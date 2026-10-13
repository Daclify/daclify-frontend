import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { PrivateKey } from '@wharfkit/antelope';
import { z } from 'zod';
import { RecoveryKitSchema, DaoRefSchema, ApiRoutes } from '@daclify/core-protocol';
import { createVault, unlockVault } from '../../src/auth/vault';
test('approves a real native delegate through the trusted browser and redeems it once', async ({
  page,
}) => {
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
});

test('approves hosted read and preview consent with genuine account proof and PKCE', async ({
  page,
}) => {
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
  const verifier = randomBytes(32).toString('base64url');
  const authorize = new URL(api + '/mcp/oauth/authorize');
  for (const [key, value] of Object.entries({
    response_type: 'code',
    client_id: 'browser-fixture',
    redirect_uri: 'https://client.example/callback',
    resource: api + '/mcp',
    scope: 'daclify:read daclify:prepare',
    state: 'browser-state',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }))
    authorize.searchParams.set(key, value);
  const started = await page.request.get(authorize.toString(), { maxRedirects: 0 });
  expect(started.status()).toBe(302);
  const target = new URL(started.headers().location ?? '');
  await page.addInitScript(
    (record) => localStorage.setItem('daclify.vault.v1', JSON.stringify(record)),
    kit,
  );
  await page.goto('/account?returnTo=' + encodeURIComponent(target.pathname + target.search));
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Login', exact: true }).click();
  await main.getByLabel('Vault password', { exact: true }).fill(password);
  await main.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect a hosted AI harness' })).toBeVisible();
  await page
    .getByLabel('Community membership')
    .selectOption({ label: 'DAO ' + context.dao.daoId + ', member ' + context.memberId });
  await page.getByLabel('vote', { exact: true }).check();
  let callback = '';
  await page.route('https://client.example/callback**', async (route) => {
    callback = route.request().url();
    await route.fulfill({ status: 200, body: 'Owned test callback' });
  });
  await page.getByRole('button', { name: 'Approve hosted connection', exact: true }).click();
  await expect.poll(() => callback).toContain('code=');
  const returned = new URL(callback);
  expect(returned.searchParams.get('state')).toBe('browser-state');
  expect(returned.searchParams.get('iss')).toBe(api + '/mcp/oauth');
  const tokens = await page.request.post(api + '/mcp/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      client_id: 'browser-fixture',
      redirect_uri: 'https://client.example/callback',
      resource: api + '/mcp',
      code: returned.searchParams.get('code') ?? '',
      code_verifier: verifier,
    },
  });
  expect(tokens.status(), await tokens.text()).toBe(200);
  const value = z
    .object({ access_token: z.string(), expires_in: z.number() })
    .parse(await tokens.json());
  expect(value.expires_in).toBeLessThanOrEqual(300);
  const read = await page.request.post(api + '/mcp', {
    headers: {
      authorization: 'Bearer ' + value.access_token,
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
    },
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_membership', arguments: {} },
    },
  });
  expect(read.status(), await read.text()).toBe(200);
  expect(await read.text()).not.toContain(
    (await unlockVault(vault.localEnvelope, password)).signingKey,
  );
});
