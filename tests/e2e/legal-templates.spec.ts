import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { legalFixture } from '../helpers/legal-templates';
import { createVault } from '../../src/auth/vault';

test('fills a template, preserves manual edits and exports an unpublished Markdown draft', async ({ page }) => {
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
  await dialog.getByLabel('Document text', { exact: true }).fill('# Reviewed conduct\n\nOnly explicit approvals publish this.');
  await dialog.getByRole('button', { name: 'Back to details', exact: true }).click();
  await dialog.getByLabel('DAO name', { exact: true }).fill('Changed fields');
  await dialog.getByRole('button', { name: 'Review document', exact: true }).click();
  await expect(dialog.getByText('Your edited wording is preserved.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(dialog.getByLabel('Document text', { exact: true })).toHaveValue('# Reviewed conduct\n\nOnly explicit approvals publish this.');
  const downloadEvent = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download draft', exact: true }).click();
  const download = await downloadEvent, path = await download.path();
  if (!path) throw new Error('FIXTURE_DOWNLOAD');
  expect((await readFile(path)).toString()).toContain('Only explicit approvals publish this.');
  expect((await readFile(path)).toString()).not.toContain('Source SHA-256');
  expect(fixture.writes).toEqual([]);
  expect((await new AxeBuilder({ page }).include('dialog[open]').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('imports inert Markdown, rejects malformed and oversized edits, and keeps drafts out of browser storage', async ({ page }) => {
  await legalFixture(page);
  await page.goto('/dao/1/documents');
  await page.getByRole('button', { name: 'Create from template', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create from template', exact: true });
  await dialog.getByRole('checkbox', { name: /Conflict of Interest Policy/ }).check();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByRole('button', { name: 'Review document', exact: true }).click();
  await dialog.getByLabel('Import edited Markdown').setInputFiles({ name: 'draft.md', mimeType: 'text/markdown', buffer: Buffer.from([0xc3, 0x28]) });
  await expect(dialog.getByRole('alert')).toContainText('UTF-8');
  await dialog.getByLabel('Import edited Markdown').setInputFiles({ name: 'draft.md', mimeType: 'text/markdown', buffer: Buffer.alloc(131073, 65) });
  await expect(dialog.getByRole('alert')).toContainText('128 KiB');
  const body = '# Unique legal wording\n\n<script>alert(1)</script>\n\n![tracker](https://example.test/pixel)';
  await dialog.getByLabel('Import edited Markdown').setInputFiles({ name: 'draft.md', mimeType: 'text/markdown', buffer: Buffer.from(body) });
  await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Unique legal wording' })).toBeVisible();
  await expect(dialog.locator('.legal-preview script, .legal-preview img')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('Unique legal wording');
  expect(page.url()).not.toContain('Unique');
});

for (const recovery of ['off', 'allowed', 'opted-in', 'unsupported', 'failed', 'foreign'] as const) {
  test(`shows truthful document recovery access: ${recovery}`, async ({ page }) => {
    const fixture = await legalFixture(page, { encrypted: true, recovery });
    await page.goto('/dao/1/documents');
    await page.getByRole('button', { name: 'Create from template', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create from template', exact: true });
    const expected = recovery === 'off' ? 'This DAO currently forbids contact document recovery.' : recovery === 'allowed' ? 'This DAO permits contact document recovery. This membership has not opted in.' : recovery === 'opted-in' ? 'Any two of your three contacts can decrypt backed-up document keys without you.' : recovery === 'unsupported' ? 'Contact document recovery is unsupported on this deployment.' : 'Contact document recovery status is unknown.';
    await expect(dialog.getByText(expected, { exact: true })).toBeVisible();
    expect(fixture.writes).toEqual([]);
  });
}

test('clears local reviews when recovery replaces keys without changing the account ID', async ({ page }) => {
  await legalFixture(page);
  await page.goto('/dao/1/documents');
  await page.getByRole('button', { name: 'Create from template', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create from template', exact: true });
  await dialog.getByRole('checkbox', { name: /Conflict of Interest Policy/ }).check();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByRole('button', { name: 'Review document', exact: true }).click();
  const replacement = await createVault('disposable replacement fixture');
  await page.evaluate(async ({ signingKey, encryptionKey }) => {
    const path = '/src/state/workspace.ts';
    const stateModule: typeof import('../../src/state/workspace') = await import(path);
    const state = stateModule.useWorkspace();
    if (!state.account) throw new Error('FIXTURE_ACCOUNT');
    state.account = { ...state.account, signingKey, encryptionKey };
  }, { signingKey: replacement.signingPublicKey, encryptionKey: replacement.encryptionPublicKey });
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Create from template', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Choose your documents' })).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /Conflict of Interest Policy/ })).not.toBeChecked();
});
