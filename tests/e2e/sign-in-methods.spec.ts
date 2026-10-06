import { expect, test, type Page } from '@playwright/test';

async function authenticator(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

test('pairs a passkey and email with an existing vault', async ({ page }) => {
  await authenticator(page);
  await page.goto('http://localhost:5178/account');
  await page.getByLabel('Vault password', { exact: true }).fill('local-test-password-2026');
  await page.getByRole('button', { name: 'Create encrypted vault' }).click();
  await page.getByLabel('I have saved my recovery kit and credential').check();
  await page.getByRole('button', { name: 'Finish account setup' }).click();
  await expect(page.getByText('Vault unlocked', { exact: true })).toBeVisible();
  const serverId = (await page.locator('p.mono').first().innerText()).trim();
  await page.getByRole('tab', { name: 'Sign-in', exact: true }).click();
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByText('Passkey added.', { exact: true })).toBeVisible();
  const mailbox = `pair.${Date.now()}@example.test`;
  await page.getByLabel('Sign-in email').fill(mailbox);
  await page.getByRole('button', { name: 'Send code' }).click();
  const revealed = await page.getByText(/The code for this browser is \d{8}\./).innerText();
  const code = /\d{8}/.exec(revealed)?.[0] ?? '';
  await page.getByLabel('Email code').fill(code);
  await page.getByRole('button', { name: 'Confirm email' }).click();
  await expect(page.getByText('Email paired.', { exact: true })).toBeVisible();
  await expect(page.getByText(mailbox, { exact: true })).toBeVisible();
  await expect(
    page
      .getByText('Telegram is not configured on this server.')
      .or(page.locator('.telegram-host script, .telegram-host iframe')),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Keys', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page.getByText(serverId, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Vault password', { exact: true })).toBeVisible();
  await expect(page.getByText('Vault unlocked', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
