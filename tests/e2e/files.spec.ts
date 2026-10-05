import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { HostedUploadSchema } from '@daclify/core-protocol';
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
  await page.getByRole('button', { name: 'Create shared DAO' }).click();
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
  await openMenu(page);
  await page.getByRole('link', { name: 'DAO hub', exact: true }).click();
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
