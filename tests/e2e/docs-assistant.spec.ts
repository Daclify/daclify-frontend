import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/v1/**', (route) =>
    route.fulfill({
      status: 503,
      json: { code: 'SERVICE_UNAVAILABLE', message: 'Unconnected UI fixture' },
    }),
  );
});

test('handbook assistant shows a source and renders model text safely', async ({ page }) => {
  await page.route('**/v1/docs/agent', (route) => route.fulfill({ json: { configured: true } }));
  let answered = false;
  await page.route('**/v1/docs/ask', (route) => {
    expect(route.request().postDataJSON()).toEqual({
      question: answered ? 'Unrelated question?' : 'Are documents encrypted?',
    });
    const json = answered
      ? {
          status: 'outside',
          topicId: null,
          title: null,
          answer: 'I cover only Daclify documentation.',
        }
      : {
          status: 'answered',
          topicId: 'privacy',
          title: 'What encryption protects',
          answer: '<img src=x onerror=alert(1)> Encrypted in the browser.',
        };
    answered = true;
    return route.fulfill({ json });
  });
  await page.goto('/docs');
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const assistant = page.getByRole('region', { name: 'Handbook assistant' });
  await expect(assistant.getByText(/Do not include secrets or private content/)).toBeVisible();
  await assistant.getByLabel('Question', { exact: true }).fill('Are documents encrypted?');
  await assistant.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(
    assistant.getByText('<img src=x onerror=alert(1)> Encrypted in the browser.', { exact: true }),
  ).toBeVisible();
  await expect(assistant.locator('img')).toHaveCount(0);
  await expect(
    assistant.getByRole('link', { name: 'Open What encryption protects' }),
  ).toHaveAttribute('href', '/docs/privacy');
  await assistant.getByLabel('Question', { exact: true }).fill('Unrelated question?');
  await assistant.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(
    assistant.getByText('I cover only Daclify documentation.', { exact: true }),
  ).toBeVisible();
  await expect(assistant.getByRole('link')).toHaveCount(1);
  await page.getByRole('button', { name: 'Minimize help' }).click();
  await expect(assistant).toBeHidden();
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(
    assistant.getByText('I cover only Daclify documentation.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(
    page.getByText('I cover only Daclify documentation.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear conversation', exact: true }).click();
  await expect(assistant.getByRole('link')).toHaveCount(0);
});

test('handbook assistant distinguishes missing config from a failed status request', async ({
  page,
}) => {
  let unavailable = false;
  await page.route('**/v1/docs/agent', (route) =>
    unavailable
      ? route.fulfill({
          status: 503,
          json: { code: 'SERVICE_UNAVAILABLE', message: 'Temporarily unavailable' },
        })
      : route.fulfill({ json: { configured: false } }),
  );
  await page.goto('/docs');
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const assistant = page.getByRole('region', { name: 'Handbook assistant' });
  await expect(
    assistant.getByText('The documentation assistant is not configured on this server.'),
  ).toBeVisible();
  await expect(assistant.getByLabel('Question', { exact: true })).toHaveCount(0);
  unavailable = true;
  await page.reload();
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(assistant.getByRole('alert')).toBeVisible();
  await expect(
    assistant.getByText('The documentation assistant is not configured on this server.'),
  ).toHaveCount(0);
  await expect(assistant.getByLabel('Question', { exact: true })).toHaveCount(0);
});
