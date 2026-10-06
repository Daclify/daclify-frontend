import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
const execute = promisify(execFile);
test('reserves and cancels work, then settles disabled payroll and withdraws the backed claim', async ({
  page,
}) => {
  test.setTimeout(95000);
  await page.goto('/account');
  await page.getByLabel('Vault password', { exact: true }).fill('module payment fixture password');
  await page.getByRole('button', { name: 'Create encrypted vault' }).click();
  await page.getByLabel('I have saved my recovery kit and credential').check();
  await page.getByRole('button', { name: 'Finish account setup' }).click();
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name: 'Create DAO', exact: true }).click();
  await page.getByLabel('DAO name').fill(`Payment fixture ${Date.now()}`);
  await page.getByRole('button', { name: 'Create shared DAO' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  const id = /\/dao\/([0-9]+)/.exec(page.url())?.[1];
  if (!id) throw new Error('Fixture DAO unavailable');
  await execute(process.execPath, ['--import', 'tsx', 'tools/native/fund.ts', id], {
    cwd: fileURLToPath(new URL('../../../daclify-backend-core/', import.meta.url)),
  });
  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  await page.getByLabel('Document ID', { exact: true }).fill('1');
  await page.getByLabel('JSON content').fill('{"text":"Synthetic proposal and delivery evidence"}');
  await page.getByRole('button', { name: 'Publish JSON', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Document 1', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Modules', exact: true }).click();
  await page.getByRole('button', { name: 'Enable Decide', exact: true }).click();
  await expect(page.getByText('Decide enabled', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Decide', exact: true }).click();
  await page.getByLabel('Public ballot title').fill('Settlement journey decision');
  await page.getByLabel('Duration (seconds)').fill('60');
  await page.getByRole('button', { name: 'Open ballot', exact: true }).click();
  await page.getByRole('button', { name: 'Vote Approve', exact: true }).click();
  await expect(page.getByText('Your vote: Approve', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Modules', exact: true }).click();
  await page.getByRole('button', { name: 'Enable Works', exact: true }).click();
  await expect(page.getByText('Works enabled', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Works', exact: true }).click();
  await page.getByRole('button', { name: 'Propose work', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Project / })).toBeVisible();
  await page.getByRole('button', { name: 'Accept and reserve funds', exact: true }).click();
  await expect(page.getByText('Milestone funds reserved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Cancel project / }).click();
  await expect(
    page.getByText('Project cancelled. Approved payments remain payable.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Modules', exact: true }).click();
  await page.getByRole('button', { name: 'Enable Payroll', exact: true }).click();
  await expect(page.getByText('Payroll enabled', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Payroll', exact: true }).click();
  await page.getByLabel('Amount per installment (TLOS)').fill('0.5000');
  await page.getByLabel('Installments', { exact: true }).fill('1');
  await page
    .getByLabel('First installment due (UTC)')
    .fill(new Date(Date.now() + 12000).toISOString().slice(0, 19));
  await page.getByRole('button', { name: 'Commit funded payroll', exact: true }).click();
  await expect(page.getByText('Funded payroll committed', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Modules', exact: true }).click();
  await page.getByRole('button', { name: 'Disable Payroll', exact: true }).click();
  await expect(
    page.getByText('Payroll disabled. Approved obligations remain payable.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Payroll', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Schedule / })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Commit funded payroll', exact: true }),
  ).not.toBeVisible();
  const settle = page.getByRole('button', { name: 'Pay outstanding', exact: true });
  await expect(settle).toBeVisible({ timeout: 16000 });
  await settle.click();
  await expect(page.getByText('Payment settled.', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Ongoing schedules', exact: true }).uncheck();
  await expect(page.getByText(/Installment .*Settled/)).toBeVisible();
  await page.getByRole('link', { name: 'Treasury', exact: true }).click();
  await expect(page.getByText('Claim: 0.5000 TLOS', { exact: false })).toBeVisible();
  await page.getByLabel('Native payout account').fill('bob');
  await page.getByLabel('Withdrawal amount (TLOS)').fill('0.5000');
  await page.getByRole('button', { name: 'Sign withdrawal', exact: true }).click();
  await expect(page.getByText('Claim withdrawn.', { exact: true })).toBeVisible();
  await expect(page.getByText('Claim: 0.0000 TLOS', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Modules', exact: true }).click();
  await page.getByRole('button', { name: 'Disable Decide', exact: true }).click();
  await expect(
    page.getByText('Decide disabled. Approved obligations remain payable.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Decide', exact: true }).click();
  const finalize = page.getByRole('button', { name: /^Finalize ballot / });
  await expect(finalize).toBeVisible({ timeout: 59000 });
  await finalize.click();
  await expect(page.getByText('Ballot finalized.', { exact: true })).toBeVisible();
  await expect(page.getByText('Passed', { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (test.info().project.name === 'chromium') {
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: '.artifacts/treasury-workspace.png', fullPage: true });
  }
});
