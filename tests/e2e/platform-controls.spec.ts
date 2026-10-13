import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  ApiRoutes,
  NetworkSchema,
  DaoSummarySchema,
  DEFAULT_RESOURCE_POLICY,
  ModuleFeePricingSchema,
  MarketplaceSchema,
  AccountSchema,
  UserMembershipSchema,
  VERSION,
} from '@daclify/core-protocol';
import { RuntimeCodeHash } from '@daclify/core-protocol/sdk';
import { ModuleStateSchema } from '@daclify/modules';
import { PrivateKey } from '@wharfkit/antelope';
import { generateKeyPairSync } from 'node:crypto';
const network = NetworkSchema.parse({
  chainId: 'ab'.repeat(32),
  rpcUrl: 'http://127.0.0.1:18888',
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
const summary = DaoSummarySchema.parse({
  reference: dao,
  title: 'Daclify DAO',
  description: 'Platform fixture',
  privacy: 'public',
  owner: 'alice',
  token: { chainId: network.chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
  members: 1,
  available: '0',
  reserved: '0',
  claims: '0',
  keyEpoch: '0',
});
const account = AccountSchema.parse({
  id: '11111111-1111-4111-8111-111111111111',
  custody: 'user-controlled',
  signingKey: PrivateKey.generate('K1').toPublic().toString(),
  encryptionKey: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
    format: 'jwk',
  }),
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
  nativeAccount: 'alice',
  custody: 'user-controlled',
  signingKey: account.signingKey,
});
const status = ApiRoutes.status.response.parse({
  checkedAt: '2026-10-11T19:00:00Z',
  apiVersion: VERSION,
  moduleVersion: '0.9.0-alpha.23',
  rpc: 'reachable',
  chain: {
    network,
    chainId: network.chainId,
    chainMatches: true,
    headBlock: 100,
    irreversibleBlock: 90,
    headTime: '2026-10-11T19:00:00',
    contracts: [
      {
        account: network.runtime,
        moduleId: null,
        codeHash: RuntimeCodeHash,
        expectedHash: RuntimeCodeHash,
        verified: true,
        ramBytes: 4096,
        ramUsed: 1024,
        permissions: [],
      },
    ],
    catalogue: [],
    fees: null,
    market: null,
    creation: null,
    runtimeSettings: null,
    rateFresh: false,
    platformDao: dao,
    sharedAvailable: true,
    independentAvailable: false,
    hosting: { free_members: 10, settler: 'relay' },
    seatPricing: { first_usd: 100, next_usd: 50, rest_usd: 20, revision: '1' },
    resourcePolicy: DEFAULT_RESOURCE_POLICY,
  },
  database: { state: 'reachable', migrations: [] },
  services: [],
  limits: {
    sponsoredWritesPerAccount: 10,
    sponsoredWritesGlobal: 100,
    windowMs: 60000,
    uploadBytes: 2000000,
  },
  defaults: { sharedUsdCents: 0, independentUsdCents: 5000, tlosPremiumBps: 2000 },
});
const catalogue = MarketplaceSchema.parse({
  configured: true,
  reason: null,
  thirdPartyBps: 500,
  firstPartyBps: 10000,
  treasury: 'fees',
  modules: [
    {
      account: 'decide',
      publisher: 'fees',
      party: 'first-party',
      price: '0.0000 TLOS',
      title: 'Decide',
      codeHash: 'cd'.repeat(32),
      summary: 'Community decisions',
      detail: 'Polls and votes.',
    },
    {
      account: 'works',
      publisher: 'fees',
      party: 'first-party',
      price: '0.0000 TLOS',
      title: 'Works',
      codeHash: 'ef'.repeat(32),
      summary: 'Agreed milestones',
      detail: 'Reviews and completion.',
    },
  ],
});
const pricing = ModuleFeePricingSchema.parse({
  chainId: network.chainId,
  runtime: network.runtime,
  interfaceVersion: 1,
  freeMembers: 10,
  plans: catalogue.modules.map((m, i) => ({
    title: m.title,
    codeHash: m.codeHash,
    pricing: {
      account: m.account,
      revision: '1',
      monthlyUsdCents: i === 0 ? 200 : 300,
      actions: ['open'],
    },
  })),
});
const modules = ModuleStateSchema.parse({
  dao,
  modules: [],
  ballots: [],
  votes: [],
  projects: [],
  milestones: [],
  schedules: [],
  entries: [],
  controls: [],
});
test.beforeEach(async ({ page }) => {
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === '/v1/network'
        ? network
        : path === '/v1/sign-in/session'
          ? { account }
          : path === ApiRoutes.memberships.path
            ? { memberships: [membership] }
            : path === '/v1/daos'
              ? { daos: [summary] }
              : path === '/v1/daos/1'
                ? summary
                : path === '/v1/platform/status'
                  ? status
                  : path === '/v1/marketplace'
                    ? catalogue
                    : path === '/v1/modules/pricing'
                      ? pricing
                      : path === '/v1/daos/1/modules'
                        ? modules
                        : { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' };
    return route.fulfill({ json: body });
  });
});
test('keeps settings compact and preserves drafts across keyboard sections', async ({ page }) => {
  await page.goto('/dao/1/platform');
  const tabs = page.getByRole('tablist', { name: 'Platform sections' });
  await expect(tabs).toBeVisible();
  await page.evaluate(async () => {
    const fixturePath = '/tests/fixtures/resource-wallet-browser.ts';
    (await import(fixturePath)).installResourceWallet();
    const signerPath = '/src/auth/action-signer.ts';
    (await import(signerPath)).selectedSigner.value = 'native';
  });
  await expect(page.getByRole('button', { name: 'Sign Decide monthly price' })).toBeEnabled();
  await page.getByLabel('Decide (USD / DAO / month)', { exact: true }).fill('2.75');
  await tabs.getByRole('tab', { name: 'Pricing', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Catalogue', exact: true })).toBeFocused();
  await expect(page.getByLabel('Decide (USD / DAO / month)', { exact: true })).toBeHidden();
  await page.keyboard.press('End');
  await expect(tabs.getByRole('tab', { name: 'Policies', exact: true })).toBeFocused();
  await expect(page.getByLabel('Included active member slots')).toBeVisible();
  await page.keyboard.press('Home');
  await expect(page.getByLabel('Decide (USD / DAO / month)', { exact: true })).toHaveValue('2.75');
  await expect(page.getByRole('button', { name: 'Sign hosting policy update' })).toBeHidden();
  expect((await new AxeBuilder({ page }).include('#main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: '.artifacts/browser/platform-controls-' + test.info().project.name + '.png',
    fullPage: true,
  });
});
test('finds a module and fills the exact registration and description fields', async ({ page }) => {
  await page.goto('/dao/1/platform');
  await page.getByRole('tab', { name: 'Catalogue', exact: true }).click();
  await page.getByLabel('Search registered modules').fill('works');
  await expect(page.getByRole('button', { name: 'Edit Decide', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit Works', exact: true }).click();
  await expect(page.getByLabel('Native module account', { exact: true }).first()).toHaveValue(
    'works',
  );
  await expect(page.getByLabel('Native module account', { exact: true }).last()).toHaveValue(
    'works',
  );
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Works');
  await expect(page.getByLabel('Summary', { exact: true })).toHaveValue('Agreed milestones');
  await expect(page.getByLabel('Verified deployed WASM hash')).toHaveValue('ef'.repeat(32));
  await page.getByLabel('Search registered modules').fill('no module matches');
  await expect(page.getByText('No modules match your search.', { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('#main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('keeps every signing action disabled when the administrator signer is locked', async ({
  page,
}) => {
  await page.goto('/dao/1/platform');
  for (const name of ['Pricing', 'Catalogue', 'Policies']) {
    await page.getByRole('tab', { name, exact: true }).click();
    for (const button of await page.getByRole('button', { name: /^Sign|^Remove/ }).all())
      await expect(button).toBeDisabled();
  }
  await expect(page.getByRole('main')).toContainText('Unlock or choose an authorized signer');
});
test('reports unavailable module pricing without inventing a zero fee', async ({ page }) => {
  await page.route('**/v1/modules/pricing', (route) =>
    route.fulfill({ status: 503, json: { code: 'CHAIN_UNAVAILABLE', message: 'Unavailable' } }),
  );
  await page.goto('/dao/1/platform');
  await expect(
    page.getByText('Monthly module pricing is unavailable.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign Decide monthly price' })).toHaveCount(0);
});
