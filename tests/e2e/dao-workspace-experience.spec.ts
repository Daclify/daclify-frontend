import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PublicKey, Signature } from '@wharfkit/antelope';
import {
  AccountSchema,
  ApiRoutes,
  DaoSummarySchema,
  defaultDaoSetup,
  DaoContentSchema,
  ErrorSchema,
  GovernanceStateSchema,
  LoginMessageSchema,
  MetadataSchema,
  NetworkSchema,
  RecoveryKitSchema,
  TreasurySchema,
  UserMembershipSchema,
  VERSION,
  type Account,
  type DaoSummary,
  type UserMembership,
} from '@daclify/core-protocol';
import { Catalog, ModulePermissions, ModuleStateSchema, type ModuleState } from '@daclify/modules';
import { ModuleCodeHashes } from '@daclify/modules/sdk';
import { encodeAction, instructionDigest } from '@daclify/core-protocol/sdk';
import { createVault } from '../../src/auth/vault.js';

// Synthetic canonical read fixtures. No provider, blockchain or operator is contacted.
const network = NetworkSchema.parse({
  chainId: 'ab'.repeat(32),
  rpcUrl: 'https://rpc.example',
  runtime: 'daclifycore',
  hub: null,
  environment: 'testnet',
  interfaceVersion: 1,
  coreVersion: VERSION,
  capabilities: ['governance-policy'],
});
const reference = {
  chainId: network.chainId,
  contract: network.runtime,
  daoId: '1',
  interfaceVersion: 1,
};
const dao = DaoSummarySchema.parse({
  reference,
  title: 'Ocean Commons',
  description: 'A community restoring our coastline through shared decisions and local action.',
  privacy: 'public',
  owner: 'alice',
  token: { chainId: network.chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
  members: 24,
  available: '1250000',
  reserved: '450000',
  claims: '90000',
  keyEpoch: '1',
  purpose: 'community',
});
const account = AccountSchema.parse({
  id: '11111111-1111-4111-8111-111111111111',
  custody: 'user-controlled',
  signingKey: null,
  encryptionKey: null,
});
const member = UserMembershipSchema.parse({
  dao: reference,
  memberId: '7',
  active: true,
  admin: false,
  reviewer: false,
  nonce: '0',
  credits: '42',
  claim: '25000',
  stake: '10000',
  nativeAccount: '',
  custody: 'user-controlled',
});
const unavailable = ErrorSchema.parse({
  code: 'SERVICE_UNAVAILABLE',
  message: 'Synthetic fixture unavailable.',
});
function moduleData(ids: ModuleState['modules'][number]['deployment']['id'][] = []) {
  return ModuleStateSchema.parse({
    dao: reference,
    modules: ids.map((id) => {
      const manifest = Catalog.find((entry) => entry.id === id);
      if (!manifest) throw new Error('Missing fixture manifest');
      return {
        manifest,
        deployment: {
          id,
          account: id === 'grants-rounds' ? 'grants' : id,
          version: manifest.version,
          codeHash: ModuleCodeHashes[id],
        },
        enabled: true,
        installed: true,
        compatible: true,
        codeVerified: true,
        actions: ModulePermissions[id].actions,
        grants: ModulePermissions[id].grants,
      };
    }),
    ballots: [],
    votes: [],
    projects: [],
    milestones: [],
    schedules: [],
    controls: [],
    executions: [],
    entries: [],
  });
}
async function fixture(
  page: Page,
  options: {
    member?: UserMembership;
    signedIn?: boolean;
    modules?: ModuleState;
    privacy?: 'public' | 'encrypted-user-controlled';
    account?: Account;
    dao?: DaoSummary;
  } = {},
) {
  const summary = DaoSummarySchema.parse({
    ...(options.dao ?? dao),
    privacy: options.privacy ?? options.dao?.privacy ?? dao.privacy,
  });
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/network') return route.fulfill({ json: network });
    if (path === '/v1/daos') return route.fulfill({ json: { daos: [summary], next: null } });
    if (path === '/v1/me')
      return options.signedIn || options.member
        ? route.fulfill({ json: { account: options.account ?? account } })
        : route.fulfill({
            status: 401,
            json: ErrorSchema.parse({ code: 'AUTH_REQUIRED', message: 'Sign in to continue.' }),
          });
    if (path === '/v1/me/memberships')
      return route.fulfill({ json: { memberships: options.member ? [options.member] : [] } });
    if (path === '/v1/daos/1/modules')
      return route.fulfill({ json: options.modules ?? moduleData() });
    if (path === '/v1/daos/1/governance')
      return route.fulfill({
        json: GovernanceStateSchema.parse({
          dao: reference,
          policy: null,
          actors: [],
          sessions: [],
          guardian: null,
          budget: null,
        }),
      });
    if (path === '/v1/daos/1/content')
      return route.fulfill({
        json: DaoContentSchema.parse({
          dao: reference,
          members: [],
          documents: [],
          keyGrants: [],
          epochs: [],
        }),
      });
    if (path === '/v1/daos/1/treasury')
      return route.fulfill({
        json: TreasurySchema.parse({ dao: reference, obligations: [], evidence: [] }),
      });
    if (path === '/v1/hub/directory')
      return route.fulfill({ json: { entries: [], next: null, skipped: 0 } });
    return route.fulfill({ status: 503, json: unavailable });
  });
}
const main = (page: Page) => page.locator('#main');
async function accessible(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('overview does not advertise tools that this DAO has not installed', async ({ page }) => {
  await fixture(page);
  await page.goto('/dao/1');
  await expect(main(page).getByRole('heading', { name: dao.title, exact: true })).toBeVisible();
  await expect(main(page).getByRole('link', { name: /Open Decide/ })).toHaveCount(0);
  await expect(main(page).getByRole('link', { name: /Open Works/ })).toHaveCount(0);
  await expect(main(page).getByRole('link', { name: /Open Documents/ })).toBeVisible();
  await expect(main(page).getByRole('link', { name: /Open Members/ })).toBeVisible();
  await accessible(page);
});
test('long public identity and expanded DAO references fit a narrow screen', async ({ page }) => {
  await fixture(page, {
    dao: DaoSummarySchema.parse({
      ...dao,
      title: 'Community'.repeat(17),
      description: 'https://example.test/' + 'a'.repeat(600),
    }),
  });
  await page.setViewportSize({ width: 320, height: 812 });
  await page.goto('/dao/1');
  await expect(
    main(page).getByRole('heading', { name: 'Workspace overview', exact: true }),
  ).toBeVisible();
  await main(page).locator('.workspace-reference summary').click();
  await expect(main(page).getByText(reference.chainId, { exact: true })).toBeVisible();
  await accessible(page);
});
test('settings has clear Identity, Governance and Services destinations with URL state', async ({
  page,
}) => {
  await fixture(page, { member: UserMembershipSchema.parse({ ...member, admin: true }) });
  await page.goto('/dao/1/settings?keep=1#configuration');
  await expect(main(page).getByRole('button', { name: 'Identity', exact: true })).toBeVisible();
  await main(page).getByRole('button', { name: 'Governance', exact: true }).click();
  await expect(
    main(page).getByRole('heading', { name: 'Governance and participants', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/keep=1.*settings=governance.*#configuration$/);
  await main(page).getByRole('button', { name: 'Services', exact: true }).click();
  await expect(
    main(page).getByRole('link', { name: 'Manage member capacity', exact: true }),
  ).toBeVisible();
  await expect(main(page).getByLabel('New DAO name', { exact: true })).toHaveCount(0);
  await main(page).getByRole('button', { name: 'Identity', exact: true }).click();
  await expect(main(page).getByLabel('New DAO name', { exact: true })).toHaveValue(dao.title);
  await expect(
    main(page).getByRole('button', { name: 'Sign and update name', exact: true }),
  ).toBeDisabled();
  const consent = await main(page)
    .getByRole('checkbox', { name: /I understand this image is public/ })
    .boundingBox();
  expect(consent?.width).toBeLessThanOrEqual(24);
});
test('signing disclosure explains member readiness without exposing settings on the overview', async ({
  page,
}) => {
  await fixture(page, { member });
  await page.goto('/dao/1');
  const signing = main(page)
    .locator('details')
    .filter({ has: page.getByText('Signing & wallets', { exact: true }) });
  await expect(signing).toHaveAttribute('open', '');
  await expect(signing.getByLabel('Authorize actions with', { exact: true })).toBeVisible();
  await expect(main(page).getByText('42', { exact: true })).toBeVisible();
  await expect(
    main(page).getByRole('link', { name: 'Your funds in Treasury', exact: true }),
  ).toHaveAttribute('href', '/dao/1/treasury');
  await expect(main(page).getByLabel('New DAO name', { exact: true })).toHaveCount(0);
});

test('offers available tools while preserving paused work and disabled unsigned actions', async ({
  page,
}) => {
  const state = moduleData(['decide', 'works', 'payroll', 'grants-rounds']);
  await fixture(page, {
    member,
    modules: ModuleStateSchema.parse({
      ...state,
      modules: state.modules.map((entry) => ({
        ...entry,
        deployment: {
          ...entry.deployment,
          codeHash:
            entry.deployment.id === 'grants-rounds' ? '00'.repeat(32) : entry.deployment.codeHash,
        },
        enabled: entry.deployment.id !== 'works',
      })),
    }),
  });
  await page.goto('/dao/1');
  await expect(main(page).getByText('Paused · view existing work', { exact: true })).toBeVisible();
  await expect(
    main(page).getByText('Deployment review needed before new actions', { exact: true }),
  ).toBeVisible();
  for (const name of ['Decide', 'Works', 'Payroll', 'Grants'])
    await expect(main(page).getByRole('link', { name: new RegExp(`Open ${name}`) })).toBeVisible();
  await main(page)
    .getByRole('link', { name: /Open Decide/ })
    .click();
  await expect(main(page).getByRole('button', { name: 'Open ballot', exact: true })).toBeDisabled();
  await main(page)
    .getByRole('navigation', { name: 'DAO sections' })
    .getByRole('link', { name: 'Works', exact: true })
    .click();
  await expect(
    main(page).getByRole('heading', { name: 'Enable this module', exact: true }),
  ).toBeVisible();
  await expect(
    main(page).getByRole('link', { name: 'Configure modules', exact: true }),
  ).toBeVisible();
});

test('module failure can be retried without hiding core destinations or claiming no installed tools', async ({
  page,
}) => {
  await fixture(page);
  let attempts = 0;
  await page.route('**/v1/daos/1/modules?*', (route) => {
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 503, json: unavailable })
      : route.fulfill({ json: moduleData(['decide']) });
  });
  await page.goto('/dao/1');
  await expect(
    main(page).getByText('DAO tools could not be loaded', { exact: true }),
  ).toBeVisible();
  await expect(main(page).getByText(/This DAO has no Decide/)).toHaveCount(0);
  await expect(main(page).getByRole('link', { name: /Open Documents/ })).toBeVisible();
  await main(page).getByRole('button', { name: 'Retry DAO tools', exact: true }).click();
  await expect(main(page).getByRole('link', { name: /Open Decide/ })).toBeVisible();
  expect(attempts).toBe(2);
});

test('rejects module data for another DAO and ignores a response after changing DAO', async ({
  page,
}) => {
  await fixture(page);
  const other = DaoSummarySchema.parse({
    ...dao,
    reference: { ...reference, daoId: '2' },
    title: 'Garden Commons',
  });
  await page.route('**/v1/daos', (route) =>
    route.fulfill({ json: { daos: [dao, other], next: null } }),
  );
  await page.route('**/v1/daos/1/modules?*', (route) =>
    route.fulfill({
      json: ModuleStateSchema.parse({ ...moduleData(['decide']), dao: other.reference }),
    }),
  );
  await page.goto('/dao/1');
  await expect(
    main(page).getByText('DAO tools could not be loaded', { exact: true }),
  ).toBeVisible();
  await expect(main(page).getByRole('link', { name: /Open Decide/ })).toHaveCount(0);
  let complete = () => {};
  const pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let started = false;
  await page.route('**/v1/daos/1/modules?*', async (route) => {
    started = true;
    await pending;
    await route.fulfill({ json: moduleData(['decide']) });
  });
  await page.route('**/v1/daos/2/modules?*', (route) =>
    route.fulfill({
      json: ModuleStateSchema.parse({ ...moduleData(['works']), dao: other.reference }),
    }),
  );
  await main(page).getByRole('button', { name: 'Retry DAO tools', exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await main(page).getByRole('link', { name: 'All DAOs', exact: true }).click();
  await main(page).getByRole('link', { name: 'View Garden Commons', exact: true }).click();
  await expect(main(page).getByRole('link', { name: /Open Works/ })).toBeVisible();
  const received = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/v1/daos/1/modules',
  );
  complete();
  await received;
  await expect(main(page).getByRole('link', { name: /Open Decide/ })).toHaveCount(0);
  await expect(main(page).getByRole('heading', { name: other.title, exact: true })).toBeVisible();
});

test('guest sign-in preserves the complete destination and visitor configuration is read-only', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/dao/1/settings?settings=identity&keep=1#configuration');
  const signIn = main(page).getByRole('link', { name: 'Sign in', exact: true });
  const href = await signIn.getAttribute('href');
  expect(new URL(href ?? '', 'https://example.test').searchParams.get('returnTo')).toBe(
    '/dao/1/settings?settings=identity&keep=1#configuration',
  );
  await expect(main(page).getByLabel('New DAO name', { exact: true })).toHaveCount(0);
  await expect(
    main(page).getByText('Administrator permission is required to update this DAO.', {
      exact: true,
    }),
  ).toBeVisible();
  await accessible(page);
});

for (const mismatch of ['chain', 'contract', 'interface'] as const)
  test(`membership from another ${mismatch} does not grant DAO access`, async ({ page }) => {
    const foreign = {
      ...reference,
      ...(mismatch === 'chain' ? { chainId: 'cd'.repeat(32) } : {}),
      ...(mismatch === 'contract' ? { contract: 'othercore' } : {}),
      ...(mismatch === 'interface' ? { interfaceVersion: 2 } : {}),
    };
    // Unknown future interface versions are rejected at the boundary, not treated as this DAO.
    if (mismatch === 'interface') {
      await fixture(page, { signedIn: true });
      await page.route('**/v1/me/memberships', (route) =>
        route.fulfill({ json: { memberships: [{ ...member, dao: foreign, admin: true }] } }),
      );
    } else
      await fixture(page, {
        member: UserMembershipSchema.parse({ ...member, dao: foreign, admin: true }),
      });
    await page.goto('/dao/1/settings');
    await expect(main(page).getByLabel('New DAO name', { exact: true })).toHaveCount(0);
    await expect(main(page).getByText('Signing & wallets', { exact: true })).toHaveCount(0);
  });

test('inactive members keep Treasury exits and cannot configure the DAO', async ({ page }) => {
  await fixture(page, {
    member: UserMembershipSchema.parse({ ...member, active: false, admin: true }),
  });
  await page.goto('/dao/1/settings');
  await expect(main(page).getByText('Inactive member', { exact: true })).toBeVisible();
  await expect(
    main(page).getByRole('link', { name: 'Your funds in Treasury', exact: true }),
  ).toHaveAttribute('href', '/dao/1/treasury');
  await expect(main(page).getByLabel('New DAO name', { exact: true })).toHaveCount(0);
  await main(page).getByRole('button', { name: 'Services', exact: true }).click();
  await expect(
    main(page).getByRole('link', { name: 'Manage member capacity', exact: true }),
  ).toHaveCount(0);
  const href = await main(page)
    .getByRole('link', { name: 'Storage and blockchain resources', exact: true })
    .getAttribute('href');
  expect(
    JSON.parse(new URL(href ?? '', 'https://example.test').searchParams.get('dao') ?? 'null'),
  ).toEqual(reference);
});

test('unknown sections recover and direct configuration links select the correct section', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/dao/1/obsolete');
  await expect(
    main(page).getByRole('heading', { name: 'Section unavailable', exact: true }),
  ).toBeVisible();
  await main(page).getByRole('link', { name: 'Workspace overview', exact: true }).click();
  await expect(
    main(page).getByRole('heading', { name: 'Workspace overview', exact: true }),
  ).toBeVisible();
  await page.goto('/dao/1/settings?settings=services');
  await expect(main(page).getByRole('button', { name: 'Services', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    main(page).getByRole('heading', { name: 'Hosting and payments', exact: true }),
  ).toBeVisible();
  await page.goto('/dao/1/settings?settings=invalid');
  await expect(main(page).getByRole('button', { name: 'Identity', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('signed rename preserves branding and setup, rejects empty names and prevents duplicate submission', async ({
  page,
}) => {
  const password = 'disposable workspace rename fixture';
  const vault = await createVault(password);
  const signingAccount = AccountSchema.parse({
    ...account,
    signingKey: vault.signingPublicKey,
    encryptionKey: vault.encryptionPublicKey,
  });
  const admin = UserMembershipSchema.parse({
    ...member,
    admin: true,
    signingKey: vault.signingPublicKey,
  });
  let summary = DaoSummarySchema.parse({
    ...dao,
    setup: defaultDaoSetup('community'),
    branding: { summary: 'Restore our coastline.' },
  });
  await fixture(page, { member: admin, account: signingAccount, dao: summary });
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
  let loginMessage = '';
  await page.route('**/v1/auth/challenge', (route) => {
    const identity = ApiRoutes.challenge.input.parse(route.request().postDataJSON());
    const origin = new URL(route.request().url()).origin;
    const id = '22222222-2222-4222-8222-222222222222',
      expires = new Date(Date.now() + 120000).toISOString();
    loginMessage = JSON.stringify(
      LoginMessageSchema.parse({
        domain: 'daclify.login.v3',
        origin,
        audience: origin,
        challenge: id,
        expires,
        ...identity,
      }),
    );
    return route.fulfill({
      json: ApiRoutes.challenge.response.parse({ id, expires, message: loginMessage }),
    });
  });
  await page.route('**/v1/auth/login', (route) => {
    const input = ApiRoutes.login.input.parse(route.request().postDataJSON());
    expect(
      Signature.from(input.signature).verifyMessage(
        new TextEncoder().encode(loginMessage),
        PublicKey.from(vault.signingPublicKey),
      ),
    ).toBe(true);
    return route.fulfill({
      json: ApiRoutes.login.response.parse({ account: signingAccount, csrfToken: 'ab'.repeat(32) }),
    });
  });
  await page.route('**/v1/daos', (route) =>
    route.fulfill({ json: { daos: [summary], next: null } }),
  );
  let submissions = 0,
    complete = () => {};
  const pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
  await page.route('**/v1/relay', async (route) => {
    const input = ApiRoutes.relay.input.parse(route.request().postDataJSON());
    expect(input.request.action).toBe('setmeta');
    expect(input.request.deployment).toBe(reference.contract);
    expect(input.request.dao_id).toBe(reference.daoId);
    expect(input.request.member_id).toBe(admin.memberId);
    expect(
      Signature.from(input.sig).verifyDigest(
        instructionDigest(input.request),
        PublicKey.from(vault.signingPublicKey),
      ),
    ).toBe(true);
    const metadata = MetadataSchema.parse({
      schemaVersion: 3,
      title: 'Ocean Collective',
      description: summary.description,
      purpose: summary.purpose,
      setup: summary.setup,
      branding: summary.branding,
    });
    expect(input.request.data).toBe(
      Buffer.from(
        encodeAction('setmeta', {
          runtime: reference.contract,
          dao_id: reference.daoId,
          member_id: admin.memberId,
          metadata: JSON.stringify(metadata),
        }),
      ).toString('hex'),
    );
    submissions++;
    await pending;
    summary = DaoSummarySchema.parse({ ...summary, title: metadata.title });
    await route.fulfill({
      json: ApiRoutes.relay.response.parse({ transactionId: 'cd'.repeat(32) }),
    });
  });
  await page.goto('/account?returnTo=/dao/1/settings');
  await page.getByLabel('Vault password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dao\/1\/settings$/);
  await main(page).getByLabel('New DAO name', { exact: true }).fill('   ');
  await expect(
    main(page).getByRole('button', { name: 'Sign and update name', exact: true }),
  ).toBeDisabled();
  await expect(
    main(page).getByText('Enter a DAO name before signing.', { exact: true }),
  ).toBeVisible();
  expect(submissions).toBe(0);
  await main(page).getByLabel('New DAO name', { exact: true }).fill('Ocean Collective');
  await main(page).getByRole('button', { name: 'Sign and update name', exact: true }).click();
  await expect.poll(() => submissions).toBe(1);
  await expect(main(page).getByRole('button', { name: 'Services', exact: true })).toBeDisabled();
  await expect(main(page).getByLabel('New DAO name', { exact: true })).toBeDisabled();
  complete();
  await expect(main(page).getByText('DAO name updated.', { exact: true })).toBeVisible();
  await expect(
    main(page).getByRole('heading', { name: 'Ocean Collective', exact: true }),
  ).toBeVisible();
  expect(submissions).toBe(1);
  await expect(main(page).getByText('Signer ready', { exact: true })).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: test.info().outputPath('identity-unlocked-admin.png'),
    fullPage: true,
  });
});

test('workspace and configuration remain usable at phone, tablet, landscape and enlarged text sizes', async ({
  page,
}) => {
  test.setTimeout(60000);
  await fixture(page, {
    member: UserMembershipSchema.parse({ ...member, admin: true }),
    modules: moduleData(['decide', 'works', 'payroll', 'grants-rounds']),
    privacy: 'encrypted-user-controlled',
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [width, height] of [
    [1440, 1100],
    [375, 812],
    [768, 1024],
    [812, 375],
    [320, 812],
  ]) {
    if (width === undefined || height === undefined) throw new Error('Invalid fixture viewport');
    await page.setViewportSize({ width, height });
    await page.goto('/dao/1');
    await expect(main(page).getByRole('link', { name: /Open Grants/ })).toBeVisible();
    await accessible(page);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: test.info().outputPath(`workspace-${width}.png`),
      fullPage: true,
    });
    await page.goto('/dao/1/settings?settings=services');
    await expect(
      main(page).getByRole('link', { name: 'Manage member capacity', exact: true }),
    ).toBeVisible();
    await accessible(page);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: test.info().outputPath(`configuration-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/dao/1/settings');
  await expect(main(page).getByLabel('New DAO name', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await accessible(page);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: test.info().outputPath('configuration-enlarged-text.png'),
    fullPage: true,
  });
  const signing = main(page)
    .locator('details')
    .filter({ has: page.getByText('Signing & wallets', { exact: true }) });
  await signing.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(signing).not.toHaveAttribute('open');
  await page.keyboard.press('Enter');
  await expect(signing).toHaveAttribute('open', '');
});
