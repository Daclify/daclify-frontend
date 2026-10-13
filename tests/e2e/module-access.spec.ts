import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrivateKey } from '@wharfkit/antelope';
import { generateKeyPairSync } from 'node:crypto';
import {
  AccountSchema,
  NetworkSchema,
  UserMembershipSchema,
  ModuleFeeStatusSchema,
  ModuleFeeApprovalSchema,
  ApiRoutes,
  VERSION,
} from '@daclify/core-protocol';
const network = NetworkSchema.parse({
  chainId: 'ab'.repeat(32),
  rpcUrl: 'https://rpc.example',
  runtime: 'core.we',
  hub: null,
  environment: 'local',
  interfaceVersion: 1,
  coreVersion: VERSION,
  capabilities: [],
});
const dao = {
  chainId: network.chainId,
  contract: network.runtime,
  daoId: '1',
  interfaceVersion: 1,
};
const account = AccountSchema.parse({
  id: '11111111-1111-4111-8111-111111111111',
  signingKey: PrivateKey.generate('K1').toPublic().toString(),
  encryptionKey: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
    format: 'jwk',
  }),
  custody: 'user-controlled',
});
const membership = UserMembershipSchema.parse({
  dao,
  memberId: '1',
  nonce: '0',
  active: true,
  admin: true,
  reviewer: false,
  credits: '0',
  claim: '0',
  stake: '0',
  nativeAccount: '',
  custody: 'user-controlled',
});
const status = ModuleFeeStatusSchema.parse({
  dao,
  activeMembers: 11,
  freeMembers: 10,
  configured: true,
  paymentMode: 'test',
  modules: [
    {
      pricing: {
        account: 'decide',
        revision: '1',
        monthlyUsdCents: 200,
        actions: ['open', 'newelect'],
      },
      title: 'Decide',
      codeHash: 'cd'.repeat(32),
      installed: true,
      term: null,
    },
  ],
});
test.beforeEach(async ({ page }) => {
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === '/v1/network'
        ? network
        : path === '/v1/sign-in/session'
          ? { account }
          : path === ApiRoutes.memberships.path
            ? { memberships: [membership] }
            : path === '/v1/modules/billing'
              ? status
              : path === '/v1/daos'
                ? { daos: [] }
                : { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' };
    await route.fulfill({ json: body });
  });
});
const address = '/module-access?dao=' + encodeURIComponent(JSON.stringify(dao));
test('shows free access through ten members and monthly per-DAO prices above it', async ({
  page,
}) => {
  await page.goto(address);
  await expect(page.getByRole('button', { name: 'Buy one month · $2.00' })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('payments do not renew automatically');
  await page.route('**/v1/modules/billing?*', (route) =>
    route.fulfill({ json: { ...status, activeMembers: 10 } }),
  );
  await page.getByRole('button', { name: 'Refresh access' }).click();
  await expect(page.getByRole('main')).toContainText('No module access payment is needed');
  await expect(page.getByRole('button', { name: /Buy one month/ })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).include('#main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('opens one approved checkout and displays verified access on return', async ({ page }) => {
  let approved: ReturnType<typeof ModuleFeeApprovalSchema.parse> | undefined;
  await page.route('**/v1/modules/billing/checkout', async (route) => {
    approved = ModuleFeeApprovalSchema.parse(route.request().postDataJSON());
    await route.fulfill({
      json: {
        id: approved.requestId,
        approval: approved,
        state: 'pending',
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_owned',
        starts: null,
        expires: null,
        receipt: null,
      },
    });
  });
  await page.route('https://checkout.stripe.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<main>Owned checkout transport fixture</main>',
    }),
  );
  await page.goto(address);
  await page.getByRole('button', { name: 'Buy one month · $2.00' }).click();
  await expect(page).toHaveURL('https://checkout.stripe.com/c/pay/cs_test_owned');
  if (!approved) throw new Error('APPROVAL_REQUIRED');
  expect(approved.monthlyUsdCents).toBe(200);
  expect(approved.dao.daoId).toBe('1');
  const acceptance = approved,
    expires = Math.floor(Date.now() / 1000) + 86400;
  await page.route('**/v1/modules/billing/orders/*', (route) =>
    route.fulfill({
      json: {
        id: acceptance.requestId,
        approval: acceptance,
        state: 'active',
        checkoutUrl: null,
        starts: Math.floor(Date.now() / 1000),
        expires,
        receipt: 'ee'.repeat(32),
      },
    }),
  );
  await page.goto(address + '&order=' + acceptance.requestId);
  await expect(page.getByRole('main')).toContainText('Payment verified and access recorded.');
});
test('refuses another DAO’s access and hides administrator controls when membership is missing', async ({
  page,
}) => {
  await page.route('**/v1/modules/billing?*', (route) =>
    route.fulfill({ json: { ...status, dao: { ...dao, daoId: '2' } } }),
  );
  await page.goto(address);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: /Buy one month/ })).toHaveCount(0);
  await page.route('**' + ApiRoutes.memberships.path, (route) =>
    route.fulfill({ json: { memberships: [] } }),
  );
  await page.reload();
  await expect(page.getByRole('main')).toContainText('You need an active administrator membership');
});
