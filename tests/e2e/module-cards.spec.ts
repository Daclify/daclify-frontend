import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PublicKey, Signature } from '@wharfkit/antelope';
import {
  AccountSchema,
  ApiRoutes,
  DaoSummarySchema,
  ErrorSchema,
  MarketplaceSchema,
  LoginMessageSchema,
  NetworkSchema,
  RecoveryKitSchema,
  TreasurySchema,
  UserMembershipSchema,
  VERSION,
} from '@daclify/core-protocol';
import {
  Catalog,
  CONTRACT_VERSION,
  ModuleApiRoutes,
  ModulePermissions,
  ModuleStateSchema,
} from '@daclify/modules';
import { ModuleCodeHashes } from '@daclify/modules/sdk';
import { encodeAction, instructionDigest } from '@daclify/core-protocol/sdk';
import { createVault } from '../../src/auth/vault.js';

// Synthetic HTTP fixtures: no chain writes, wallet authority or settlement are emulated.
const password = 'disposable module activation fixture';
const vault = await createVault(password);
const account = AccountSchema.parse({
  id: '11111111-1111-4111-8111-111111111111',
  custody: 'user-controlled',
  signingKey: vault.signingPublicKey,
  encryptionKey: vault.encryptionPublicKey,
});
const network = NetworkSchema.parse({
  chainId: '11'.repeat(32),
  rpcUrl: 'http://127.0.0.1:18888',
  runtime: 'daclifycore',
  hub: null,
  environment: 'local',
  interfaceVersion: 1,
  coreVersion: VERSION,
  capabilities: [],
});
const daos = [
  'Design Commons',
  'Builders Guild',
  'Visitors Club',
  'Other deployment',
  'Inactive Commons',
].map((title, index) =>
  DaoSummarySchema.parse({
    reference: {
      chainId: network.chainId,
      contract: index === 3 ? 'othercore' : network.runtime,
      daoId: String(index + 1),
      interfaceVersion: 1,
    },
    title,
    description: '',
    privacy: 'public',
    owner: 'alice',
    token: { chainId: network.chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
    members: 1,
    available: '0',
    reserved: '0',
    claims: '0',
    keyEpoch: '1',
  }),
);
const memberships = daos.map((dao, index) =>
  UserMembershipSchema.parse({
    dao: dao.reference,
    memberId: '1',
    nonce: '0',
    active: index !== 4,
    admin: index !== 2,
    reviewer: false,
    credits: '0',
    claim: '0',
    stake: '0',
    nativeAccount: '',
    custody: 'user-controlled',
    signingKey: account.signingKey,
  }),
);
const catalogue = MarketplaceSchema.parse({
  configured: true,
  reason: null,
  thirdPartyBps: 500,
  firstPartyBps: 10000,
  treasury: 'treasury',
  modules: [
    ['decide', 'daclifydecid', 'Decide', ModuleCodeHashes.decide],
    ['works', 'daclifyworks', 'Works', ModuleCodeHashes.works],
    ['payroll', 'daclifypayr1', 'Payroll', ModuleCodeHashes.payroll],
    ['grants-rounds', 'daclifygrant', 'Grants rounds', ModuleCodeHashes['grants-rounds']],
    [
      'endorsement-admission',
      'daclifyendor',
      'Endorsement admission',
      ModuleCodeHashes['endorsement-admission'],
    ],
  ].map(([, contract, title, codeHash]) => ({
    account: contract,
    publisher: 'daclify',
    party: 'first-party',
    price: '0.0000 TLOS',
    title,
    codeHash,
    summary: `${title} for your community.`,
    detail: '',
  })),
});
function moduleState(daoId: string, verified = true, enabled = daoId === '2') {
  const dao = daos.find((dao) => dao.reference.daoId === daoId);
  if (!dao) throw new Error('FIXTURE_DAO');
  return ModuleStateSchema.parse({
    dao: dao.reference,
    next: { ballots: null, projects: null, schedules: null },
    modules: [
      {
        deployment: {
          id: 'decide',
          account: 'daclifydecid',
          version: CONTRACT_VERSION,
          codeHash: verified ? ModuleCodeHashes.decide : 'ab'.repeat(32),
        },
        manifest: Catalog.find((module) => module.id === 'decide'),
        enabled,
        compatible: true,
        codeVerified: verified,
        actions: [],
        grants: [],
      },
    ],
    projects: [],
    milestones: [],
    schedules: [],
    controls: [],
    executions: [],
    ballots: [],
    votes: [],
    entries: [],
  });
}

test.beforeEach(async ({ page }) => {
  await page.route(/\/v1\//, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const values: Record<string, unknown> = {
      [ApiRoutes.network.path]: network,
      [ApiRoutes.daos.path]: { daos },
      [ApiRoutes.me.path]: { account },
      '/v1/me/memberships': { memberships },
      '/v1/marketplace': catalogue,
    };
    for (const dao of daos) {
      values[ModuleApiRoutes.state.path.replace(':id', dao.reference.daoId)] = moduleState(
        dao.reference.daoId,
      );
      values[ApiRoutes.treasury.path.replace(':id', dao.reference.daoId)] = TreasurySchema.parse({
        dao: dao.reference,
        obligations: [],
        evidence: [],
      });
    }
    await route.fulfill({
      status: path in values ? 200 : 503,
      json:
        values[path] ??
        ErrorSchema.parse({ code: 'SERVICE_UNAVAILABLE', message: 'Fixture unavailable.' }),
    });
  });
});

