import { expect, test, type Page } from '@playwright/test';
import { moduleFixture } from './fixtures/module-design';
import {
  ApiRoutes,
  LoginMessageSchema,
  RecoveryKitSchema,
  AccountSchema,
  CreationOrderViewSchema,
  defaultDaoSetup,
  DaoClaimViewSchema,
  PlatformStatusSchema,
} from '@daclify/core-protocol';
import { PublicKey, Signature } from '@wharfkit/antelope';
import { instructionDigest } from '@daclify/core-protocol/sdk';
import { createVault } from '../../src/auth/vault';
import AxeBuilder from '@axe-core/playwright';

test('a claimed DAO uses the same approval setup without carrying its invitation secret', async ({
  page,
}) => {
  const fixture = await approvalFixture(page),
    token = 'a'.repeat(43);
  const first = fixture.members[0];
  if (!first) throw new Error('Member fixture required');
  const member = { ...first, dao: { ...first.dao, daoId: '3' } };
  const request = {
    metadata: { schemaVersion: 1, title: 'Claimed community', description: '' },
    privacy: 'public',
    token: fixture.summary.token,
    setup: defaultDaoSetup(),
  };
  const preview = DaoClaimViewSchema.parse({
    id: crypto.randomUUID(),
    request,
    chainId: fixture.network.chainId,
    runtime: fixture.network.runtime,
    method: 'free',
    expiresAt: new Date(Date.now() + 120000).toISOString(),
    state: 'created',
  });
  await page.route('**' + ApiRoutes.daoClaimPreview.path, (route) =>
    route.fulfill({ json: preview }),
  );
  await page.route('**' + ApiRoutes.status.path, (route) =>
    route.fulfill({
      json: PlatformStatusSchema.parse({
        checkedAt: new Date().toISOString(),
        apiVersion: fixture.network.coreVersion,
        moduleVersion: '0.10.0-alpha.28',
        chain: null,
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
      }),
    }),
  );
  await page.route('**' + ApiRoutes.daoClaimConfirm.path, (route) => {
    expect(ApiRoutes.daoClaimConfirm.input.parse(route.request().postDataJSON()).token).toBe(token);
    fixture.members.push(member);
    return route.fulfill({
      json: CreationOrderViewSchema.parse({
        network: fixture.network,
        setup: request,
        creator: {
          signingKey: fixture.account.signingKey,
          encryptionKey: fixture.account.encryptionKey,
          custody: fixture.account.custody,
        },
        requestId: crypto.randomUUID(),
        deployment: 'shared',
        method: 'free',
        usdCents: 0,
        tlosAmount: null,
        recipient: fixture.network.runtime,
        tokenContract: 'eosio.token',
        memo: 'fixture',
        expires: Math.floor(Date.now() / 1000) + 120,
        state: 'created',
        dao: member.dao,
        checkoutUrl: null,
        founderExecutive: true,
      }),
    });
  });
  await page.goto('/claim-dao#' + token);
  await page.getByRole('button', { name: 'Resume my claim', exact: true }).click();
  await expect(page).toHaveURL(/\/account\?setup=approvals.*dao=3/);
  expect(page.url()).not.toContain(token);
  await expect(page.getByRole('heading', { name: 'Approval setup', exact: true })).toBeVisible();
  expect(fixture.submitted).toEqual([]);
});

