import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  AccountSchema,
  ApiRoutes,
  DaoSummarySchema,
  GovernanceStateSchema,
  LoginMessageSchema,
  NetworkSchema,
  RecoveryKitSchema,
  TreasurySchema,
  UserMembershipSchema,
  VERSION,
  defaultDaoSetup,
} from '@daclify/core-protocol';
import { governanceSettings, instructionDigest } from '@daclify/core-protocol/sdk';
import { Catalog, ModulePermissions, ModuleStateSchema } from '@daclify/modules';
import { ModuleCodeHashes, DecideActionSchemas, decideAbi } from '@daclify/modules/sdk';
import { ABI, PublicKey, Serializer, Signature } from '@wharfkit/antelope';
import { createVault } from '../../src/auth/vault';
import { z } from 'zod';

test.use({ timezoneId: 'Atlantic/Canary' });

async function fixture(page: Page, savedPolicy = true, visitor = false) {
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
  const dao = {
    chainId: network.chainId,
    contract: network.runtime,
    daoId: '1',
    interfaceVersion: 1,
  };
  const summary = DaoSummarySchema.parse({
    reference: dao,
    title: 'Design fixture DAO',
    description: 'Synthetic governance UI',
    privacy: 'public',
    owner: 'alice',
    token: { chainId: dao.chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
    members: 1,
    available: '0',
    reserved: '0',
    claims: '0',
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
    dao,
    memberId: '1',
    nonce: '0',
    active: true,
    admin: true,
    reviewer: false,
    credits: '0',
    stake: '0',
    claim: '0',
    nativeAccount: '',
    custody: 'user-controlled',
  });
  const manifest = Catalog.find((m) => m.id === 'decide');
  if (!manifest) throw new Error('Decide manifest missing');
  const modules = ModuleStateSchema.parse({
    dao,
    modules: [
      {
        manifest,
        deployment: {
          id: 'decide',
          account: 'decide',
          version: manifest.version,
          codeHash: ModuleCodeHashes.decide,
        },
        enabled: true,
        installed: true,
        compatible: true,
        codeVerified: true,
        actions: ModulePermissions.decide.actions,
        grants: ModulePermissions.decide.grants,
      },
    ],
    ballots: [
      {
        id: '9',
        dao_id: '1',
        creator: '1',
        kind: 0,
        choices: 2,
        closes: Math.floor(Date.now() / 1000) + 86400,
        quorum: 5000,
        approval: 5001,
        denominator: '1',
        max_member: '1',
        cast: '0',
        tallies: ['0', '0'],
        status: 0,
        winner: 0,
        metadata: JSON.stringify({
          schemaVersion: 1,
          title: 'Community decision',
          options: ['Reject', 'Approve'],
        }),
      },
    ],
    votes: [],
    projects: [],
    milestones: [],
    schedules: [],
    controls: [],
    executions: [],
    entries: [],
  });
  const governance = GovernanceStateSchema.parse({
    dao,
    policy: savedPolicy
      ? { dao_id: '1', revision: '1', config: governanceSettings(defaultDaoSetup(), 'decide') }
      : null,
    actors: [],
    sessions: [],
    guardian: null,
    budget: null,
  });
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/network') return route.fulfill({ json: network });
    if (path === '/v1/daos') return route.fulfill({ json: { daos: [summary], next: null } });
    if (path === '/v1/me') return route.fulfill({ json: { account } });
    if (path === '/v1/me/memberships')
      return route.fulfill({ json: { memberships: visitor ? [] : [member] } });
    if (path === '/v1/daos/1/modules') return route.fulfill({ json: modules });
    if (path === '/v1/daos/1/governance') return route.fulfill({ json: governance });
    if (path === '/v1/daos/1/treasury')
      return route.fulfill({ json: TreasurySchema.parse({ dao, obligations: [], evidence: [] }) });
    if (path === '/v1/hub/directory')
      return route.fulfill({ json: { entries: [], next: null, skipped: 0 } });
    return route.fulfill({
      status: 404,
      json: { code: 'NOT_FOUND', message: 'Fixture route unavailable.' },
    });
  });
  return { account, member, modules };
}

