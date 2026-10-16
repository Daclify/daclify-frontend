import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  AccountControlRequestSchema,
  AccountControlMessageSchema,
  ApiRoutes,
  CreationOrderViewSchema,
  DaoClaimIssueSchema,
  defaultDaoSetup,
  VERSION,
} from '@daclify/core-protocol';
import { legalFixture } from '../helpers/legal-templates';

async function savedOrder(
  page: Page,
  options: { eligible?: boolean; paid?: boolean; reserved?: boolean } = {},
) {
  const fixture = await legalFixture(page);
  const network = {
    chainId: fixture.dao.chainId,
    runtime: fixture.dao.contract,
    rpcUrl: 'https://rpc.example',
    hub: null,
    environment: 'testnet',
    interfaceVersion: 1,
    coreVersion: VERSION,
    capabilities: ['shared-dao-create', 'dao-presets', 'dao-claim-links'],
  };
  const order = CreationOrderViewSchema.parse({
    network,
    requestId: '33333333-3333-4333-8333-333333333333',
    deployment: 'shared',
    method: options.paid ? 'card' : 'free',
    usdCents: options.paid ? 2000 : 0,
    setup: {
      metadata: {
        schemaVersion: 1,
        title: 'Saved community setup',
        description: 'Exact saved community purpose',
      },
      privacy: 'encrypted-managed-allowed',
      token: { chainId: network.chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
      setup: defaultDaoSetup('team'),
    },
    creator: {
      signingKey: fixture.account.signingKey,
      encryptionKey: fixture.account.encryptionKey,
      custody: fixture.account.custody,
    },
    tlosAmount: null,
    recipient: '',
    tokenContract: 'eosio.token',
    memo: '',
    expires: Math.floor(Date.now() / 1000) + 3600,
    state: 'paid',
    dao: null,
    checkoutUrl: null,
    ...(options.reserved ? { founderExecutive: false } : {}),
  });
  const writes: string[] = [],
    issued: unknown[] = [];
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') writes.push(path);
    if (path === '/v1/network') return route.fulfill({ json: network });
    if (path === '/v1/dao-orders/' + order.requestId) return route.fulfill({ json: order });
    if (path === '/v1/dao-claims/eligibility')
      return route.fulfill({
        json: { eligible: options.eligible ?? true, governingDao: fixture.dao },
      });
    if (path === '/v1/dao-claims') return route.fulfill({ json: [] });
    if (path === '/v1/dao-claims/sign-in-approval')
      return route.fulfill({ json: { expires: new Date(Date.now() + 240000).toISOString() } });
    if (path === '/v1/account/control') {
      const request = AccountControlRequestSchema.parse(route.request().postDataJSON());
      const id = randomUUID(),
        expires = new Date(Date.now() + 240000).toISOString();
      return route.fulfill({
        json: {
          id,
          expires,
          message: JSON.stringify(
            AccountControlMessageSchema.parse({
              ...request,
              domain: 'daclify.account-control.v2',
              audience: new URL(route.request().url()).origin,
              origin: new URL(page.url()).origin,
              accountId: fixture.account.id,
              signingKey: fixture.account.signingKey,
              challengeId: id,
              expires,
            }),
          ),
        },
      });
    }
    if (path === '/v1/dao-claims/issue') {
      issued.push(DaoClaimIssueSchema.parse(route.request().postDataJSON()));
      return route.fulfill({
        json: {
          token: 's'.repeat(43),
          claim: {
            id: '44444444-4444-4444-8444-444444444444',
            request: order.setup,
            chainId: network.chainId,
            runtime: network.runtime,
            method: null,
            expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
            state: 'ready',
          },
        },
      });
    }
    return route.fallback();
  });
  await page.goto('/create?order=' + order.requestId);
  await expect(
    page.getByRole('heading', { name: order.setup.metadata.title, exact: true }),
  ).toBeVisible();
  return { order, writes, issued };
}

test('copies a durable owner-only order address that resumes the saved setup', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { order, writes } = await savedOrder(page);
  await page.getByRole('button', { name: 'Copy order link', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Order link copied' })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(new URL('/create?order=' + order.requestId, page.url()).toString());
  await page.goto(copied);
  await expect(
    page.getByRole('heading', { name: order.setup.metadata.title, exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([]);
});

test('keeps a selectable order address when clipboard access fails', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) },
    }),
  );
  const { order } = await savedOrder(page);
  await page.getByRole('button', { name: 'Copy order link', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Select and copy' })).toBeVisible();
  await expect(page.getByLabel('Saved order link (only for your account)')).toHaveValue(
    new URL('/create?order=' + order.requestId, page.url()).toString(),
  );
});

