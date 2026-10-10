// Consumes only the testnet producer's disposable private fixture; deletes it after use.
import assert from 'node:assert/strict';
import { readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { AccountSchema, RecoveryKitSchema } from '@daclify/core-protocol';
const fixturePath = resolve(
  '../daclify-backend-core/.superpowers/sdd/2026-10-10-passwordless-devices-and-vault-recovery/public-device-fixture.json',
);
const metadata = await stat(fixturePath);
assert.equal(metadata.mode & 0o077, 0);
assert.ok(metadata.size < 65536);
const fixture = z
  .strictObject({
    version: z.literal(1),
    api: z.literal('https://testnet.api.daclify.com'),
    origin: z.literal('https://testnet.app.daclify.com'),
    account: AccountSchema,
    password: z.string().min(12),
    kit: RecoveryKitSchema,
    receivingCookies: z.array(z.strictObject({ name: z.string(), value: z.string() })).max(8),
    csrf: z.string().min(32),
  })
  .parse(JSON.parse(await readFile(fixturePath, 'utf8')));
const browser = await chromium.launch({ headless: true });
const source = await browser.newContext(),
  receiving = await browser.newContext();
const errors = [];
try {
  await source.addInitScript(
    (kit) => localStorage.setItem('daclify.vault.v1', JSON.stringify(kit)),
    fixture.kit,
  );
  await receiving.addCookies(
    fixture.receivingCookies.map((cookie) => ({
      ...cookie,
      url: fixture.api,
      secure: true,
      httpOnly: true,
      sameSite: 'None',
    })),
  );
  await receiving.addInitScript(
    (token) => sessionStorage.setItem('daclify.csrf.testnet', token),
    fixture.csrf,
  );
  const old = await source.newPage(),
    fresh = await receiving.newPage();
  for (const page of [old, fresh]) page.on('pageerror', (error) => errors.push(error.message));
  await old.goto(fixture.origin + '/account');
  await fresh.goto(fixture.origin + '/account');
  await old.getByLabel('Vault password', { exact: true }).fill(fixture.password);
  await old.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(old.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(fresh.getByText(fixture.account.id, { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(fresh.getByLabel('Vault password', { exact: true })).toBeHidden();
  await fresh
    .getByRole('button', { name: 'Request approval from another device', exact: true })
    .click();
  const link = await fresh.getByLabel('Approval link', { exact: true }).inputValue();
  assert.match(link, /deviceApproval=[0-9a-f-]{36}$/);
  await old.getByLabel('Approval link or request ID', { exact: true }).fill(link);
  await old.getByRole('button', { name: 'Review device request', exact: true }).click();
  await expect(old.getByLabel('Approval verification code', { exact: true })).toBeVisible();
  assert.equal(
    await old.getByLabel('Approval verification code', { exact: true }).innerText(),
    await fresh.getByLabel('Device verification code', { exact: true }).innerText(),
  );
  await old
    .getByLabel('The verification codes match and I recognize this device.', { exact: true })
    .check();
  await old.getByRole('button', { name: 'Approve this device', exact: true }).click();
  await expect(fresh.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible({
    timeout: 30000,
  });
  assert.equal(await fresh.evaluate(() => localStorage.getItem('daclify.vault.v1')), null);
  await fresh.getByText('Public join identity', { exact: true }).click();
  const identity = JSON.parse(
    await fresh.getByLabel('Public join identity JSON', { exact: true }).inputValue(),
  );
  assert.equal(identity.signingKey, fixture.kit.signingPublicKey);
  assert.deepEqual(identity.encryptionKey, fixture.kit.encryptionPublicKey);
  const scan = await new AxeBuilder({ page: fresh }).include('#main').analyze();
  assert.deepEqual(scan.violations, []);
  assert.deepEqual(errors, []);
  await fresh.getByRole('tab', { name: 'Sign-in', exact: true }).click();
  await expect(
    fresh.getByRole('heading', { name: 'Fast sign-in with full access', exact: true }),
  ).toBeVisible();
  await expect(
    fresh.getByText('Fast sign-in backups are not available on this service yet.', {
      exact: true,
    }),
  ).toBeVisible();
  const report = {
    status: 'passed',
    kind: 'public-testnet-device-transfer',
    checkedAt: new Date().toISOString(),
    origin: fixture.origin,
    api: fixture.api,
    realHttp: true,
    realBrowser: true,
    realProofVerification: true,
    originalIdentity: true,
    passwordOrJsonOnReceivingDevice: false,
    plaintextKeysStored: false,
    hostedRecoveryConfigured: false,
    axeViolations: scan.violations.length,
    consoleErrors: errors.length,
    walletHardwareQualified: false,
  };
  await writeFile(
    'docs/evidence/2026-10-10-passwordless-public.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report));
} catch {
  process.exitCode = 1;
  console.error(
    'PUBLIC_PASSWORDLESS_BROWSER_FAILED: inspect the testnet interface without logging the private fixture.',
  );
} finally {
  for (const context of [source, receiving]) {
    for (const page of context.pages())
      try {
        await page.evaluate(async (api) => {
          const token = sessionStorage.getItem('daclify.csrf.testnet');
          if (token)
            await fetch(api + '/v1/auth/logout', {
              method: 'POST',
              credentials: 'include',
              headers: { 'content-type': 'application/json', 'x-csrf-token': token },
              body: '{}',
            });
        }, fixture.api);
      } catch {}
  }
  await source.close();
  await receiving.close();
  await browser.close();
  await unlink(fixturePath);
}
