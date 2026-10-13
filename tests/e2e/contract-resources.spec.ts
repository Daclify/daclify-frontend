import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ApiRoutes, NetworkSchema, VERSION } from '@daclify/core-protocol';
import { PackedTransaction, Serializer } from '@wharfkit/antelope';
import { z } from 'zod';
import {
  resourceAbi,
  resourceAccount,
  resourceInfo,
  resourceRawAbi,
} from '../fixtures/resource-rpc';

const network = NetworkSchema.parse({
  chainId: resourceInfo.chain_id,
  rpcUrl: 'https://rpc.example',
  runtime: 'core.we',
  hub: null,
  environment: 'testnet',
  interfaceVersion: 1,
  coreVersion: VERSION,
  capabilities: [],
});
const now = Math.floor(Date.now() / 1000);
const status = ApiRoutes.status.response.parse({
  checkedAt: new Date().toISOString(),
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
    headTime: resourceInfo.head_block_time,
    contracts: ['core.we', 'works', 'relay'].map((account) => ({
      account,
      moduleId: account === 'works' ? 'works' : null,
      codeHash: (account === 'relay' ? '00' : 'ab').repeat(32),
      expectedHash: null,
      verified: false,
      ramBytes: account === 'works' ? 20000 : 10000,
      ramUsed: account === 'core.we' ? 9900 : 1000,
      permissions: [],
    })),
    catalogue: [],
    fees: null,
    market: null,
    creation: {
      shared_usd: 0,
      independent_usd: 5000,
      premium_bps: 2000,
      settler: 'relay',
      median: '1000',
      precision: 4,
      observed_at: now,
    },
    runtimeSettings: null,
    rateFresh: true,
    platformDao: null,
    sharedAvailable: true,
    independentAvailable: false,
  },
});
const packedSchema = z.object({
  compression: z.union([z.literal(0), z.literal(1)]),
  signatures: z.array(z.string()),
  packed_context_free_data: z.string(),
  packed_trx: z.string(),
});
let sent: unknown[] = [];
test.beforeEach(async ({ page }) => {
  sent = [];
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/chain/get_info') return route.fulfill({ json: resourceInfo });
    if (path === '/v1/chain/get_raw_abi')
      return route.fulfill({ json: Serializer.objectify(resourceRawAbi) });
    if (path === '/v1/chain/get_table_rows')
      return route.fulfill({
        json: {
          rows: [
            {
              supply: '10000000000.0000 RAMCORE',
              base: { balance: '100000 RAM', weight: '0.50000000000000000' },
              quote: { balance: '100.0000 TLOS', weight: '0.50000000000000000' },
            },
          ],
          more: false,
          next_key: '',
        },
      });
    if (path === '/v1/chain/get_currency_balance') return route.fulfill({ json: ['20.0000 TLOS'] });
    if (path === '/v1/chain/get_account') {
      const input = z.object({ account_name: z.string() }).parse(route.request().postDataJSON());
      return route.fulfill({
        json: Serializer.objectify(
          resourceAccount(
            input.account_name,
            input.account_name === 'works' ? '20000' : '10000',
            input.account_name === 'core.we' ? '9900' : '1000',
          ),
        ),
      });
    }
    if (path === '/v1/chain/push_transaction') {
      const transaction = PackedTransaction.from(
        packedSchema.parse(route.request().postDataJSON()),
      ).getSignedTransaction();
      const action = transaction.actions[0];
      if (!action) throw new Error('EXPECTED_ACTION');
      sent.push(
        Serializer.objectify(
          Serializer.decode({ abi: resourceAbi, type: action.name.toString(), data: action.data }),
        ),
      );
      return route.fulfill({
        json: {
          transaction_id: transaction.id.toString(),
          processed: {
            id: transaction.id.toString(),
            block_num: 101,
            block_time: resourceInfo.head_block_time,
            receipt: { status: 'executed', cpu_usage_us: 1, net_usage_words: 1 },
            elapsed: 1,
            net_usage: 1,
            scheduled: false,
            action_traces: [],
            account_ram_delta: null,
          },
        },
      });
    }
    if (path === '/v1/sign-in/session') return route.fulfill({ status: 204 });
    return route.fulfill({
      status: 200,
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
async function openResources(page: Page) {
  await page.goto('/status');
  await page.getByRole('tab', { name: 'Contracts', exact: true }).click();
  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  const card = page.getByRole('dialog', { name: 'Contract resources', exact: true });
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Select core.we', exact: true })).toBeVisible();
  return card;
}
async function wallet(page: Page, waitForApproval = false) {
  await page.evaluate(async (delay) => {
    const path = '/tests/fixtures/resource-wallet-browser.ts';
    const fixture = await import(path);
    fixture.installResourceWallet(delay);
  }, waitForApproval);
}
test('shows complete contract totals, individual free percentages and the doubling preview', async ({
  page,
}) => {
  const card = await openResources(page);
  await expect(card.getByRole('region', { name: 'Resource totals', exact: true })).toContainText(
    '10,900 bytes',
  );
  await expect(card.getByRole('region', { name: 'Resource totals', exact: true })).toContainText(
    '30,000 bytes',
  );
  await expect(card).toContainText('USD reference');
  const first = card
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: 'Select core.we', exact: true }) });
  await expect(first).toContainText('99% used');
  await expect(first).toContainText('1% free');
  const slider = card.getByRole('slider', { name: 'RAM capacity target', exact: true });
  await slider.fill('200');
  await expect(card.getByRole('region', { name: 'Purchase preview', exact: true })).toContainText(
    '20,000 bytes',
  );
  await expect(card.getByRole('region', { name: 'Purchase preview', exact: true })).toContainText(
    '49.5%',
  );
  await expect(card.getByRole('button', { name: 'Connect Anchor', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(card).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Resources', exact: true })).toBeFocused();
});
test('prepares and sends a fixed RAM quantity from the selected payer after wallet approval', async ({
  page,
}) => {
  const card = await openResources(page);
  await wallet(page);
  await card.getByRole('slider', { name: 'RAM capacity target', exact: true }).fill('200');
  await card.getByRole('button', { name: 'Prepare purchase', exact: true }).click();
  await expect(card.getByRole('region', { name: 'Prepared purchase', exact: true })).toContainText(
    'alice',
  );
  await card.getByRole('button', { name: 'Buy RAM with Anchor', exact: true }).click();
  await expect(card.getByRole('status')).toContainText('Confirmed');
  expect(sent).toEqual([{ payer: 'alice', receiver: 'core.we', quant: '11.1673 TLOS' }]);
});
test('delegates CPU and NET with payer ownership rather than promising percentage capacity', async ({
  page,
}) => {
  const card = await openResources(page);
  await wallet(page);
  for (const kind of ['CPU', 'NET']) {
    await card.getByRole('button', { name: kind, exact: true }).click();
    await card.getByRole('slider', { name: kind + ' stake target', exact: true }).fill('200');
    await expect(card).toContainText('Capacity varies');
    await card.getByRole('button', { name: 'Prepare purchase', exact: true }).click();
    await card.getByRole('button', { name: 'Stake ' + kind + ' with Anchor', exact: true }).click();
    await expect(card.getByRole('status')).toContainText('Confirmed');
  }
  expect(sent).toEqual([
    {
      from: 'alice',
      receiver: 'core.we',
      stake_net_quantity: '0.0000 TLOS',
      stake_cpu_quantity: '2.0000 TLOS',
      transfer: false,
    },
    {
      from: 'alice',
      receiver: 'core.we',
      stake_net_quantity: '1.0000 TLOS',
      stake_cpu_quantity: '0.0000 TLOS',
      transfer: false,
    },
  ]);
});
test('closing the card while the wallet is waiting prevents broadcast', async ({ page }) => {
  const card = await openResources(page);
  await wallet(page, true);
  await card.getByRole('button', { name: 'Prepare purchase', exact: true }).click();
  await card.getByRole('button', { name: 'Buy RAM with Anchor', exact: true }).click();
  await expect(card).toContainText('Waiting for Anchor');
  await card.getByRole('button', { name: 'Close resources', exact: true }).click();
  await page.evaluate(async () => {
    const path = '/tests/fixtures/resource-wallet-browser.ts';
    (await import(path)).approveResourceWallet();
  });
  await page.waitForTimeout(200);
  expect(sent).toEqual([]);
});
test('unavailable account reads keep totals unavailable instead of treating them as zero', async ({
  page,
}) => {
  await page.route('**/v1/chain/get_account', (route) => {
    const input = z.object({ account_name: z.string() }).parse(route.request().postDataJSON());
    return input.account_name === 'works'
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({ json: Serializer.objectify(resourceAccount(input.account_name)) });
  });
  const card = await openResources(page);
  await expect(card.getByRole('region', { name: 'Resource totals', exact: true })).toContainText(
    'Unavailable',
  );
  await expect(card).toContainText('1 missing account');
});

test('an expired USD rate keeps native amounts visible without inventing a dollar value', async ({
  page,
}) => {
  if (!status.chain?.creation) throw new Error('EXPECTED_CREATION_RATE');
  await page.route('**/v1/platform/status', (route) =>
    route.fulfill({
      json: {
        ...status,
        chain: {
          ...status.chain,
          rateFresh: false,
          creation: { ...status.chain?.creation, observed_at: now - 901 },
        },
      },
    }),
  );
  const card = await openResources(page);
  await expect(card).toContainText(
    'USD estimates are unavailable without a fresh published TLOS rate',
  );
  await expect(card.getByRole('region', { name: 'Resource totals', exact: true })).toContainText(
    'USD unavailable',
  );
  await expect(card.getByRole('region', { name: 'Purchase preview', exact: true })).toContainText(
    'TLOS',
  );
});

test('insufficient liquid balance never offers a purchase to sign', async ({ page }) => {
  await page.route('**/v1/chain/get_currency_balance', (route) =>
    route.fulfill({ json: ['0.0001 TLOS'] }),
  );
  const card = await openResources(page);
  await wallet(page);
  await card.getByRole('button', { name: 'Prepare purchase', exact: true }).click();
  await expect(card.getByRole('alert')).toContainText('does not have enough liquid TLOS');
  await expect(card.getByRole('button', { name: 'Buy RAM with Anchor', exact: true })).toHaveCount(
    0,
  );
  expect(sent).toEqual([]);
});

test('a zero CPU stake uses an explicit positive amount rather than a misleading percentage increase', async ({
  page,
}) => {
  await page.route('**/v1/chain/get_account', (route) => {
    const input = z.object({ account_name: z.string() }).parse(route.request().postDataJSON());
    const account = Serializer.objectify(resourceAccount(input.account_name));
    const parsed = z
      .object({ total_resources: z.record(z.string(), z.unknown()) })
      .passthrough()
      .parse(account);
    return route.fulfill({
      json: {
        ...parsed,
        total_resources: { ...parsed.total_resources, cpu_weight: '0.0000 TLOS' },
      },
    });
  });
  const card = await openResources(page);
  await wallet(page);
  await card.getByRole('button', { name: 'CPU', exact: true }).click();
  await expect(card.getByRole('slider', { name: 'CPU stake target', exact: true })).toBeDisabled();
  await card.getByLabel('Additional CPU stake in TLOS', { exact: true }).fill('0.0001');
  await card.getByRole('button', { name: 'Prepare purchase', exact: true }).click();
  await card.getByRole('button', { name: 'Stake CPU with Anchor', exact: true }).click();
  await expect(card.getByRole('status')).toContainText('Confirmed');
  expect(sent).toEqual([
    {
      from: 'alice',
      receiver: 'core.we',
      stake_net_quantity: '0.0000 TLOS',
      stake_cpu_quantity: '0.0001 TLOS',
      transfer: false,
    },
  ]);
});

test('a RAM market outage keeps independently priced CPU staking available', async ({ page }) => {
  await page.route('**/v1/chain/get_table_rows', (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  const card = await openResources(page);
  await expect(card.getByRole('alert')).toContainText('RAM market price is unavailable');
  await wallet(page);
  await card.getByRole('button', { name: 'CPU', exact: true }).click();
  await card.getByRole('button', { name: 'Prepare purchase', exact: true }).click();
  await card.getByRole('button', { name: 'Stake CPU with Anchor', exact: true }).click();
  await expect(card.getByRole('status')).toContainText('Confirmed');
  expect(sent).toEqual([
    {
      from: 'alice',
      receiver: 'core.we',
      stake_net_quantity: '0.0000 TLOS',
      stake_cpu_quantity: '0.5000 TLOS',
      transfer: false,
    },
  ]);
});

test('an uncertain submission requires review and refreshes the recipient before preparing another purchase', async ({
  page,
}) => {
  let submitted = false;
  await page.route('**/v1/chain/get_account', (route) => {
    const input = z.object({ account_name: z.string() }).parse(route.request().postDataJSON());
    return route.fulfill({
      json: Serializer.objectify(
        resourceAccount(input.account_name, submitted ? '20000' : '10000'),
      ),
    });
  });
  await page.route('**/v1/chain/push_transaction', (route) => {
    submitted = true;
    return route.fulfill({ status: 503, json: {} });
  });
  const card = await openResources(page);
  await wallet(page);
  await card.getByRole('button', { name: 'Prepare purchase', exact: true }).click();
  await card.getByRole('button', { name: 'Buy RAM with Anchor', exact: true }).click();
  await expect(card.getByRole('alert')).toContainText('Submission could not be confirmed');
  await expect(card.getByRole('button', { name: 'Prepare purchase', exact: true })).toBeDisabled();
  await card.getByRole('button', { name: 'I have checked this transaction', exact: true }).click();
  await expect(card.getByRole('region', { name: 'Purchase preview', exact: true })).toContainText(
    '25,000 bytes',
  );
});
