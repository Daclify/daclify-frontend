import { test, expect } from '@playwright/test';
import { PrivateKey } from '@wharfkit/antelope';
import { generateKeyPairSync } from 'node:crypto';
import { AccountSchema, DaoSummarySchema, NetworkSchema, VERSION } from '@daclify/core-protocol';
const publicKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
  format: 'jwk',
});
const account = AccountSchema.parse({
  id: '11111111-1111-4111-8111-111111111111',
  custody: 'user-controlled',
  signingKey: PrivateKey.generate('K1').toPublic().toString(),
  encryptionKey: { kty: 'EC', crv: 'P-256', x: publicKey.x, y: publicKey.y },
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
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const values: Record<string, unknown> = {
      '/v1/network': network,
      '/v1/daos': { daos: [dao] },
      '/v1/me': { account },
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
test('discloses actual guardian authority without giving a visitor administration', async ({
  page,
}) => {
  await page.goto('/dao/1/settings');
  await expect(page.getByRole('heading', { name: 'Governance and participants' })).toBeVisible();
  await expect(page.getByText('guardian', { exact: true })).toBeVisible();
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
  await page.goto('/create');
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
test('filters discovery by purpose without treating it as a permission', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Grant Commons' })).toBeVisible();
  await page.getByLabel('DAO purpose filter').selectOption('gaming-guild');
  await expect(page.getByRole('heading', { name: 'Grant Commons' })).not.toBeVisible();
  await page.getByLabel('DAO purpose filter').selectOption('ngo-grants');
  await expect(page.getByRole('heading', { name: 'Grant Commons' })).toBeVisible();
});