test('renders square illustrated cards and recognises deployed module accounts', async ({
  page,
}) => {
  await page.goto('/modules');
  await expect(page.locator('.catalogue-card')).toHaveCount(5);
  const decide = page
    .locator('.catalogue-card')
    .filter({ has: page.getByRole('button', { name: 'Decide', exact: true }) });
  const size = await decide.boundingBox();
  expect(size).not.toBeNull();
  expect(Math.abs((size?.width ?? 0) - (size?.height ?? 0))).toBeLessThan(4);
  await expect(decide.locator('.module-artwork > svg')).toBeVisible();
  await page.getByLabel('Find a module', { exact: true }).fill('stake vote');
  await expect(page.locator('.catalogue-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Decide', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Stake vote\b/ })).toBeVisible();
  await expect(page.locator('#main')).toContainText('daclifydecid');
  await page.getByRole('button', { name: 'Back to modules', exact: true }).click();
  await page.getByLabel('Find a module', { exact: true }).fill('');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('module-cards.png'), fullPage: true });
});

test('shows illustrated details, pricing and contract disclosure for every module', async ({
  page,
}) => {
  await page.goto('/modules');
  for (const module of catalogue.modules) {
    await page.getByRole('button', { name: `View ${module.title} details`, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: module.title, level: 1, exact: true }),
    ).toBeVisible();
    await expect(page.locator('.module-detail-hero .detail-artwork')).toBeVisible();
    const activation = page.locator('.detail-activation');
    await expect(activation.getByText('No usage charge', { exact: true })).toBeVisible();
    await expect(
      activation.getByRole('button', { name: `Activate ${module.title}`, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What you can do', exact: true })).toBeVisible();
    const contract = page.locator('.detail-contract');
    await expect(contract.locator('summary')).toHaveText('Contract details');
    await expect(contract.getByText(module.codeHash, { exact: true })).toBeHidden();
    await contract.locator('summary').click();
    await expect(contract.getByText(module.codeHash, { exact: true })).toBeVisible();
    await expect(contract.getByText(module.account, { exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await contract.locator('summary').click();
    await page.getByRole('button', { name: 'Back to modules', exact: true }).focus();
    await page.screenshot({
      path: test.info().outputPath(`detail-${module.account}.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Back to modules', exact: true }).click();
  }
});

test('keeps module identity and search while exploring tools and activating from details', async ({
  page,
}) => {
  await page.goto('/modules');
  await page.getByLabel('Find a module', { exact: true }).fill('stake vote');
  await page.getByRole('button', { name: 'View Decide details', exact: true }).click();
  const credit = page.getByRole('button', { name: /^Credit vote\b/ });
  await credit.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Decide', level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Credit vote', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close tool details' }).click();
  await expect(credit).toBeFocused();
  await page.getByRole('button', { name: 'Activate Decide', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Choose a DAO', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Activate Decide', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Back to modules', exact: true }).click();
  await expect(page.getByLabel('Find a module', { exact: true })).toHaveValue('stake vote');
  await expect(page.locator('.catalogue-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'View Decide details', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Credit vote', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Credit vote\b/ })).toHaveAttribute(
    'aria-haspopup',
    'dialog',
  );
});

test('chooses between administrator DAOs and respects the locked signer', async ({ page }) => {
  await page.goto('/modules');
  await page.getByRole('button', { name: 'Activate Decide', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const picker = dialog.getByLabel('Choose a DAO', { exact: true });
  await expect(picker.locator('option')).toHaveText(['Design Commons', 'Builders Guild']);
  await expect(dialog.getByRole('button', { name: 'Enable Decide', exact: true })).toBeDisabled();
  await picker.selectOption('2');
  await expect(dialog.getByText('Enabled', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Enable Decide', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Disable Decide', exact: true })).toHaveCount(0);
  await picker.selectOption('1');
  await expect(dialog.getByRole('button', { name: 'Enable Decide', exact: true })).toBeDisabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('activation-dialog.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Activate Decide', exact: true })).toBeFocused();
});

test('rejects unverified code inside the activation dialog', async ({ page }) => {
  const state = moduleState('1', false);
  await page.route(`**${ModuleApiRoutes.state.path.replace(':id', '1')}?*`, (route) =>
    route.fulfill({
      json: ModuleStateSchema.parse({
        ...state,
        modules: state.modules.map((module) => ({ ...module, codeVerified: true })),
      }),
    }),
  );
  await page.goto('/modules');
  await page.getByRole('button', { name: 'Activate Decide', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Unverified deployment', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Enable Decide', exact: true })).toBeDisabled();
});

test('requires sign-in before showing DAO activation choices', async ({ page }) => {
  await page.route(`**${ApiRoutes.me.path}`, (route) =>
    route.fulfill({
      status: 401,
      json: ErrorSchema.parse({ code: 'AUTH_REQUIRED', message: 'Sign in to continue.' }),
    }),
  );
  await page.goto('/modules');
  await page.getByRole('button', { name: 'Activate Decide', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute(
    'href',
    '/account?returnTo=/modules',
  );
  await expect(dialog.getByLabel('Choose a DAO', { exact: true })).toHaveCount(0);
});

test('signs the selected DAO activation and refreshes its state without closing the dialog', async ({
  page,
}) => {
  const kit = RecoveryKitSchema.parse({
    version: 1,
    localEnvelope: vault.localEnvelope,
    recoveryEnvelope: vault.recoveryEnvelope,
    signingPublicKey: vault.signingPublicKey,
    encryptionPublicKey: vault.encryptionPublicKey,
  });
  await page.addInitScript(
    (record) => localStorage.setItem('daclify.vault.v1', JSON.stringify(record)),
    kit,
  );
  await page.route(`**${ApiRoutes.challenge.path}`, (route) => {
    const origin = new URL(route.request().url()).origin;
    const id = '22222222-2222-4222-8222-222222222222';
    const expires = new Date(Date.now() + 120000).toISOString();
    const message = LoginMessageSchema.parse({
      domain: 'daclify.login.v3',
      encryptionKey: account.encryptionKey,
      origin,
      audience: origin,
      challenge: id,
      expires,
      signingKey: account.signingKey,
    });
    return route.fulfill({
      json: ApiRoutes.challenge.response.parse({ id, expires, message: JSON.stringify(message) }),
    });
  });
  await page.route(`**${ApiRoutes.login.path}`, (route) =>
    route.fulfill({
      json: ApiRoutes.login.response.parse({ account, csrfToken: 'ab'.repeat(32) }),
    }),
  );
  let enabled = false;
  let writes = 0;
  let finishWrite = () => {};
  const confirmation = new Promise<void>((resolve) => {
    finishWrite = resolve;
  });
  await page.route(`**${ModuleApiRoutes.state.path.replace(':id', '1')}?*`, (route) =>
    route.fulfill({ json: moduleState('1', true, enabled) }),
  );
  await page.route(`**${ApiRoutes.relay.path}`, async (route) => {
    const body = ApiRoutes.relay.input.parse(route.request().postDataJSON());
    expect(body.request.dao_id).toBe('1');
    expect(body.request.deployment).toBe(network.runtime);
    expect(body.request.action).toBe('modconfig');
    expect(body.request.target).toBe(network.runtime);
    expect(body.request.data).toBe(
      Buffer.from(
        encodeAction('modconfig', {
          runtime: network.runtime,
          dao_id: '1',
          member_id: '1',
          account: 'daclifydecid',
          version: 1,
          actions: [...ModulePermissions.decide.actions],
          grants: [...ModulePermissions.decide.grants],
          code_hash: ModuleCodeHashes.decide,
        }),
      ).toString('hex'),
    );
    expect(
      Signature.from(body.sig).verifyDigest(
        instructionDigest(body.request),
        PublicKey.from(vault.signingPublicKey),
      ),
    ).toBe(true);
    writes++;
    await confirmation;
    enabled = true;
    await route.fulfill({
      json: ApiRoutes.relay.response.parse({ transactionId: 'ab'.repeat(32) }),
    });
  });
  await page.goto('/account?returnTo=/modules');
  await page.getByLabel('Vault password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/modules$/);
  await page.getByRole('button', { name: 'Activate Decide', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Enable Decide', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Enable Decide', exact: true }).click();
  await expect.poll(() => writes).toBe(1);
  await expect(dialog.getByLabel('Choose a DAO', { exact: true })).toBeDisabled();
  await expect(
    dialog.getByRole('button', { name: 'Close activation', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  finishWrite();
  await expect(dialog.getByText('Decide enabled', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Enabled', { exact: true })).toBeVisible();
  expect(writes).toBe(1);
  await dialog.getByLabel('Choose a DAO', { exact: true }).selectOption('2');
  await expect(dialog.getByText('Enabled', { exact: true })).toBeVisible();
  expect(writes).toBe(1);
});

test('keeps unknown third-party listings usable without offering an unsupported activation', async ({
  page,
}) => {
  await page.route('**/v1/marketplace', (route) =>
    route.fulfill({
      json: MarketplaceSchema.parse({
        ...catalogue,
        modules: [
          ...catalogue.modules,
          {
            account: 'custom',
            publisher: 'builder',
            party: 'third-party',
            price: '1.0000 TLOS',
            title: 'Community insights',
            codeHash: 'ab'.repeat(32),
            summary: 'A third-party catalogue fixture.',
            detail: '',
          },
        ],
      }),
    }),
  );
  await page.goto('/modules');
  await page.getByLabel('Publisher', { exact: true }).selectOption('third-party');
  await expect(page.locator('.catalogue-card')).toHaveCount(1);
  await expect(page.getByText('Extension', { exact: true })).toBeVisible();
  await expect(page.getByText('1.0000 TLOS', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View Community insights details', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Community insights', level: 1, exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.detail-activation').getByText('1.0000 TLOS', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('A third-party catalogue fixture.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What you can do', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Activate Community insights', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByText('This module is not available in this DAO’s configured deployments.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Enable / })).toHaveCount(0);
});

test('recognises older first-party artwork while blocking its incompatible deployment', async ({
  page,
}) => {
  await page.route('**/v1/marketplace', (route) =>
    route.fulfill({
      json: MarketplaceSchema.parse({
        ...catalogue,
        modules: catalogue.modules
          .filter((module) => module.title === 'Decide')
          .map((module) => ({ ...module, codeHash: 'ab'.repeat(32) })),
      }),
    }),
  );
  const state = moduleState('1');
  await page.route(`**${ModuleApiRoutes.state.path.replace(':id', '1')}?*`, (route) =>
    route.fulfill({
      json: ModuleStateSchema.parse({
        ...state,
        modules: state.modules.map((module) => ({
          ...module,
          deployment: { ...module.deployment, version: '0.8.0-alpha.1' },
          compatible: true,
        })),
      }),
    }),
  );
  await page.goto('/modules');
  await expect(page.getByText('Governance', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Activate Decide', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Incompatible release', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Enable Decide', exact: true })).toBeDisabled();
});