test('issues a separate claim link from the saved free setup without creating the original order', async ({
  page,
}) => {
  const { order, writes, issued } = await savedOrder(page);
  await page.getByText('Prepare this setup for someone else', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create claim link', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Create claim link', exact: true }).click();
  await expect(page.getByLabel('Private invitation link · copy now')).toHaveValue(
    new URL('/claim-dao#' + 's'.repeat(43), page.url()).toString(),
  );
  expect(issued).toEqual([{ request: order.setup }]);
  expect(writes).toEqual(['/v1/account/control', '/v1/dao-claims/issue']);
  await expect(
    page.getByText('Leave this order uncreated if the recipient should be the founder.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Create this DAO', exact: true })).toBeVisible();
});

test('retains the saved order when opening account access for claim approval', async ({ page }) => {
  const { order } = await savedOrder(page);
  await page.getByText('Prepare this setup for someone else', { exact: true }).click();
  await page.getByLabel('Approve invitation with').selectOption('vault');
  const link = page.getByRole('link', { name: 'Unlock your Daclify account', exact: true });
  const href = await link.getAttribute('href');
  if (!href) throw Error('APPROVAL_DESTINATION_REQUIRED');
  expect(new URL(href, page.url()).searchParams.get('returnTo')).toBe(
    '/create?order=' + order.requestId,
  );
  await link.click();
  await expect(page).toHaveURL(/\/account\?/);
  await expect(page.getByRole('tab', { name: 'Access & recovery', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel('Vault password', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: order.setup.metadata.title, exact: true }),
  ).toBeVisible();
});

for (const mode of ['non-executive', 'paid-receipt', 'reserved-claim'] as const) {
  test(`does not offer claim conversion for a ${mode}`, async ({ page }) => {
    const { writes } = await savedOrder(page, {
      eligible: mode !== 'non-executive',
      paid: mode === 'paid-receipt',
      reserved: mode === 'reserved-claim',
    });
    await expect(
      page.getByText('Prepare this setup for someone else', { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create this DAO', exact: true })).toBeVisible();
    expect(writes).toEqual([]);
  });
}

for (const action of ['create', 'resume'] as const) {
  test(`opens the DAO after ${action} with locked keys and offers approval setup in the workspace`, async ({
    page,
  }) => {
    const { order } = await savedOrder(page);
    const created = CreationOrderViewSchema.parse({
      ...order,
      state: 'created',
      dao: {
        chainId: order.network.chainId,
        contract: order.network.runtime,
        daoId: '1',
        interfaceVersion: 1,
      },
    });
    if (action === 'create') {
      await page.route(
        '**' + ApiRoutes.creationFulfill.path.replace(':id', order.requestId),
        (route) => route.fulfill({ json: created }),
      );
      await page.getByRole('button', { name: 'Create this DAO', exact: true }).click();
    } else {
      await page.route('**/v1/dao-orders/' + order.requestId, (route) =>
        route.fulfill({ json: created }),
      );
      await page.reload();
    }
    await expect(page).toHaveURL(/\/dao\/1$/);
    await expect(
      page.getByRole('region', { name: 'Workspace overview', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('complementary', { name: 'Account access', exact: true })
      .getByRole('link', { name: 'Set up approvals', exact: true })
      .click();
    await expect(page).toHaveURL(/\/account\?setup=approvals/);
    await expect(page.getByRole('tab', { name: 'Access & recovery', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('heading', { name: 'Approval setup', exact: true })).toBeVisible();
    const back = page.getByRole('link', { name: 'Return to your DAO or setup', exact: true });
    await expect(back).toHaveAttribute('href', '/dao/1');
    await back.click();
    await expect(page).toHaveURL(/\/dao\/1$/);
  });
}

test('keeps account entry links on their requested section', async ({ page }) => {
  await legalFixture(page);
  for (const [url, section] of [
    ['/account', 'Profile'],
    ['/account?returnTo=/create', 'Access & recovery'],
    ['/account?setup=approvals&dao=1&returnTo=/dao/1', 'Access & recovery'],
    ['/account?deviceApproval=22222222-2222-4222-8222-222222222222', 'Access & recovery'],
    ['/account?billing=submitted', 'Payment history'],
    ['/account?billing=cancelled', 'Payment history'],
    ['/account?telegramPair=22222222-2222-4222-8222-222222222222', 'Sign-in methods'],
    ['/account?returnTo=https://example.test', 'Profile'],
  ] as const) {
    await page.goto(url);
    await expect(page.getByRole('tab', { name: section, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  }
});
