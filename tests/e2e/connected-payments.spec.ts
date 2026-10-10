import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import {
  AccountSchema,
  AccountControlRequestSchema,
  ChallengeRequestSchema,
  LoginRequestSchema,
  PlatformStatusSchema,
  PaymentStatusSchema,
  PaymentCatalogueSchema,
  HostingChangeInputSchema,
  AccountControlMessageSchema,
  LoginMessageSchema,
  HostingStatusSchema,
  NetworkSchema,
  UserMembershipSchema,
  VERSION,
  type Account,
} from '@daclify/core-protocol';
const origin = 'http://127.0.0.1:5218';
const dao = {
  chainId: 'ab'.repeat(32),
  contract: 'daclifycore',
  daoId: '1',
  interfaceVersion: 1 as const,
};
const network = NetworkSchema.parse({
  chainId: dao.chainId,
  rpcUrl: 'http://127.0.0.1:20388',
  runtime: dao.contract,
  hub: 'daclifyhub',
  environment: 'local',
  interfaceVersion: 1,
  coreVersion: VERSION,
  capabilities: [],
});
test('shows three deployment choices with free creation and explicit independent pricing', async ({
  page,
}) => {
  await page.route('**/networks.json', (r) => r.fulfill({ json: { mode: 'local' } }));
  await page.route('**/v1/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path === '/v1/network') return r.fulfill({ json: network });
    if (path === '/v1/daos') return r.fulfill({ json: { daos: [], next: null } });
    if (path === '/v1/platform/status')
      return r.fulfill({
        json: PlatformStatusSchema.parse({
          checkedAt: new Date().toISOString(),
          apiVersion: VERSION,
          moduleVersion: VERSION,
          chain: null,
          rpc: 'unconfigured',
          database: { state: 'reachable', migrations: [] },
          limits: {
            sponsoredWritesPerAccount: 5,
            sponsoredWritesGlobal: 20,
            windowMs: 60000,
            uploadBytes: 0,
          },
          services: [],
          defaults: { sharedUsdCents: 0, independentUsdCents: 5000, tlosPremiumBps: 2000 },
        }),
      });
    return r.fulfill({
      status: 401,
      json: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' },
    });
  });
  await page.goto('/create');
  await expect(page.getByRole('radio')).toHaveCount(3);
  await expect(page.getByText('Free · up to 10 active members', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: /Your complete DAO portal/ }).check();
  await expect(page.getByRole('link', { name: /Contact for pricing/ })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.artifacts/browser/create-' + test.info().project.name + '.png' });
});
test('requires admin access, a current signer and explicit monthly consent before checkout', async ({
  page,
}) => {
  let account: Account | undefined,
    key = '';
  const changes: unknown[] = [];
  let status = HostingStatusSchema.parse({
    dao,
    pricing: {
      freeSlots: 10,
      rates: { first_usd: 100, next_usd: 50, rest_usd: 20, revision: '0' },
    },
    activeMembers: 10,
    effectiveCapacity: 10,
    expires: null,
    receipt: null,
    exempt: false,
    configured: true,
    subscription: null,
  });
  await page.route('**/networks.json', (r) => r.fulfill({ json: { mode: 'local' } }));
  await page.route('**/v1/**', async (r) => {
    const path = new URL(r.request().url()).pathname;
    const body: unknown = r.request().method() === 'POST' ? r.request().postDataJSON() : null;
    let response: unknown;
    let code = 200;
    if (path === '/v1/network') response = network;
    else if (path === '/v1/daos') response = { daos: [], next: null };
    else if (path === '/v1/hub/directory') response = { entries: [], skipped: 0, next: null };
    else if (path === '/v1/me') {
      response = account ? { account } : { code: 'AUTH_REQUIRED', message: 'Sign in.' };
      code = account ? 200 : 401;
    } else if (path === '/v1/me/memberships')
      response = {
        memberships: account
          ? [
              UserMembershipSchema.parse({
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
                signingKey: key,
              }),
            ]
          : [],
      };
    else if (path === '/v1/auth/challenge') {
      const identity = ChallengeRequestSchema.parse(body);
      key = identity.signingKey;
      const id = randomUUID(),
        expires = new Date(Date.now() + 300000).toISOString();
      response = {
        id,
        expires,
        message: JSON.stringify(
          LoginMessageSchema.parse({
            domain: 'daclify.login.v3',
            encryptionKey: identity.encryptionKey,
            origin,
            audience: origin,
            challenge: id,
            signingKey: key,
            expires,
          }),
        ),
      };
    } else if (path === '/v1/auth/login') {
      account = AccountSchema.parse({
        id: randomUUID(),
        signingKey: key,
        encryptionKey: LoginRequestSchema.parse(body).encryptionKey,
        custody: 'user-controlled',
      });
      response = { account, csrfToken: 'c'.repeat(43) };
    } else if (path === '/v1/account/control') {
      const id = randomUUID(),
        expires = new Date(Date.now() + 300000).toISOString();
      if (!account) throw new Error('Account missing');
      response = {
        id,
        expires,
        message: JSON.stringify(
          AccountControlMessageSchema.parse({
            ...AccountControlRequestSchema.parse(body),
            domain: 'daclify.account-control.v2',
            origin,
            audience: origin,
            accountId: account.id,
            signingKey: key,
            challengeId: id,
            expires,
          }),
        ),
      };
    } else if (path === '/v1/payments/status')
      response = PaymentStatusSchema.parse({
        dao,
        configured: true,
        accountId: null,
        accountKind: null,
        state: 'not-connected',
        chargesEnabled: false,
        payoutsEnabled: false,
        policy: { basisPoints: 500, revision: '0' },
        products: [],
        brokerConfigured: false,
      });
    else if (path === '/v1/payments/catalogue')
      response = PaymentCatalogueSchema.parse({
        dao,
        enabled: false,
        policy: { basisPoints: 500, revision: '0' },
        products: [],
      });
    else if (path === '/v1/hosting/status') response = status;
    else if (path === '/v1/hosting/change') {
      const input = HostingChangeInputSchema.parse(body);
      changes.push(input);
      status = HostingStatusSchema.parse({
        ...status,
        subscription: {
          id: randomUUID(),
          requestId: input.requestId,
          state: 'pending',
          extraSlots: input.extraSlots,
          pricing: status.pricing,
          monthlyUsdCents: input.monthlyUsdCents,
          checkoutUrl: 'https://checkout.stripe.com/c/pay/fixture',
          invoiceUrl: null,
          pendingChange: null,
        },
      });
      response = status;
    } else if (path.endsWith('/evm-binding')) response = { binding: null };
    else {
      code = 503;
      response = { code: 'UNCONFIGURED', message: 'Unavailable in this UI fixture.' };
    }
    await r.fulfill({ status: code, json: response });
  });
  const query = '/hosting?dao=' + encodeURIComponent(JSON.stringify(dao));
  await page.goto(query);
  await expect(page.getByRole('heading', { name: 'Administrator access required' })).toBeVisible();
  expect(changes).toHaveLength(0);
  await page.goto('/account?returnTo=' + encodeURIComponent(query));
  await page.getByLabel('Vault password', { exact: true }).fill('browser-payment-fixture-password');
  await page.getByRole('button', { name: 'Create encrypted vault' }).click();
  await page.getByLabel('I have saved my recovery kit and credential').check();
  await page.getByRole('button', { name: 'Finish account setup' }).click();
  await expect(page.getByRole('heading', { name: 'Your current capacity' })).toBeVisible();
  await page.getByLabel('Additional paid slots').fill('240');
  await expect(page.getByText('$140.00 / month', { exact: false }).first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Approve and prepare card checkout' }),
  ).toBeDisabled();
  await page.getByLabel('I approve this capacity and recurring monthly price.').check();
  await page.getByRole('button', { name: 'Approve and prepare card checkout' }).click();
  await expect(page.getByRole('button', { name: 'Continue secure Stripe checkout' })).toBeVisible();
  expect(changes).toHaveLength(1);
  expect(status.effectiveCapacity).toBe(10);
  expect(status.subscription?.monthlyUsdCents).toBe(14000);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: '.artifacts/browser/hosting-' + test.info().project.name + '.png',
  });
  await page.goto('/payments?dao=' + encodeURIComponent(JSON.stringify(dao)));
  await expect(page.getByRole('heading', { name: 'Merchant setup', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Connect an existing Stripe account' }),
  ).toBeDisabled();
  await expect(page.getByText('Current commission: 5%', { exact: false })).toBeVisible();
  await expect(
    page.getByText('Products create card payment receipts.', { exact: false }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: '.artifacts/browser/payments-' + test.info().project.name + '.png',
  });
});
