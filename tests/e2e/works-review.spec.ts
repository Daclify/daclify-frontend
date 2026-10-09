import { payCreation } from './creation-payment';
import { test, expect, devices, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);
const core = fileURLToPath(new URL('../../../daclify-backend-core/', import.meta.url));
const password = 'contributor review fixture password';
async function menu(page: Page) {
  const button = page.getByRole('button', { name: 'Menu', exact: true });
  if ((await button.isVisible()) && (await button.getAttribute('aria-expanded')) === 'false')
    await button.click();
}
async function account(page: Page) {
  await page.goto('/account');
  await page.getByLabel('Vault password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create encrypted vault' }).click();
  await page.getByLabel('I have saved my recovery kit and credential').check();
  await page.getByRole('button', { name: 'Finish account setup' }).click();
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
}
async function document(page: Page, id: string, value: string) {
  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  await page.getByLabel('Document ID', { exact: true }).fill(id);
  await page.getByLabel('JSON content').fill(JSON.stringify({ text: value }));
  await page.getByRole('button', { name: 'Publish JSON', exact: true }).click();
  await expect(page.getByText(value, { exact: false })).toBeVisible();
}
test('hands work between two internal accounts, requests a revision, approves and settles after removal', async ({
  page,
  browser,
}) => {
  test.setTimeout(45000);
  await account(page);
  await menu(page);
  await page.getByRole('link', { name: 'Create', exact: true }).click();
  const title = `Review fixture ${Date.now()}`;
  await page.getByLabel('DAO name').fill(title);
  await payCreation(page, 'custom');
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  const daoId = /\/dao\/([0-9]+)/.exec(page.url())?.[1];
  if (!daoId) throw new Error('Fixture DAO unavailable');
  await execute(process.execPath, ['--import', 'tsx', 'tools/native/fund.ts', daoId], {
    cwd: core,
  });
  const context = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    ...(test.info().project.name === 'mobile-chromium'
      ? devices['Pixel 7']
      : devices['Desktop Chrome']),
  });
  try {
    const contributor = await context.newPage();
    await account(contributor);
    await contributor.getByText('Public join identity', { exact: true }).click();
    const identity = await contributor.getByLabel('Public join identity JSON').inputValue();
    const kitText = await contributor.evaluate(() => localStorage.getItem('daclify.vault.v1'));
    if (!kitText) throw new Error('Public fixture keys unavailable');
    await page.getByRole('link', { name: 'Members', exact: true }).click();
    await page.getByLabel('Applicant public join identity (JSON)').fill(kitText);
    await page
      .getByLabel('I confirmed these public keys, participant identity and application terms')
      .check();
    await page.getByRole('button', { name: 'Sign participant admission', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByLabel('Applicant public join identity (JSON)').fill(identity);
    await page.getByRole('button', { name: 'Sign participant admission', exact: true }).click();
    await expect(page.getByText(/^Membership admitted\./)).toBeVisible();
    await contributor.getByRole('button', { name: 'Lock vault', exact: true }).click();
    await contributor.getByLabel('Vault password', { exact: true }).fill(password);
    await contributor.getByRole('button', { name: 'Unlock and sign in' }).click();
    await expect(contributor.getByText('Vault unlocked', { exact: true })).toBeVisible();
    await menu(contributor);
    await contributor.getByRole('link', { name: 'Hub', exact: true }).click();
    await contributor
      .getByRole('link')
      .filter({ has: contributor.getByRole('heading', { name: title, exact: true }) })
      .click();
    await expect(contributor.getByText('Member', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Members', exact: true }).click();
    await page.getByLabel('Member', { exact: true }).selectOption('1');
    await expect(page.getByLabel('Administrator', { exact: true })).toBeChecked();
    await page.getByLabel('Reviewer', { exact: true }).check();
    await page.getByRole('button', { name: 'Save roles', exact: true }).click();
    await expect(page.getByText('Reviewer', { exact: true }).first()).toBeVisible();
    await document(page, '1', 'Synthetic work proposal');
    await page.getByRole('link', { name: 'Modules', exact: true }).click();
    await page.getByRole('button', { name: 'Enable Works', exact: true }).click();
    await expect(page.getByText('Works enabled', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Works', exact: true }).click();
    await page.getByLabel('Contributor member ID').fill('2');
    await page.getByLabel('Proposal document ID', { exact: true }).fill('1');
    await page.getByRole('button', { name: 'Propose work', exact: true }).click();
    await page.getByRole('button', { name: 'Accept and reserve funds', exact: true }).click();
    await expect(page.getByText('Milestone funds reserved', { exact: true })).toBeVisible();
    await document(contributor, '2', 'Synthetic first delivery');
    await contributor.getByRole('link', { name: 'Works', exact: true }).click();
    await contributor.getByRole('button', { name: /^Submit evidence for milestone / }).click();
    await contributor.getByLabel('Submission document ID').fill('2');
    await contributor
      .getByRole('button', { name: 'Submit milestone evidence', exact: true })
      .click();
    await expect(
      contributor.getByText('Milestone submitted for review', { exact: true }),
    ).toBeVisible();
    await expect(
      contributor.getByRole('button', { name: 'Approve milestone', exact: true }),
    ).not.toBeVisible();
    await document(page, '3', 'Synthetic independent review');
    await page.getByRole('link', { name: 'Works', exact: true }).click();
    await page.getByRole('button', { name: /^Review milestone / }).click();
    await page.getByLabel('Review document ID').fill('3');
    await page.getByRole('button', { name: 'Request changes', exact: true }).click();
    await expect(page.getByText('Changes requested', { exact: true })).toBeVisible();
    await document(contributor, '2', 'Synthetic revised delivery');
    await contributor.getByRole('link', { name: 'Works', exact: true }).click();
    await contributor.getByRole('button', { name: /^Submit evidence for milestone / }).click();
    await contributor.getByLabel('Submission document ID').fill('2');
    await contributor.getByLabel('Submission document version').fill('2');
    await contributor
      .getByRole('button', { name: 'Submit milestone evidence', exact: true })
      .click();
    await expect(
      contributor.getByText('Milestone submitted for review', { exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Documents', exact: true }).click();
    await page.getByRole('link', { name: 'Works', exact: true }).click();
    await page.getByRole('button', { name: /^Review milestone / }).click();
    await page.getByLabel('Review document ID').fill('3');
    await page.getByRole('button', { name: 'Approve milestone', exact: true }).click();
    await expect(
      page.getByText('Milestone approved. Payment remains to be settled.', { exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Modules', exact: true }).click();
    await page.getByRole('button', { name: 'Disable Works', exact: true }).click();
    await expect(
      page.getByText('Works disabled. Approved obligations remain payable.', { exact: true }),
    ).toBeVisible();
    await contributor.getByRole('link', { name: 'Documents', exact: true }).click();
    await contributor.getByRole('link', { name: 'Works', exact: true }).click();
    await contributor.getByRole('button', { name: /^Settle milestone / }).click();
    await expect(contributor.getByText('Payment settled.', { exact: true })).toBeVisible();
    await contributor.getByRole('link', { name: 'Treasury', exact: true }).click();
    await expect(contributor.getByText('Claim: 1.0000 TLOS', { exact: false })).toBeVisible();
  } finally {
    await context.close();
  }
});
