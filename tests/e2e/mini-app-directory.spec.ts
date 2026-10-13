import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { RecoveryKitSchema, ApiRoutes, MiniAppOriginProofSchema } from '@daclify/core-protocol';
import { createVault } from '../../src/auth/vault';
test('publishes an owned origin, escapes its text, and moderates through actual governing DAO membership', async ({
  page,
}) => {
  test.setTimeout(120000);
  const api = 'http://127.0.0.1:' + (process.env.DACLIFY_TEST_API_PORT ?? '3008'),
    origin = 'http://127.0.0.1:' + (process.env.DACLIFY_TEST_UI_PORT ?? '5178');
  const vault = await createVault('Owned directory browser password'),
    kit = RecoveryKitSchema.parse({
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
      platform: true,
    },
  });
  expect(created.status(), await created.text()).toBe(200);
  await page.addInitScript(
    (record) => localStorage.setItem('daclify.vault.v1', JSON.stringify(record)),
    kit,
  );
  await page.goto('/account?returnTo=' + encodeURIComponent('/mini-apps#discover'));
  await page.getByRole('main').getByRole('button', { name: 'Login', exact: true }).click();
  await page.getByLabel('Vault password', { exact: true }).fill('Owned directory browser password');
  await page.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  const region = page.getByRole('region', { name: 'Community app directory' }),
    form = region.getByRole('form', { name: 'Maintain app listing' });
  await region.getByText('Manage listings', { exact: true }).click();
  await region.getByRole('button', { name: 'List an app', exact: true }).click();
  await form
    .getByLabel('App HTTPS origin', { exact: true })
    .fill('https://browser-' + vault.signingPublicKey.slice(-10).toLowerCase() + '.example');
  const title = '<img src=x onerror=alert(1)>';
  await form.getByLabel('App title', { exact: true }).fill(title);
  await form.getByLabel('App description', { exact: true }).fill('Owned app directory fixture');
  await form.getByRole('button', { name: 'Save listing', exact: true }).click();
  await expect(region.getByRole('status')).toContainText('Listing saved');
  await form.getByRole('button', { name: 'Request origin verification' }).click();
  const proofText = await form.locator('pre').textContent();
  if (!proofText) throw Error('Challenge JSON missing');
  const proof = MiniAppOriginProofSchema.parse(JSON.parse(proofText));
  expect(
    (
      await page.request.post(api + '/fixture/directory-proof', {
        headers: { 'x-fixture-token': owner.token, origin },
        data: proof,
      })
    ).status(),
  ).toBe(200);
  await form.getByRole('button', { name: 'Complete origin verification' }).click();
  await expect(region.getByRole('status')).toContainText('Listing published');
  await expect(region.getByRole('heading', { name: title, exact: true })).toBeVisible();
  expect(await region.locator('img').count()).toBe(0);
  const card = region
    .locator('.app-card')
    .filter({ has: region.getByRole('heading', { name: title, exact: true }) });
  await card.getByText('App details', { exact: true }).click();
  await card.getByRole('button', { name: 'Report this listing' }).click();
  await region.getByLabel('Report reason', { exact: true }).fill('Broken callback');
  await region.getByRole('button', { name: 'Send report' }).click();
  await expect(region.getByRole('status')).toContainText('Report received');
  const moderation = region.getByRole('region', { name: 'Directory moderation' });
  await region
    .locator('summary')
    .filter({ hasText: /^Directory moderation$/ })
    .click();
  await expect(moderation).toBeVisible();
  await moderation.getByRole('button', { name: 'Review reports' }).click();
  await expect(moderation).toContainText('Broken callback');
  await moderation.getByRole('button', { name: 'Hide listing', exact: true }).click();
  await expect(region.getByRole('status')).toContainText('Moderation saved');
  await page.getByRole('button', { name: 'Lock keys', exact: true }).click();
  const published = await page.request.get(api + ApiRoutes.miniAppDirectory.path);
  expect(published.status()).toBe(200);
  expect(
    ApiRoutes.miniAppDirectory.response
      .parse(await published.json())
      .listings.some((listing) => listing.id === proof.listingId),
  ).toBe(false);
  await page.request.post(api + ApiRoutes.logout.path, {
    headers: {
      origin,
      'x-csrf-token': await page.evaluate(() => sessionStorage.getItem('daclify.csrf') ?? ''),
    },
    data: {},
  });
  await page.goto('/mini-apps#discover');
  await expect(page.getByRole('region', { name: 'Community app directory' })).toContainText(
    'Maintainer verified means HTTPS origin control',
  );
});
