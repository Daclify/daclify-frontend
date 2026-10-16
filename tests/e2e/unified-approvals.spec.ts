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
import { PrivateKey, PublicKey, Signature } from '@wharfkit/antelope';
import { instructionDigest } from '@daclify/core-protocol/sdk';
import { createVault } from '../../src/auth/vault';
import AxeBuilder from '@axe-core/playwright';

test('a claimed DAO opens its workspace without carrying its invitation secret', async ({
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
  let claimWrites = 0;
  await page.route('**' + ApiRoutes.daoClaimConfirm.path, (route) => {
    claimWrites++;
    return route.abort('failed');
  });
  await page.route(
    '**' + ApiRoutes.creationOrderStatus.path.replace(':id', preview.id),
    (route) => {
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
          requestId: preview.id,
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
    },
  );
  await page.goto('/claim-dao#' + token);
  await page.getByRole('button', { name: 'Resume my claim', exact: true }).click();
  await expect(page).toHaveURL(/\/dao\/3$/);
  expect(page.url()).not.toContain(token);
  expect(claimWrites).toBe(0);
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
    address,
    kit: RecoveryKitSchema.parse({
      version: 1,
      localEnvelope: vault.localEnvelope,
      recoveryEnvelope: vault.recoveryEnvelope,
      signingPublicKey: vault.signingPublicKey,
      encryptionPublicKey: vault.encryptionPublicKey,
    }),
    submitted,
    priorWallet: (dao: string, wallet: string) => prior.set(dao, wallet),
    failNextSecond: () => {
      failSecond = true;
    },
  };
}

test('locked wallet activation opens account recovery and resumes the selected DAOs', async ({
  page,
}) => {
  const fixture = await approvalFixture(page);
  await page.goto('/account?setup=approvals&dao=2&returnTo=/dao/2/documents');
  await page.getByLabel('Default approval method').selectOption('evm');
  await page.getByRole('button', { name: 'Connect your paired wallet' }).click();
  const setup = page.getByRole('region', { name: 'Approval setup', exact: true });
  await expect(setup.getByText('Unlock account to enable', { exact: false })).toBeVisible();
  await setup.getByRole('button', { name: 'Unlock account to continue', exact: true }).click();
  await expect(setup.getByLabel('Vault password', { exact: true })).toBeFocused();
  await page.screenshot({ path: test.info().outputPath('approval-recovery.png'), fullPage: true });
  expect(fixture.submitted).toEqual([]);
  await setup.getByLabel('Vault password', { exact: true }).fill('incorrect disposable password');
  await setup.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'The vault could not be unlocked. Check your password or recovery kit.',
  );
  expect(fixture.submitted).toEqual([]);
  await setup.getByLabel('Vault password', { exact: true }).fill(fixture.password);
  await setup.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(
    setup.getByRole('button', { name: 'Approve selected DAOs', exact: true }),
  ).toBeFocused();
  await expect(page).toHaveURL(/\/account\?.*setup=approvals/);
  await expect(page.getByRole('checkbox', { name: /Community 2/ })).toBeChecked();
  expect(fixture.submitted).toEqual([]);
  await setup.getByRole('button', { name: 'Approve selected DAOs', exact: true }).click();
  await expect(setup.getByText('1 of 1 selected DAOs enabled.', { exact: true })).toBeVisible();
  expect(fixture.submitted).toEqual(['2']);
});

