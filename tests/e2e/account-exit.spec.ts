import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrivateKey } from '@wharfkit/antelope';
import { AccountSchema, ExitPreflightSchema, VERSION } from '@daclify/core-protocol';
import { createRecoveryRecipient } from '@daclify/core-protocol/sdk';
test('reviews sole-member closure without signing and keeps hosted erasure separate from native rights', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const recipient = await createRecoveryRecipient(),
    account = AccountSchema.parse({
      id: crypto.randomUUID(),
      custody: 'user-controlled',
      signingKey: PrivateKey.generate('K1').toPublic().toString(),
      encryptionKey: recipient.publicKey,
    });
  const reference = {
    chainId: 'ab'.repeat(32),
    contract: 'daclifycore',
    daoId: '1',
    interfaceVersion: 1,
  };
  let mutations = 0;
  const preflight = ExitPreflightSchema.parse({
    version: 1,
    nativeAvailable: true,
    memberships: [
      {
        reference,
        memberId: '1',
        nonce: '0',
        active: true,
        admin: true,
        claim: '100',
        stake: '200',
        nativeAccount: null,
        soleMember: true,
        lifecycle: 'active',
        reason: 'DAO_AVAILABLE',
      },
    ],
    limits: { memberships: 256, statusDays: 30 },
    retained: 'Shared history and unsettled rights remain.',
  });
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') mutations++;
    const responses: Record<string, unknown> = {
      '/v1/network': {
        chainId: reference.chainId,
        rpcUrl: 'https://rpc.example.test',
        runtime: reference.contract,
        hub: null,
        environment: 'testnet',
        interfaceVersion: 1,
        coreVersion: VERSION,
        capabilities: ['account-exit-v1'],
      },
      '/v1/daos': { daos: [], next: null },
      '/v1/me': { account },
      '/v1/me/memberships': { memberships: [] },
      '/v1/me/exit/preflight': preflight,
    };
    await route.fulfill({
      status: path in responses ? 200 : 503,
      json: responses[path] ?? { code: 'FIXTURE_UNAVAILABLE' },
    });
  });
  await page.goto('/account/exit');
  await expect(
    page.getByRole('heading', { name: 'Leave DAOs and delete your account', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Close this sole-member DAO')).not.toBeChecked();
  await page.getByLabel('Close this sole-member DAO').check();
  await page.getByLabel('Exit choice').selectOption('delete-account');
  await expect(page.getByLabel('Close this sole-member DAO')).toBeChecked();
  await expect(
    page.getByText(
      'Keep your recovery kit or linked wallet until all claims and stake are settled.',
      { exact: true },
    ),
  ).toBeVisible();
  expect(mutations).toBe(0);
  await page.getByRole('button', { name: 'Cancel review' }).click();
  expect(mutations).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
});
test('recovers an unknown begin response after reload using only its saved status capability', async ({
  page,
}) => {
  const chainId = 'ab'.repeat(32),
    id = crypto.randomUUID(),
    capability = 'a'.repeat(43),
    preflight = ExitPreflightSchema.parse({
      version: 1,
      nativeAvailable: false,
      memberships: [],
      limits: { memberships: 256, statusDays: 30 },
      retained: 'Required history',
    }),
    expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
  let api = '',
    nativeWrites = 0;
  const report = {
    version: 1,
    id,
    mode: 'delete-account',
    state: 'processing',
    components: [
      { id: 'hosted', state: 'confirmed', reason: 'HOSTED_IDENTITY_ERASED' },
      { id: 'native', state: 'unavailable', reason: 'NATIVE_UNAVAILABLE' },
    ],
    expiresAt,
  };
  await page.route('**/v1/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    if (request.method() === 'POST' && path !== '/v1/account-exit/status') nativeWrites++;
    api = url.origin + '/v1';
    const responses: Record<string, unknown> = {
      '/v1/network': {
        chainId,
        runtime: 'daclifycore',
        rpcUrl: 'https://rpc.example.test',
        hub: null,
        environment: 'testnet',
        interfaceVersion: 1,
        coreVersion: VERSION,
        capabilities: ['account-exit-v1'],
      },
      '/v1/daos': { daos: [], next: null },
      '/v1/account-exit/status': report,
    };
    await route.fulfill({
      status: path in responses ? 200 : 401,
      json: responses[path] ?? { code: 'AUTH_REQUIRED' },
    });
  });
  await page.goto('/account/exit');
  await expect(
    page.getByRole('heading', { name: 'Leave DAOs and delete your account', exact: true }),
  ).toBeVisible();
  await expect.poll(() => api).not.toBe('');
  await page.evaluate(
    ({ api, capability, preflight }) =>
      localStorage.setItem(
        'daclify.exit.v1:' + api + ':pending',
        JSON.stringify({
          version: 1,
          api,
          capability,
          preflight,
          daos: [],
          intent: { version: 1, mode: 'delete-account', memberships: [] },
          createdAt: new Date().toISOString(),
        }),
      ),
    { api, capability, preflight },
  );
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Account exit report', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('hosted identity erased')).toBeVisible();
  expect(nativeWrites).toBe(0);
  await page.getByRole('button', { name: 'Refresh report', exact: true }).click();
  expect(nativeWrites).toBe(0);
});

