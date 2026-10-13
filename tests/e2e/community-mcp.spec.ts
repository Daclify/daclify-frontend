import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { PrivateKey } from '@wharfkit/antelope';
import { z } from 'zod';
import {
  RecoveryKitSchema,
  DaoRefSchema,
  ApiRoutes,
  McpLocalConfigurationSchema,
} from '@daclify/core-protocol';
import { createVault, unlockVault } from '../../src/auth/vault';
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
