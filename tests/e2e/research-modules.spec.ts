import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { DaoRefSchema } from '@daclify/core-protocol';
const Evidence = z.object({
  fixture: z.literal('daclify-research-native'),
  reference: DaoRefSchema,
});
test('shows an actual native award as a Works lifecycle without offering a visitor signing powers', async ({
  page,
}, info) => {
  const evidence = Evidence.parse(
    JSON.parse(
      await readFile('../daclify-backend-core/.artifacts/native/grants-evidence.json', 'utf8'),
    ),
  );
  await page.goto(`/dao/${evidence.reference.daoId}/grants-rounds`);
  await expect(page.getByRole('heading', { name: 'Grants rounds', exact: true })).toBeVisible();
  await expect(page.getByText(/cumulative awards 1.0000 TLOS/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Continue Works project/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign consent and submit' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Propose award vote' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('grants.png'), fullPage: true });
});
test('shows the native election candidates and actual recall without allowing visitor nominations or recall', async ({
  page,
}, info) => {
  const evidence = Evidence.parse(
    JSON.parse(
      await readFile('../daclify-backend-core/.artifacts/native/elections-evidence.json', 'utf8'),
    ),
  );
  await page.goto(`/dao/${evidence.reference.daoId}/decide`);
  await expect(
    page.getByRole('heading', { name: 'Representative elections', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Recalled/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign self-nomination' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign term recall' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('elections.png'), fullPage: true });
});

test('shows the enforced admission policy and completed native admission without offering visitor sponsorship', async ({
  page,
}) => {
  const evidence = Evidence.parse(
    JSON.parse(
      await readFile('../daclify-backend-core/.artifacts/native/admission-evidence.json', 'utf8'),
    ),
  );
  await page.goto(`/dao/${evidence.reference.daoId}/members`);
  await expect(
    page.getByRole('heading', { name: 'Member endorsement admission', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Admitted member 4/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign sponsored application' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign admission request' })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