test('keeps an uncertain settlement through restart and never prepares or sends a replacement on page load', async ({
  page,
}) => {
  const chainId = 'ab'.repeat(32),
    id = crypto.randomUUID(),
    capability = 'b'.repeat(43),
    preflight = ExitPreflightSchema.parse({
      version: 1,
      nativeAvailable: false,
      memberships: [],
      limits: { memberships: 256, statusDays: 30 },
      retained: 'Required history',
    }),
    report = {
      version: 1,
      id,
      mode: 'delete-account',
      state: 'processing',
      components: [{ id: 'hosted', state: 'confirmed', reason: 'HOSTED_IDENTITY_ERASED' }],
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
    packet = {
      transactionId: 'cd'.repeat(32),
      packet: 'aa',
      firstBlock: 1,
      cursor: 1,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
  let api = '',
    writes = 0,
    receiptCalls = 0;
  await page.route('**/v1/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    api = url.origin + '/v1';
    if (
      request.method() === 'POST' &&
      !['/v1/account-exit/status', '/v1/account-exit/settlement/receipt'].includes(path)
    )
      writes++;
    if (path === '/v1/account-exit/settlement/receipt') {
      receiptCalls++;
      expect(request.postDataJSON()).toEqual(packet);
      return route.fulfill({ json: { state: 'pending', cursor: 1 } });
    }
    const responses: Record<string, unknown> = {
      '/v1/network': {
        chainId,
        runtime: 'daclifycore',
        rpcUrl: 'https://rpc.example.test',
        hub: null,
        environment: 'testnet',
        interfaceVersion: 1,
        coreVersion: VERSION,
        capabilities: ['account-exit-v1'],
      },
      '/v1/daos': { daos: [], next: null },
      '/v1/account-exit/status': report,
    };
    await route.fulfill({
      status: path in responses ? 200 : 401,
      json: responses[path] ?? { code: 'AUTH_REQUIRED' },
    });
  });
  await page.goto('/account/exit');
  await expect.poll(() => api).not.toBe('');
  await page.evaluate(
    ({ api, report, capability, preflight, packet }) => {
      const key = 'daclify.exit.v1:' + api;
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          api,
          operation: { ...report, statusCapability: capability },
          intent: { version: 1, mode: 'delete-account', memberships: [] },
          preflight,
          daos: [],
        }),
      );
      localStorage.setItem(
        key + ':settlement',
        JSON.stringify({
          version: 1,
          api,
          operationId: report.id,
          memberKey: 'pending-member',
          packet,
        }),
      );
    },
    { api, report, capability, preflight, packet },
  );
  await page.reload();
  await expect(
    page.getByText('Transaction ' + packet.transactionId, { exact: true }),
  ).toBeVisible();
  expect(writes).toBe(0);
  expect(receiptCalls).toBe(0);
  await page.getByRole('button', { name: 'Check exact settlement receipt' }).click();
  await expect(page.getByText('Awaiting irreversible confirmation', { exact: true })).toBeVisible();
  expect(receiptCalls).toBe(1);
  expect(writes).toBe(0);
});

test('cannot retry a signed settlement imported from another exit operation', async ({ page }) => {
  const id = crypto.randomUUID(),
    other = crypto.randomUUID(),
    capability = 'c'.repeat(43),
    chainId = 'ab'.repeat(32),
    preflight = ExitPreflightSchema.parse({
      version: 1,
      nativeAvailable: false,
      memberships: [],
      limits: { memberships: 256, statusDays: 30 },
      retained: 'History',
    }),
    report = {
      version: 1,
      id,
      mode: 'delete-account',
      state: 'processing',
      components: [],
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
  let api = '',
    writes = 0;
  await page.route('**/v1/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    api = url.origin + '/v1';
    if (request.method() === 'POST' && path !== '/v1/account-exit/status') writes++;
    const responses: Record<string, unknown> = {
      '/v1/network': {
        chainId,
        runtime: 'daclifycore',
        rpcUrl: 'https://rpc.example.test',
        hub: null,
        environment: 'testnet',
        interfaceVersion: 1,
        coreVersion: VERSION,
        capabilities: ['account-exit-v1'],
      },
      '/v1/daos': { daos: [], next: null },
      '/v1/account-exit/status': report,
    };
    await route.fulfill({
      status: path in responses ? 200 : 401,
      json: responses[path] ?? { code: 'AUTH_REQUIRED' },
    });
  });
  await page.goto('/account/exit');
  await expect.poll(() => api).not.toBe('');
  await page.evaluate(
    ({ api, report, capability, preflight, other }) => {
      const key = 'daclify.exit.v1:' + api;
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          api,
          operation: { ...report, statusCapability: capability },
          intent: { version: 1, mode: 'delete-account', memberships: [] },
          preflight,
          daos: [],
        }),
      );
      localStorage.setItem(
        key + ':settlement',
        JSON.stringify({
          version: 1,
          api,
          operationId: other,
          memberKey: 'original-member',
          packet: {
            transactionId: 'cd'.repeat(32),
            packet: 'aa',
            firstBlock: 1,
            cursor: 1,
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          },
        }),
      );
    },
    { api, report, capability, preflight, other },
  );
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Retry the same signed settlement' }),
  ).toBeDisabled();
  expect(writes).toBe(0);
});
