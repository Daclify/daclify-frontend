import { expect, test } from '@playwright/test';
import { ApiRoutes } from '@daclify/core-protocol';
import { payCreation } from './creation-payment';

test('creates a shared DAO after a real passkey login while its Daclify keys stay locked', async ({
  page,
}) => {
  const ui = 'http://localhost:' + (process.env.DACLIFY_TEST_UI_PORT ?? '5178');
  page.on('dialog', (dialog) => void dialog.accept());
  const authenticator = await page.context().newCDPSession(page);
  await authenticator.send('WebAuthn.enable');
  await authenticator.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.goto(ui + '/account');
  await page.getByRole('button', { name: 'New Account', exact: true }).click();
  await page.getByRole('button', { name: 'Own Keys', exact: true }).click();
  await page
    .getByLabel('Vault password', { exact: true })
    .fill('owned passkey DAO creation password');
  await page.getByRole('button', { name: 'Create encrypted vault', exact: true }).click();
  await page.getByLabel('I have saved my recovery kit and credential', { exact: true }).check();
  const opened = page.waitForResponse(
    (response) => new URL(response.url()).pathname === ApiRoutes.login.path,
  );
  await page.getByRole('button', { name: 'Finish account setup', exact: true }).click();
  const original = ApiRoutes.login.response.parse(await (await opened).json()).account;
  await expect(page.getByText('Vault unlocked', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Sign-in methods', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Passkey' }).click();
  await page.getByRole('button', { name: 'Add a passkey', exact: true }).click();
  await expect(page.getByText('Passkey added.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.getByRole('button', { name: 'Passkey', exact: true }).click();
  const signedIn = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/v1/sign-in/passkey/login',
  );
  await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
  expect((await signedIn).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await expect(page.getByText('Vault locked', { exact: true })).toBeVisible();
  const account = ApiRoutes.me.response.parse(
    await (await page.request.get(ui + '/v1/sign-in/session')).json(),
  ).account;
  expect(account).toEqual(original);
  await page.goto(ui + '/create');
  await expect(page.getByLabel('DAO name', { exact: true })).toBeVisible();
  await page.getByLabel('DAO name', { exact: true }).fill('Owned passkey creation ' + Date.now());
  const order = await payCreation(page);
  expect(order.creator.signingKey).toBe(original.signingKey);
  const created = ApiRoutes.creationOrderStatus.response.parse(
    await (await page.request.get(ui + '/v1/dao-orders/' + order.requestId)).json(),
  );
  expect(created.state).toBe('created');
  if (!created.dao) throw new Error('OWNED_CREATED_DAO_REQUIRED');
  const memberships = ApiRoutes.memberships.response.parse(
    await (await page.request.get(ui + ApiRoutes.memberships.path)).json(),
  ).memberships;
  expect(memberships.find((member) => member.dao.daoId === created.dao?.daoId)).toMatchObject({
    active: true,
    admin: true,
    signingKey: original.signingKey,
  });
  await expect(page.getByText('Vault locked', { exact: true })).toBeVisible();
});