test('sign-in-only kit recovery preserves DAO selections through cancellation and restoration', async ({
  page,
}) => {
  const fixture = await approvalFixture(page);
  await page.addInitScript(() => localStorage.removeItem('daclify.vault.v1'));
  await page.goto('/account?setup=approvals&dao=2');
  await page.getByLabel('Default approval method').selectOption('evm');
  await page.getByRole('button', { name: 'Connect your paired wallet' }).click();
  await page.getByRole('checkbox', { name: /Community 1/ }).check();
  const setup = page.getByRole('region', { name: 'Approval setup', exact: true });
  await setup.getByRole('button', { name: 'Unlock account to continue', exact: true }).click();
  await expect(
    setup.getByText(/Your paired sign-ins do not currently unlock your account keys/),
  ).toBeVisible();
  await expect(setup.getByRole('group', { name: 'Paired sign-in methods' })).toBeHidden();
  await setup.getByRole('button', { name: 'Recover from an encrypted kit' }).click();
  const restore = page.getByRole('dialog', { name: 'Restore your existing keys', exact: true });
  await expect(restore).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await restore.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(restore).toBeHidden();
  await expect(setup.getByRole('checkbox', { name: /Community 1/ })).toBeChecked();
  await expect(setup.getByRole('checkbox', { name: /Community 2/ })).toBeChecked();
  expect(fixture.submitted).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await setup.getByRole('button', { name: 'Recover from an encrypted kit' }).click();
  await restore.getByLabel('Encrypted recovery kit', { exact: true }).setInputFiles({
    name: 'disposable-recovery-kit.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture.kit)),
  });
  await restore
    .getByLabel('Vault password or recovery code', { exact: true })
    .fill(fixture.password);
  await restore
    .getByLabel('New vault password', { exact: true })
    .fill('disposable restored password');
  await restore.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(restore).toBeHidden();
  await expect(
    setup.getByRole('button', { name: 'Approve selected DAOs', exact: true }),
  ).toBeFocused();
  await expect(setup.getByRole('checkbox', { name: /Community 1/ })).toBeChecked();
  await expect(setup.getByRole('checkbox', { name: /Community 2/ })).toBeChecked();
  expect(fixture.submitted).toEqual([]);
  await setup.getByRole('button', { name: 'Approve selected DAOs', exact: true }).click();
  await expect(setup.getByText('2 of 2 selected DAOs enabled.', { exact: true })).toBeVisible();
  expect(fixture.submitted).toEqual(['1', '2']);
});

