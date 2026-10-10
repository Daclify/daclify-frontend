import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createVault } from '../../src/auth/vault';
import { PrivateKey } from '@wharfkit/antelope';
import {
  NetworkSchema,
  RecoveryContextSchema,
  RecoveryMethodsSchema,
  RecoveryClaimSchema,
  VERSION,
  recoveryVaultDomain,
} from '@daclify/core-protocol';
import {
  createRecoveryRecipient,
  createRecoveryPayload,
  sealRecoveryDelivery,
} from '@daclify/core-protocol/sdk';
async function fixture(page: Page) {
  const signing = PrivateKey.generate('K1'),
    encryption = await createRecoveryRecipient();
  const account = {
    id: crypto.randomUUID(),
    custody: 'user-controlled' as const,
    signingKey: signing.toPublic().toString(),
    encryptionKey: encryption.publicKey,
  };
  let authenticated = false,
    context: ReturnType<typeof RecoveryContextSchema.parse> | undefined,
    key: Uint8Array | undefined,
    envelope: Awaited<ReturnType<typeof createRecoveryPayload>>['envelope'] | undefined;
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/network')
      return route.fulfill({
        json: NetworkSchema.parse({
          chainId: 'ab'.repeat(32),
          rpcUrl: 'https://rpc.example.test',
          runtime: 'daclifycore',
          hub: null,
          environment: 'testnet',
          interfaceVersion: 1,
          coreVersion: VERSION,
          capabilities: [],
        }),
      });
    if (path === '/v1/daos') return route.fulfill({ json: { daos: [], next: null } });
    if (path === '/v1/me')
      return route.fulfill(
        authenticated
          ? { json: { account } }
          : { status: 401, json: { code: 'AUTH_REQUIRED', message: 'Sign in' } },
      );
    if (path === '/v1/me/memberships') return route.fulfill({ json: { memberships: [] } });
    if (path === '/v1/sign-in/options')
      return route.fulfill({
        json: {
          telegram: { configured: false, username: null, oidc: false, miniApp: false },
          email: { delivery: 'mail' },
          passkey: { rpId: '127.0.0.1' },
        },
      });
    if (path === '/v1/sign-in/email/login/start')
      return route.fulfill({ json: { delivery: 'sent' } });
    if (path === '/v1/sign-in/email/login') {
      authenticated = true;
      context = RecoveryContextSchema.parse({
        version: 1,
        id: crypto.randomUUID(),
        accountId: account.id,
        origin: new URL(page.url()).origin,
        credentialKey: 'email:alice@example.test',
        mode: 'daclify-assisted',
        signingPublicKey: account.signingKey,
        encryptionPublicKey: account.encryptionKey,
        salt: Buffer.alloc(32, 1).toString('base64'),
      });
      const payload = await createRecoveryPayload(
        { signingKey: signing.toString(), encryptionPrivateKey: encryption.privateKey },
        context,
      );
      key = payload.key;
      envelope = payload.envelope;
      return route.fulfill({
        headers: { 'x-daclify-recovery-grant': 'g'.repeat(43) },
        json: { account, csrfToken: 'c'.repeat(43) },
      });
    }
    if (path === '/v1/account/recovery/claim') {
      const input = RecoveryClaimSchema.parse(route.request().postDataJSON());
      if (!context || !key || !envelope) throw new Error('Missing encrypted browser fixture');
      expect(input.grant).toBe('g'.repeat(43));
      return route.fulfill({
        json: {
          backup: { context, envelope, keyWrap: { kind: 'service', ciphertext: 'vault:v1:YWJj' } },
          keyGrant: await sealRecoveryDelivery(
            key,
            input.recipient,
            'claim:' + recoveryVaultDomain(context),
          ),
        },
      });
    }
    if (path === '/v1/account/recovery')
      return route.fulfill({
        json: RecoveryMethodsSchema.parse({
          methods: [
            {
              credentialKey: 'email:alice@example.test',
              kind: 'email',
              subject: 'alice@example.test',
              chainId: null,
              mode: 'daclify-assisted',
              availableModes: ['daclify-assisted'],
              reason: null,
            },
          ],
          assistedEver: true,
          configured: true,
          reason: null,
        }),
      });
    if (path === '/v1/sign-in/methods')
      return route.fulfill({
        status: 503,
        json: { code: 'SERVICE_UNAVAILABLE', message: 'Fixture' },
      });
    return route.fulfill({
      status: 503,
      json: { code: 'SERVICE_UNAVAILABLE', message: 'Fixture' },
    });
  });
  return account;
}
test('gets full account access on a fresh device using the selected paired email', async ({
  page,
}) => {
  const account = await fixture(page);
  await page.goto('/account');
  await page.getByRole('button', { name: /^Email/ }).click();
  await page.getByLabel('Sign-in email', { exact: true }).fill('alice@example.test');
  await page.getByRole('button', { name: /Send.*code/ }).click();
  await page.getByLabel('Email code', { exact: true }).fill('12345678');
  await page.getByRole('button', { name: 'Sign in with email', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible();
  await expect(page.getByText(account.id, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Vault password', { exact: true })).toBeHidden();
  await page.getByRole('tab', { name: 'Sign-in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fast sign-in with full access' })).toBeVisible();
  await expect(
    page.getByText('Daclify keeps a spare unlocking key.', { exact: false }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('daclify.vault.v1'))).toBeNull();
});

test('preserves another account’s local kit and does not offer it as the recovered account’s backup', async ({
  page,
}) => {
  const other = await createVault('disposable different account password');
  const record = {
    version: 1,
    localEnvelope: other.localEnvelope,
    recoveryEnvelope: other.recoveryEnvelope,
    signingPublicKey: other.signingPublicKey,
    encryptionPublicKey: other.encryptionPublicKey,
  };
  await page.addInitScript(
    (value) => localStorage.setItem('daclify.vault.v1', JSON.stringify(value)),
    record,
  );
  const account = await fixture(page);
  await page.goto('/account');
  await page.getByRole('button', { name: /^Email/ }).click();
  await page.getByLabel('Sign-in email', { exact: true }).fill('alice@example.test');
  await page.getByRole('button', { name: /Send.*code/ }).click();
  await page.getByLabel('Email code', { exact: true }).fill('12345678');
  await page.getByRole('button', { name: 'Sign in with email', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible();
  await expect(page.getByText(account.id, { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Download encrypted backup', exact: true }),
  ).toBeHidden();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('daclify.vault.v1') ?? 'null').signingPublicKey,
    ),
  ).toBe(other.signingPublicKey);
  await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
  await expect(page.getByLabel('Vault password', { exact: true })).toBeHidden();
});