test('ballot creation opens from the compact toolbar and preserves its draft across closing and switching tabs', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/dao/1/decide');
  const ballots = page.getByRole('tab', { name: 'Ballots', exact: true });
  const elections = page.getByRole('tab', { name: 'Elections', exact: true });
  const add = page.getByRole('button', { name: 'Open a ballot', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Open a ballot', exact: true });
  await expect(page.getByRole('heading', { name: 'Decide', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Ballot rules and help', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Rules & help/ })).toHaveCount(0);
  await expect(add.locator('svg')).toHaveCSS('width', '32px');
  await expect(add.locator('svg')).toHaveCSS('height', '32px');
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Community decision', exact: true }),
  ).toBeVisible();
  await expect(ballots).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'DAO elections' })).not.toBeVisible();
  await page.screenshot({ path: test.info().outputPath('ballots-list.png'), fullPage: true });
  await add.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Public ballot title')).toBeFocused();
  await dialog.getByLabel('Public ballot title').fill('Keep this draft');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('ballot-popup.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(add).toBeFocused();
  await ballots.focus();
  await page.keyboard.press('ArrowRight');
  await expect(elections).toBeFocused();
  await expect(elections).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'DAO elections' })).toBeVisible();
  await expect(dialog).not.toBeVisible();
  await page.keyboard.press('Home');
  await expect(ballots).toBeFocused();
  await add.click();
  await expect(dialog.getByLabel('Public ballot title')).toHaveValue('Keep this draft');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(add).toBeFocused();
  await page.screenshot({ path: test.info().outputPath('ballots.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('saved ballot policy displays three days and exact percentages without allowing overrides', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/dao/1/decide');
  await page.getByRole('button', { name: 'Open a ballot', exact: true }).click();
  await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('3');
  await expect(page.getByLabel('Duration unit', { exact: true })).toHaveValue('days');
  await expect(page.getByLabel('Quorum (%)', { exact: true })).toHaveValue('50');
  await expect(page.getByLabel('Approval (%)', { exact: true })).toHaveValue('50.01');
  await expect(page.getByLabel('Duration', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Quorum (%)', { exact: true })).toBeDisabled();
  await expect(page.locator('#main')).not.toContainText('basis points');
  await expect(page.locator('#main')).not.toContainText('259200');
  await page.screenshot({ path: test.info().outputPath('saved-policy.png'), fullPage: true });
});

test('custom ballot timing offers hours, days, weeks and a local closing date, and rejects invalid thresholds', async ({
  page,
}) => {
  await fixture(page, false);
  await page.clock.setFixedTime(new Date('2026-10-12T12:00:00Z'));
  await page.goto('/dao/1/decide');
  await page.getByRole('button', { name: 'Open a ballot', exact: true }).click();
  const unit = page.getByLabel('Duration unit', { exact: true });
  for (const value of ['hours', 'days', 'weeks']) {
    await unit.selectOption(value);
    await expect(unit).toHaveValue(value);
  }
  await page.getByLabel('Duration', { exact: true }).fill('2');
  await page.getByLabel('Choose a closing date', { exact: true }).check();
  const deadline = page.getByLabel('Closing date and time', { exact: true });
  await expect(deadline).toBeVisible();
  await expect(deadline).toHaveValue('2026-10-26T12:00');
  await deadline.fill('2026-10-26T13:00');
  expect(
    await deadline.evaluate((input) => input instanceof HTMLInputElement && input.checkValidity()),
  ).toBe(true);
  await expect(page.getByText(/Closes around.*Atlantic\/Canary/)).toBeVisible();
  await deadline.fill('2026-10-12T12:00');
  expect(
    await deadline.evaluate((input) => input instanceof HTMLInputElement && input.checkValidity()),
  ).toBe(false);
  await page.getByLabel('Choose a closing date', { exact: true }).uncheck();
  await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('2');
  await page.getByLabel('Quorum (%)', { exact: true }).fill('100.01');
  expect(
    await page
      .getByLabel('Quorum (%)', { exact: true })
      .evaluate((input) => input instanceof HTMLInputElement && input.checkValidity()),
  ).toBe(false);
  await page.getByLabel('Approval (%)', { exact: true }).fill('50');
  expect(
    await page
      .getByLabel('Approval (%)', { exact: true })
      .evaluate((input) => input instanceof HTMLInputElement && input.checkValidity()),
  ).toBe(false);
});

test('an invalid duration cannot switch to a calendar or leave a stale valid duration', async ({
  page,
}) => {
  await fixture(page, false);
  await page.goto('/dao/1/decide');
  await page.getByRole('button', { name: 'Open a ballot', exact: true }).click();
  const duration = page.getByLabel('Duration', { exact: true });
  await duration.fill('');
  await expect(page.getByLabel('Choose a closing date', { exact: true })).toBeDisabled();
  expect(
    await duration.evaluate((input) => input instanceof HTMLInputElement && input.checkValidity()),
  ).toBe(false);
  await duration.fill('3');
  await expect(page.getByLabel('Choose a closing date', { exact: true })).toBeEnabled();
});

test('governance settings use the same duration units and percentage controls', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/dao/1/settings?settings=governance');
  await page.getByText('Edit ballot policy and commitment limits', { exact: true }).click();
  await expect(page.getByLabel('Policy duration', { exact: true })).toHaveValue('3');
  await expect(page.getByLabel('Policy duration unit', { exact: true })).toHaveValue('days');
  await expect(page.getByLabel('Policy quorum (%)', { exact: true })).toHaveValue('50');
  await expect(page.getByLabel('Policy approval (%)', { exact: true })).toHaveValue('50.01');
  await page.getByLabel('Policy duration unit', { exact: true }).selectOption('hours');
  await expect(page.getByLabel('Policy duration', { exact: true })).toHaveValue('72');
  await expect(
    page.getByRole('button', { name: 'Sign policy update', exact: true }),
  ).toBeDisabled();
});

test('visitors can browse decisions and help but cannot open the ballot creation popup', async ({
  page,
}) => {
  await fixture(page, true, true);
  await page.goto('/dao/1/decide');
  const add = page.getByRole('button', { name: 'Open a ballot', exact: true });
  await expect(add).toBeDisabled();
  await expect(page.getByRole('dialog', { name: 'Open a ballot', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Community decision', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Ballot rules and help', exact: true }),
  ).toHaveAttribute('href', '/docs/decide?dao=1');
});

test('failed submission preserves the draft and retry closes the popup only after confirmed success', async ({
  page,
}) => {
  const state = await fixture(page),
    password = 'disposable ballot popup fixture';
  const vault = await createVault(password);
  Object.assign(
    state.account,
    AccountSchema.parse({
      ...state.account,
      signingKey: vault.signingPublicKey,
      encryptionKey: vault.encryptionPublicKey,
    }),
  );
  state.member.signingKey = vault.signingPublicKey;
  await page.addInitScript(
    (kit) => localStorage.setItem('daclify.vault.v1', JSON.stringify(kit)),
    RecoveryKitSchema.parse({
      version: 1,
      localEnvelope: vault.localEnvelope,
      recoveryEnvelope: vault.recoveryEnvelope,
      signingPublicKey: vault.signingPublicKey,
      encryptionPublicKey: vault.encryptionPublicKey,
    }),
  );
  let message = '',
    attempts = 0,
    release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/v1/auth/challenge', (route) => {
    const input = ApiRoutes.challenge.input.parse(route.request().postDataJSON()),
      id = crypto.randomUUID(),
      expires = new Date(Date.now() + 120000).toISOString(),
      origin = new URL(route.request().url()).origin;
    message = JSON.stringify(
      LoginMessageSchema.parse({
        ...input,
        domain: 'daclify.login.v3',
        origin,
        audience: origin,
        challenge: id,
        expires,
      }),
    );
    return route.fulfill({ json: { id, expires, message } });
  });
  await page.route('**/v1/auth/login', (route) => {
    const input = ApiRoutes.login.input.parse(route.request().postDataJSON());
    expect(
      Signature.from(input.signature).verifyMessage(
        new TextEncoder().encode(message),
        PublicKey.from(vault.signingPublicKey),
      ),
    ).toBe(true);
    return route.fulfill({ json: { account: state.account, csrfToken: 'c'.repeat(43) } });
  });
  await page.route('**/v1/relay', async (route) => {
    const input = ApiRoutes.relay.input.parse(route.request().postDataJSON());
    expect(input.request.action).toBe('open');
    expect(input.request.target).toBe('decide');
    expect(
      Signature.from(input.sig).verifyDigest(
        instructionDigest(input.request),
        PublicKey.from(vault.signingPublicKey),
      ),
    ).toBe(true);
    const fields = z.record(z.string(), z.unknown()).parse(
      Serializer.objectify(
        Serializer.decode({
          abi: ABI.from(decideAbi),
          type: 'open',
          data: input.request.data,
        }),
      ),
    );
    for (const key of ['dao_id', 'member_id', 'ballot_id'])
      if (typeof fields[key] === 'number') fields[key] = String(fields[key]);
    const decoded = DecideActionSchemas.open.parse(fields);
    expect(decoded).toMatchObject({
      dao_id: '1',
      member_id: '1',
      duration: 259200,
      quorum: 5000,
      approval: 5001,
    });
    attempts++;
    if (attempts === 1)
      return route.fulfill({
        status: 503,
        json: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic unavailable relay' },
      });
    await held;
    const existing = state.modules.ballots[0];
    if (!existing) throw new Error('Fixture ballot missing');
    state.modules.ballots.push({ ...existing, id: decoded.ballot_id, metadata: decoded.metadata });
    state.member.nonce = '1';
    return route.fulfill({ json: { transactionId: 'ab'.repeat(32) } });
  });
  await page.goto('/account');
  await page.getByLabel('Vault password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(page.getByText('Keys unlocked', { exact: true })).toBeVisible();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name: 'My DAO', exact: true }).click();
  await page
    .getByRole('link', { name: /Design fixture DAO/ })
    .first()
    .click();
  await page.getByRole('link', { name: 'Decide', exact: true }).click();
  await page.getByRole('button', { name: 'Open a ballot', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Open a ballot', exact: true });
  await dialog.getByLabel('Public ballot title').fill('Retry decision');
  await dialog.getByRole('button', { name: 'Open ballot', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('Public ballot title')).toHaveValue('Retry decision');
  await dialog.getByRole('button', { name: 'Open ballot', exact: true }).click();
  await expect.poll(() => attempts).toBe(2);
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Retry decision', exact: true })).toBeVisible();
});
