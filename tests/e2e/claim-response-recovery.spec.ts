import { test, expect, type Page } from '@playwright/test';
import {
  ApiRoutes,
  ChainPlatformSchema,
  CreationOrderViewSchema,
  DaoClaimViewSchema,
  PlatformStatusSchema,
  defaultDaoSetup,
  VERSION,
} from '@daclify/core-protocol';
import { legalFixture } from '../helpers/legal-templates';

async function invitation(
  page: Page,
  state: 'ready' | 'claiming' | 'created' = 'ready',
  method: 'free' | 'card' = 'free',
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
    capabilities: ['shared-dao-create', 'dao-claim-links'],
  };
  const setup = {
    metadata: { schemaVersion: 1, title: 'Invited community', description: '' },
    privacy: 'public',
    token: fixture.summary.token,
    setup: defaultDaoSetup(),
  };
  const preview = DaoClaimViewSchema.parse({
    id: '33333333-3333-4333-8333-333333333333',
    request: setup,
    chainId: network.chainId,
    runtime: network.runtime,
    method: state === 'ready' ? null : method,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    state,
  });
  const created = CreationOrderViewSchema.parse({
    network,
    requestId: preview.id,
    deployment: 'shared',
    method,
    usdCents: method === 'free' ? 0 : 2000,
    setup,
    creator: {
      signingKey: fixture.account.signingKey,
      encryptionKey: fixture.account.encryptionKey,
      custody: fixture.account.custody,
    },
    tlosAmount: null,
    recipient: network.runtime,
    tokenContract: 'eosio.token',
    memo: 'fixture',
    expires: Math.floor(Date.now() / 1000) + 3600,
    state: 'created',
    dao: fixture.dao,
    checkoutUrl: null,
    founderExecutive: true,
  });
  const status = PlatformStatusSchema.parse({
    checkedAt: new Date().toISOString(),
    apiVersion: VERSION,
    moduleVersion: '0.10.0-alpha.42',
    chain: ChainPlatformSchema.parse({
      network,
      chainId: network.chainId,
      chainMatches: true,
      headBlock: 1,
      irreversibleBlock: 1,
      headTime: new Date().toISOString(),
      contracts: [],
      catalogue: [],
      fees: null,
      market: null,
      creation: {
        shared_usd: method === 'free' ? 0 : 2000,
        independent_usd: 5000,
        premium_bps: 2000,
        settler: 'relay',
        median: '10000',
        precision: 4,
        observed_at: 0,
      },
      runtimeSettings: null,
      rateFresh: true,
      platformDao: fixture.dao,
      sharedAvailable: true,
      independentAvailable: false,
    }),
    rpc: 'reachable',
    database: { state: 'reachable', migrations: [] },
    limits: {
      sponsoredWritesPerAccount: 10,
      sponsoredWritesGlobal: 100,
      windowMs: 60000,
      uploadBytes: 5000000,
    },
    services: [],
    defaults: { sharedUsdCents: 0, independentUsdCents: 5000, tlosPremiumBps: 2000 },
  });
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') writes.push(new URL(request.url()).pathname);
  });
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === ApiRoutes.network.path) return route.fulfill({ json: network });
    if (path === ApiRoutes.daoClaimPreview.path) return route.fulfill({ json: preview });
    if (path === ApiRoutes.status.path) return route.fulfill({ json: status });
    return route.fallback();
  });
  const orderPath = ApiRoutes.creationOrderStatus.path.replace(':id', preview.id);
  const open = async () => {
    await page.goto('/claim-dao#' + 'a'.repeat(43));
    await expect(
      page.getByRole('button', {
        name: state === 'ready' ? 'Claim and create DAO' : 'Resume my claim',
        exact: true,
      }),
    ).toBeEnabled();
  };
  return { fixture, created, writes, open, orderPath };
}

