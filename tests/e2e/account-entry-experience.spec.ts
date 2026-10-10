import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PublicKey, Signature } from '@wharfkit/antelope';
import { readFile } from 'node:fs/promises';
import {
  ApiRoutes,
  AccountSchema,
  LoginMessageSchema,
  RecoveryKitSchema,
  SessionSchema,
  SignInEmailSchema,
  SignInEmailCodeSchema,
  SignInProofSchema,
  ErrorSchema,
  NetworkSchema,
  SignInOptionsSchema,
  SignInMethodsSchema,
  CredentialHistorySchema,
  NativeLinksSchema,
  VERSION,
  type Account,
} from '@daclify/core-protocol';
import { createVault } from '../../src/auth/vault.js';

// Producer-validated synthetic HTTP responses; no live provider or chain is contacted.
const network = NetworkSchema.parse({
  chainId: 'ab'.repeat(32),
  rpcUrl: 'https://rpc.example',
  runtime: 'daclifycore',
  hub: null,
  environment: 'testnet',
  interfaceVersion: 1,
  coreVersion: VERSION,
  capabilities: [],
});
const configured = SignInOptionsSchema.parse({
  telegram: { configured: true, username: 'daclify_fixture_bot', oidc: true, miniApp: false },
  email: { delivery: 'mail' },
  passkey: { rpId: 'localhost' },
});
const unavailable = ErrorSchema.parse({
  code: 'SERVICE_UNAVAILABLE',
  message: 'Disposable fixture unavailable.',
});
async function fixture(page: Page, options = configured) {
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === ApiRoutes.network.path) return route.fulfill({ json: network });
    if (path === ApiRoutes.daos.path) return route.fulfill({ json: { daos: [], next: null } });
    if (path === '/v1/me')
      return route.fulfill({
        status: 401,
        json: ErrorSchema.parse({ code: 'AUTH_REQUIRED', message: 'Sign in to continue.' }),
      });
    if (path === '/v1/sign-in/options') return route.fulfill({ json: options });
    return route.fulfill({ status: 503, json: unavailable });
  });
}
const main = (page: Page) => page.locator('#main');
async function accessible(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function vaultLogin(page: Page, accounts = new Map<string, Account>()) {
  let current: Account | undefined,
    message = '';
  await page.route('**/v1/auth/challenge', (route) => {
    const identity = ApiRoutes.challenge.input.parse(route.request().postDataJSON());
    const origin = new URL(route.request().url()).origin;
    const id = crypto.randomUUID(),
      expires = new Date(Date.now() + 120000).toISOString();
    message = JSON.stringify(
      LoginMessageSchema.parse({
        domain: 'daclify.login.v3',
        challenge: id,
        origin,
        audience: origin,
        expires,
        ...identity,
      }),
    );
    return route.fulfill({ json: ApiRoutes.challenge.response.parse({ id, expires, message }) });
  });
  await page.route('**/v1/auth/login', (route) => {
    const input = ApiRoutes.login.input.parse(route.request().postDataJSON());
    const identity = LoginMessageSchema.parse(JSON.parse(message));
    expect(input.challengeId).toBe(identity.challenge);
    expect(input.encryptionKey).toEqual(identity.encryptionKey);
    expect(
      Signature.from(input.signature).verifyMessage(
        new TextEncoder().encode(message),
        PublicKey.from(identity.signingKey),
      ),
    ).toBe(true);
    current =
      accounts.get(identity.signingKey) ??
      AccountSchema.parse({
        id: crypto.randomUUID(),
        custody: 'user-controlled',
        signingKey: identity.signingKey,
        encryptionKey: identity.encryptionKey,
      });
    expect(current.encryptionKey).toEqual(identity.encryptionKey);
    accounts.set(identity.signingKey, current);
    return route.fulfill({
      json: ApiRoutes.login.response.parse({ account: current, csrfToken: 'ab'.repeat(32) }),
    });
  });
  await page.route('**/v1/me', (route) =>
    current
      ? route.fulfill({ json: { account: current } })
      : route.fulfill({
          status: 401,
          json: ErrorSchema.parse({ code: 'AUTH_REQUIRED', message: 'Sign in.' }),
        }),
  );
  await page.route('**/v1/me/memberships', (route) => route.fulfill({ json: { memberships: [] } }));
  return accounts;
}
test('separates returning sign-in from creation and reveals only the selected provider', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/account?returnTo=/hub');
  await expect(
    main(page).getByRole('heading', { name: 'Welcome back', exact: true }),
  ).toBeVisible();
  await expect(
    main(page).getByRole('heading', { name: 'New to Daclify?', exact: true }),
  ).toBeVisible();
  await expect(main(page).getByLabel('Sign-in email', { exact: true })).toHaveCount(0);
  await expect(main(page).getByLabel('Telos EVM network', { exact: true })).toHaveCount(0);
  await main(page).getByRole('button', { name: 'Email', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(main(page).getByRole('button', { name: 'Email', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(main(page).getByLabel('Sign-in email', { exact: true })).toBeVisible();
  await main(page).getByRole('button', { name: 'Telos EVM', exact: true }).click();
  await expect(main(page).getByLabel('Telos EVM network', { exact: true })).toBeVisible();
  await expect(main(page).getByLabel('Sign-in email', { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/returnTo=\/hub$/);
  await accessible(page);
});
test('offers retry when provider configuration fails rather than pretending it is unconfigured', async ({
  page,
}) => {
  await fixture(page);
  let reads = 0;
  await page.route('**/v1/sign-in/options', (route) => {
    reads++;
    return reads === 1
      ? route.fulfill({ status: 503, json: unavailable })
      : route.fulfill({ json: configured });
  });
  await page.goto('/account');
  await expect(
    main(page).getByText('Sign-in options could not be checked.', { exact: true }),
  ).toBeVisible();
  await expect(
    main(page).getByRole('button', { name: 'Create encrypted vault', exact: true }),
  ).toBeVisible();
  await main(page).getByRole('button', { name: 'Retry sign-in options', exact: true }).click();
  await main(page).getByRole('button', { name: 'Telegram', exact: true }).click();
  await expect(
    main(page).getByRole('button', { name: 'Continue with Telegram', exact: true }),
  ).toBeVisible();
  expect(reads).toBe(2);
});
test('keeps unavailable managed signup secondary and recovery immediately discoverable', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/account');
  await expect(
    main(page).getByRole('heading', { name: 'Recovery through a service', exact: true }),
  ).toHaveCount(0);
  await main(page).getByText('Managed recovery option', { exact: true }).click();
  await expect(
    main(page).getByRole('button', { name: 'Managed signup unavailable', exact: true }),
  ).toBeDisabled();
  await main(page)
    .getByRole('button', { name: 'Recover from an encrypted kit', exact: true })
    .click();
  await expect(
    main(page).getByRole('heading', { name: 'Recover your account', exact: true }),
  ).toBeVisible();
  await expect(
    main(page).getByLabel('Vault password or recovery code', { exact: true }),
  ).toBeVisible();
  await expect(main(page).getByLabel('Encrypted recovery kit', { exact: true })).toBeFocused();
  await main(page).getByRole('button', { name: 'Cancel recovery', exact: true }).click();
  await expect(
    main(page).getByRole('heading', { name: 'Welcome back', exact: true }),
  ).toBeVisible();
  await expect(
    main(page).getByRole('button', { name: 'Recover from an encrypted kit', exact: true }),
  ).toBeFocused();
});

test('does not load the legacy Telegram widget until selected and cleans it up when switching', async ({
  page,
}) => {
  await fixture(
    page,
    SignInOptionsSchema.parse({ ...configured, telegram: { ...configured.telegram, oidc: false } }),
  );
  let widgetLoads = 0;
  await page.route('https://telegram.org/js/telegram-widget.js?22', (route) => {
    widgetLoads++;
    return route.fulfill({ contentType: 'application/javascript', body: '' });
  });
  await page.goto('/account');
  await expect(main(page).getByRole('button', { name: 'Telegram', exact: true })).toBeVisible();
  expect(widgetLoads).toBe(0);
  await main(page).getByRole('button', { name: 'Telegram', exact: true }).click();
  await expect(main(page).locator('.telegram-host script')).toHaveCount(1);
  await expect.poll(() => widgetLoads).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () => Object.keys(window).filter((key) => key.startsWith('daclifyTelegramAuth')).length,
      ),
    )
    .toBe(1);
  await main(page).getByRole('button', { name: 'Email', exact: true }).click();
  await expect(main(page).locator('.telegram-host script')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => Object.keys(window).filter((key) => key.startsWith('daclifyTelegramAuth')).length,
      ),
    )
    .toBe(0);
  await main(page).getByRole('button', { name: 'Telegram', exact: true }).click();
  await expect(main(page).locator('.telegram-host script')).toHaveCount(1);
  await expect.poll(() => widgetLoads).toBe(2);
});

test('honors unavailable provider flags and explains local email and passkey limitations', async ({
  page,
}) => {
  await fixture(
    page,
    SignInOptionsSchema.parse({
      ...configured,
      telegram: { configured: false, username: 'leftover_fixture_username' },
      email: { delivery: 'local' },
    }),
  );
  await page.goto('/account');
  await main(page).getByRole('button', { name: 'Telegram', exact: true }).click();
  await expect(
    main(page).getByText('Telegram is not configured on this server.', { exact: true }),
  ).toBeVisible();
  await expect(main(page).locator('.telegram-host')).toHaveCount(0);
  await main(page).getByRole('button', { name: 'Email', exact: true }).click();
  await expect(main(page).getByRole('button', { name: 'Send code', exact: true })).toHaveCount(0);
  await expect(
    main(page).getByText(/Email sign-in from this screen needs mail delivery/),
  ).toBeVisible();
  await main(page).getByRole('button', { name: 'Passkey', exact: true }).click();
  await expect(
    main(page).getByText(/For local testing, open this page at localhost/),
  ).toBeVisible();
  await expect(
    main(page).getByRole('button', { name: 'Sign in with a passkey', exact: true }),
  ).toHaveCount(0);
});

test('supports the Telegram Mini App choice without accepting unverified launch data in the browser', async ({
  page,
}) => {
  await fixture(
    page,
    SignInOptionsSchema.parse({
      ...configured,
      telegram: { configured: false, username: null, miniApp: true },
    }),
  );
  const proof = 'user=%7B%22id%22%3A123%7D&hash=untrusted';
  await page.addInitScript(
    (initData) => Object.defineProperty(window, 'Telegram', { value: { WebApp: { initData } } }),
    proof,
  );
  let sent = '';
  await page.route('**/v1/sign-in/telegram/login', (route) => {
    sent = SignInProofSchema.parse(route.request().postDataJSON()).proof;
    return route.fulfill({
      status: 401,
      json: ErrorSchema.parse({
        code: 'PROVIDER_INVALID',
        message: 'Rejected unverified fixture.',
      }),
    });
  });
  await page.goto('/account');
  await main(page).getByRole('button', { name: 'Telegram', exact: true }).click();
  await main(page)
    .getByRole('button', { name: 'Continue from Telegram Mini App', exact: true })
    .click();
  await expect(
    main(page).getByText('The login proof was rejected.', { exact: true }),
  ).toBeVisible();
  expect(sent).toBe(proof);
  await expect(main(page).getByRole('heading', { name: 'Your account', exact: true })).toHaveCount(
    0,
  );
});

test('email code steps preserve the recipient, prevent duplicate sends and allow retry or another address', async ({
  page,
}) => {
  await fixture(page);
  let sends = 0,
    finishSend = () => {};
  const pending = new Promise<void>((resolve) => {
    finishSend = resolve;
  });
  await page.route('**/v1/sign-in/email/login/start', async (route) => {
    expect(SignInEmailSchema.parse(route.request().postDataJSON()).email).toBe(
      'member@example.test',
    );
    sends++;
    if (sends === 1) await pending;
    await route.fulfill({ json: { delivery: 'sent' } });
  });
  await page.route('**/v1/sign-in/email/login', (route) => {
    expect(SignInEmailCodeSchema.parse(route.request().postDataJSON())).toEqual({
      email: 'member@example.test',
      code: '12345678',
    });
    return route.fulfill({
      status: 401,
      json: ErrorSchema.parse({ code: 'EMAIL_INVALID', message: 'Disposable expired code.' }),
    });
  });
  await page.goto('/account');
  await main(page).getByRole('button', { name: 'Email', exact: true }).click();
  await main(page).getByLabel('Sign-in email', { exact: true }).fill('member@example.test');
  await main(page).getByRole('button', { name: 'Send code', exact: true }).click();
  await expect.poll(() => sends).toBe(1);
  await expect(main(page).getByLabel('Sign-in email', { exact: true })).toBeDisabled();
  await expect(main(page).getByRole('button', { name: 'Telegram', exact: true })).toBeDisabled();
  await expect(
    main(page).getByRole('button', { name: 'Create encrypted vault', exact: true }),
  ).toBeDisabled();
  await expect(
    main(page).getByRole('button', { name: 'Recover from an encrypted kit', exact: true }),
  ).toBeDisabled();
  await expect(
    main(page).getByRole('button', { name: 'Sending code…', exact: true }),
  ).toBeDisabled();
  finishSend();
  await expect(
    main(page).getByRole('button', { name: 'Create encrypted vault', exact: true }),
  ).toBeEnabled();
  await expect(
    main(page).getByText(/Enter the 8-digit code for member@example.test/),
  ).toBeVisible();
  await expect(main(page).getByLabel('Sign-in email', { exact: true })).toHaveCount(0);
  await main(page).getByLabel('Email code', { exact: true }).fill('12345678');
  await main(page).getByRole('button', { name: 'Sign in with email', exact: true }).click();
  await expect(
    main(page).getByText('That email code is not valid anymore.', { exact: true }),
  ).toBeVisible();
  await main(page).getByRole('button', { name: 'Send another code', exact: true }).click();
  await expect(main(page).getByLabel('Email code', { exact: true })).toHaveValue('');
  expect(sends).toBe(2);
  await main(page).getByRole('button', { name: 'Use another email', exact: true }).click();
  await expect(main(page).getByLabel('Sign-in email', { exact: true })).toBeEnabled();
  await expect(main(page).getByLabel('Email code', { exact: true })).toHaveCount(0);
});

test('email opens a session without unlocking keys and returns to the complete destination', async ({
  page,
}) => {
  await fixture(page);
  const vault = await createVault('disposable email account fixture');
  const account = AccountSchema.parse({
    id: crypto.randomUUID(),
    custody: 'user-controlled',
    signingKey: vault.signingPublicKey,
    encryptionKey: vault.encryptionPublicKey,
  });
  let loggedIn = false;
  await page.route('**/v1/me', (route) =>
    loggedIn
      ? route.fulfill({ json: { account } })
      : route.fulfill({
          status: 401,
          json: ErrorSchema.parse({ code: 'AUTH_REQUIRED', message: 'Sign in.' }),
        }),
  );
  await page.route('**/v1/me/memberships', (route) => route.fulfill({ json: { memberships: [] } }));
  await page.route('**/v1/sign-in/email/login/start', (route) =>
    route.fulfill({ json: { delivery: 'sent' } }),
  );
  await page.route('**/v1/sign-in/email/login', (route) => {
    expect(SignInEmailCodeSchema.parse(route.request().postDataJSON())).toEqual({
      email: 'member@example.test',
      code: '12345678',
    });
    loggedIn = true;
    return route.fulfill({ json: SessionSchema.parse({ account, csrfToken: 'ab'.repeat(32) }) });
  });
  await page.goto('/account?returnTo=' + encodeURIComponent('/hub?q=ocean#communities'));
  await main(page).getByRole('button', { name: 'Email', exact: true }).click();
  await main(page).getByLabel('Sign-in email', { exact: true }).fill('member@example.test');
  await main(page).getByRole('button', { name: 'Send code', exact: true }).click();
  await main(page).getByLabel('Email code', { exact: true }).fill('12345678');
  await main(page).getByRole('button', { name: 'Sign in with email', exact: true }).click();
  await expect(page).toHaveURL(/\/hub\?q=ocean#communities$/);
  await expect(page.getByText('Vault locked', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('daclify.vault.v1'))).toBeNull();
});

test('saved vault is offered before alternatives and creation never replaces it', async ({
  page,
}) => {
  await fixture(page);
  await vaultLogin(page);
  const password = 'disposable saved vault fixture';
  const vault = await createVault(password);
  const kit = RecoveryKitSchema.parse({
    version: 1,
    localEnvelope: vault.localEnvelope,
    recoveryEnvelope: vault.recoveryEnvelope,
    signingPublicKey: vault.signingPublicKey,
    encryptionPublicKey: vault.encryptionPublicKey,
  });
  await page.addInitScript(
    (record) => localStorage.setItem('daclify.vault.v1', JSON.stringify(record)),
    kit,
  );
  await page.goto('/account?returnTo=/hub');
  await expect(main(page).getByText('Saved on this device', { exact: true })).toBeVisible();
  await expect(
    main(page).getByRole('button', { name: 'Create encrypted vault', exact: true }),
  ).toHaveCount(0);
  await main(page).getByLabel('Vault password', { exact: true }).fill(password);
  await main(page).getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/hub$/);
  await expect(page.getByText('Vault unlocked', { exact: true })).toBeVisible();
});

for (const recoveryMethod of ['recovery code', 'vault password']) {
  test(`creates keys with backup acknowledgment and restores the same identity using the ${recoveryMethod}`, async ({
    page,
    browser,
  }) => {
    await fixture(page);
    const accounts = await vaultLogin(page);
    await page.goto('/account');
    const password = 'disposable account create fixture';
    await main(page).getByLabel('Vault password', { exact: true }).fill(password);
    await main(page).getByRole('button', { name: 'Create encrypted vault', exact: true }).click();
    await expect(
      main(page).getByRole('heading', { name: 'Save your recovery kit', exact: true }),
    ).toBeVisible();
    await expect(
      main(page).getByRole('button', { name: 'Finish account setup', exact: true }),
    ).toBeDisabled();
    const credential = await main(page)
      .getByLabel('Recovery credential — generated for this vault', { exact: true })
      .inputValue();
    const downloadReady = page.waitForEvent('download');
    await main(page)
      .getByRole('button', { name: 'Download encrypted recovery kit', exact: true })
      .click();
    const downloaded = await (await downloadReady).path();
    if (!downloaded) throw new Error('Disposable recovery kit unavailable');
    const kit = await readFile(downloaded);
    await main(page)
      .getByLabel('I have saved my recovery kit and credential', { exact: true })
      .check();
    await main(page).getByRole('button', { name: 'Finish account setup', exact: true }).click();
    await expect(
      main(page).getByRole('heading', { name: 'User-controlled account', exact: true }),
    ).toBeVisible();
    expect(accounts.size).toBe(1);
    const original = [...accounts.values()][0];
    if (!original) throw new Error('Fixture registration missing');
    expect(await page.evaluate(() => localStorage.getItem('daclify.vault.v1'))).not.toContain(
      'PVT_K1_',
    );
    const context = await browser.newContext();
    try {
      const recovered = await context.newPage();
      await fixture(recovered);
      await vaultLogin(recovered, accounts);
      await recovered.goto(new URL('/account', page.url()).href);
      await main(recovered)
        .getByRole('button', { name: 'Recover from an encrypted kit', exact: true })
        .click();
      await main(recovered)
        .getByLabel('Encrypted recovery kit', { exact: true })
        .setInputFiles({ name: 'disposable-kit.json', mimeType: 'application/json', buffer: kit });
      await main(recovered)
        .getByLabel('Vault password or recovery code', { exact: true })
        .fill(recoveryMethod === 'vault password' ? password : credential);
      await main(recovered)
        .getByLabel('New vault password', { exact: true })
        .fill('replacement disposable password');
      await main(recovered)
        .getByRole('button', { name: 'Restore and sign in', exact: true })
        .click();
      await expect(main(recovered).getByText(original.id, { exact: true })).toBeVisible();
      await expect(recovered.getByText('Vault unlocked', { exact: true })).toBeVisible();
      expect(accounts.size).toBe(1);
    } finally {
      await context.close();
    }
  });
}

test('entry and selected methods remain readable on phone, tablet, landscape and enlarged text', async ({
  page,
}) => {
  test.setTimeout(60000);
  await fixture(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [width, height] of [
    [1440, 1100],
    [375, 812],
    [768, 1024],
    [812, 375],
    [320, 812],
  ]) {
    if (!width || !height) throw new Error('Invalid fixture viewport');
    await page.setViewportSize({ width, height });
    await page.goto('/account');
    await expect(
      main(page).getByRole('heading', { name: 'Welcome back', exact: true }),
    ).toBeVisible();
    await accessible(page);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: test.info().outputPath(`account-entry-${width}.png`),
      fullPage: true,
    });
    await main(page).getByRole('button', { name: 'Telos EVM', exact: true }).click();
    await expect(main(page).getByLabel('Telos EVM network', { exact: true })).toBeVisible();
    await accessible(page);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: test.info().outputPath(`account-wallet-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await accessible(page);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: test.info().outputPath('account-enlarged-text.png'),
    fullPage: true,
  });
});
test('creation and recovery shortcuts retain the destination and password tools remain usable', async ({
  page,
}) => {
  await fixture(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/account?returnTo=%2Fhub%3Fmine%3D1');
  const createLink = main(page).getByRole('link', { name: 'Create an account', exact: true });
  await createLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#new-account')).toBeFocused();
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/hub?mine=1');
  await main(page).getByRole('button', { name: 'Generate vault password', exact: true }).click();
  const password = main(page).getByLabel('Vault password', { exact: true });
  const generated = await password.inputValue();
  expect(generated).toMatch(/^[A-Za-z0-9_-]{24}$/);
  await expect(password).toHaveAttribute('type', 'text');
  const hide = main(page).getByRole('button', { name: 'Hide vault password', exact: true });
  await expect(hide).toHaveAttribute('aria-pressed', 'true');
  await hide.click();
  await expect(password).toHaveAttribute('type', 'password');
  await main(page).getByRole('button', { name: 'Copy vault password', exact: true }).click();
  await expect(
    main(page).getByRole('button', { name: 'Copy vault password', exact: true }),
  ).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(generated);
  await main(page).getByRole('link', { name: 'Recovery options', exact: true }).click();
  await expect(
    main(page).getByRole('button', { name: 'Recover from an encrypted kit', exact: true }),
  ).toBeFocused();
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/hub?mine=1');
  await accessible(page);
});

test('a pending wallet request prevents another account flow and cancellation releases the controls', async ({
  page,
}) => {
  await fixture(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      value: {
        request({ method }: { method: string }) {
          if (method === 'eth_requestAccounts')
            return new Promise((_, reject) => {
              window.addEventListener(
                'daclify-fixture-cancel-wallet',
                () => reject(new Error('Wallet approval cancelled.')),
                { once: true },
              );
            });
          return Promise.resolve(null);
        },
      },
    });
  });
  await page.goto('/account');
  await main(page).getByRole('button', { name: 'Telos EVM', exact: true }).click();
  await main(page).getByRole('button', { name: 'Continue with Telos EVM', exact: true }).click();
  await expect(
    main(page).getByRole('button', { name: 'Waiting for wallet…', exact: true }),
  ).toBeDisabled();
  await expect(main(page).getByRole('button', { name: 'Email', exact: true })).toBeDisabled();
  await expect(
    main(page).getByRole('button', { name: 'Create encrypted vault', exact: true }),
  ).toBeDisabled();
  await expect(
    main(page).getByRole('button', { name: 'Recover from an encrypted kit', exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event('daclify-fixture-cancel-wallet')));
  await expect(
    main(page).getByRole('button', { name: 'Create encrypted vault', exact: true }),
  ).toBeEnabled();
  await expect(
    main(page).getByRole('button', { name: 'Recover from an encrypted kit', exact: true }),
  ).toBeEnabled();
  await main(page).getByRole('button', { name: 'Email', exact: true }).click();
  await expect(main(page).getByLabel('Sign-in email', { exact: true })).toBeVisible();
});
test('authenticated account tabs retain all paired-method management and key controls', async ({
  page,
}) => {
  await fixture(page);
  await vaultLogin(page);
  const methods = SignInMethodsSchema.parse({
    telegram: { ...configured.telegram, subjects: ['123456789'] },
    email: { delivery: 'mail', subjects: ['member@example.test'] },
    passkeys: [{ id: 'disposable-passkey-id' }],
  });
  await page.route('**/v1/sign-in/methods', (route) => route.fulfill({ json: methods }));
  await page.route('**/v1/account/history', (route) =>
    route.fulfill({ json: CredentialHistorySchema.parse({ entries: [], next: null }) }),
  );
  await page.route('**/v1/account/native', (route) =>
    route.fulfill({ json: NativeLinksSchema.parse({ links: [] }) }),
  );
  await page.goto('/account');
  await main(page)
    .getByLabel('Vault password', { exact: true })
    .fill('disposable management fixture password');
  await main(page).getByRole('button', { name: 'Create encrypted vault', exact: true }).click();
  await main(page)
    .getByLabel('I have saved my recovery kit and credential', { exact: true })
    .check();
  await main(page).getByRole('button', { name: 'Finish account setup', exact: true }).click();
  await expect(
    main(page).getByRole('heading', { name: 'User-controlled account', exact: true }),
  ).toBeVisible();
  await main(page).getByRole('tab', { name: 'Sign-in', exact: true }).click();
  await expect(
    main(page).getByRole('heading', { name: 'Sign-in methods', exact: true }),
  ).toBeVisible();
  await expect(
    main(page).getByRole('button', { name: 'Pair Telos Zero', exact: true }),
  ).toBeVisible();
  await expect(
    main(page).getByRole('button', { name: 'Remove passkey disposable', exact: true }),
  ).toBeVisible();
  await expect(
    main(page).getByRole('button', { name: 'Pair Telegram', exact: true }),
  ).toBeVisible();
  await expect(main(page).getByText('Telegram 123456789', { exact: true })).toBeVisible();
  await expect(main(page).getByText('member@example.test', { exact: true })).toBeVisible();
  await expect(main(page).getByLabel('Sign-in email', { exact: true })).toBeVisible();
  await expect(
    main(page).getByRole('heading', { name: 'Sign-in changes', exact: true }),
  ).toBeVisible();
  await expect(
    main(page).getByRole('group', { name: 'Paired sign-in methods', exact: true }),
  ).toHaveCount(0);
  await main(page).getByRole('tab', { name: 'Keys', exact: true }).click();
  await expect(
    main(page).getByRole('button', { name: 'Download encrypted backup', exact: true }),
  ).toBeVisible();
  await expect(main(page).getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible();
});