test('an enabled wallet approves its selected DAO without recovering account keys', async ({
  page,
}) => {
  const fixture = await approvalFixture(page);
  fixture.priorWallet('1', fixture.address);
  await page.addInitScript(() => localStorage.removeItem('daclify.vault.v1'));
  await page.goto('/account?setup=approvals&dao=1');
  await page.getByLabel('Default approval method').selectOption('evm');
  await page.getByRole('button', { name: 'Connect your paired wallet' }).click();
  const setup = page.getByRole('region', { name: 'Approval setup', exact: true });
  await expect(setup.getByText(/Already enabled/)).toBeVisible();
  await setup.getByRole('button', { name: 'Approve selected DAOs', exact: true }).click();
  await expect(setup.getByText('1 of 1 selected DAOs enabled.', { exact: true })).toBeVisible();
  await expect(
    setup.getByRole('button', { name: 'Unlock account to continue', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText('Wallet ready', { exact: true })).toBeVisible();
  expect(fixture.submitted).toEqual([]);
});

test('different member keys are rejected without an endless unlock step', async ({ page }) => {
  const fixture = await approvalFixture(page),
    member = fixture.members[1];
  if (!member) throw new Error('Member fixture required');
  member.signingKey = PrivateKey.generate('K1').toPublic().toString();
  await page.goto('/account?setup=approvals&dao=2');
  await page.getByLabel('Default approval method').selectOption('evm');
  await page.getByRole('button', { name: 'Connect your paired wallet' }).click();
  const setup = page.getByRole('region', { name: 'Approval setup', exact: true });
  await setup.getByRole('button', { name: 'Unlock account to continue', exact: true }).click();
  await setup.getByLabel('Vault password', { exact: true }).fill(fixture.password);
  await setup.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(
    setup.getByRole('button', { name: 'Approve selected DAOs', exact: true }),
  ).toBeVisible();
  await setup.getByRole('button', { name: 'Approve selected DAOs', exact: true }).click();
  await expect(setup.getByRole('alert')).toContainText('do not match this DAO member');
  expect(fixture.submitted).toEqual([]);
});

test('approval recovery offers only paired methods with full access enabled', async ({ page }) => {
  await approvalFixture(page);
  await page.addInitScript(() => localStorage.removeItem('daclify.vault.v1'));
  await page.route('**/v1/account/recovery', (route) =>
    route.fulfill({
      json: {
        configured: true,
        assistedEver: true,
        assistedRevision: 1,
        reason: null,
        methods: [
          {
            credentialKey: 'email:fixture@example.test',
            kind: 'email',
            subject: 'fixture@example.test',
            chainId: null,
            mode: 'daclify-assisted',
            availableModes: ['daclify-assisted'],
            reason: null,
          },
          {
            credentialKey: 'evm:41:0x7e5f4552091a69125d5dfcb7b8c2659029395bdf',
            kind: 'evm',
            subject: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf',
            chainId: '41',
            mode: null,
            availableModes: ['wallet-protected'],
            reason: null,
          },
        ],
      },
    }),
  );
  await page.goto('/account?setup=approvals&dao=2');
  await page.getByLabel('Default approval method').selectOption('evm');
  await page.getByRole('button', { name: 'Connect your paired wallet' }).click();
  const setup = page.getByRole('region', { name: 'Approval setup', exact: true });
  await setup.getByRole('button', { name: 'Unlock account to continue', exact: true }).click();
  const picker = setup.getByRole('group', { name: 'Paired sign-in methods' });
  await expect(picker.getByRole('button')).toHaveCount(1);
  await expect(picker.getByRole('button', { name: 'E-Mail', exact: true })).toBeVisible();
  await expect(
    setup.getByRole('heading', { name: 'Unlock with a paired sign-in', exact: true }),
  ).toBeVisible();
});

test('Google full-access recovery is available when it is the only enabled sign-in', async ({
  page,
}) => {
  await approvalFixture(page);
  await page.addInitScript(() => localStorage.removeItem('daclify.vault.v1'));
  await page.route('**/v1/account/recovery', (route) =>
    route.fulfill({
      json: {
        configured: true,
        assistedEver: true,
        assistedRevision: 1,
        reason: null,
        methods: [
          {
            credentialKey: 'google:fixture-subject',
            kind: 'google',
            subject: 'fixture-subject',
            chainId: null,
            mode: 'daclify-assisted',
            availableModes: ['daclify-assisted'],
            reason: null,
          },
        ],
      },
    }),
  );
  await page.route('**/v1/sign-in/google', (route) =>
    route.fulfill({ json: { clientId: 'fixture.apps.googleusercontent.com' } }),
  );
  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.google = {accounts: {id: {initialize() {}, renderButton(host) {
      const button = document.createElement('button'); button.textContent = 'Continue with Google'; host.append(button);
    }}}};`,
    }),
  );
  await page.goto('/account?setup=approvals&dao=2');
  await page.getByLabel('Default approval method').selectOption('evm');
  await page.getByRole('button', { name: 'Connect your paired wallet' }).click();
  const setup = page.getByRole('region', { name: 'Approval setup', exact: true });
  await setup.getByRole('button', { name: 'Unlock account to continue', exact: true }).click();
  await expect(setup.getByRole('group', { name: 'Paired sign-in methods' })).toBeHidden();
  await expect(
    setup
      .getByRole('region', { name: 'Paired Google sign-in' })
      .getByRole('button', { name: 'Continue with Google' }),
  ).toBeVisible();
});

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
  await page.getByText('Account keys and recovery', { exact: true }).click();
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

test('creating a DAO with locked account keys opens its workspace', async ({ page }) => {
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
  await expect(page).toHaveURL(/\/dao\/3$/);
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
  await page.getByRole('button', { name: 'Unlock account to continue', exact: true }).click();
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