async function approvalFixture(page: Page) {
  const base = await moduleFixture(page),
    password = 'disposable approval fixture password';
  const vault = await createVault(password);
  const account = AccountSchema.parse({
    ...base.account,
    signingKey: vault.signingPublicKey,
    encryptionKey: vault.encryptionPublicKey,
  });
  const members = ['1', '2'].map((id) => ({
    ...base.member,
    dao: { ...base.dao, daoId: id },
    signingKey: account.signingKey,
  }));
  const address = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
  const enabled = new Set<string>(),
    prior = new Map<string, string>(),
    submitted: string[] = [];
  let message = '',
    failSecond = false;
  await page.addInitScript(
    ({ kit, address }) => {
      if (!localStorage.getItem('daclify.vault.v1'))
        localStorage.setItem('daclify.vault.v1', JSON.stringify(kit));
      Object.defineProperty(window, 'ethereum', {
        configurable: true,
        value: {
          request: async ({ method }: { method: string }) =>
            method === 'eth_chainId'
              ? '0x29'
              : method === 'eth_accounts' || method === 'eth_requestAccounts'
                ? [address]
                : method === 'eth_signTypedData_v4'
                  ? '0x' + '11'.repeat(64) + '1b'
                  : null,
        },
      });
    },
    {
      kit: RecoveryKitSchema.parse({
        version: 1,
        localEnvelope: vault.localEnvelope,
        recoveryEnvelope: vault.recoveryEnvelope,
        signingPublicKey: vault.signingPublicKey,
        encryptionPublicKey: vault.encryptionPublicKey,
      }),
      address,
    },
  );
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/network')
      return route.fulfill({ json: { ...base.network, capabilities: ['evm-eoa-governance'] } });
    if (path === '/v1/daos')
      return route.fulfill({
        json: {
          daos: members.map((member) => ({
            ...base.summary,
            title: 'Community ' + member.dao.daoId,
            reference: member.dao,
          })),
          next: null,
        },
      });
    if (path === '/v1/sign-in/session' || path === '/v1/me')
      return route.fulfill({ json: path === '/v1/me' ? { account } : { account } });
    if (path === '/v1/me/memberships') return route.fulfill({ json: { memberships: members } });
    if (path === '/v1/account/evm')
      return route.fulfill({ json: { links: [{ chainId: 41, address, controlVerified: true }] } });
    if (path === '/v1/account/native') return route.fulfill({ json: { links: [] } });
    if (path === '/v1/account/recovery')
      return route.fulfill({
        json: {
          configured: false,
          assistedEver: false,
          assistedRevision: 0,
          reason: 'RECOVERY_UNAVAILABLE',
          methods: [],
        },
      });
    const binding = path.match(/^\/v1\/daos\/(\d+)\/evm\/1$/);
    if (binding)
      return route.fulfill({
        json: {
          binding:
            enabled.has(binding[1] ?? '') || prior.has(binding[1] ?? '')
              ? {
                  member_id: '1',
                  chain_id: '41',
                  address: enabled.has(binding[1] ?? '')
                    ? address.slice(2)
                    : prior.get(binding[1] ?? '')?.slice(2),
                  epoch: '1',
                  active: true,
                }
              : null,
        },
      });
    if (path === ApiRoutes.challenge.path) {
      const identity = ApiRoutes.challenge.input.parse(route.request().postDataJSON()),
        origin = new URL(route.request().url()).origin,
        id = crypto.randomUUID(),
        expires = new Date(Date.now() + 120000).toISOString();
      message = JSON.stringify(
        LoginMessageSchema.parse({
          domain: 'daclify.login.v3',
          challenge: id,
          origin,
          audience: origin,
          expires,
          ...identity,
        }),
      );
      return route.fulfill({ json: { id, expires, message } });
    }
    if (path === ApiRoutes.login.path) {
      const input = ApiRoutes.login.input.parse(route.request().postDataJSON());
      expect(
        Signature.from(input.signature).verifyMessage(
          new TextEncoder().encode(message),
          PublicKey.from(account.signingKey ?? ''),
        ),
      ).toBe(true);
      return route.fulfill({ json: { account, csrfToken: 'ab'.repeat(32) } });
    }
    if (path === ApiRoutes.relay.path) {
      const input = ApiRoutes.relay.input.parse(route.request().postDataJSON());
      if (!('sig' in input)) throw new Error('Root consent required');
      expect(
        Signature.from(input.sig).verifyDigest(
          instructionDigest(input.request),
          PublicKey.from(account.signingKey ?? ''),
        ),
      ).toBe(true);
      expect(input.request.action).toBe('linkevm');
      if (failSecond && input.request.dao_id === '2') {
        failSecond = false;
        return route.fulfill({
          status: 503,
          json: { code: 'SERVICE_UNAVAILABLE', message: 'Disposable failed second activation' },
        });
      }
      submitted.push(input.request.dao_id);
      enabled.add(input.request.dao_id);
      return route.fulfill({ json: { transactionId: 'ab'.repeat(32) } });
    }
    return route.fallback();
  });
  return {
    account,
    network: base.network,
    summary: base.summary,
    members,
    password,
    submitted,
    priorWallet: (dao: string, wallet: string) => prior.set(dao, wallet),
    failNextSecond: () => {
      failSecond = true;
    },
  };
}

