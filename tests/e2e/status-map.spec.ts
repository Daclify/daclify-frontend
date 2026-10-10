import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ApiRoutes, NetworkSchema, VERSION } from '@daclify/core-protocol';
import { PrivateKey } from '@wharfkit/antelope';

const publicKey = PrivateKey.generate('K1').toPublic().toString();
const activeKey = PrivateKey.generate('K1').toPublic().toString();
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
const permission = (name: string, parent: string, withKey = true) => ({
  name,
  parent,
  threshold: 2,
  keys: withKey ? [{ key: publicKey, weight: 1 }] : [],
  accounts: [{ actor: 'alice', permission: 'active', weight: 1 }],
  waits: [],
});
const status = ApiRoutes.status.response.parse({
  checkedAt: '2026-10-10T12:00:00.000Z',
  apiVersion: VERSION,
  moduleVersion: VERSION,
  rpc: 'reachable',
  database: { state: 'reachable', migrations: [] },
  services: [],
  limits: {
    sponsoredWritesPerAccount: 10,
    sponsoredWritesGlobal: 100,
    windowMs: 60000,
    uploadBytes: 2000000,
  },
  defaults: { sharedUsdCents: 0, independentUsdCents: 5000, tlosPremiumBps: 2000 },
  chain: {
    network,
    chainId: network.chainId,
    chainMatches: true,
    headBlock: 100,
    irreversibleBlock: 90,
    headTime: '2026-10-10T12:00:00',
    contracts: [
      {
        account: 'core.we',
        moduleId: null,
        codeHash: 'ab'.repeat(32),
        expectedHash: 'ab'.repeat(32),
        verified: true,
        ramBytes: 4096,
        ramUsed: 1024,
        permissions: [
          permission('owner', ''),
          {
            ...permission('active', 'owner'),
            keys: [
              { key: publicKey, weight: 1 },
              { key: activeKey, weight: 2 },
            ],
          },
          {
            name: 'execctx',
            parent: 'active',
            threshold: 1,
            keys: [],
            accounts: [{ actor: 'core.we', permission: 'eosio.code', weight: 1 }],
            waits: [],
          },
        ],
      },
      {
        account: 'works',
        moduleId: 'works',
        codeHash: 'cd'.repeat(32),
        expectedHash: 'ab'.repeat(32),
        verified: false,
        ramBytes: -1,
        ramUsed: 2048,
        permissions: [
          permission('owner', ''),
          {
            name: 'active',
            parent: 'owner',
            threshold: 1,
            keys: [],
            accounts: [{ actor: 'core.we', permission: 'execctx', weight: 1 }],
            waits: [],
          },
        ],
      },
    ],
    catalogue: [],
    fees: null,
    market: null,
    creation: null,
    runtimeSettings: null,
    rateFresh: false,
    platformDao: null,
    sharedAvailable: true,
    independentAvailable: false,
  },
});
const info = {
  server_version: '12345678',
  chain_id: network.chainId,
  head_block_num: 100,
  last_irreversible_block_num: 90,
  last_irreversible_block_id: 'ab'.repeat(32),
  head_block_id: 'ab'.repeat(32),
  head_block_time: '2026-10-10T12:00:00.000',
  head_block_producer: 'eosio',
  virtual_block_cpu_limit: 200000,
  virtual_block_net_limit: 1048576,
  block_cpu_limit: 200000,
  block_net_limit: 1048576,
};
function account(name: string) {
  return {
    account_name: name,
    head_block_num: 100,
    head_block_time: info.head_block_time,
    privileged: false,
    last_code_update: info.head_block_time,
    created: info.head_block_time,
    ram_quota: name === 'works' ? -1 : 4096,
    ram_usage: name === 'works' ? 2048 : 1024,
    net_weight: 1000,
    cpu_weight: 1000,
    cpu_limit: {
      used: '9007199254740993',
      available: '9007199254740993',
      max: '18014398509481986',
    },
    net_limit: { used: 0, available: 0, max: 0 },
    permissions: (
      status.chain?.contracts.find((contract) => contract.account === name)?.permissions ?? []
    ).map((permission) => ({
      perm_name: permission.name,
      parent: permission.parent,
      required_auth: {
        threshold: permission.threshold,
        keys: permission.keys,
        accounts: permission.accounts.map(({ actor, permission, weight }) => ({
          permission: { actor, permission },
          weight,
        })),
        waits: permission.waits.map(({ seconds, weight }) => ({ wait_sec: seconds, weight })),
      },
      ...(permission.name === 'execctx'
        ? {
            linked_actions: [
              { account: 'eosio', action: 'claimrewards' },
              { account: 'works', action: 'claim' },
            ],
          }
        : {}),
    })),
  };
}
test.beforeEach(async ({ page }) => {
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/chain/get_info') return route.fulfill({ json: info });
    if (path === '/v1/chain/get_account') {
      const input: unknown = route.request().postDataJSON();
      const name =
        typeof input === 'object' && input !== null && 'account_name' in input
          ? String(input.account_name)
          : '';
      return route.fulfill({ json: account(name) });
    }
    return route.fulfill({
      status: path === '/v1/me' ? 401 : 200,
      json:
        path === '/v1/network'
          ? network
          : path === '/v1/platform/status'
            ? status
            : path === '/v1/docs/agent'
              ? { configured: false }
              : path === '/v1/daos'
                ? { daos: [] }
                : { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' },
    });
  });
});
async function openContracts(page: import('@playwright/test').Page) {
  await page.goto('/status');
  await page.getByRole('tab', { name: 'Contracts', exact: true }).click();
}

