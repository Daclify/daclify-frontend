import { expect, test, type Page } from '@playwright/test';
import { PrivateKey, PublicKey, Signature } from '@wharfkit/antelope';
import {
  ApiRoutes,
  VaultAttachMessageSchema,
  AccountControlMessageSchema,
  AccountControlRequestSchema,
  AccountControlProofSchema,
  AccountReconnectMessageSchema,
  LoginMessageSchema,
  RecoveryKitSchema,
  type Account,
} from '@daclify/core-protocol';
import { createVault } from '../../src/auth/vault';
const id = 'ea8725ba-243d-4dd4-8455-c9f6da55cbfe',
  chainId = 'ab'.repeat(32);
const address = '0x1111111111111111111111111111111111111111';
async function fixture(page: Page, registered = false) {
  let account: Account = { id, custody: 'user-controlled', signingKey: null, encryptionKey: null };
  const original = registered ? await createVault('original fixture vault password') : undefined;
  const restoredId = '89590c11-9a6c-4a88-9435-2d11c0343052';
  let message = '',
    intentId = '';
  const sourceKey = PrivateKey.generate('K1').toPublic().toString();
  await page.addInitScript(() => {
    const provider = {
      request(args: { method: string }) {
        if (args.method === 'eth_chainId') return Promise.resolve('0x29');
        if (args.method === 'eth_requestAccounts' || args.method === 'eth_accounts')
          return Promise.resolve(['0x1111111111111111111111111111111111111111']);
        if (args.method === 'personal_sign')
          return Promise.resolve('0x' + '11'.repeat(32) + '22'.repeat(32) + '1b');
        return Promise.resolve(null);
      },
    };
    Object.defineProperty(window, 'ethereum', { value: provider, configurable: true });
  });
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/network')
      return route.fulfill({
        json: {
          chainId,
          rpcUrl: 'https://rpc.example',
          runtime: 'daclifycore',
          hub: null,
          environment: 'testnet',
          interfaceVersion: 1,
          coreVersion: '0.6.0-alpha.1',
          capabilities: ['native-linked', 'evm-eoa-governance'],
        },
      });
    if (path === '/v1/daos') return route.fulfill({ json: { daos: [] } });
    if (path === '/v1/sign-in/session') return route.fulfill({ json: { account } });
    if (path === '/v1/me/memberships')
      return route.fulfill({
        json: {
          memberships: [
            {
              dao: { chainId, contract: 'daclifycore', daoId: '1', interfaceVersion: 1 },
              memberId: '1',
              nonce: '3',
              active: true,
              admin: true,
              reviewer: false,
              credits: '42',
              claim: '0',
              stake: '0',
              nativeAccount: '',
              custody: 'user-controlled',
              signingKey: sourceKey,
            },
          ],
        },
      });
    if (path === '/v1/account/evm')
      return route.fulfill({ json: { links: [{ chainId: 41, address, controlVerified: true }] } });
    if (path === '/v1/account/vault/challenge') {
      const input = ApiRoutes.vaultAttachChallenge.input.parse(route.request().postDataJSON());
      intentId = crypto.randomUUID();
      const expires = new Date(Date.now() + 300000).toISOString();
      message = JSON.stringify(
        VaultAttachMessageSchema.parse({
          ...input,
          domain: 'daclify.vault-attach.v2',
          origin: new URL(page.url()).origin,
          audience: new URL(route.request().url()).origin,
          accountId: id,
          id: intentId,
          expires,
        }),
      );
      return route.fulfill({ json: { id: intentId, message, expires } });
    }
    if (path === '/v1/account/control') {
      const input = AccountControlRequestSchema.parse(route.request().postDataJSON());
      const challengeId = crypto.randomUUID(),
        expires = new Date(Date.now() + 300000).toISOString();
      return route.fulfill({
        json: {
          id: challengeId,
          expires,
          message: JSON.stringify(
            AccountControlMessageSchema.parse({
              ...input,
              domain: 'daclify.account-control.v2',
              origin: new URL(page.url()).origin,
              audience: new URL(route.request().url()).origin,
              accountId: id,
              signingKey: null,
              challengeId,
              expires,
            }),
          ),
        },
      });
    }
    if (path === '/v1/account/vault') {
      const input = ApiRoutes.vaultAttach.input.parse(route.request().postDataJSON()),
        identity = VaultAttachMessageSchema.parse(JSON.parse(message));
      expect(input.id).toBe(intentId);
      expect(
        Signature.from(input.signature).verifyMessage(
          new TextEncoder().encode(message),
          PublicKey.from(identity.signingKey),
        ),
      ).toBe(true);
      const proof = AccountControlProofSchema.parse(
        JSON.parse(route.request().headers()['x-account-proof'] ?? '{}'),
      );
      expect(proof.kind).toBe('evm');
      if (proof.kind !== 'evm') throw new Error('Fixture requires EVM account control');
      expect(proof.chainId).toBe(41);
      expect(proof.address.toLowerCase()).toBe(address);
      if (registered)
        return route.fulfill({
          status: 409,
          json: { code: 'VAULT_ALREADY_REGISTERED', message: 'Registered account' },
        });
      account = {
        id,
        custody: 'user-controlled',
        signingKey: identity.signingKey,
        encryptionKey: identity.encryptionKey,
      };
      return route.fulfill({ json: { account, csrfToken: 'c'.repeat(43) } });
    }
    if (path === '/v1/account/reconnect/challenge' || path === '/v1/auth/challenge') {
      const input = ApiRoutes.challenge.input.parse(route.request().postDataJSON());
      if (!original) throw new Error('Missing registered fixture');
      expect(input.signingKey).toBe(original.signingPublicKey);
      expect(input.encryptionKey).toEqual(original.encryptionPublicKey);
      intentId = crypto.randomUUID();
      const expires = new Date(Date.now() + 300000).toISOString();
      message = JSON.stringify(
        path === '/v1/auth/challenge'
          ? LoginMessageSchema.parse({
              ...input,
              domain: 'daclify.login.v3',
              origin: new URL(page.url()).origin,
              audience: new URL(route.request().url()).origin,
              challenge: intentId,
              expires,
            })
          : AccountReconnectMessageSchema.parse({
              ...input,
              domain: 'daclify.account-reconnect.v1',
              origin: new URL(page.url()).origin,
              audience: new URL(route.request().url()).origin,
              accountId: id,
              targetAccountId: restoredId,
              id: intentId,
              expires,
            }),
      );
      return route.fulfill({ json: { id: intentId, message, expires } });
    }
    if (path === '/v1/account/reconnect' || path === '/v1/auth/login') {
      if (!original) throw new Error('Missing registered fixture');
      const input =
        path === '/v1/auth/login'
          ? ApiRoutes.login.input.parse(route.request().postDataJSON())
          : ApiRoutes.vaultAttach.input.parse(route.request().postDataJSON());
      expect(
        Signature.from(input.signature).verifyMessage(
          new TextEncoder().encode(message),
          PublicKey.from(original.signingPublicKey),
        ),
      ).toBe(true);
      if (path === '/v1/account/reconnect') {
        const proof = AccountControlProofSchema.parse(
          JSON.parse(route.request().headers()['x-account-proof'] ?? '{}'),
        );
        expect(proof.kind).toBe('evm');
        expect(AccountReconnectMessageSchema.parse(JSON.parse(message)).targetAccountId).toBe(
          restoredId,
        );
      }
      account = {
        id: restoredId,
        custody: 'user-controlled',
        signingKey: original.signingPublicKey,
        encryptionKey: original.encryptionPublicKey,
      };
      return route.fulfill({ json: { account, csrfToken: 'd'.repeat(43) } });
    }
    return route.fulfill({
      status: 503,
      json: { code: 'STRIPE_NOT_CONFIGURED', message: 'Fixture provider unavailable' },
    });
  });
  await page.addInitScript(() => sessionStorage.setItem('daclify.csrf', 'c'.repeat(43)));
  return { original, restoredId };
}
test('shows wallet-only recovery honestly and gates paid DAO creation before checkout', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'This device' })).toBeVisible();
  await expect(
    page.getByText(
      /document-decryption keys and lost social-login pairings have not been restored/,
    ),
  ).toBeVisible();
  await expect(page.getByText('Signing public key', { exact: true })).toHaveCount(0);
  await page.getByText('Account details', { exact: true }).click();
  await expect(page.getByText(id, { exact: true })).toBeVisible();
  await page.goto('/create');
  await expect(page.getByRole('heading', { name: 'Enable full access' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recover from an encrypted kit' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

for (const keepSignIns of [true, false]) {
  test(`restores an already registered account ${keepSignIns ? 'with explicitly reconnected sign-ins' : 'without signing out first'}`, async ({
    page,
  }) => {
    const { original, restoredId } = await fixture(page, true);
    if (!original) throw new Error('Missing fixture kit');
    await page.goto('/account');
    await page.getByRole('tab', { name: 'Sign-in methods', exact: true }).click();
    await page.locator('summary').filter({ hasText: 'Telos EVM' }).click();
    await page.getByRole('button', { name: 'Use paired EVM wallet for account control' }).click();
    await page.getByRole('tab', { name: 'Access & recovery', exact: true }).click();
    await page.getByRole('button', { name: 'Recover from an encrypted kit' }).click();
    const recovery = page.getByRole('dialog', { name: 'Restore your existing keys', exact: true });
    const kit = RecoveryKitSchema.parse({
      version: 1,
      localEnvelope: original.localEnvelope,
      recoveryEnvelope: original.recoveryEnvelope,
      signingPublicKey: original.signingPublicKey,
      encryptionPublicKey: original.encryptionPublicKey,
    });
    await recovery.getByLabel('Encrypted recovery kit').setInputFiles({
      name: 'account-kit.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(kit)),
    });
    await recovery.getByLabel('Vault password or recovery code').fill(original.recoveryCredential);
    await recovery
      .getByLabel('New vault password', { exact: true })
      .fill('restored fixture password');
    await recovery.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Your original account was found' }),
    ).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page
      .getByRole('button', {
        name: keepSignIns ? 'Restore account and keep my sign-ins' : 'Restore account only',
        exact: true,
      })
      .click();
    await expect(page.getByText('Keys unlocked', { exact: true })).toBeVisible();
    await page.getByText('Public join identity', { exact: true }).click();
    await expect(page.getByText(restoredId, { exact: true })).toBeVisible();
    const storage = await page.evaluate(() => localStorage.getItem('daclify.vault.v1'));
    expect(storage).not.toContain('PVT_K1_');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
test('attaches a proved new vault to the recovered profile with a separate wallet approval', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/account');
  await page.getByRole('tab', { name: 'Sign-in methods', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Telos EVM' }).click();
  await page.getByRole('button', { name: 'Use paired EVM wallet for account control' }).click();
  await expect(
    page.getByText('Paired EVM wallet selected for account-control proofs.'),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Access & recovery', exact: true }).click();
  await page.getByText('Create Daclify keys for a new DAO', { exact: true }).click();
  await page.getByLabel('New vault password', { exact: true }).fill('fixture-vault-password-2026');
  await page.getByRole('button', { name: 'Create encrypted vault', exact: true }).click();
  await page.getByLabel('I have saved my recovery kit and credential').check();
  await page.getByRole('button', { name: 'Finish account setup' }).click();
  await expect(page.getByRole('heading', { name: 'This device', exact: true })).toBeVisible();
  await page.getByText('Public join identity', { exact: true }).click();
  await expect(page.getByText(id, { exact: true })).toBeVisible();
  await expect(page.getByText('Keys unlocked', { exact: true })).toBeVisible();
  const raw = await page.evaluate(() => localStorage.getItem('daclify.vault.v1'));
  expect(raw).not.toContain('PVT_K1_');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('enables full access inside Create and keeps the original setup route', async ({ page }) => {
  await fixture(page);
  await page.goto('/account');
  await page.getByRole('tab', { name: 'Sign-in methods', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Telos EVM' }).click();
  await page.getByRole('button', { name: 'Use paired EVM wallet for account control' }).click();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Enable full access' })).toBeVisible();
  await page.getByText('Create Daclify keys for a new DAO', { exact: true }).click();
  await page.getByLabel('New vault password', { exact: true }).fill('one account fixture password');
  await page.getByRole('button', { name: 'Create encrypted vault', exact: true }).click();
  await page.getByLabel('I have saved my recovery kit and credential').check();
  await page.getByRole('button', { name: 'Finish account setup' }).click();
  await expect(page.getByLabel('DAO name', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByRole('heading', { name: 'Enable full access' })).toHaveCount(0);
});
