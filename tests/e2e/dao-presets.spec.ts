import { test, expect, type Page } from '@playwright/test';
import { PublicKey, Signature } from '@wharfkit/antelope';
import {
  AccountSchema,
  ApiRoutes,
  DaoSummarySchema,
  LoginMessageSchema,
  NetworkSchema,
  RecoveryKitSchema,
  VERSION,
} from '@daclify/core-protocol';
import AxeBuilder from '@axe-core/playwright';
import { createVault } from '../../src/auth/vault';
const password = 'disposable DAO setup fixture password';
const vault = await createVault(password);
const account = AccountSchema.parse({
  id: '11111111-1111-4111-8111-111111111111',
  custody: 'user-controlled',
  signingKey: vault.signingPublicKey,
  encryptionKey: vault.encryptionPublicKey,
});
const network = NetworkSchema.parse({
  chainId: 'ab'.repeat(32),
  rpcUrl: 'http://127.0.0.1:19888',
  runtime: 'daclifycore',
  hub: null,
  environment: 'local',
  interfaceVersion: 1,
  coreVersion: VERSION,
  capabilities: ['shared-dao-create', 'dao-presets', 'governance-policy', 'guarded-agents'],
});
const dao = DaoSummarySchema.parse({
  reference: {
    chainId: network.chainId,
    contract: network.runtime,
    daoId: '1',
    interfaceVersion: 1,
  },
  title: 'Grant Commons',
  description: '',
  privacy: 'public',
  owner: 'alice',
  token: { chainId: network.chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
  members: 1,
  available: '0',
  reserved: '0',
  claims: '0',
  keyEpoch: '1',
  purpose: 'ngo-grants',
});
test.beforeEach(async ({ page }) => {
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
  let message = '';
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/auth/challenge') {
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
    }
    if (path === '/v1/auth/login') {
      const input = ApiRoutes.login.input.parse(route.request().postDataJSON());
      expect(
        Signature.from(input.signature).verifyMessage(
          new TextEncoder().encode(message),
          PublicKey.from(vault.signingPublicKey),
        ),
      ).toBe(true);
      return route.fulfill({ json: { account, csrfToken: 'c'.repeat(43) } });
    }
    const values: Record<string, unknown> = {
      '/v1/network': network,
      '/v1/daos': { daos: [dao] },
      '/v1/sign-in/session': { account },
      '/v1/me/memberships': { memberships: [] },
      '/v1/docs/agent/status': { configured: false },
      '/v1/daos/1/governance': {
        dao: dao.reference,
        policy: {
          dao_id: '1',
          revision: '1',
          config: {
            participant_mode: 2,
            decide: 'decide',
            guardian: 'guardian',
            kind: 0,
            duration: 300,
            quorum: 5000,
            approval: 5001,
            governed_works: true,
            max_commitment: '10000',
            daily_commitment: '20000',
          },
        },
        actors: [
          {
            id: '1',
            kind: 1,
            operator_label: 'Declared operator',
            revoked: false,
            credential_epoch: '1',
          },
        ],
        sessions: [],
        guardian: null,
        budget: null,
      },
    };
    await route.fulfill({
      status: path in values ? 200 : 503,
      json: values[path] ?? {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Fixture endpoint unavailable',
      },
    });
  });
});
async function openCreation(page: Page) {
  await page.goto('/account');
  await page.getByLabel('Vault password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(page.getByText('Keys unlocked', { exact: true })).toBeVisible();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name: 'Create', exact: true }).click();
}
test('signed-out creation requires an account before revealing its setup form', async ({
  page,
}) => {
  await page.route('**/v1/sign-in/session', (route) => route.fulfill({ status: 204 }));
  await page.goto('/create');
  await expect(
    page.getByRole('heading', { name: 'Set up your account first', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('DAO name', { exact: true })).toHaveCount(0);
});
test('creation still requires a public signing identity for a wallet-only account', async ({
  page,
}) => {
  const wallet = AccountSchema.parse({
    ...account,
    signingKey: null,
    encryptionKey: null,
    walletOrigin: 'signup',
  });
  await page.route('**/v1/sign-in/session', (route) =>
    route.fulfill({ json: { account: wallet } }),
  );
  await page.goto('/create');
  await expect(
    page.getByRole('heading', { name: 'Enable full access', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('DAO name', { exact: true })).toHaveCount(0);
});
test('discloses actual guardian authority without giving a visitor administration', async ({
  page,
}) => {
  await page.goto('/dao/1/settings?settings=governance');
  await expect(page.getByRole('heading', { name: 'Voting rules' })).toBeVisible();
  await expect(page.getByText('guardian', { exact: true })).toBeVisible();
  await page.getByText('Advanced: agents and automation access', { exact: true }).click();
  await page.getByText('Prepare a native guardian action', { exact: true }).click();
  await expect(
    page.getByText(
      'Signing recovery can impersonate an agent; it does not recover document decryption keys.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign policy update' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare guardian transaction' })).toBeVisible();
});
test('shows purpose presets and makes participant mode a separate choice', async ({ page }) => {
  await openCreation(page);
  await page.getByLabel('DAO purpose').selectOption('ngo-grants');
  await expect(
    page.getByText('This does not establish legal or charitable status.', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('Participants').selectOption('agents-guarded');
  await expect(page.getByLabel('Human guardian account')).toBeVisible();
  await expect(page.getByLabel('Founding agent signing public key')).toBeVisible();
  await expect(
    page.getByText(
      'Your human account sponsors creation and does not receive a voting membership.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review free DAO setup' })).toBeDisabled();
});
test('DAO setup retains form edits while retrying failed readiness and summarises the choices', async ({
  page,
}) => {
  await openCreation(page);
  await page.getByLabel('DAO name', { exact: true }).fill('Ocean Commons');
  await expect(page.getByRole('alert')).toContainText('Could not check shared creation');
  await page.getByRole('button', { name: 'Retry availability', exact: true }).click();
  await expect(page.getByLabel('DAO name', { exact: true })).toHaveValue('Ocean Commons');
  const summary = page.getByRole('complementary', { name: 'Your DAO setup' });
  await expect(summary).toContainText('Ocean Commons');
  await expect(summary).toContainText('Public content');
  await page.getByText('Advanced governance and emergency safeguards', { exact: true }).click();
  await page.getByLabel('Ballot duration unit', { exact: true }).selectOption('weeks');
  await page.getByLabel('Ballot duration', { exact: true }).fill('2');
  await page.getByLabel('Approval (%)', { exact: true }).fill('50.03');
  await expect(summary).toContainText('2 weeks');
  await expect(summary).toContainText('50.03% approval');
  await page
    .getByLabel('Privacy policy', { exact: true })
    .selectOption('encrypted-user-controlled');
  await expect(summary).toContainText('User-controlled keys required');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('dao-setup.png'), fullPage: true });
});
test('filters discovery by purpose without treating it as a permission', async ({ page }) => {
  await page.goto('/hub');
  await expect(page.getByRole('heading', { name: 'Grant Commons' })).toBeVisible();
  await page.getByLabel('DAO purpose filter').selectOption('gaming-guild');
  await expect(page.getByRole('heading', { name: 'Grant Commons' })).not.toBeVisible();
  await page.getByLabel('DAO purpose filter').selectOption('ngo-grants');
  await expect(page.getByRole('heading', { name: 'Grant Commons' })).toBeVisible();
});
