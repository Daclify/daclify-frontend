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