for (const interruption of ['gateway', 'network', 'pending'] as const) {
  test(`opens the verified DAO after a ${interruption} claim response without submitting again`, async ({
    page,
  }) => {
    const fixture = await invitation(page);
    let reads = 0;
    await page.route('**' + ApiRoutes.daoClaimConfirm.path, (route) =>
      interruption === 'gateway'
        ? route.fulfill({ status: 504, contentType: 'text/html', body: '<h1>Gateway Timeout</h1>' })
        : interruption === 'pending'
          ? route.fulfill({ status: 503, json: { code: 'DAO_CLAIM_PENDING', message: 'Pending' } })
          : route.abort('failed'),
    );
    await page.route('**' + fixture.orderPath, (route) => {
      reads++;
      return route.fulfill({ json: fixture.created });
    });
    await fixture.open();
    await page.getByRole('button', { name: 'Claim and create DAO', exact: true }).click();
    await expect(page).toHaveURL(/\/dao\/1$/);
    expect(reads).toBe(1);
    expect(fixture.writes.filter((path) => path === ApiRoutes.daoClaimConfirm.path)).toHaveLength(
      1,
    );
    expect(page.url()).not.toContain('a'.repeat(43));
  });
}

test('checks again when the saved claim is temporarily pending without resubmitting', async ({
  page,
}) => {
  const fixture = await invitation(page);
  let reads = 0;
  await page.route('**' + ApiRoutes.daoClaimConfirm.path, (route) => route.abort('failed'));
  await page.route('**' + fixture.orderPath, (route) => {
    reads++;
    return reads === 1
      ? route.fulfill({ status: 503, json: { code: 'CREATION_ORDER_PENDING', message: 'Pending' } })
      : route.fulfill({ json: fixture.created });
  });
  await fixture.open();
  await page.getByRole('button', { name: 'Claim and create DAO', exact: true }).click();
  await expect(page).toHaveURL(/\/dao\/1$/);
  expect(reads).toBe(2);
  expect(fixture.writes.filter((path) => path === ApiRoutes.daoClaimConfirm.path)).toHaveLength(1);
});

