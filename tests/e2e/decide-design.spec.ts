import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  AccountSchema,
  DaoSummarySchema,
  GovernanceStateSchema,
  NetworkSchema,
  TreasurySchema,
  UserMembershipSchema,
  VERSION,
  defaultDaoSetup,
} from '@daclify/core-protocol';
import { governanceSettings } from '@daclify/core-protocol/sdk';
import { Catalog, ModulePermissions, ModuleStateSchema } from '@daclify/modules';
import { ModuleCodeHashes } from '@daclify/modules/sdk';

test.use({ timezoneId: 'Atlantic/Canary' });

async function fixture(page: Page, savedPolicy = true) {
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
    ballots: [],
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
    if (path === '/v1/me/memberships') return route.fulfill({ json: { memberships: [member] } });
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
}

test('Decide separates accessible Ballots and Elections tabs while retaining the ballot draft', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/dao/1/decide');
  const ballots = page.getByRole('tab', { name: 'Ballots', exact: true });
  const elections = page.getByRole('tab', { name: 'Elections', exact: true });
  await expect(ballots).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'DAO elections' })).not.toBeVisible();
  await page.getByLabel('Public ballot title').fill('Keep this draft');
  await ballots.focus();
  await page.keyboard.press('ArrowRight');
  await expect(elections).toBeFocused();
  await expect(elections).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'DAO elections' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Open a binary ballot' })).not.toBeVisible();
  await page.keyboard.press('Home');
  await expect(ballots).toBeFocused();
  await expect(page.getByLabel('Public ballot title')).toHaveValue('Keep this draft');
  await page.screenshot({ path: test.info().outputPath('ballots.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('saved ballot policy displays three days and exact percentages without allowing overrides', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/dao/1/decide');
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
