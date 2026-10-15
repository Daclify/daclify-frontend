import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { legalFixture, unlockLegalFixture } from '../helpers/legal-templates';
import { createVault, sha256Hex } from '../../src/auth/vault';

test('fills a template, preserves manual edits and exports an unpublished Markdown draft', async ({
  page,
}) => {
  const fixture = await legalFixture(page);
  await page.goto('/dao/1/documents');
  await page.getByRole('button', { name: 'Create from template', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create from template', exact: true });
  await expect(dialog.getByRole('checkbox')).toHaveCount(12);
  await dialog.getByRole('checkbox', { name: /DAO Code of Conduct/ }).check();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog.getByLabel('DAO name', { exact: true })).toHaveValue('Legal template DAO');
  await dialog.getByLabel('Proposed effective date', { exact: true }).fill('2026-12-01');
  await dialog.getByLabel('Conduct reporting contact or committee').fill('Community review team');
  await dialog.getByRole('button', { name: 'Review document', exact: true }).click();
  await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
  await dialog
    .getByLabel('Document text', { exact: true })
    .fill('# Reviewed conduct\n\nOnly explicit approvals publish this.');
  await dialog.getByRole('button', { name: 'Back to details', exact: true }).click();
  await dialog.getByLabel('DAO name', { exact: true }).fill('Changed fields');
  await dialog.getByRole('button', { name: 'Review document', exact: true }).click();
  await expect(dialog.getByText('Your edited wording is preserved.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(dialog.getByLabel('Document text', { exact: true })).toHaveValue(
    '# Reviewed conduct\n\nOnly explicit approvals publish this.',
  );
  const downloadEvent = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download draft', exact: true }).click();
  const download = await downloadEvent,
    path = await download.path();
  if (!path) throw new Error('FIXTURE_DOWNLOAD');
  expect((await readFile(path)).toString()).toContain('Only explicit approvals publish this.');
  expect((await readFile(path)).toString()).not.toContain('Source SHA-256');
  expect(fixture.writes).toEqual([]);
  expect((await new AxeBuilder({ page }).include('dialog[open]').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('imports inert Markdown, rejects malformed and oversized edits, and keeps drafts out of browser storage', async ({
  page,
}) => {
  await legalFixture(page);
  await page.goto('/dao/1/documents');
  await page.getByRole('button', { name: 'Create from template', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create from template', exact: true });
  await dialog.getByRole('checkbox', { name: /Conflict of Interest Policy/ }).check();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByRole('button', { name: 'Review document', exact: true }).click();
  await dialog.getByLabel('Import edited Markdown').setInputFiles({
    name: 'draft.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from([0xc3, 0x28]),
  });
  await expect(dialog.getByRole('alert')).toContainText('UTF-8');
  await dialog.getByLabel('Import edited Markdown').setInputFiles({
    name: 'draft.md',
    mimeType: 'text/markdown',
    buffer: Buffer.alloc(131073, 65),
  });
  await expect(dialog.getByRole('alert')).toContainText('128 KiB');
  const body =
    '# Unique legal wording\n\n<script>alert(1)</script>\n\n![tracker](https://example.test/pixel)';
  await dialog
    .getByLabel('Import edited Markdown')
    .setInputFiles({ name: 'draft.md', mimeType: 'text/markdown', buffer: Buffer.from(body) });
  await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Unique legal wording' })).toBeVisible();
  await expect(dialog.locator('.legal-preview script, .legal-preview img')).toHaveCount(0);
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
  ).not.toContain('Unique legal wording');
  expect(page.url()).not.toContain('Unique');
});

for (const recovery of [
  'off',
  'allowed',
  'opted-in',
  'unsupported',
  'failed',
  'foreign',
] as const) {
  test(`shows truthful document recovery access: ${recovery}`, async ({ page }) => {
    const fixture = await legalFixture(page, { encrypted: true, recovery });
    await page.goto('/dao/1/documents');
    await page.getByRole('button', { name: 'Create from template', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create from template', exact: true });
    const expected =
      recovery === 'off'
        ? 'This DAO currently forbids contact document recovery.'
        : recovery === 'allowed'
          ? 'This DAO permits contact document recovery. This membership has not opted in.'
          : recovery === 'opted-in'
            ? 'Any two of your three contacts can decrypt backed-up document keys without you.'
            : recovery === 'unsupported'
              ? 'Contact document recovery is unsupported on this deployment.'
              : 'Contact document recovery status is unknown.';
    await expect(dialog.getByText(expected, { exact: true })).toBeVisible();
    expect(fixture.writes).toEqual([]);
  });
}

test('clears local reviews when recovery replaces keys without changing the account ID', async ({
  page,
}) => {
  await legalFixture(page);
  await page.goto('/dao/1/documents');
  await page.getByRole('button', { name: 'Create from template', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create from template', exact: true });
  await dialog.getByRole('checkbox', { name: /Conflict of Interest Policy/ }).check();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByRole('button', { name: 'Review document', exact: true }).click();
  const replacement = await createVault('disposable replacement fixture');
  await page.evaluate(
    async ({ signingKey, encryptionKey }) => {
      const path = '/src/state/workspace.ts';
      const stateModule: typeof import('../../src/state/workspace') = await import(path);
      const state = stateModule.useWorkspace();
      if (!state.account) throw new Error('FIXTURE_ACCOUNT');
      state.account = { ...state.account, signingKey, encryptionKey };
    },
    { signingKey: replacement.signingPublicKey, encryptionKey: replacement.encryptionPublicKey },
  );
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Create from template', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Choose your documents' })).toBeVisible();
  await expect(
    dialog.getByRole('checkbox', { name: /Conflict of Interest Policy/ }),
  ).not.toBeChecked();
});

for (const encrypted of [false, true]) {
  test(`publishes exact generated Markdown once and protects private bytes: ${encrypted}`, async ({
    page,
  }) => {
    const fixture = await legalFixture(page, { encrypted });
    await page.goto('/dao/1/documents');
    await unlockLegalFixture(page, fixture.password);
    await page.getByRole('button', { name: 'Create from template', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create from template', exact: true });
    await dialog.getByRole('checkbox', { name: /DAO Code of Conduct/ }).check();
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await dialog.getByRole('button', { name: 'Review document', exact: true }).click();
    const body = '# Unique private contract text\n\nReviewed agreement.';
    await dialog
      .getByLabel('Import edited Markdown')
      .setInputFiles({ name: 'draft.md', mimeType: 'text/markdown', buffer: Buffer.from(body) });
    await dialog.getByLabel('I reviewed this document for publication').check();
    if (!encrypted) await dialog.getByLabel('I understand this document will be public').check();
    await dialog.getByRole('button', { name: 'Continue to publish', exact: true }).click();
    fixture.faults.upload = true;
    await dialog.getByRole('button', { name: 'Publish draft', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Retry this upload', exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Return to review', exact: true }),
    ).toBeDisabled();
    fixture.faults.upload = false;
    fixture.faults.lostPublication = true;
    await dialog.getByRole('button', { name: 'Retry this upload', exact: true }).click();
    await expect.poll(() => fixture.actions).toEqual(['putdoc']);
    await dialog.getByRole('button', { name: 'Publish verified record', exact: true }).click();
    await expect(dialog.getByText('Published draft', { exact: true })).toBeVisible();
    expect(fixture.uploads).toHaveLength(2);
    expect(fixture.uploads[0]).toEqual(fixture.uploads[1]);
    expect(fixture.actions).toEqual(['putdoc']);
    const upload = fixture.uploads[0];
    if (!upload) throw new Error('FIXTURE_UPLOAD');
    const stored = Buffer.from(upload.content, 'base64').toString();
    if (encrypted) {
      expect(upload.metadata).toBe('{}');
      expect(stored).not.toContain('Unique private contract text');
      expect(stored).not.toContain('Source SHA-256');
    } else {
      expect(stored).toContain(body);
      expect(stored).toContain(`Document ${upload.documentId} / version 1`);
      expect(stored).toContain('Source SHA-256');
    }
  });
}

test('continues a published template into separate registration and proposal without automatic adoption', async ({
  page,
}) => {
  const fixture = await legalFixture(page);
  await page.goto('/dao/1/documents');
  await unlockLegalFixture(page, fixture.password);
  await page.getByRole('button', { name: 'Create from template', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create from template', exact: true });
  await dialog.getByRole('checkbox', { name: /DAO Code of Conduct/ }).check();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByRole('button', { name: 'Review document', exact: true }).click();
  await dialog.getByLabel('Import edited Markdown').setInputFiles({
    name: 'draft.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Reviewed community rules'),
  });
  await dialog.getByLabel('I reviewed this document for publication').check();
  await dialog.getByLabel('I understand this document will be public').check();
  await dialog.getByRole('button', { name: 'Continue to publish', exact: true }).click();
  await dialog.getByRole('button', { name: 'Publish draft', exact: true }).click();
  await expect(dialog.getByText('Published draft', { exact: true })).toBeVisible();
  expect(fixture.actions).toEqual(['putdoc']);
  await dialog
    .getByLabel(
      'I compared the wording with current DAO rules; authored differences require separate governance changes',
    )
    .check();
  await dialog.getByRole('button', { name: 'Continue document setup', exact: true }).click();
  const register = page.getByRole('dialog', { name: 'Register managed document', exact: true });
  await expect(register.getByLabel('Managed document', { exact: true })).toHaveValue(
    fixture.uploads[0]?.documentId ?? '',
  );
  fixture.faults.lostRegistration = true;
  await register.getByRole('button', { name: 'Register document', exact: true }).click();
  await expect(register).not.toBeVisible();
  fixture.faults.lostProposal = true;
  await page.getByRole('button', { name: 'Propose version', exact: true }).click();
  await expect(page.getByText('Awaiting administrator approval', { exact: true })).toBeVisible();
  expect(fixture.actions).toEqual(['putdoc', 'regdoc', 'proposedoc']);
  expect(fixture.register.changes[0]?.status).toBe(0);
});

test('opens optional setup from the overview and consumes its hint', async ({ page }) => {
  await legalFixture(page);
  await page.goto('/dao/1');
  await page.getByRole('link', { name: /Set up DAO documents/ }).click();
  await expect(
    page.getByRole('dialog', { name: 'Create from template', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/dao\/1\/documents$/);
});

test('preselects only the exact Works agreement and signs nothing during handoff', async ({
  page,
}) => {
  const fixture = await legalFixture(page);
  fixture.records.documents.push({
    id: '1',
    document_id: '42',
    version: 3,
    commitment: 'ab'.repeat(32),
    metadata: '{"title":"Contributor agreement"}',
    cid: '',
    bytes: 1,
    author: '1',
    envelope_version: 0,
    key_epoch: '0',
  });
  await page.goto('/dao/1/works?document=42&version=3&commitment=' + 'ab'.repeat(32));
  const dialog = page.getByRole('dialog', { name: 'Propose milestone work', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#work-document')).toHaveValue('1');
  await expect(page).toHaveURL(/\/dao\/1\/works$/);
  expect(fixture.actions).toEqual([]);
  await dialog.getByRole('button', { name: 'Close work proposal', exact: true }).click();
  await page.goto('/dao/1/works?document=42&version=4&commitment=' + 'ab'.repeat(32));
  await expect(
    page
      .getByText(
        'The exact agreement version is unavailable. Choose and review a document explicitly.',
      )
      .first(),
  ).toBeVisible();
  await expect(dialog).not.toBeVisible();
  expect(fixture.actions).toEqual([]);
});

test('discovers a later-page constitution and requires exact adopted-text review before amendment', async ({
  page,
}) => {
  const fixture = await legalFixture(page);
  const metadata = '{"title":"Existing constitution"}',
    commitment = await sha256Hex(new TextEncoder().encode(metadata));
  fixture.records.documents.push({
    id: '1',
    document_id: '42',
    version: 1,
    commitment,
    metadata,
    cid: '',
    bytes: metadata.length,
    author: '1',
    envelope_version: 0,
    key_epoch: '0',
  });
  fixture.register.registrations.push({
    id: '2',
    dao_id: '1',
    document_id: '42',
    category: 0,
    approval: 0,
    track_acceptance: true,
    revision: '1',
    adopted_id: '1',
    pending_id: '0',
  });
  fixture.register.changes.push({
    id: '1',
    dao_id: '1',
    register_id: '2',
    document_id: '42',
    document_version: 1,
    commitment,
    source_hash: fixture.register.module?.deployment.codeHash ?? 'ab'.repeat(32),
    expected_revision: '0',
    policy_revision: '0',
    ballot_id: '0',
    proposer: '1',
    proposed_at: 1,
    deadline: 1000,
    adopted_at: 2,
    adopted_by: '1',
    status: 1,
  });
  await page.route('**/v1/daos/1/governing-documents*', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).searchParams.has('after')
        ? fixture.register
        : { ...fixture.register, registrations: [], changes: [], next: '2' },
    }),
  );
  await page.goto('/dao/1/documents');
  await page.getByRole('button', { name: 'Create from template', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create from template', exact: true });
  await dialog.getByRole('checkbox', { name: /DAO Constitution and Charter/ }).check();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog.getByText(/Amending document 42 as version 2/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Review document', exact: true })).toBeDisabled();
  await dialog
    .getByRole('button', { name: 'Open verified supporting document', exact: true })
    .click();
  await dialog
    .getByRole('checkbox', { name: 'I reviewed this document version', exact: true })
    .check();
  await expect(dialog.getByRole('button', { name: 'Review document', exact: true })).toBeEnabled();
  expect(fixture.actions).toEqual([]);
});

test('keeps optional setup unavailable to a nonadministrator', async ({ page }) => {
  const fixture = await legalFixture(page, { admin: false });
  await page.goto('/dao/1');
  await expect(
    page.getByRole('heading', { name: 'Legal template DAO', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Set up DAO documents/ })).toHaveCount(0);
  await page.goto('/dao/1/documents?templates=1');
  await expect(page).toHaveURL(/\/dao\/1\/documents$/);
  await expect(
    page.getByRole('dialog', { name: 'Create from template', exact: true }),
  ).not.toBeVisible();
  expect(fixture.actions).toEqual([]);
});

test('requires renewed review when another version appears while editing', async ({ page }) => {
  const fixture = await legalFixture(page);
  const row = {
    id: '1',
    document_id: '42',
    version: 1,
    commitment: 'ab'.repeat(32),
    metadata: '{}',
    cid: '',
    bytes: 2,
    author: '1',
    envelope_version: 0,
    key_epoch: '0',
  };
  fixture.records.documents.push(row);
  await page.goto('/dao/1/documents');
  await page.getByRole('button', { name: 'Create from template', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create from template', exact: true });
  await dialog.getByLabel('Document to amend (optional)').selectOption('42');
  await dialog.getByRole('checkbox', { name: /DAO Code of Conduct/ }).check();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByRole('button', { name: 'Review document', exact: true }).click();
  await dialog.getByLabel('Import edited Markdown').setInputFiles({
    name: 'draft.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Reviewed revision'),
  });
  await dialog.getByLabel('I reviewed this document for publication').check();
  await dialog.getByLabel('I understand this document will be public').check();
  fixture.records.documents.push({ ...row, id: '2', version: 2 });
  await dialog.getByRole('button', { name: 'Continue to publish', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('changed');
  await expect(dialog.getByLabel('I reviewed this document for publication')).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Publish draft', exact: true })).toHaveCount(0);
  await expect(dialog.getByText(/Document 42 \/ version 3/)).toBeVisible();
  expect(fixture.uploads).toEqual([]);
  expect(fixture.actions).toEqual([]);
});

test('keeps an unpublished draft on this page across Escape and clears protected wording on vault lock', async ({
  page,
}) => {
  const fixture = await legalFixture(page, { encrypted: true });
  await page.goto('/dao/1/documents');
  await unlockLegalFixture(page, fixture.password);
  await page.getByRole('button', { name: 'Create from template', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create from template', exact: true });
  await dialog.getByRole('checkbox', { name: /DAO Code of Conduct/ }).check();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByRole('button', { name: 'Review document', exact: true }).click();
  await dialog.getByLabel('Import edited Markdown').setInputFiles({
    name: 'private.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Disposable protected wording'),
  });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Create from template', exact: true }).click();
  await expect(
    dialog.getByRole('heading', { name: 'Disposable protected wording', exact: true }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/auth/session.ts';
    const session: typeof import('../../src/auth/session') = await import(path);
    session.lockVault();
  });
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Create from template', exact: true }).click();
  await expect(
    dialog.getByRole('heading', { name: 'Choose your documents', exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText('Disposable protected wording', { exact: true })).toHaveCount(0);
  expect(fixture.actions).toEqual([]);
});

test('retains a verified upload when another file occupies its native version and allows a newly reviewed version', async ({
  page,
}) => {
  const fixture = await legalFixture(page);
  fixture.faults.versionConflict = true;
  await page.goto('/dao/1/documents');
  await unlockLegalFixture(page, fixture.password);
  await page.getByRole('button', { name: 'Create from template', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create from template', exact: true });
  await dialog.getByRole('checkbox', { name: /DAO Code of Conduct/ }).check();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByRole('button', { name: 'Review document', exact: true }).click();
  await dialog
    .getByLabel('Import edited Markdown')
    .setInputFiles({
      name: 'draft.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Reviewed contract'),
    });
  await dialog.getByLabel('I reviewed this document for publication').check();
  await dialog.getByLabel('I understand this document will be public').check();
  await dialog.getByRole('button', { name: 'Continue to publish', exact: true }).click();
  await dialog.getByRole('button', { name: 'Publish draft', exact: true }).click();
  const download = page.waitForEvent('download');
  await dialog
    .getByRole('button', { name: 'Save receipt and review a new version', exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe('retained-upload-receipt.json');
  await expect(dialog.getByLabel('I reviewed this document for publication')).not.toBeChecked();
  expect(fixture.receipts.size).toBe(1);
  expect(fixture.actions).toEqual([]);
  expect(fixture.records.documents[0]?.commitment).toBe('ff'.repeat(32));
});