test('keeps an uncertain claim resumable and checks its saved result before another write', async ({
  page,
}) => {
  const fixture = await invitation(page);
  let available = false,
    reads = 0;
  await page.route('**' + ApiRoutes.daoClaimConfirm.path, (route) => route.abort('failed'));
  await page.route('**' + fixture.orderPath, (route) => {
    reads++;
    return available
      ? route.fulfill({ json: fixture.created })
      : route.fulfill({
          status: 503,
          json: { code: 'CREATION_ORDER_PENDING', message: 'Pending' },
        });
  });
  await fixture.open();
  await page.getByRole('button', { name: 'Claim and create DAO', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Creation may still be in progress' }),
  ).toBeVisible();
  expect(reads).toBe(3);
  await expect(page.getByRole('alert')).toHaveCount(0);
  available = true;
  await page.getByRole('button', { name: 'Resume my claim', exact: true }).click();
  await expect(page).toHaveURL(/\/dao\/1$/);
  expect(fixture.writes.filter((path) => path === ApiRoutes.daoClaimConfirm.path)).toHaveLength(1);
});

for (const state of ['claiming', 'created'] as const) {
  test(`resumes a ${state} invitation using its account-owned order without another claim write`, async ({
    page,
  }) => {
    const fixture = await invitation(page, state);
    await page.route('**' + fixture.orderPath, (route) => route.fulfill({ json: fixture.created }));
    await fixture.open();
    await page.getByRole('button', { name: 'Resume my claim', exact: true }).click();
    await expect(page).toHaveURL(/\/dao\/1$/);
    expect(fixture.writes.filter((path) => path === ApiRoutes.daoClaimConfirm.path)).toEqual([]);
  });
}

test('preserves a rejected claim rather than treating it as an uncertain creation', async ({
  page,
}) => {
  const fixture = await invitation(page);
  let reads = 0;
  await page.route('**' + fixture.orderPath, (route) => {
    reads++;
    return route.fulfill({ json: fixture.created });
  });
  await page.route('**' + ApiRoutes.daoClaimConfirm.path, (route) =>
    route.fulfill({
      status: 409,
      json: { code: 'DAO_CLAIM_RESERVED', message: 'Reserved' },
    }),
  );
  await fixture.open();
  await page.getByRole('button', { name: 'Claim and create DAO', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('reserved');
  expect(reads).toBe(0);
  await expect(page).toHaveURL(/\/claim-dao#/);
});

test('opens a normal successful claim without making recovery requests', async ({ page }) => {
  const fixture = await invitation(page);
  let reads = 0;
  await page.route('**' + fixture.orderPath, (route) => {
    reads++;
    return route.fulfill({ json: fixture.created });
  });
  await page.route('**' + ApiRoutes.daoClaimConfirm.path, (route) =>
    route.fulfill({ json: fixture.created }),
  );
  await fixture.open();
  await page.getByRole('button', { name: 'Claim and create DAO', exact: true }).click();
  await expect(page).toHaveURL(/\/dao\/1$/);
  expect(reads).toBe(0);
});

for (const invalid of ['order', 'network', 'dao', 'executive'] as const) {
  test(`does not accept a recovered result with the wrong ${invalid}`, async ({ page }) => {
    const fixture = await invitation(page);
    const result = CreationOrderViewSchema.parse({
      ...fixture.created,
      ...(invalid === 'order' ? { requestId: '44444444-4444-4444-8444-444444444444' } : {}),
      ...(invalid === 'network'
        ? { network: { ...fixture.created.network, chainId: 'cd'.repeat(32) } }
        : {}),
      ...(invalid === 'dao' ? { dao: { ...fixture.fixture.dao, contract: 'othercore' } } : {}),
      ...(invalid === 'executive' ? { founderExecutive: false } : {}),
    });
    await page.route('**' + ApiRoutes.daoClaimConfirm.path, (route) => route.abort('failed'));
    await page.route('**' + fixture.orderPath, (route) => route.fulfill({ json: result }));
    await fixture.open();
    await page.getByRole('button', { name: 'Claim and create DAO', exact: true }).click();
    if (invalid === 'executive')
      await expect(
        page.getByRole('status').filter({ hasText: 'Creation may still be in progress' }),
      ).toBeVisible();
    else await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/claim-dao#/);
    expect(fixture.writes.filter((path) => path === ApiRoutes.daoClaimConfirm.path)).toHaveLength(
      1,
    );
  });
}

test('retains a recovered unpaid order in the existing payment flow', async ({ page }) => {
  const fixture = await invitation(page, 'ready', 'card');
  const unpaid = CreationOrderViewSchema.parse({
    ...fixture.created,
    state: 'awaiting-payment',
    method: 'card',
    usdCents: 2000,
    founderExecutive: false,
    dao: null,
  });
  await page.route('**' + ApiRoutes.daoClaimConfirm.path, (route) => route.abort('failed'));
  await page.route('**' + fixture.orderPath, (route) => route.fulfill({ json: unpaid }));
  await fixture.open();
  await page.getByRole('button', { name: 'Claim and create DAO', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/create\\?order=' + unpaid.requestId + '$'));
  await expect(
    page.getByRole('heading', { name: unpaid.setup.metadata.title, exact: true }),
  ).toBeVisible();
  expect(fixture.writes.filter((path) => path === ApiRoutes.daoClaimConfirm.path)).toHaveLength(1);
  expect(fixture.writes).not.toContain(ApiRoutes.creationOrder.path);
});

test('ignores a late saved result after switching accounts', async ({ page }) => {
  const fixture = await invitation(page);
  let release: () => void = () => {
    throw Error('Status request must start');
  };
  let requested: () => void = () => {
    throw Error('Status waiter must start');
  };
  const waiting = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route('**' + ApiRoutes.daoClaimConfirm.path, (route) => route.abort('failed'));
  await page.route('**' + fixture.orderPath, async (route) => {
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    requested();
    await held;
    await route.fulfill({ json: fixture.created });
  });
  await fixture.open();
  await page.getByRole('button', { name: 'Claim and create DAO', exact: true }).click();
  await waiting;
  await page.evaluate(async () => {
    const path = '/src/state/workspace.ts';
    const module: typeof import('../../src/state/workspace') = await import(path);
    const state = module.useWorkspace();
    if (!state.account) throw Error('Fixture account required');
    state.account = { ...state.account, id: '55555555-5555-4555-8555-555555555555' };
  });
  const refreshed = page
    .waitForRequest((request) => new URL(request.url()).pathname === ApiRoutes.network.path, {
      timeout: 500,
    })
    .then(
      () => true,
      () => false,
    );
  release();
  expect(await refreshed).toBe(false);
  await expect(
    page.getByRole('button', { name: 'Claim and create DAO', exact: true }),
  ).toBeEnabled();
  await expect(page).toHaveURL(/\/claim-dao#/);
  expect(fixture.writes.filter((path) => path === ApiRoutes.daoClaimConfirm.path)).toHaveLength(1);
});
