import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';
import { PrivateKey, PublicKey, Signature } from '@wharfkit/antelope';
import {
  ApiRoutes,
  VaultAttachMessageSchema,
  AccountControlMessageSchema,
  type Account,
} from '@daclify/core-protocol';
const id = 'ea8725ba-243d-4dd4-8455-c9f6da55cbfe',
  chainId = 'ab'.repeat(32);
const address = '0x1111111111111111111111111111111111111111';
async function fixture(page: Page) {
  let account: Account = { id, custody: 'user-controlled', signingKey: null, encryptionKey: null };
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
    if (path === '/v1/me') return route.fulfill({ json: { account } });
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
          domain: 'daclify.vault-attach.v1',
          origin: new URL(page.url()).origin,
          accountId: id,
          id: intentId,
          expires,
        }),
      );
      return route.fulfill({ json: { id: intentId, message, expires } });
    }
    if (path === '/v1/account/control') {
      const input = z
        .object({ path: z.string(), bodyHash: z.string() })
        .parse(route.request().postDataJSON());
      const challengeId = crypto.randomUUID(),
        expires = new Date(Date.now() + 300000).toISOString();
      return route.fulfill({
        json: {
          id: challengeId,
          expires,
          message: JSON.stringify(
            AccountControlMessageSchema.parse({
              ...input,
              domain: 'daclify.account-control.v1',
              origin: new URL(page.url()).origin,
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
      const proof = z
        .object({
          kind: z.literal('evm'),
          chainId: z.literal(41),
          address: z.string(),
          signature: z.string(),
        })
        .parse(JSON.parse(route.request().headers()['x-account-proof'] ?? '{}'));
      expect(proof.address.toLowerCase()).toBe(address);
      account = {
        id,
        custody: 'user-controlled',
        signingKey: identity.signingKey,
        encryptionKey: identity.encryptionKey,
      };
      return route.fulfill({ json: { account, csrfToken: 'c'.repeat(43) } });
    }
    return route.fulfill({
      status: 503,
      json: { code: 'STRIPE_NOT_CONFIGURED', message: 'Fixture provider unavailable' },
    });
  });
  await page.addInitScript(() => sessionStorage.setItem('daclify.csrf', 'c'.repeat(43)));
}
test('shows wallet-only recovery honestly and gates paid DAO creation before checkout', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Blockchain wallet access' })).toBeVisible();
  await expect(
    page.getByText(
      /document-decryption keys and lost social-login pairings have not been restored/,
    ),
  ).toBeVisible();
  await expect(page.getByText('Signing public key', { exact: true })).toHaveCount(0);
  await page.goto('/create');
  await expect(page.getByRole('heading', { name: 'Set up your Daclify keys' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Set up or restore keys' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('attaches a proved new vault to the recovered profile with a separate wallet approval', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/account');
  await page.getByRole('tab', { name: 'Linked', exact: true }).click();
  await page.getByRole('button', { name: 'Use paired EVM wallet for account control' }).click();
  await expect(
    page.getByText('Paired EVM wallet selected for account-control proofs.'),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Keys', exact: true }).click();
  await page.getByText('Create Daclify keys for a new DAO', { exact: true }).click();
  await page.getByLabel('New vault password', { exact: true }).fill('fixture-vault-password-2026');
  await page.getByRole('button', { name: 'Create encrypted vault', exact: true }).click();
  await page.getByLabel('I have saved my recovery kit and credential').check();
  await page.getByRole('button', { name: 'Finish account setup' }).click();
  await expect(
    page.getByRole('heading', { name: 'User-controlled account', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(id, { exact: true })).toBeVisible();
  await expect(page.getByText('Vault unlocked', { exact: true })).toBeVisible();
  const raw = await page.evaluate(() => localStorage.getItem('daclify.vault.v1'));
  expect(raw).not.toContain('PVT_K1_');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
