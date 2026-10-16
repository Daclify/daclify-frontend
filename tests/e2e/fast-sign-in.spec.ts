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
  UserMembershipSchema,
  MemberProfileSchema,
  recoveryVaultDomain,
} from '@daclify/core-protocol';
import {
  createRecoveryRecipient,
  createRecoveryPayload,
  sealRecoveryDelivery,
} from '@daclify/core-protocol/sdk';
async function fixture(page: Page, withProfile = false, initiallyAuthenticated = false) {
  const signing = PrivateKey.generate('K1'),
    encryption = await createRecoveryRecipient();
  const account = {
    id: crypto.randomUUID(),
    custody: 'user-controlled' as const,
    signingKey: signing.toPublic().toString(),
    encryptionKey: encryption.publicKey,
  };
  let authenticated = initiallyAuthenticated,
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
    if (path === '/v1/sign-in/session')
      return route.fulfill(authenticated ? { json: { account } } : { status: 204 });
    if (path === '/v1/me/memberships')
      return route.fulfill({
        json: {
          memberships: withProfile
            ? [
                UserMembershipSchema.parse({
                  dao: {
                    chainId: 'ab'.repeat(32),
                    contract: 'daclifycore',
                    daoId: '1',
                    interfaceVersion: 1,
                  },
                  memberId: '1',
                  nonce: '0',
                  active: true,
                  admin: false,
                  reviewer: false,
                  credits: '0',
                  claim: '0',
                  stake: '0',
                  nativeAccount: 'alice',
                  custody: 'user-controlled',
                  signingKey: account.signingKey,
                }),
              ]
            : [],
        },
      });
    if (path === '/v1/profile')
      return route.fulfill({
        json: MemberProfileSchema.parse({
          accountName: 'alice',
          profile: JSON.stringify({
            name: 'alice',
            fullName: 'Alice Example',
            motto: 'Build together',
            email: 'alice@example.test',
          }),
        }),
      });
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
async function unlockProfile(page: Page) {
  const profile = page.getByRole('tabpanel', { name: 'Profile', exact: true });
  await profile.getByRole('button', { name: 'E-Mail', exact: true }).click();
  await profile.getByLabel('Sign-in email', { exact: true }).fill('alice@example.test');
  await profile.getByRole('button', { name: /Send.*code/ }).click();
  await profile.getByLabel('Email code', { exact: true }).fill('12345678');
  await profile.getByRole('button', { name: 'Sign in with email', exact: true }).click();
  return profile;
}
test('unlocks a signed-in email account directly from its locked profile without a vault password', async ({
  page,
}) => {
  await fixture(page, true, true);
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') writes.push(new URL(request.url()).pathname);
  });
  await page.goto('/account');
  const profile = page.getByRole('tabpanel', { name: 'Profile', exact: true });
  await expect(profile.getByLabel('Full name', { exact: true })).toHaveCount(0);
  await unlockProfile(page);
  await expect(profile.getByLabel('Full name', { exact: true })).toHaveValue('Alice Example');
  await profile.getByLabel('Full name', { exact: true }).fill('Updated profile name');
  await expect(profile.getByLabel('Full name', { exact: true })).toHaveValue(
    'Updated profile name',
  );
  await expect(page.getByRole('tab', { name: 'Profile', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel('Vault password', { exact: true })).toHaveCount(0);
  expect(writes).toEqual([
    '/v1/sign-in/email/login/start',
    '/v1/sign-in/email/login',
    '/v1/account/recovery/claim',
  ]);
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
  ).not.toContain('PVT_K1_');
  await page.reload();
  await expect(profile.getByRole('button', { name: 'E-Mail', exact: true })).toBeVisible();
  await expect(profile.getByLabel('Full name', { exact: true })).toHaveCount(0);
});
test('stays in Profile during approval-setup recovery without duplicating hidden email forms', async ({
  page,
}) => {
  await fixture(page, true, true);
  await page.goto('/account?setup=approvals&returnTo=%2Fdao%2F1');
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  const profile = await unlockProfile(page);
  await expect(profile.getByLabel('Full name', { exact: true })).toHaveValue('Alice Example');
  await expect(page).toHaveURL(/\/account\?setup=approvals&returnTo=%2Fdao%2F1$/);
  await expect(page.getByRole('tab', { name: 'Profile', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('#sign-in-email')).toHaveCount(0);
});
test('unlocks Profile after visiting Sign-in methods without duplicate email fields', async ({
  page,
}) => {
  await fixture(page, true, true);
  await page.goto('/account');
  await page.getByRole('tab', { name: 'Sign-in methods', exact: true }).click();
  await expect(page.locator('#sign-in-email')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  const profile = page.getByRole('tabpanel', { name: 'Profile', exact: true });
  await profile.getByRole('button', { name: 'E-Mail', exact: true }).click();
  await expect(page.locator('#sign-in-email')).toHaveCount(1);
  expect(
    (await new AxeBuilder({ page }).include('#account-panel-profile').analyze()).violations,
  ).toEqual([]);
  await unlockProfile(page);
  await expect(profile.getByLabel('Full name', { exact: true })).toHaveValue('Alice Example');
});
for (const failure of ['missing-grant', 'recovery-storage', 'email-verification'] as const) {
  test(`keeps private fields locked after ${failure} and shows the problem`, async ({ page }) => {
    const account = await fixture(page, true, true);
    if (failure === 'missing-grant')
      await page.route('**/v1/sign-in/email/login', (route) =>
        route.fulfill({ json: { account, csrfToken: 'c'.repeat(43) } }),
      );
    else
      await page.route(
        failure === 'recovery-storage'
          ? '**/v1/account/recovery/claim'
          : '**/v1/sign-in/email/login',
        (route) =>
          route.fulfill({
            status: failure === 'recovery-storage' ? 503 : 400,
            json: {
              code: failure === 'recovery-storage' ? 'RECOVERY_UNAVAILABLE' : 'EMAIL_CODE_INVALID',
              message: 'Synthetic failure',
            },
          }),
      );
    await page.goto('/account');
    await unlockProfile(page);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(
      page
        .getByRole('tabpanel', { name: 'Profile', exact: true })
        .getByLabel('Full name', { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Profile', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await page.evaluate(() => localStorage.getItem('daclify.vault.v1'))).toBeNull();
  });
}
test('offers account recovery without claiming a sign-in-only email can unlock keys', async ({
  page,
}) => {
  await fixture(page, true, true);
  await page.route('**/v1/account/recovery', (route) =>
    route.fulfill({
      json: RecoveryMethodsSchema.parse({
        methods: [
          {
            credentialKey: 'email:alice@example.test',
            kind: 'email',
            subject: 'alice@example.test',
            chainId: null,
            mode: null,
            availableModes: [],
            reason: null,
          },
        ],
        assistedEver: true,
        assistedEnabled: false,
        configured: true,
        reason: null,
      }),
    }),
  );
  await page.goto('/account');
  const profile = page.getByRole('tabpanel', { name: 'Profile', exact: true });
  await expect(
    profile.getByRole('button', { name: 'Access & recovery', exact: true }),
  ).toBeVisible();
  await expect(profile.getByRole('button', { name: 'E-Mail', exact: true })).toHaveCount(0);
  await profile.getByRole('button', { name: 'Access & recovery', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Access & recovery', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    page.getByRole('button', { name: 'Recover from an encrypted kit', exact: true }),
  ).toBeVisible();
});
test('retries unavailable unlock options without requesting a code', async ({ page }) => {
  await fixture(page, true, true);
  let available = false;
  await page.route('**/v1/account/recovery', (route) =>
    available
      ? route.fallback()
      : route.fulfill({
          status: 503,
          json: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic failure' },
        }),
  );
  await page.goto('/account');
  const profile = page.getByRole('tabpanel', { name: 'Profile', exact: true });
  await expect(
    profile.getByRole('button', { name: 'Retry unlock options', exact: true }),
  ).toBeVisible();
  available = true;
  await profile.getByRole('button', { name: 'Retry unlock options', exact: true }).click();
  await expect(profile.getByRole('button', { name: 'E-Mail', exact: true })).toBeVisible();
});
test('requires another paired email verification after the inactivity lock', async ({ page }) => {
  await page.clock.install();
  await fixture(page, true, true);
  await page.goto('/account');
  const profile = await unlockProfile(page);
  await expect(profile.getByLabel('Full name', { exact: true })).toHaveValue('Alice Example');
  await page.clock.fastForward(10 * 60000 + 1000);
  await expect(profile.getByLabel('Full name', { exact: true })).toHaveCount(0);
  await unlockProfile(page);
  await expect(profile.getByLabel('Full name', { exact: true })).toHaveValue('Alice Example');
});
test('gets full account access on a fresh device using the selected paired email', async ({
  page,
}) => {
  const account = await fixture(page);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.getByRole('button', { name: 'E-Mail', exact: true }).click();
  await page.getByLabel('Sign-in email', { exact: true }).fill('alice@example.test');
  await page.getByRole('button', { name: /Send.*code/ }).click();
  await page.getByLabel('Email code', { exact: true }).fill('12345678');
  await page.getByRole('button', { name: 'Sign in with email', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible();
  await page.getByText('Public join identity', { exact: true }).click();
  await expect(page.getByText(account.id, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Vault password', { exact: true })).toBeHidden();
  await page.getByRole('tab', { name: 'Sign-in methods', exact: true }).click();
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
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.getByRole('button', { name: 'E-Mail', exact: true }).click();
  await page.getByLabel('Sign-in email', { exact: true }).fill('alice@example.test');
  await page.getByRole('button', { name: /Send.*code/ }).click();
  await page.getByLabel('Email code', { exact: true }).fill('12345678');
  await page.getByRole('button', { name: 'Sign in with email', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible();
  await page.getByText('Public join identity', { exact: true }).click();
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

test('keeps private profile fields compact and retains drafts when optional sections close', async ({
  page,
}) => {
  await fixture(page, true);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.getByRole('button', { name: 'E-Mail', exact: true }).click();
  await page.getByLabel('Sign-in email', { exact: true }).fill('alice@example.test');
  await page.getByRole('button', { name: /Send.*code/ }).click();
  await page.getByLabel('Email code', { exact: true }).fill('12345678');
  await page.getByRole('button', { name: 'Sign in with email', exact: true }).click();
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Alice Example');
  await expect(page.getByLabel('Account name', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Email', { exact: true })).toBeHidden();
  await expect(page.getByLabel('Avatar image CID', { exact: true })).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('account-profile.png'), fullPage: true });
  const contacts = page.getByText('Private contact & links', { exact: true });
  await contacts.click();
  await page.getByLabel('Email', { exact: true }).fill('public@example.test');
  await contacts.click();
  await contacts.click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('public@example.test');
  await page.getByText('Profile images', { exact: true }).click();
  await expect(page.getByLabel('Avatar image CID', { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('#main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
