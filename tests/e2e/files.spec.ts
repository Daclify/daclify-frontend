import { payCreation } from './creation-payment';
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { ModuleApiRoutes } from '@daclify/modules';
import { DecideTableSchemas } from '@daclify/modules/sdk';
import {
  ArchiveRoutes,
  buildArchiveTree,
  encodeArchiveChunk,
  archiveAttestation,
  archiveSourceSchema,
  archiveManifestForPlan,
  encodeArchiveManifest,
  archiveExportConsent,
} from '@daclify/modules/archive';
import { RuntimeTableSchemas, runtimeAbi } from '@daclify/core-protocol/sdk';
import { Name, ABI, Serializer } from '@wharfkit/antelope';
import { Checksum256 } from '@wharfkit/antelope';
import type { z } from 'zod';
import {
  HostedUploadSchema,
  DaoRefSchema,
  StorageApprovalSchema,
  DEFAULT_STORAGE_PRICING,
  DEFAULT_RESOURCE_POLICY,
  storagePricingHash,
  ApiRoutes,
} from '@daclify/core-protocol';
const password = 'download fixture password 2026';
async function openMenu(page: Page) {
  const button = page.getByRole('button', { name: 'Menu', exact: true });
  if ((await button.isVisible()) && (await button.getAttribute('aria-expanded')) === 'false')
    await button.click();
}
async function createWorkspace(page: Page, encrypted = false) {
  await page.goto('/account');
  await page.getByLabel('Vault password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create encrypted vault' }).click();
  await page.getByLabel('I have saved my recovery kit and credential').check();
  await page.getByRole('button', { name: 'Finish account setup' }).click();
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  await openMenu(page);
  await page.getByRole('link', { name: 'Create DAO', exact: true }).click();
  await page.getByLabel('DAO name').fill(`File fixture ${Date.now()}`);
  if (encrypted) await page.getByLabel('Privacy policy').selectOption('encrypted-user-controlled');
  await payCreation(page);
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  if (encrypted) {
    await page.getByRole('button', { name: 'Initialize encryption epoch' }).click();
    await expect(page.getByText('Encryption epoch ready', { exact: true })).toBeVisible();
  }
}
test('resumes a verified public upload after a lost response and a browser reload', async ({
  page,
}) => {
  await createWorkspace(page);
  const title = await page.locator('main h1').textContent();
  if (!title) throw new Error('Workspace unavailable');
  const payload = Buffer.from([0, 1, 2, 128, 255]);
  await page.route(
    '**/v1/uploads',
    async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort();
    },
    { times: 1 },
  );
  await page.getByLabel('File document ID').fill('27');
  await page.getByLabel('Document file', { exact: true }).setInputFiles({
    name: 'binary-fixture.bin',
    mimeType: 'application/octet-stream',
    buffer: payload,
  });
  await page.getByRole('button', { name: 'Upload file', exact: true }).click();
  await expect(page.getByText('Pending request:', { exact: false })).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Pending request:', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Check upload completion' }).click();
  await expect(page.getByRole('heading', { name: 'Verified file record' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign and publish file record' })).toBeDisabled();
  await page.getByRole('link', { name: 'Your account', exact: true }).click();
  await page.getByLabel('Vault password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock and sign in' }).click();
  await expect(page.getByText('Vault unlocked', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/dao\/\d+\/documents$/);
  await openMenu(page);
  await page.getByRole('link', { name: 'DAO hub', exact: true }).click();
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:[0-9]+\/$/);
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    .click();
  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  await page.getByRole('button', { name: 'Check upload completion' }).click();
  await page.getByRole('button', { name: 'Sign and publish file record' }).click();
  await expect(page.getByText('File document published.', { exact: true })).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download document 27', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('binary-fixture.bin');
  const path = await download.path();
  if (!path) throw new Error('Download unavailable');
  expect(await readFile(path)).toEqual(payload);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('publishes only ciphertext for a private file and decrypts its original filename on download', async ({
  page,
}) => {
  await createWorkspace(page, true);
  const payload = Buffer.from('private fixture download contents');
  const filename = 'private-fixture-notes.txt';
  await page.getByLabel('File document ID').fill('28');
  await page
    .getByLabel('Document file', { exact: true })
    .setInputFiles({ name: filename, mimeType: 'text/plain', buffer: payload });
  const requestEvent = page.waitForRequest(
    (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/v1/uploads',
  );
  await page.getByRole('button', { name: 'Encrypt and upload file' }).click();
  const request = await requestEvent;
  const input = HostedUploadSchema.parse(JSON.parse(request.postData() ?? '{}'));
  expect(input.metadata).toBe('{}');
  const stored = Buffer.from(input.content, 'base64').toString('utf8');
  expect(stored).not.toContain(filename);
  expect(stored).not.toContain(payload.toString());
  await expect(page.getByRole('heading', { name: 'Verified file record' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign and publish file record' }).click();
  await expect(page.getByRole('heading', { name: 'Document 28', exact: true })).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Decrypt and download document 28', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(filename);
  const path = await download.path();
  if (!path) throw new Error('Download unavailable');
  expect(await readFile(path)).toEqual(payload);
  await page.getByRole('button', { name: 'Lock keys', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Decrypt and download document 28', exact: true }),
  ).toBeDisabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('shows one shared storage object for two published document references', async ({ page }) => {
  await createWorkspace(page);
  const payload = Buffer.from('Repeated hosted resource fixture');
  for (const documentId of ['127', '128']) {
    await page.getByLabel('File document ID').fill(documentId);
    await page.getByLabel('Document file', { exact: true }).setInputFiles({
      name: 'repeated.bin',
      mimeType: 'application/octet-stream',
      buffer: payload,
    });
    await page.getByRole('button', { name: 'Upload file', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Verified file record' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign and publish file record' }).click();
    await expect(page.getByText('File document published.', { exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Refresh storage usage' }).click();
  await expect(page.getByText('1 unique files · 2 references.', { exact: false })).toBeVisible();
  await expect(page.getByText(`${payload.length} bytes used of`, { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Manage resources →', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Storage and blockchain resources' }),
  ).toBeVisible();
  await expect(page.getByText('Paid storage is not configured on this operator.')).toBeVisible();
  await expect(page.getByText('1 unique files · 2 references.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve and prepare card checkout' })).toHaveCount(
    0,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('uploads a public card image for a private DAO, retries the same request and signs publication separately', async ({
  page,
}) => {
  await createWorkspace(page, true);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const panel = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Public directory card', exact: true }) });
  const image = Buffer.from('iVBORw0KGgo=', 'base64');
  await panel
    .getByLabel('Image file', { exact: true })
    .setInputFiles({ name: 'public-logo.png', mimeType: 'image/png', buffer: image });
  const upload = panel.getByRole('button', { name: 'Upload and verify image', exact: true });
  await expect(upload).toBeDisabled();
  await panel
    .getByRole('checkbox', {
      name: 'I understand this image is public and unencrypted, including for a private DAO.',
    })
    .check();
  let requestId: string | undefined;
  await page.route('**/v1/branding/uploads', async (route) => {
    const input = ApiRoutes.brandingUpload.input.parse(
      JSON.parse(route.request().postData() ?? '{}'),
    );
    if (!requestId) {
      requestId = input.requestId;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort();
    } else {
      expect(input.requestId).toBe(requestId);
      await route.continue();
    }
  });
  await upload.click();
  const retry = panel.getByRole('button', { name: 'Retry the same upload', exact: true });
  await expect(retry).toBeEnabled();
  await page.reload();
  await expect(retry).toBeEnabled();
  await expect(
    panel.getByRole('button', { name: 'Sign and update card', exact: true }),
  ).toBeDisabled();
  await page.getByRole('link', { name: 'Your account', exact: true }).click();
  await page.getByLabel('Vault password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dao\/\d+\/settings$/);
  await retry.click();
  await expect(
    panel.getByText('Image verified and hosted. Sign the card update to publish this selection.'),
  ).toBeVisible();
  await panel
    .getByLabel('Card summary', { exact: true })
    .fill('Private documents, public community identity.');
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/v1/relay' && response.request().method() === 'POST',
  );
  await panel.getByRole('button', { name: 'Sign and update card', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(
    panel.getByRole('button', { name: 'Sign and update card', exact: true }),
  ).toBeEnabled();
  await expect(panel.getByLabel('Logo', { exact: true })).not.toHaveValue('');
  await page.reload();
  await expect(panel.getByLabel('Card summary', { exact: true })).toHaveValue(
    'Private documents, public community identity.',
  );
  await expect(panel.getByLabel('Logo', { exact: true })).not.toHaveValue('');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('recovers bounded hosted references, displays uncertain files and distinguishes recovery from paid billing', async ({
  page,
}) => {
  await createWorkspace(page);
  const panel = page
    .locator('aside')
    .filter({ has: page.getByRole('heading', { name: 'Hosted storage', exact: true }) });
  await panel.getByText('Recover hosted records after database loss', { exact: true }).click();
  let batch = 0;
  await page.route('**' + ApiRoutes.storageRecover.path, async (route) => {
    const input = ApiRoutes.storageRecover.input.parse(
      JSON.parse(route.request().postData() ?? 'null'),
    );
    expect(input.kind).toBe('document-version');
    expect(input.after).toBe(batch === 0 ? '0' : '26');
    await route.fulfill({
      json: ApiRoutes.storageRecover.response.parse({
        dao: input.dao,
        kind: input.kind,
        next: batch++ === 0 ? '26' : null,
        billingRestored: false,
        objects: [
          {
            referenceKey: 'chain:7:1:1',
            cid: 'bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            state: batch === 1 ? 'recovered' : 'unavailable',
          },
        ],
      }),
    });
  });
  await panel.getByRole('button', { name: 'Verify surviving hosted records', exact: true }).click();
  await expect(
    panel.getByText('1 references checked. Paid billing has not been restored.', { exact: true }),
  ).toBeVisible();
  await expect(panel.getByText('chain:7:1:1: recovered', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Verify next batch', exact: true }).click();
  await expect(panel.getByText('chain:7:1:1: unavailable', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Verify next batch', exact: true })).toHaveCount(
    0,
  );
  await panel.getByLabel('References to recover').selectOption('branding');
  await expect(panel.getByText('chain:7:1:1: unavailable', { exact: true })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('requires exact recurring storage consent and shows a pending checkout without granting capacity', async ({
  page,
}) => {
  await createWorkspace(page);
  const resources = page.getByRole('link', { name: 'Manage resources →', exact: true });
  const href = await resources.getAttribute('href');
  if (!href) throw new Error('Resource link missing');
  const dao = DaoRefSchema.parse(
    JSON.parse(new URL(href, 'http://localhost').searchParams.get('dao') ?? 'null'),
  );
  const status = {
    dao,
    configured: true,
    currentPricing: DEFAULT_STORAGE_PRICING,
    funding: {
      state: 'free',
      pricing: DEFAULT_STORAGE_PRICING,
      units: 0,
      paidThrough: null,
      graceEndsAt: null,
      uploadCapacityBytes: '100000000',
      retainedCapacityBytes: '100000000',
    },
    subscription: null,
  };
  await page.route('**/v1/storage/billing?*', (route) => route.fulfill({ json: status }));
  await page.route('**/v1/storage/approve', async (route) => {
    const input = StorageApprovalSchema.parse(JSON.parse(route.request().postData() ?? 'null'));
    expect(input.dao).toEqual(dao);
    expect(input.units).toBe(3);
    expect(input.monthlyUsdCents).toBe(300);
    expect(input.pricingHash).toBe(storagePricingHash(DEFAULT_STORAGE_PRICING));
    expect(input.recurringConsent).toBe(true);
    expect(route.request().headers()['x-account-signature']).toBeTruthy();
    await route.fulfill({
      json: {
        ...status,
        subscription: {
          id: crypto.randomUUID(),
          requestId: input.requestId,
          state: 'pending',
          pricing: DEFAULT_STORAGE_PRICING,
          units: 3,
          monthlyUsdCents: 300,
          checkoutUrl: 'https://checkout.stripe.com/c/pay/browser-fixture',
          invoiceUrl: null,
          pending: null,
        },
      },
    });
  });
  await resources.click();
  const approve = page.getByRole('button', { name: 'Approve and prepare card checkout' });
  await expect(approve).toBeDisabled();
  await page.getByLabel('Additional paid storage units').fill('2');
  const consent = page.getByLabel('I approve these units and this recurring monthly price.');
  await consent.check();
  await expect(approve).toBeEnabled();
  await page.getByLabel('Additional paid storage units').fill('3');
  await expect(consent).not.toBeChecked();
  await expect(approve).toBeDisabled();
  await consent.check();
  await approve.click();
  await expect(page.getByRole('button', { name: 'Continue secure Stripe checkout' })).toBeVisible();
  await expect(page.getByText('100,000,000 bytes', { exact: true })).toHaveCount(2);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('previews eligibility, requires export consent and downloads a verified recovery bundle', async ({
  page,
}) => {
  await createWorkspace(page);
  const link = page.getByRole('link', { name: 'Manage resources →', exact: true });
  const href = await link.getAttribute('href');
  if (!href) throw new Error('Resource link missing');
  const dao = DaoRefSchema.parse(
    JSON.parse(new URL(href, 'http://localhost').searchParams.get('dao') ?? 'null'),
  );
  // Eligibility responses are HTTP fixtures; native snapshot/coverage is qualified separately.
  await page.route(
    '**' + ModuleApiRoutes.state.path.replace(':id', dao.daoId) + '*',
    async (route) => {
      const response = await route.fetch(),
        body = ModuleApiRoutes.state.response.parse(await response.json());
      body.ballots = ['7', '8'].map((id) =>
        DecideTableSchemas.ballots.parse({
          id,
          dao_id: dao.daoId,
          creator: '1',
          kind: 0,
          choices: 2,
          closes: 1,
          quorum: 5000,
          approval: 5001,
          denominator: '1',
          max_member: '1',
          cast: '0',
          tallies: ['0', '0'],
          status: 2,
          winner: -1,
          metadata: '{}',
        }),
      );
      await route.fulfill({ json: body });
    },
  );
  const source = archiveSourceSchema('ordinary-poll-votes');
  let ramReads = 0;
  await page.route('**' + ApiRoutes.ramUsage.path.replace(':id', dao.daoId), async (route) => {
    const active = ramReads++ === 0;
    await route.fulfill({
      json: ApiRoutes.ramUsage.response.parse({
        dao,
        observation: active ? 'active' : 'disabled',
        enforcement: 'disabled',
        completionHolds: active ? { rows: 1, bytes: '883' } : null,
        policy: null,
        totalObservedBytes: active ? '2383' : null,
        purchasedBytes: '4096',
        read: {
          startedAt: '2026-10-08T00:00:00.000Z',
          completedAt: '2026-10-08T00:00:01.000Z',
          atomic: false,
        },
        payers: [
          {
            payer: dao.contract,
            moduleId: null,
            sourceVerified: true,
            usage: active
              ? { identity: '1000', activity: '200', retained: '1183', platform: '0' }
              : null,
            purchasedBytes: '4096',
            entitlement: { policy_revision: '1', identity_per_slot: '2048', slots: 10 },
            globalQuotaBytes: '1000000',
            globalUsedBytes: '10000',
          },
        ],
      }),
    });
  });
  const saved: z.infer<typeof ArchiveRoutes.export.response>[] = [];
  const id = crypto.randomUUID();
  let latest: z.infer<typeof ArchiveRoutes.preview.response> | undefined;
  await page.route('**' + ArchiveRoutes.list.path + '?*', (route) =>
    route.fulfill({ json: { dao, exports: saved, next: null } }),
  );
  await page.route('**' + ArchiveRoutes.preview.path, async (route) => {
    const input = ArchiveRoutes.preview.input.parse(
      JSON.parse(route.request().postData() ?? 'null'),
    );
    expect(input.dao).toEqual(dao);
    expect(input.retentionSeconds).toBe(90 * 86400);
    if (!('ballotIds' in input)) throw new Error('Poll fixture received document selection');
    const id = input.ballotIds[0];
    if (!id) throw new Error('Preview ID missing');
    latest = ArchiveRoutes.preview.response.parse({
      dao,
      source: { account: 'decide', codeHash: source.codeHash, abiHash: source.rawAbiHash },
      snapshot: {
        blockNumber: 1,
        blockId: '00000001' + 'ab'.repeat(28),
        timestamp: '2026-01-01T00:00:00.000Z',
      },
      pruningAuthorized: false,
      grossRamBytes: '0',
      families:
        id === '8'
          ? [{ kind: 'ordinary-poll-votes', parentId: '8', grossRamBytes: '0', chunks: [] }]
          : [],
      blocked: id === '7' ? [{ parentId: '7', reason: 'retention' }] : [],
    });
    await route.fulfill({ json: latest });
  });
  await page.route('**' + ArchiveRoutes.export.path, async (route) => {
    if (!latest) throw new Error('Export without preview');
    const input = ArchiveRoutes.export.input.parse(
      JSON.parse(route.request().postData() ?? 'null'),
    );
    expect(input.selection.dao).toEqual(dao);
    if (!('ballotIds' in input.selection)) throw new Error('Poll fixture received document export');
    expect(input.selection.ballotIds).toEqual(['8']);
    expect(input.selectionCommitment).toBe(archiveExportConsent(latest).selectionCommitment);
    const status = ArchiveRoutes.export.response.parse({
      id,
      dao,
      state: 'planned',
      maximumStoredBytes: input.maximumStoredBytes,
      heldBytes: input.maximumStoredBytes,
      verifiedChunks: 0,
      totalChunks: 0,
      manifest: null,
      pruningAuthorized: false,
    });
    saved.splice(0, saved.length, status);
    await route.fulfill({ json: status });
  });
  await page.route('**' + ArchiveRoutes.reconcile.path.replace(':id', id), async (route) => {
    if (!latest || !saved[0]) throw new Error('Missing export');
    const bytes = encodeArchiveManifest(archiveManifestForPlan(latest, []));
    saved[0] = ArchiveRoutes.reconcile.response.parse({
      ...saved[0],
      state: 'verified',
      backupSupported: true,
      heldBytes: '0',
      manifest: {
        cid: 'bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        bytes: bytes.length,
        commitment: Checksum256.hash(bytes).toString(),
      },
    });
    await route.fulfill({ json: saved[0] });
  });
  await page.route('**' + ArchiveRoutes.backup.path.replace(':id', id), async (route) => {
    if (!saved[0]?.manifest) throw new Error('Missing reviewed manifest');
    const input = ArchiveRoutes.backup.input.parse(
      JSON.parse(route.request().postData() ?? 'null'),
    );
    expect(input.expectedManifestCommitment).toBe(saved[0].manifest.commitment);
    saved[0] = ArchiveRoutes.backup.response.parse({
      ...saved[0],
      backupSupported: true,
      backup: {
        formatVersion: 1,
        storeId: 'owned-browser-backup-fixture',
        keyId: 'fixture-key',
        commitment: 'cd'.repeat(32),
        manifestCommitment: input.expectedManifestCommitment,
        bytes: '4096',
        verifiedAt: '2026-10-08T12:00:00.000Z',
      },
    });
    await route.fulfill({ json: saved[0] });
  });
  await page.route('**' + ArchiveRoutes.attest.path.replace(':id', id), async (route) => {
    if (!latest || !saved[0]?.manifest || !saved[0].backup)
      throw new Error('Missing verified export');
    const input = ArchiveRoutes.attest.input.parse(
        JSON.parse(route.request().postData() ?? 'null'),
      ),
      manifest = archiveManifestForPlan(latest, []);
    expect(input.descriptorCommitment).toBe(manifest.descriptorCommitment);
    saved[0] = ArchiveRoutes.attest.response.parse({
      ...saved[0],
      anchor: RuntimeTableSchemas.archives.parse({
        id: '1',
        dao_id: dao.daoId,
        manifest: {
          format_version: 1,
          chain_id: dao.chainId,
          runtime: dao.contract,
          dao_id: dao.daoId,
          source: 'decide',
          code_hash: source.codeHash,
          abi_hash: source.rawAbiHash,
          block_number: 1,
          block_id: latest.snapshot.blockId,
          timestamp: latest.snapshot.timestamp,
          families: [
            {
              kind: 'ordinary-poll-votes',
              parent_id: '8',
              table: 'votes',
              scope: Name.from(dao.contract).value.toString(),
              schema_hash: source.schemaHash,
              records: '0',
              chunks: [],
            },
          ],
          files: [],
        },
        manifest_cid: saved[0].manifest.cid,
        manifest_bytes: saved[0].manifest.bytes,
        manifest_commitment: input.manifestCommitment,
        descriptor_commitment: input.descriptorCommitment,
        backup_commitment: input.backupCommitment,
        verifier: 'relay',
        retention_seconds: input.retentionSeconds,
        attested_at: Math.floor(Date.now() / 1000),
        approved_by: '0',
        approved_at: 0,
        revoked: false,
        attestation_transaction: 'ab'.repeat(32),
        approval_transaction: '00'.repeat(32),
      }),
    });
    await route.fulfill({ json: saved[0] });
  });
  let signatures = 0;
  await page.route('**' + ApiRoutes.relay.path, async (route) => {
    const input = ApiRoutes.relay.input.parse(JSON.parse(route.request().postData() ?? 'null'));
    if (!saved[0]?.anchor) throw new Error('Approval requires attestation');
    expect(input.request.action).toMatch(/^arch(approve|revoke)$/);
    const fields = RuntimeTableSchemas.archives.parse(saved[0].anchor),
      raw: unknown = JSON.parse(
        JSON.stringify(
          Serializer.decode({
            abi: ABI.from(runtimeAbi),
            type: input.request.action,
            data: input.request.data,
          }),
        ),
      );
    expect(raw).toMatchObject({
      runtime: dao.contract,
      dao_id: dao.daoId,
      manifest_commitment: fields.manifest_commitment,
      backup_commitment: fields.backup_commitment,
      retention_seconds: 90 * 86400,
    });
    signatures++;
    saved[0].anchor = {
      ...fields,
      approved_by: '1',
      approved_at: Math.floor(Date.now() / 1000),
      revoked: input.request.action === 'archrevoke',
      approval_transaction: 'cd'.repeat(32),
    };
    await route.fulfill({
      json: ApiRoutes.relay.response.parse({ transactionId: 'cd'.repeat(32) }),
    });
  });
  await page.route('**' + ArchiveRoutes.bundle.path.replace(':id', id), async (route) => {
    if (!latest || !saved[0]?.manifest) throw new Error('Missing verified manifest');
    const manifest = archiveManifestForPlan(latest, []),
      bytes = encodeArchiveManifest(manifest);
    await route.fulfill({
      json: ArchiveRoutes.bundle.response.parse({
        id,
        manifest,
        manifestFile: { ...saved[0].manifest, content: Buffer.from(bytes).toString('base64') },
        chunks: [],
      }),
    });
  });
  await page.route('**' + ArchiveRoutes.history.path + '?*', (route) =>
    route.fulfill({
      json: { dao, anchors: saved[0]?.anchor ? [saved[0].anchor] : [], next: null },
    }),
  );
  await page.route('**' + ArchiveRoutes.historyPage.path, async (route) => {
    const input = ArchiveRoutes.historyPage.input.parse(
      JSON.parse(route.request().postData() ?? 'null'),
    );
    expect(input.dao).toEqual(dao);
    expect(input.manifestCommitment).toBe(saved[0]?.manifest?.commitment);
    await route.fulfill({
      json: ArchiveRoutes.historyPage.response.parse({
        dao,
        manifestCommitment: input.manifestCommitment,
        parentId: '8',
        records: [],
        next: null,
        coverage: 'verified-archive',
        liveRowsIncluded: false,
      }),
    });
  });
  await page.route('**' + ArchiveRoutes.recover.path, async (route) => {
    const input = ArchiveRoutes.recover.input.parse(
      JSON.parse(route.request().postData() ?? 'null'),
    );
    if (!latest || !saved[0]?.anchor || !saved[0].manifest)
      throw new Error('Missing anchored history');
    expect(input.manifestCommitment).toBe(saved[0].manifest.commitment);
    const manifest = archiveManifestForPlan(latest, []),
      bytes = encodeArchiveManifest(manifest);
    await route.fulfill({
      json: {
        id,
        manifest,
        manifestFile: { ...saved[0].manifest, content: Buffer.from(bytes).toString('base64') },
        chunks: [],
      },
    });
  });
  await link.click();
  await expect(
    page.getByText('recorded for this DAO across its metered Daclify contract records.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByText(/physically occupied by 1 core obligation/)).toBeVisible();
  const preview = page.getByRole('button', { name: 'Preview archive eligibility', exact: true }),
    select = page.getByLabel('Finalized ballot', { exact: true });
  await expect(preview).toBeDisabled();
  await expect(select).toBeEnabled();
  await select.selectOption('7');
  await preview.click();
  await expect(
    page.getByText('The 90-day wait from actual finalization or legacy marking has not ended.'),
  ).toBeVisible();
  await select.selectOption('8');
  await expect(
    page.getByText('The 90-day wait from actual finalization or legacy marking has not ended.'),
  ).toHaveCount(0);
  await preview.click();
  await expect(page.getByText('Eligible for export planning.', { exact: false })).toBeVisible();
  const exportButton = page.getByRole('button', { name: 'Create archive export', exact: true });
  await expect(exportButton).toBeDisabled();
  await page.getByLabel('I approve this export and its storage reservation.').check();
  await exportButton.click();
  await expect(page.getByText('Export ' + id, { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh export status', exact: true }).click();
  await page
    .getByRole('button', { name: 'Create and verify encrypted backup', exact: true })
    .click();
  await expect(
    page.getByText('Encrypted backup restored and verified', { exact: false }),
  ).toBeVisible();
  const approve = page.getByRole('button', { name: 'Sign archive approval', exact: true });
  await expect(approve).toBeDisabled();
  await page.getByLabel('I approve this exact manifest and backup', { exact: false }).check();
  await approve.click();
  await expect(page.getByText('Administrator approval recorded', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Revoke archive approval', exact: true }).click();
  await expect(page.getByText('Approval revoked', { exact: false })).toBeVisible();
  expect(signatures).toBe(2);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download recovery bundle', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toContain(id);
  await page.reload();
  await page.getByRole('button', { name: 'Browse verified votes', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Archived votes · poll #8', exact: true }),
  ).toBeVisible();
  const recoveredDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Recover archive bundle', exact: true }).click();
  expect((await recoveredDownload).suggestedFilename()).toContain('archive-1');
  await expect(page.getByText('Export ' + id, { exact: false })).toBeVisible();
  await expect(
    page.getByText('Encrypted backup restored and verified', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText('DAO-level observation is disabled on this deployment.', { exact: false }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('requires exact one-time card RAM consent and preserves the order across reload', async ({
  page,
}) => {
  await createWorkspace(page);
  const href = await page
    .getByRole('link', { name: 'Manage resources →', exact: true })
    .getAttribute('href');
  if (!href) throw new Error('Resource link missing');
  const dao = DaoRefSchema.parse(
    JSON.parse(new URL(href, 'http://fixture').searchParams.get('dao') ?? 'null'),
  );
  const terms = ApiRoutes.ramCardQuote.response.parse({
    quote: {
      dao,
      rail: 'tlos',
      baseUnits: '50000',
      feeUnits: '2500',
      totalUnits: '52500',
      feeBps: 500,
      order: {
        dao_id: dao.daoId,
        payer: 'relay',
        reference: 'cd'.repeat(32),
        policy_revision: '1',
        maximum: '5.2500 TLOS',
        expires: Math.floor(Date.now() / 1000) + 300,
        purchases: [{ receiver: dao.contract, quantity: '5.0000 TLOS', minimum_bytes: '1048576' }],
      },
      systemCodeHash: 'ef'.repeat(32),
      systemRawAbiHash: 'fe'.repeat(32),
      quotedAt: new Date().toISOString(),
    },
    policy: { ...DEFAULT_RESOURCE_POLICY, revision: '1' },
    oracle: { median: '10000', precision: 4, observed_at: Math.floor(Date.now() / 1000) },
    baseUsdCents: 500,
    feeUsdCents: 100,
    totalUsdCents: 600,
  });
  await page.route('**' + ApiRoutes.ramUsage.path.replace(':id', dao.daoId), (route) =>
    route.fulfill({
      json: ApiRoutes.ramUsage.response.parse({
        dao,
        observation: 'active',
        enforcement: 'disabled',
        policy: terms.policy,
        totalObservedBytes: '0',
        purchasedBytes: '0',
        read: {
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          atomic: false,
        },
        payers: [
          {
            payer: dao.contract,
            moduleId: null,
            sourceVerified: true,
            usage: { identity: '0', activity: '0', retained: '0', platform: '0' },
            purchasedBytes: '0',
            globalQuotaBytes: '10000000',
            globalUsedBytes: '10000',
          },
        ],
      }),
    }),
  );
  await page.route('**' + ApiRoutes.ramCardQuote.path, (route) => route.fulfill({ json: terms }));
  let saved: z.infer<typeof ApiRoutes.ramCardStatus.response> | undefined;
  await page.route('**' + ApiRoutes.ramCardCheckout.path, async (route) => {
    const approval = ApiRoutes.ramCardCheckout.input.parse(
      JSON.parse(route.request().postData() ?? 'null'),
    );
    expect(approval).toMatchObject({ consent: true, totalUsdCents: 600, feeUsdCents: 100 });
    expect(route.request().headers()['x-account-intent-id']).toBeTruthy();
    saved = ApiRoutes.ramCardCheckout.response.parse({
      id: approval.requestId,
      dao,
      state: 'pending',
      approval,
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_ram_browser',
      acquiredBytes: null,
      settledAt: null,
    });
    await route.fulfill({ json: saved });
  });
  await page.route('**/v1/resources/ram/card/orders/*', (route) => {
    if (!saved) throw new Error('Missing saved order');
    return route.fulfill({ json: saved });
  });
  await page.getByRole('link', { name: 'Manage resources →', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Buy RAM with a card', exact: true });
  await panel.getByLabel('Contract receiving RAM').selectOption(dao.contract);
  await panel.getByRole('button', { name: 'Get card quote', exact: true }).click();
  await expect(panel.getByText('One-time total $6.00.', { exact: false })).toBeVisible();
  const approve = panel.getByRole('button', {
    name: 'Approve and prepare card checkout',
    exact: true,
  });
  await expect(approve).toBeDisabled();
  await panel
    .getByLabel('I approve this exact one-time price and byte minimum.', { exact: false })
    .check();
  await approve.click();
  await expect(
    panel.getByRole('link', { name: 'Continue secure Stripe checkout ↗', exact: true }),
  ).toBeVisible();
  expect(saved?.state).toBe('pending');
  await page.reload();
  await expect(panel.getByText('Order ' + saved?.id, { exact: false })).toBeVisible();
  await expect(
    panel.getByRole('link', { name: 'Continue secure Stripe checkout ↗', exact: true }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('curates whole storage objects with explicit capacity and preserves selections across reload', async ({
  page,
}) => {
  await createWorkspace(page);
  const link = page.getByRole('link', { name: 'Manage resources →', exact: true }),
    href = await link.getAttribute('href');
  if (!href) throw new Error('Resource link missing');
  const dao = DaoRefSchema.parse(
    JSON.parse(new URL(href, 'http://localhost').searchParams.get('dao') ?? 'null'),
  );
  const ids = [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
  ];
  let generation = '0',
    keep: string[] = [];
  function status() {
    return ApiRoutes.curation.response.parse({
      dao,
      generation,
      funding: {
        state: 'overdue',
        pricing: { ...DEFAULT_STORAGE_PRICING, freeBytes: '100' },
        units: 1,
        paidThrough: '2026-08-01T00:00:00Z',
        graceEndsAt: '2026-08-31T00:00:00Z',
        uploadCapacityBytes: '100',
        retainedCapacityBytes: '100',
      },
      cleanup: 'disabled',
      objects: ids.map((id, i) => ({
        id,
        cid: 'bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        bytes: i === 2 ? '40' : '60',
        createdAt: `2026-0${i + 1}-01T00:00:00Z`,
        kinds: ['media'],
        selected: keep.includes(id),
        retained: i > 0,
        releasedAt: null,
      })),
    });
  }
  await page.route('**' + ApiRoutes.curation.path + '?*', (route) =>
    route.fulfill({ json: status() }),
  );
  await page.route('**' + ApiRoutes.retain.path, async (route) => {
    const input = ApiRoutes.retain.input.parse(JSON.parse(route.request().postData() ?? 'null'));
    expect(input.dao).toEqual(dao);
    expect(input.generation).toBe(generation);
    keep = input.keep;
    generation = (BigInt(generation) + 1n).toString();
    await route.fulfill({ json: status() });
  });
  await link.click();
  const panel = page.getByRole('region', { name: 'Choose files to keep' }),
    choices = panel.locator('input[type=checkbox]'),
    save = page.getByRole('button', { name: 'Save free-allowance priorities', exact: true });
  await choices.nth(0).check();
  await choices.nth(1).check();
  await expect(save).toBeDisabled();
  await expect(
    panel.getByText('Select fewer files or complete archive bundles to fit the free allowance.', {
      exact: false,
    }),
  ).toBeVisible();
  await choices.nth(1).uncheck();
  await choices.nth(2).check();
  await save.click();
  await expect(panel.getByText('Your file priorities were saved.')).toBeVisible();
  expect(keep).toEqual([ids[0], ids[2]]);
  await page.reload();
  await expect(choices.nth(0)).toBeChecked();
  await expect(choices.nth(2)).toBeChecked();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('previews document protection and signs restoration of verified original archive rows', async ({
  page,
}) => {
  test.setTimeout(60000);
  await createWorkspace(page, true);
  for (const version of [1, 2]) {
    await page.getByLabel('Document ID', { exact: true }).fill('901');
    await page.getByLabel('JSON content', { exact: true }).fill(JSON.stringify({ version }));
    await page.getByRole('button', { name: 'Encrypt and publish JSON', exact: true }).click();
    await expect(page.getByText(`Version ${version}`, { exact: true })).toBeVisible();
  }
  const link = page.getByRole('link', { name: 'Manage resources →', exact: true }),
    href = await link.getAttribute('href');
  if (!href) throw new Error('Resource link missing');
  const dao = DaoRefSchema.parse(
    JSON.parse(new URL(href, 'http://localhost').searchParams.get('dao') ?? 'null'),
  );
  const content = ApiRoutes.content.response.parse(
      await (await page.request.get(ApiRoutes.content.path.replace(':id', dao.daoId))).json(),
    ),
    original = content.documents.find((d) => d.document_id === '901' && d.version === 1);
  if (!original) throw new Error('Original document missing');
  const source = archiveSourceSchema('document-versions'),
    domain = {
      format_version: 1 as const,
      chain_id: dao.chainId,
      runtime: dao.contract,
      dao_id: dao.daoId,
      source: dao.contract,
      code_hash: source.codeHash,
      abi_hash: source.rawAbiHash,
      schema_hash: source.schemaHash,
      table: 'documents',
      scope: dao.daoId,
      chunk_ordinal: 0,
      leaf_count: 1,
    },
    rows = [
      {
        primaryKey: original.id,
        packed: Serializer.encode({
          abi: ABI.from(runtimeAbi),
          type: 'document_record',
          object: original,
        }).hexString,
      },
    ],
    tree = buildArchiveTree(domain, rows),
    chunkBytes = encodeArchiveChunk(domain, rows),
    cid = 'bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const plan = ArchiveRoutes.preview.response.parse({
      dao,
      source: { account: dao.contract, codeHash: source.codeHash, abiHash: source.rawAbiHash },
      snapshot: {
        blockNumber: 1,
        blockId: '00000001' + 'ab'.repeat(28),
        timestamp: '2026-01-01T00:00:00Z',
      },
      pruningAuthorized: false,
      grossRamBytes: '1',
      blocked: [],
      families: [
        {
          kind: 'document-versions',
          parentId: '901',
          grossRamBytes: '1',
          chunks: [{ domain, root: tree.root, bytes: chunkBytes.length, rows }],
        },
      ],
    }),
    manifest = archiveManifestForPlan(plan, [
      { cid, bytes: chunkBytes.length, commitment: Checksum256.hash(chunkBytes).toString() },
    ]),
    manifestBytes = encodeArchiveManifest(manifest),
    commitment = Checksum256.hash(manifestBytes).toString(),
    bundle = {
      id: crypto.randomUUID(),
      manifest,
      manifestFile: {
        cid,
        bytes: manifestBytes.length,
        commitment,
        content: Buffer.from(manifestBytes).toString('base64'),
      },
      chunks: [{ cid, content: Buffer.from(chunkBytes).toString('base64') }],
    };
  const native = archiveAttestation(
      bundle,
      {
        formatVersion: 1,
        storeId: 'fixture',
        keyId: 'fixture',
        commitment: 'cd'.repeat(32),
        manifestCommitment: commitment,
        bytes: '4096',
        verifiedAt: '2026-10-08T12:00:00Z',
      },
      7776000,
    ),
    anchor = RuntimeTableSchemas.archives.parse({
      id: '1',
      dao_id: dao.daoId,
      manifest: native.manifest,
      manifest_cid: cid,
      manifest_bytes: manifestBytes.length,
      manifest_commitment: commitment,
      descriptor_commitment: manifest.descriptorCommitment,
      backup_commitment: 'cd'.repeat(32),
      verifier: 'relay',
      retention_seconds: 7776000,
      attested_at: 1,
      approved_by: '1',
      approved_at: 1,
      revoked: false,
      attestation_transaction: 'ab'.repeat(32),
      approval_transaction: 'cd'.repeat(32),
    });
  // Archive availability/history are HTTP fixtures; restoration uses the actual native exact-row guard.
  await page.route('**' + ArchiveRoutes.history.path + '?*', (route) =>
    route.fulfill({ json: { dao, anchors: [anchor], next: null } }),
  );
  await page.route('**' + ArchiveRoutes.recover.path, (route) => route.fulfill({ json: bundle }));
  await page.route('**' + ArchiveRoutes.preview.path, async (route) => {
    const selection = ArchiveRoutes.preview.input.parse(
      JSON.parse(route.request().postData() ?? 'null'),
    );
    if (!('documentRows' in selection)) throw new Error('Expected document selection');
    expect(selection.documentRows).toEqual([original.id]);
    await route.fulfill({
      json: {
        ...plan,
        families: [],
        blocked: [{ parentId: original.id, reason: 'referenced-version' }],
      },
    });
  });
  await link.click();
  await page.getByLabel('Archive content', { exact: true }).selectOption('document-versions');
  await page.getByLabel('Document version', { exact: true }).selectOption(original.id);
  await page.getByRole('button', { name: 'Preview archive eligibility', exact: true }).click();
  await expect(
    page.getByText(
      'An agreement, grant, election, admission or another protected record requires this version.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Create archive export', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Browse verified document versions', exact: true })
    .click();
  const restore = page.getByRole('button', { name: 'Sign and restore this version', exact: true });
  await restore.click();
  await expect(page.getByRole('button', { name: 'Restored on chain', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'Back to DAO documents', exact: true }).click();
  await page.getByText('Version history & integrity', { exact: true }).click();
  await page.getByRole('button', { name: 'Decrypt document 901 version 1', exact: true }).click();
  await expect(page.getByText('{\"version\":1}', { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('shows the original storage grace deadline and separates mail delivery from in-app notices', async ({
  page,
}) => {
  await createWorkspace(page);
  const link = page.getByRole('link', { name: 'Manage resources →', exact: true }),
    href = await link.getAttribute('href');
  if (!href) throw new Error('Resource link missing');
  const dao = DaoRefSchema.parse(
      JSON.parse(new URL(href, 'http://fixture').searchParams.get('dao') ?? 'null'),
    ),
    paidThrough = new Date(Date.now() - 86400000).toISOString(),
    graceEndsAt = new Date(Date.now() + 29 * 86400000).toISOString();
  await page.route('**/v1/storage/billing?*', (route) =>
    route.fulfill({
      json: {
        dao,
        configured: true,
        currentPricing: DEFAULT_STORAGE_PRICING,
        funding: {
          state: 'grace',
          pricing: DEFAULT_STORAGE_PRICING,
          units: 1,
          paidThrough,
          graceEndsAt,
          uploadCapacityBytes: '100000000',
          retainedCapacityBytes: '1100000000',
        },
        notices: [{ stage: 'grace-started', paidThrough, graceEndsAt }],
        noticeDelivery: false,
        subscription: null,
      },
    }),
  );
  await link.click();
  await expect(
    page.getByText('Storage is in its payment grace period.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('Original grace deadline:', { exact: false })).toBeVisible();
  await expect(
    page.getByText(
      'Email reminders are disabled on this operator; check Resources for payment and retention notices.',
      { exact: true },
    ),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