test('unlocking during approval setup stays on the setup screen', async ({ page }) => {
  const fixture = await approvalFixture(page);
  await page.goto('/account?setup=approvals&dao=1&returnTo=/dao/1/documents');
  await page.getByLabel('Default approval method').selectOption('evm');
  await page.getByRole('button', { name: 'Connect your paired wallet' }).click();
  await expect(page.getByRole('checkbox', { name: /Community 1/ })).toBeChecked();
  await page.getByRole('checkbox', { name: /Community 1/ }).uncheck();
  await page.getByRole('button', { name: 'Save default approval method', exact: true }).click();
  await expect(
    page.getByText('Default saved for this account and network on this browser.'),
  ).toBeVisible();
  await page.getByLabel('Vault password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(
    page.getByText('Ready to sign actions and open your private documents.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/\/account\?.*setup=approvals/);
  expect(fixture.submitted).toEqual([]);
  await page.getByRole('link', { name: 'Return to your DAO or setup' }).click();
  await expect(page.getByLabel('Authorize actions with')).toHaveValue('evm');
});

test('creating a DAO with locked account keys finishes through the same setup flow', async ({
  page,
}) => {
  const fixture = await approvalFixture(page),
    id = crypto.randomUUID();
  const order = CreationOrderViewSchema.parse({
    network: fixture.network,
    setup: {
      metadata: { schemaVersion: 1, title: 'New community', description: '' },
      privacy: 'public',
      token: fixture.summary.token,
      setup: defaultDaoSetup(),
    },
    creator: {
      signingKey: fixture.account.signingKey,
      encryptionKey: fixture.account.encryptionKey,
      custody: fixture.account.custody,
    },
    requestId: id,
    deployment: 'shared',
    method: 'free',
    usdCents: 0,
    tlosAmount: null,
    recipient: fixture.network.runtime,
    tokenContract: 'eosio.token',
    memo: 'fixture',
    expires: Math.floor(Date.now() / 1000) + 120,
    state: 'paid',
    dao: null,
    checkoutUrl: null,
  });
  let creates = 0;
  await page.route('**' + ApiRoutes.creationOrderStatus.path.replace(':id', id), (route) =>
    route.fulfill({ json: order }),
  );
  await page.route('**' + ApiRoutes.creationFulfill.path.replace(':id', id), (route) => {
    creates++;
    const first = fixture.members[0];
    if (!first) throw new Error('Member fixture required');
    const member = { ...first, dao: { ...first.dao, daoId: '3' } };
    fixture.members.push(member);
    return route.fulfill({ json: { ...order, state: 'created', dao: member.dao } });
  });
  await page.goto('/create?order=' + id);
  await expect(page.getByRole('button', { name: 'Create this DAO', exact: true })).toBeVisible();
  expect(creates).toBe(0);
  await page.getByRole('button', { name: 'Create this DAO', exact: true }).click();
  await expect(page).toHaveURL(/\/account\?setup=approvals.*dao=3/);
  await expect(page.getByRole('heading', { name: 'Approval setup', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return to your DAO or setup' })).toHaveAttribute(
    'href',
    '/dao/3',
  );
  expect(creates).toBe(1);
  expect(fixture.submitted).toEqual([]);
});

test('one setup enables two selected DAOs and a retry skips the first confirmed activation', async ({
  page,
}) => {
  const fixture = await approvalFixture(page);
  fixture.priorWallet('2', '0x' + '22'.repeat(20));
  await page.goto('/account?setup=approvals&dao=1&returnTo=/dao/1/documents');
  await page.getByLabel('Default approval method').selectOption('evm');
  await page.getByRole('button', { name: 'Connect your paired wallet' }).click();
  await page.getByRole('checkbox', { name: /Community 2/ }).check();
  const checkbox = await page.getByRole('checkbox', { name: /Community 2/ }).boundingBox();
  expect(checkbox?.width).toBeLessThanOrEqual(24);
  expect(checkbox?.height).toBeLessThanOrEqual(24);
  await expect(page.getByText(/Replaces 0x22222222/)).toBeVisible();
  await page.getByLabel('Vault password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeEnabled();
  fixture.failNextSecond();
  await page.getByRole('button', { name: 'Approve selected DAOs', exact: true }).click();
  await expect(page.getByText('1 of 2 selected DAOs enabled.', { exact: true })).toBeVisible();
  expect(fixture.submitted).toEqual(['1']);
  await page.getByRole('button', { name: 'Approve selected DAOs', exact: true }).click();
  await expect(page.getByText('2 of 2 selected DAOs enabled.', { exact: true })).toBeVisible();
  expect(fixture.submitted).toEqual(['1', '2']);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('unified-approvals.png'), fullPage: true });
  await page.getByRole('button', { name: 'Lock keys', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'This device', exact: true })
      .getByText('Wallet approvals ready', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Return to your DAO or setup' }).click();
  await expect(page).toHaveURL(/\/dao\/1\/documents$/);
  await expect(page.getByLabel('Authorize actions with')).toHaveValue('evm');
  await page.reload();
  await expect(page.getByLabel('Authorize actions with')).toHaveValue('evm');
  expect(fixture.submitted).toEqual(['1', '2']);
});

test('an unready DAO uses account approval setup and preserves its destination', async ({
  page,
}) => {
  await moduleFixture(page);
  await page.goto('/dao/1/documents');
  const setup = page.getByRole('link', { name: 'Set up approvals', exact: true }).first();
  await expect(setup).toBeVisible();
  await setup.click();
  await expect(page).toHaveURL(/\/account\?.*setup=approvals/);
  await expect(page.getByRole('heading', { name: 'Approval setup', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return to your DAO or setup' })).toHaveAttribute(
    'href',
    '/dao/1/documents',
  );
});