test('a contract-name diagram switches a single account detail panel containing resources and the tree', async ({
  page,
}) => {
  await openContracts(page);
  const diagram = page.getByRole('region', { name: 'Contract connections', exact: true });
  await expect(diagram.getByRole('button')).toHaveText(['core.we', 'works']);
  const details = page.getByRole('region', { name: 'Contract Account Details', exact: true });
  await expect(details.getByRole('heading', { name: 'core.we', exact: true })).toBeVisible();
  await expect(
    details.getByRole('meter', { name: 'core.we CPU usage', exact: true }),
  ).toBeVisible();
  await expect(details.getByRole('region', { name: 'Permission map', exact: true })).toBeVisible();
  await expect(diagram.locator('[data-connection-kind="delegation"]')).toHaveCount(1);
  await expect(diagram.locator('[data-connection-kind="action"]')).toHaveCount(1);
  await expect(diagram.getByRole('button', { name: 'core.we', exact: true })).toHaveAttribute(
    'aria-description',
    /core.we@execctx → works::claim/,
  );
  await expect(page.getByRole('button', { name: 'List view', exact: true })).toHaveCount(0);
  await expect(page.getByText('Follow the authority', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Public permission authorities', { exact: true })).toHaveCount(0);
  await diagram.getByRole('button', { name: 'works', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(details.getByRole('heading', { name: 'works', exact: true })).toBeVisible();
  await expect(details).toContainText('Unlimited');
  await expect(details.getByRole('button', { name: 'works@active', exact: true })).toBeVisible();
  await expect(diagram.getByRole('button', { name: 'works', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(details.getByRole('button', { name: 'core.we@active', exact: true })).toHaveCount(0);
});

test('permission tree groups inline signers under owner, active and custom children with reported action links', async ({
  page,
}) => {
  await openContracts(page);
  const map = page.getByRole('region', { name: 'Permission map', exact: true });
  const owner = map.getByRole('article', { name: 'Permission owner', exact: true });
  const active = map.getByRole('article', { name: 'Permission active', exact: true });
  const child = map.getByRole('article', { name: 'Permission execctx', exact: true });
  await expect(
    owner.getByRole('button', { name: `Public key ${publicKey}`, exact: true }),
  ).toBeVisible();
  await expect(
    active.getByRole('button', { name: `Public key ${publicKey}`, exact: true }),
  ).toBeVisible();
  await expect(
    active.getByRole('button', { name: `Public key ${activeKey}`, exact: true }),
  ).toContainText('+2');
  await expect(
    owner.locator('..').getByRole('article', { name: 'Permission active', exact: true }),
  ).toBeVisible();
  await expect(
    active.locator('..').getByRole('article', { name: 'Permission execctx', exact: true }),
  ).toBeVisible();
  await expect(child).toContainText('eosio::claimrewards');
  await active.getByRole('button', { name: `Public key ${publicKey}`, exact: true }).click();
  await expect(
    owner.getByRole('button', { name: `Public key ${publicKey}`, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Selected authority', exact: true })).toContainText(
    'works@owner',
  );
});

test('many reported action links remain compact and expand with the keyboard', async ({ page }) => {
  await page.route('**/v1/chain/get_account', (route) => {
    const input: unknown = route.request().postDataJSON();
    const name =
      typeof input === 'object' && input !== null && 'account_name' in input
        ? String(input.account_name)
        : '';
    const reading = account(name);
    return route.fulfill({
      json: {
        ...reading,
        permissions: reading.permissions.map((permission) =>
          permission.perm_name === 'execctx'
            ? {
                ...permission,
                linked_actions: Array.from({ length: 12 }, (_, index) => ({
                  account: 'eosio',
                  action: 'claim' + String.fromCharCode(97 + index),
                })),
              }
            : permission,
        ),
      },
    });
  });
  await openContracts(page);
  const child = page.getByRole('article', { name: 'Permission execctx', exact: true });
  await expect(child.getByText('eosio::claima', { exact: true })).toBeVisible();
  await expect(child.getByText('eosio::claimd', { exact: true })).not.toBeVisible();
  const disclosure = child.getByText('9 more actions', { exact: true });
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(child.getByText('eosio::claimd', { exact: true })).toBeVisible();
  await expect(child.getByText('eosio::claiml', { exact: true })).toBeVisible();
});

test('tree selection highlights shared signers and contract connections without repeating authority definitions', async ({
  page,
}) => {
  await openContracts(page);
  const explorer = page.getByRole('region', { name: 'Contract explorer', exact: true });
  await expect(explorer).toBeVisible();
  const map = explorer.getByRole('region', { name: 'Permission map', exact: true });
  await map.getByRole('button', { name: 'core.we@active', exact: true }).click();
  const inspector = explorer.getByRole('region', { name: 'Selected authority', exact: true });
  await expect(map.getByRole('button', { name: 'core.we@active', exact: true })).toHaveAttribute(
    'title',
    'Threshold 2 · parent owner',
  );
  await expect(inspector).toContainText('No additional matching delegation');
  await expect(map.locator('[data-edge-kind="hierarchy"]')).toHaveCount(2);
  await expect(map.locator('[data-edge-kind="key"]')).toHaveCount(3);
  await map
    .getByRole('button', { name: `Public key ${publicKey}`, exact: true })
    .first()
    .click();
  await expect(inspector).toContainText('core.we@owner');
  await expect(inspector).toContainText('core.we@active');
  await expect(inspector).toContainText('works@owner');
  await expect(inspector).toContainText('Shared key');
  await expect(
    explorer
      .getByRole('region', { name: 'Contract connections', exact: true })
      .getByRole('button', { name: 'works', exact: true }),
  ).toHaveAttribute('data-related', 'true');
  await map.getByRole('button', { name: 'core.we@execctx', exact: true }).click();
  await expect(
    map.getByRole('button', { name: 'Code authority core.we@eosio.code', exact: true }),
  ).toBeVisible();
  await expect(inspector).toContainText('works@active');
});

test('resources preserve large integers and distinguish zero capacity, unlimited and failed reads', async ({
  page,
}) => {
  await openContracts(page);
  const explorer = page.getByRole('region', { name: 'Contract explorer', exact: true });
  const core = explorer.getByRole('region', { name: 'Contract Account Details', exact: true });
  await expect(core).toContainText('9,007,199,254,740,993 µs');
  await expect(core).toContainText('No capacity');
  await expect(core.getByRole('meter', { name: 'core.we CPU usage', exact: true })).toHaveAttribute(
    'aria-valuenow',
    '50',
  );
  expect(
    (await core.getByRole('meter', { name: 'core.we CPU usage', exact: true }).boundingBox())
      ?.width,
  ).toBeGreaterThan(100);
  await explorer
    .getByRole('region', { name: 'Contract connections', exact: true })
    .getByRole('button', { name: 'works', exact: true })
    .click();
  await expect(core).toContainText('Unlimited');
  await expect(core).toContainText('Hash mismatch');
  await explorer
    .getByRole('region', { name: 'Contract connections', exact: true })
    .getByRole('button', { name: 'core.we', exact: true })
    .click();
  await page.route('**/v1/chain/get_account', (route) =>
    route.fulfill({ status: 503, json: { message: 'offline' } }),
  );
  await explorer.getByRole('button', { name: 'Refresh resources', exact: true }).click();
  await expect(explorer).toContainText('Resource readings unavailable');
  await expect(core).toContainText('Unavailable');
  await expect(explorer.getByRole('region', { name: 'Permission map', exact: true })).toBeVisible();
  await page.route('**/v1/chain/get_account', (route) =>
    route.fulfill({ json: account('core.we') }),
  );
  await explorer.getByRole('button', { name: 'Refresh resources', exact: true }).click();
  await expect(core).toContainText('9,007,199,254,740,993 µs');
});

test('a wrong-chain RPC cannot provide resource figures', async ({ page }) => {
  await page.route('**/v1/chain/get_info', (route) =>
    route.fulfill({ json: { ...info, chain_id: 'cd'.repeat(32) } }),
  );
  await openContracts(page);
  const explorer = page.getByRole('region', { name: 'Contract explorer', exact: true });
  await expect(explorer).toContainText('Resource chain mismatch');
  await expect(
    explorer.getByRole('region', { name: 'Contract Account Details', exact: true }),
  ).not.toContainText('9,007,199');
});

test('an account response for a different name cannot supply resource figures', async ({
  page,
}) => {
  await page.route('**/v1/chain/get_account', (route) =>
    route.fulfill({ json: account('wrongacct') }),
  );
  await openContracts(page);
  const explorer = page.getByRole('region', { name: 'Contract explorer', exact: true });
  await expect(explorer).toContainText('Resource readings unavailable for core.we, works');
  const card = explorer.getByRole('region', { name: 'Contract Account Details', exact: true });
  await expect(card).toContainText('1,024 bytes');
  await expect(card).toContainText('status snapshot');
  await expect(card).not.toContainText('9,007,199');
});

test('a delegated permission is distinguishable from its definition and can be followed', async ({
  page,
}) => {
  const core = status.chain?.contracts.find((contract) => contract.account === 'core.we');
  if (!core || !status.chain) throw new Error('Fixture requires runtime contract');
  await page.route('**/v1/platform/status', (route) =>
    route.fulfill({
      json: {
        ...status,
        chain: {
          ...status.chain,
          contracts: [
            {
              ...core,
              permissions: core.permissions.map((permission) =>
                permission.name === 'owner'
                  ? {
                      ...permission,
                      accounts: [
                        ...permission.accounts,
                        { actor: 'core.we', permission: 'active', weight: 1 },
                      ],
                    }
                  : permission,
              ),
            },
          ],
        },
      },
    }),
  );
  await openContracts(page);
  const explorer = page.getByRole('region', { name: 'Contract explorer', exact: true });
  const map = explorer.getByRole('region', { name: 'Permission map', exact: true });
  await map
    .getByRole('button', { name: 'Delegated permission core.we@active', exact: true })
    .click();
  const inspector = explorer.getByRole('region', { name: 'Selected authority', exact: true });
  await expect(inspector).toContainText('core.we@owner');
  await inspector.getByRole('button', { name: 'Inspect core.we@active', exact: true }).click();
  await expect(map.getByRole('button', { name: 'core.we@active', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(map.getByRole('button', { name: 'core.we@active', exact: true })).toHaveAttribute(
    'title',
    'Threshold 2 · parent owner',
  );
});

test('refresh discards delayed resource reads and retains the selected contract and disclosure', async ({
  page,
}) => {
  await openContracts(page);
  const explorer = page.getByRole('region', { name: 'Contract explorer', exact: true });
  await expect(explorer).toContainText('Resource readings checked');
  const details = explorer.getByRole('region', { name: 'Contract Account Details', exact: true });
  await explorer
    .getByRole('region', { name: 'Contract connections', exact: true })
    .getByRole('button', { name: 'works', exact: true })
    .click();
  await explorer.getByText('Release details', { exact: true }).click();
  let release = () => {},
    started = () => {},
    delivered = () => {};
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  const completed = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  let requests = 0;
  await page.route('**/v1/chain/get_account', async (route) => {
    const input: unknown = route.request().postDataJSON();
    const name =
      typeof input === 'object' && input !== null && 'account_name' in input
        ? String(input.account_name)
        : '';
    const first = ++requests <= 2;
    if (first) {
      started();
      await new Promise<void>((resolve) => {
        const before = release;
        release = () => {
          before();
          resolve();
        };
      });
      try {
        await route.fulfill({ json: account(name) });
      } finally {
        delivered();
      }
    } else
      await route.fulfill({
        json: { ...account(name), cpu_limit: { used: 7, available: 93, max: 100 } },
      });
  });
  await explorer.getByRole('button', { name: 'Refresh resources', exact: true }).click();
  await pending;
  await page.route('**/v1/platform/status', (route) =>
    route.fulfill({ json: { ...status, checkedAt: '2026-10-10T14:00:00.000Z' } }),
  );
  try {
    await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await expect(details.getByRole('heading', { name: 'works', exact: true })).toBeVisible();
    await expect(
      details.getByRole('button', { name: 'Delegated permission alice@active', exact: true }),
    ).toBeVisible();
    await expect(
      details
        .locator('details')
        .filter({ has: page.getByText('Release details', { exact: true }) }),
    ).toHaveAttribute('open', '');
    await expect(details).toContainText('7 µs');
  } finally {
    release();
  }
  await completed;
  await expect(details).not.toContainText('9,007,199');
});

test('the diagram and tree support keyboard, mobile, enlarged text and accessible details', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openContracts(page);
  const explorer = page.getByRole('region', { name: 'Contract explorer', exact: true });
  await expect(explorer).toContainText('Resource readings checked');
  const map = explorer.getByRole('region', { name: 'Permission map', exact: true });
  const owner = map.getByRole('button', { name: 'core.we@owner', exact: true });
  await owner.focus();
  await page.keyboard.press('Enter');
  await expect(owner).toHaveAttribute('aria-pressed', 'true');
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  const diagram = explorer.getByRole('region', { name: 'Contract connections', exact: true });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(diagram.getByRole('button', { name: 'works', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: test.info().outputPath(`contract-accounts-${width}.png`),
      fullPage: true,
    });
  }
  await diagram.getByRole('button', { name: 'works', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(explorer.getByRole('heading', { name: 'works', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Selected authority', exact: true })).toHaveCount(
    0,
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await diagram.getByRole('button', { name: 'core.we', exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    map.getByRole('button', { name: `Public key ${publicKey}`, exact: true }).first(),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(
    explorer.getByRole('meter', { name: 'core.we CPU usage', exact: true }),
  ).toBeVisible();
});
