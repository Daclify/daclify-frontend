import { expect, test, type Page } from '@playwright/test';

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

test('browses modules and names from their sidebar pages', async ({ page }) => {
  await page.goto('/modules');
  await expect(page.getByRole('heading', { name: 'Modules', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Decide', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Works', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Payroll', exact: true })).toBeVisible();
  await page.getByLabel('Find a module', { exact: true }).fill('payroll');
  await expect(page.getByRole('button', { name: 'Decide', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Payroll', exact: true })).toBeVisible();
  await page.getByLabel('Find a module', { exact: true }).fill('stake vote');
  await expect(page.getByRole('button', { name: 'Payroll', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Decide', exact: true })).toBeVisible();
  await page.getByLabel('Find a module', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Decide', exact: true }).click();
  const main = page.locator('#main');
  await expect(page.getByRole('heading', { name: 'Decide', exact: true })).toBeVisible();
  await expect(main.getByText('Ballots and proposals for a DAO.', { exact: true })).toBeVisible();
  await page.getByText('Contract details', { exact: true }).click();
  await expect(main.getByText('Code hash', { exact: true })).toBeVisible();
  for (const name of ['Member vote', 'Credit vote', 'Stake vote', 'Advisory poll'])
    await expect(page.getByRole('button', { name: new RegExp(`^${name}\\b`) })).toBeVisible();
  await page.getByRole('button', { name: 'Back to modules', exact: true }).click();
  await page.getByRole('button', { name: 'Decide', exact: true }).click();
  await page.getByRole('button', { name: /^Member vote\b/ }).click();
  await expect(page.getByRole('heading', { name: 'Member vote', exact: true })).toBeVisible();
  await page.getByText('Contract details', { exact: true }).click();
  await expect(main.getByText('Code hash', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to modules', exact: true }).click();
  await page.getByRole('button', { name: 'Works', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Milestone work\b/ })).toBeVisible();
  await page.getByRole('button', { name: 'Back to modules', exact: true }).click();
  await page.getByRole('button', { name: 'Payroll', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Salary\b/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^One-time payment\b/ })).toBeVisible();
  await page.getByRole('button', { name: 'Back to modules', exact: true }).click();
  await page.getByText('Usage fees & what’s included', { exact: true }).click();
  await expect(
    page.getByText('Third-party usage charges pay the platform 5%.', { exact: false }),
  ).toBeVisible();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation').getByRole('link', { name: 'Names', exact: true }).click();
  await expect(page).toHaveURL(/\/names$/);
  await expect(page.getByRole('heading', { name: 'Basic name', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Premium name', exact: true })).toBeVisible();
  await expect(page.getByText('$5.00', { exact: true })).toBeVisible();
  await expect(page.getByText('30 KiB of RAM', { exact: false })).toBeVisible();
  await page.getByLabel('Telos account name', { exact: true }).fill('BAD');
  await expect(page.getByText('A Telos name uses a to z, 1 to 5, and dots.')).toBeVisible();
  await page.getByLabel('Telos account name', { exact: true }).fill('basicname111');
  const quoteCard = page.locator('.quote-card');
  await expect(quoteCard.getByText('Basic', { exact: true })).toBeVisible();
  await expect(quoteCard.getByText('platform fee 100%', { exact: false })).toBeVisible();
  await page.getByLabel('Telos account name', { exact: true }).fill('alice');
  await expect(page.getByText('That Telos account already exists.', { exact: true })).toBeVisible();
  await page.getByLabel('Telos account name', { exact: true }).fill('zz.dao');
  await expect(
    page.getByText('Connect the suffix account before this name can be sold.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Card payments are not configured on this service.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('regsuffix', { exact: false })).toBeVisible();
  await noOverflow(page);
});
