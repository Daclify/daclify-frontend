import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { z } from 'zod';
import { createVault } from '../../src/auth/vault.js';

const apiPort = z.coerce
    .number()
    .int()
    .min(1024)
    .max(65535)
    .parse(process.env.DACLIFY_TEST_API_PORT ?? 3028),
  uiPort = z.coerce
    .number()
    .int()
    .min(1024)
    .max(65535)
    .parse(process.env.DACLIFY_TEST_UI_PORT ?? 5198),
  api = 'http://127.0.0.1:' + apiPort,
  uiOrigin = 'http://127.0.0.1:' + uiPort;
async function emailCode(page: Page, email: string): Promise<string> {
  const response = await page.request.get(`${api}/fixture/code?email=${encodeURIComponent(email)}`);
  return z.strictObject({ code: z.string().regex(/^\d{8}$/) }).parse(await response.json()).code;
}
async function signup(page: Page, email: string) {
  await page.goto('/account');
  const panel = page.locator('.quick-signup');
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: 'Continue with email', exact: true }).click();
  await panel.getByLabel('Email address', { exact: true }).fill(email);
  await panel.getByRole('button', { name: 'Send code', exact: true }).click();
  await expect(panel.getByLabel('Email code', { exact: true })).toBeVisible();
  await panel.getByLabel('Email code', { exact: true }).fill(await emailCode(page, email));
  await panel.getByRole('button', { name: 'Verify email and create account', exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.request.post(`${api}/fixture/options`, {
    headers: { origin: uiOrigin },
    data: { assisted: true, failStorage: false },
  });
});
test('quick email signup opens usable original keys without storing plaintext or requiring a password', async ({
  page,
  browser,
}) => {
  const email = `${crypto.randomUUID()}@example.test`;
  await signup(page, email);
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  await expect(
    page.getByText('Ready to sign actions and open your private documents.', { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('PVT_K1_');
  expect(await page.evaluate(() => localStorage.getItem('daclify.vault.v1'))).toBeNull();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const before = await page.request.get(`${api}/fixture/state?email=${encodeURIComponent(email)}`);
  const identity = z
    .object({
      id: z.uuid(),
      signing_key: z.string(),
      encryption_key: z.unknown(),
      assisted_ever: z.boolean(),
    })
    .parse(await before.json());
  expect(identity.assisted_ever).toBe(true);
  const context = await browser.newContext(),
    fresh = await context.newPage();
  try {
    await fresh.goto(new URL('/account', page.url()).href);
    const returning = fresh.locator('.account-returning');
    await returning.getByRole('button', { name: 'Email', exact: true }).click();
    await returning.getByLabel('Sign-in email', { exact: true }).fill(email);
    await returning.getByRole('button', { name: 'Send code', exact: true }).click();
    await expect(returning.getByLabel('Email code', { exact: true })).toBeVisible();
    await returning.getByLabel('Email code', { exact: true }).fill(await emailCode(fresh, email));
    await returning.getByRole('button', { name: 'Sign in with email', exact: true }).click();
    await expect(
      fresh.getByText('Ready to sign actions and open your private documents.', { exact: true }),
    ).toBeVisible();
    await expect(fresh.getByText(identity.signing_key, { exact: true })).toHaveCount(1);
  } finally {
    await context.close();
  }
});
test('offers the user-controlled vault when assisted signup is unavailable', async ({ page }) => {
  await page.request.post(`${api}/fixture/options`, {
    headers: { origin: uiOrigin },
    data: { assisted: false },
  });
  await page.goto('/account');
  await expect(
    page.locator('.quick-signup').getByText(/Quick signup is unavailable/),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Create encrypted vault', exact: true }),
  ).toBeVisible();
});
test('keeps opt-out available for a paused assisted backup', async ({ page }) => {
  const email = `${crypto.randomUUID()}@example.test`;
  await signup(page, email);
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  await page.request.post(`${api}/fixture/quarantine`, {
    headers: { origin: uiOrigin },
    data: { email },
  });
  await page.reload();
  const panel = page.locator('.assisted-opt-out');
  await expect(
    panel.getByRole('button', { name: 'Turn off Daclify-assisted recovery', exact: true }),
  ).toBeVisible();
  await expect(panel.getByText('Daclify-assisted recovery off', { exact: true })).toHaveCount(0);
});
test('retries a recovery-storage outage with the same pending identity', async ({ page }) => {
  const email = `${crypto.randomUUID()}@example.test`;
  await page.request.post(`${api}/fixture/options`, {
    headers: { origin: uiOrigin },
    data: { failStorage: true },
  });
  await signup(page, email);
  await expect(page.locator('.quick-signup').getByRole('alert')).toBeVisible();
  await page.request.post(`${api}/fixture/options`, {
    headers: { origin: uiOrigin },
    data: { failStorage: false },
  });
  await page
    .locator('.quick-signup')
    .getByRole('button', { name: 'Retry account setup', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
});
test('creates usable original keys from a Telegram Mini App with real HMAC verification', async ({
  page,
}) => {
  const { proof } = z
    .object({ proof: z.string() })
    .parse(await (await page.request.get(`${api}/fixture/telegram-proof`)).json());
  await page.addInitScript((proof) => {
    Reflect.set(window, 'Telegram', { WebApp: { initData: proof } });
  }, proof);
  await page.goto('/account');
  const panel = page.locator('.quick-signup');
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: 'Continue with Telegram', exact: true }).click();
  await panel
    .getByRole('button', { name: 'Create account from Telegram Mini App', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  await expect(
    page.getByText('Ready to sign actions and open your private documents.', { exact: true }),
  ).toBeVisible();
});
test('resumes Telegram OIDC signup after redirect with real JWT verification', async ({ page }) => {
  // Replace only the external provider transport; the API verifies an actual signed RS256 token.
  await page.route('https://oauth.telegram.org/auth?*', async (route) => {
    const url = new URL(route.request().url()),
      callback = new URL(z.string().parse(url.searchParams.get('redirect_uri')));
    callback.search = new URLSearchParams({
      state: z.string().parse(url.searchParams.get('state')),
      code: z.string().parse(url.searchParams.get('nonce')),
    }).toString();
    await route.fulfill({ status: 302, headers: { location: callback.href }, body: '' });
  });
  await page.goto('/account');
  let panel = page.locator('.quick-signup');
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: 'Continue with Telegram', exact: true }).click();
  await panel.getByRole('button', { name: 'Verify with Telegram', exact: true }).click();
  await expect(page).toHaveURL(/signup=/);
  panel = page.locator('.quick-signup');
  await expect(
    panel.getByText('Your telegram identity is verified. Complete encrypted account setup below.'),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('daclify.vault.v1'))).toBeNull();
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  await expect(
    page.getByText('Ready to sign actions and open your private documents.', { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);
});
test('leaves another account’s saved vault intact during quick signup', async ({ page }) => {
  const existing = await createVault('owned existing vault password');
  const kit = {
    version: 1,
    localEnvelope: existing.localEnvelope,
    recoveryEnvelope: existing.recoveryEnvelope,
    signingPublicKey: existing.signingPublicKey,
    encryptionPublicKey: existing.encryptionPublicKey,
  };
  await page.goto('/account');
  await page.evaluate((kit) => localStorage.setItem('daclify.vault.v1', JSON.stringify(kit)), kit);
  await page.reload();
  await page.getByRole('link', { name: 'Create another account', exact: true }).click();
  const panel = page.locator('.quick-signup'),
    email = `${crypto.randomUUID()}@example.test`;
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: 'Continue with email', exact: true }).click();
  await panel.getByLabel('Email address', { exact: true }).fill(email);
  await panel.getByRole('button', { name: 'Send code', exact: true }).click();
  await expect(panel.getByLabel('Email code', { exact: true })).toBeVisible();
  await panel.getByLabel('Email code', { exact: true }).fill(await emailCode(page, email));
  await panel.getByRole('button', { name: 'Verify email and create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('daclify.vault.v1'))).toBe(
    JSON.stringify(kit),
  );
});
