import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { DaoRefSchema, SpendingReportSchema } from '@daclify/core-protocol';
test('exports a real native agreement payment without a session and without duplicate expense or narrative data', async ({
  page,
}, testInfo) => {
  const evidence = z
    .object({ fixture: z.literal('daclify-research-native'), reference: DaoRefSchema })
    .parse(
      JSON.parse(
        await readFile(
          '../daclify-backend-core/.artifacts/native/agreements-evidence.json',
          'utf8',
        ),
      ),
    );
  await page.goto(`/dao/${evidence.reference.daoId}/treasury`);
  await expect(page.getByRole('heading', { name: 'Spending and outcomes' })).toBeVisible();
  await expect(page.getByText('1 of 2 obligations. Exports include the full report.')).toHaveCount(
    0,
  );
  await expect(
    page.getByText('2 of 2 obligations. Exports include the full report.'),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Payment state', exact: true }).selectOption('settled');
  await expect(
    page.getByText('1 of 2 obligations. Exports include the full report.'),
  ).toBeVisible();
  const jsonEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export full JSON' }).click();
  const jsonDownload = await jsonEvent,
    jsonPath = testInfo.outputPath('spending.json');
  await jsonDownload.saveAs(jsonPath);
  const raw = await readFile(jsonPath, 'utf8'),
    report = SpendingReportSchema.parse(JSON.parse(raw));
  expect(report.complete).toBe(true);
  expect(report.summary).toMatchObject({
    settledObligations: '10000',
    externalCashflow: '10000',
    claims: '0',
    reserved: '0',
  });
  expect(raw).not.toContain('Research delivery and report');
  expect(report.obligations).toHaveLength(2);
  const csvEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export full CSV' }).click();
  const csvDownload = await csvEvent,
    csvPath = testInfo.outputPath('spending.csv');
  await csvDownload.saveAs(csvPath);
  const csv = await readFile(csvPath, 'utf8');
  expect(csv).toContain('claim-withdrawal');
  expect(csv).toContain('internal-claim-credit');
  expect(csv).not.toContain('Research delivery and report');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
