import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrivateKey } from '@wharfkit/antelope';
import { VERSION, AccountSchema, SignInMethodsSchema } from '@daclify/core-protocol';
import { createRecoveryRecipient } from '@daclify/core-protocol/sdk';

test('keeps account tasks compact and all paired methods reachable by keyboard', async ({
  page,
}) => {
  page.on('dialog', (dialog) => void dialog.accept());
  const encryption = await createRecoveryRecipient();
  const account = AccountSchema.parse({
    id: crypto.randomUUID(),
    custody: 'user-controlled',
    signingKey: PrivateKey.generate('K1').toPublic().toString(),
    encryptionKey: encryption.publicKey,
  });
  const methods = SignInMethodsSchema.parse({
    telegram: { configured: false, username: null, oidc: false, miniApp: false, subjects: [] },
    email: { delivery: 'mail', subjects: ['member@example.test'] },
    passkeys: [{ id: 'disposable-passkey-id' }],
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      value: {
        request: () =>
          new Promise((_resolve, reject) => {
            window.addEventListener(
              'cancel-fixture-wallet',
              () => reject(new Error('Wallet cancelled')),
              { once: true },
            );
          }),
      },
    });
  });
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      '/v1/network': {
        chainId: 'ab'.repeat(32),
        rpcUrl: 'https://rpc.example.test',
        runtime: 'daclifycore',
        hub: null,
        environment: 'testnet',
        interfaceVersion: 1,
        coreVersion: VERSION,
        capabilities: [],
      },
      '/v1/daos': { daos: [], next: null },
      '/v1/me': { account },
      '/v1/me/memberships': { memberships: [] },
      '/v1/sign-in/options': {
        telegram: { configured: false, username: null, oidc: false, miniApp: false },
        email: { delivery: 'mail' },
        passkey: { rpId: '127.0.0.1' },
      },
      '/v1/sign-in/methods': methods,
      '/v1/account/history': { entries: [], next: null },
      '/v1/account/native': { links: [] },
      '/v1/account/evm': { links: [] },
      '/v1/account/recovery': {
        configured: false,
        assistedEver: false,
        reason: 'RECOVERY_UNAVAILABLE',
        methods: [
          {
            credentialKey: 'email:member@example.test',
            kind: 'email',
            subject: 'member@example.test',
            chainId: null,
            mode: null,
            availableModes: [],
            reason: 'RECOVERY_UNAVAILABLE',
          },
        ],
      },
    };
    const response = responses[path];
    await route.fulfill(
      response
        ? { json: response }
        : {
            status: 503,
            json: { code: 'SERVICE_UNAVAILABLE', message: 'Fixture endpoint unavailable' },
          },
    );
  });
  await page.goto('/account');
  await expect(page.getByRole('tab', { name: 'Access & recovery', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('account-access.png'), fullPage: true });
  await expect(page.getByRole('tab')).toHaveCount(4);
  const access = page.getByRole('tab', { name: 'Access & recovery', exact: true });
  await expect(access).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'This device', exact: true })).toBeVisible();
  await expect(page.getByText(account.signingKey ?? '', { exact: true })).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Request approval from another device' }),
  ).toBeVisible();
  await page.getByText('Public join identity', { exact: true }).click();
  await expect(page.getByText(account.id, { exact: true })).toBeVisible();
  const identity = JSON.parse(await page.getByLabel('Public join identity JSON').inputValue());
  expect(identity.signingKey).toBe(account.signingKey);
  await page.getByText('Public join identity', { exact: true }).click();
  await access.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Sign-in methods', exact: true })).toBeFocused();
  await expect(page.getByLabel('Sign-in email', { exact: true })).toBeHidden();
  await page.screenshot({
    path: test.info().outputPath('account-methods-compact.png'),
    fullPage: true,
  });
  for (const name of ['Passkey', 'Email', 'Telegram', 'Telos Zero', 'Telos EVM']) {
    const provider = page.locator('summary').filter({ hasText: name }).first();
    await provider.focus();
    await page.keyboard.press('Enter');
    await expect(provider.locator('..')).toHaveAttribute('open', '');
  }
  await expect(page.getByLabel('Sign-in email', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Pair Telos EVM wallet', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pair Telos Zero', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pair Telos EVM wallet', exact: true }).click();
  await expect(page.locator('section[aria-label="Telos Zero sign-in"]')).toHaveAttribute(
    'inert',
    '',
  );
  await expect(page.getByRole('button', { name: 'Send code', exact: true })).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event('cancel-fixture-wallet')));
  await expect(page.locator('section[aria-label="Telos Zero sign-in"]')).not.toHaveAttribute(
    'inert',
    '',
  );
  await expect(page.getByRole('button', { name: 'Send code', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('account-methods.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).include('#main').analyze()).violations).toEqual([]);
  await page.route('**/v1/account/recovery', (route) =>
    route.fulfill({
      status: 503,
      json: { code: 'SERVICE_UNAVAILABLE', message: 'Fixture unavailable' },
    }),
  );
  await page.reload();
  await expect(page.getByText('Recovery status unavailable', { exact: true })).toBeVisible();
  await page.getByText('Public join identity', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy public join identity' })).toBeDisabled();
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await expect(
    page.getByText('Join or create a DAO to publish your public profile.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Sign-in methods', exact: true }).focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Payment history', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(access).toBeFocused();
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(
    page.getByRole('button', { name: 'Request approval from another device' }),
  ).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('#main').analyze()).violations).toEqual([]);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    await page.evaluate(() => {
      const heading = document.querySelector('.settings-heading h1')?.getBoundingClientRect();
      const help = document.querySelector('.settings-heading .help-link')?.getBoundingClientRect();
      return (
        !!heading &&
        !!help &&
        (heading.bottom <= help.top ||
          help.bottom <= heading.top ||
          heading.right <= help.left ||
          help.right <= heading.left)
      );
    }),
  ).toBe(true);
});
