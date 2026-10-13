import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ApiRoutes } from '@daclify/core-protocol';
const owner = z
  .object({ token: z.string() })
  .parse(
    JSON.parse(
      readFileSync('../daclify-backend-core/.artifacts/native/browser-owner.json', 'utf8'),
    ),
  );
async function account(page: Page, navigate = true) {
  page.on('dialog', (dialog) => void dialog.accept());
  if (navigate) await page.goto('/account');
  await page.getByRole('button', { name: 'New Account', exact: true }).click();
  await page.getByRole('button', { name: 'Own Keys', exact: true }).click();
  await page.getByLabel('Vault password', { exact: true }).fill('owned DAO claim password 2026');
  await page.getByRole('button', { name: 'Create encrypted vault', exact: true }).click();
  await page.getByLabel('I have saved my recovery kit and credential', { exact: true }).check();
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === ApiRoutes.login.path);
  await page.getByRole('button', { name: 'Finish account setup', exact: true }).click();
  const session = ApiRoutes.login.response.parse(await (await response).json());
  await expect(page.getByText('Vault unlocked', { exact: true })).toBeVisible();
  return session.account;
}
async function passkey(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.getByRole('tab', { name: 'Sign-in methods', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Passkey' }).click();
  await page.getByRole('button', { name: 'Add a passkey', exact: true }).click();
  await expect(page.getByText('Passkey added.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.getByRole('button', { name: 'Passkey', exact: true }).click();
  const signedIn = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/v1/sign-in/passkey/login',
  );
  await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
  expect((await signedIn).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await expect(page.getByText('Vault locked', { exact: true })).toBeVisible();
}
async function invitation(page: Page, paired = false) {
  const issuer = await account(page);
  const seeded = await page.request.post(
    'http://127.0.0.1:' + (process.env.DACLIFY_TEST_API_PORT ?? '3008') + '/fixture/dao',
    {
      headers: { 'x-fixture-token': owner.token, origin: new URL(page.url()).origin },
      data: { signingKey: issuer.signingKey, encryptionKey: issuer.encryptionKey, platform: true },
    },
  );
  expect(seeded.status()).toBe(200);
  await expect
    .poll(async () => {
      const eligibility = await page.request.get(ApiRoutes.daoClaimEligibility.path);
      expect(eligibility.status()).toBe(200);
      return ApiRoutes.daoClaimEligibility.response.parse(await eligibility.json()).eligible;
    })
    .toBe(true);
  if (paired) await passkey(page);
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation').getByRole('link', { name: 'Create', exact: true }).click();
  await page.getByLabel('DAO name', { exact: true }).fill('Claimed browser DAO ' + Date.now());
  await expect(
    page.getByRole('heading', { name: 'Prepare this DAO for someone else' }),
  ).toBeVisible();
  if (!paired) await page.getByLabel('Approve invitation with').selectOption('vault');
  await expect(page.getByRole('button', { name: 'Create claim link', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Create claim link', exact: true }).click();
  const input = page.getByLabel('Private invitation link · copy now', { exact: true });
  await expect(input).toBeVisible();
  return { link: await input.inputValue(), issuer };
}
test('new-account entry preserves a secret-free redirect and claims the sole native executive on desktop and mobile', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const { link, issuer } = await invitation(page);
  const origin = new URL(page.url()).origin;
  const recipient = await browser.newContext({
      baseURL: origin,
      viewport: page.viewportSize() ?? { width: 1280, height: 720 },
    }),
    target = await recipient.newPage();
  const errors: string[] = [];
  target.on('pageerror', (e) => errors.push(e.message));
  await target.goto(link);
  await expect(
    target.getByRole('button', { name: 'Sign in or create an account', exact: true }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page: target }).analyze()).violations).toEqual([]);
  const accountHref = await target
    .getByRole('link', { name: 'Sign in', exact: true })
    .getAttribute('href');
  expect(accountHref?.includes(new URL(link).hash.slice(1))).toBe(false);
  await target.getByRole('button', { name: 'Sign in or create an account', exact: true }).click();
  await expect.poll(() => new URL(target.url()).pathname).toBe('/account');
  expect(target.url().includes(new URL(link).hash.slice(1))).toBe(false);
  const claimant = await account(target, false);
  await expect.poll(() => new URL(target.url()).pathname).toBe('/claim-dao');
  await expect(
    target.getByRole('button', { name: 'Claim and create DAO', exact: true }),
  ).toBeEnabled();
  expect(new URL(target.url()).search).toBe('');
  await target.screenshot({
    path: '.artifacts/browser/dao-claim-review-' + test.info().project.name + '.png',
  });
  await target.getByRole('button', { name: 'Claim and create DAO', exact: true }).click();
  await expect.poll(() => new URL(target.url()).pathname).toMatch(/^\/dao\/\d+$/);
  const id = new URL(target.url()).pathname.split('/')[2];
  if (!id) throw Error('Owned DAO missing');
  const governance = ApiRoutes.governance.response.parse(
    await (await target.request.get('/v1/daos/' + id + '/governance')).json(),
  );
  expect(governance.executiveMembers).toMatchObject([
    { id: '1', signing_key: claimant.signingKey, active: true, admin: true },
  ]);
  expect(governance.executiveMembers.some((m) => m.signing_key === issuer.signingKey)).toBe(false);
  expect(
    ApiRoutes.dao.response.parse(await (await target.request.get('/v1/daos/' + id)).json()).members,
  ).toBe(1);
  expect(errors).toEqual([]);
  await recipient.close();
});
test('paired passkey executive approval and a locked-vault claimant both work', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const { link } = await invitation(page, true);
  await expect(page.getByText('Vault locked', { exact: true })).toBeVisible();
  const recipient = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport: page.viewportSize() ?? { width: 1280, height: 720 },
    }),
    target = await recipient.newPage();
  const claimant = await account(target);
  await passkey(target);
  await target.goto(link);
  await expect(
    target.getByRole('button', { name: 'Claim and create DAO', exact: true }),
  ).toBeEnabled();
  await target.getByRole('button', { name: 'Claim and create DAO', exact: true }).click();
  await expect.poll(() => new URL(target.url()).pathname).toMatch(/^\/dao\/\d+$/);
  await expect(target.getByText('Vault locked', { exact: true })).toBeVisible();
  const id = new URL(target.url()).pathname.split('/')[2];
  const result = ApiRoutes.governance.response.parse(
    await (await target.request.get('/v1/daos/' + id + '/governance')).json(),
  );
  expect(result.executiveMembers[0]?.signing_key).toBe(claimant.signingKey);
  await recipient.close();
});
test('issuer can revoke an unused link and public preview cannot claim it', async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const { link } = await invitation(page);
  await page.getByText('Your recent invitations', { exact: true }).click();
  await page.getByRole('button', { name: 'Revoke invitation', exact: true }).first().click();
  const recipient = await browser.newContext(),
    target = await recipient.newPage();
  await target.goto(link);
  await expect(
    target.getByText('This invitation is revoked. Ask its issuer for a new link.', { exact: true }),
  ).toBeVisible();
  await expect(
    target.getByRole('button', { name: 'Claim and create DAO', exact: true }),
  ).toHaveCount(0);
  await recipient.close();
});
