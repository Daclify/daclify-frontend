import { expect, test } from '@playwright/test';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { RecoveryKitSchema } from '@daclify/core-protocol';
import { unlockVault, recoverVault } from '../../src/auth/vault.js';

test('turns assisted recovery off after a verified same-key kit and preserves account history', async ({
  page,
}) => {
  const apiPort = z.coerce
      .number()
      .int()
      .min(1024)
      .max(65535)
      .parse(process.env.DACLIFY_TEST_API_PORT ?? 3028),
    uiPort = z.coerce
      .number()
      .int()
      .min(1024)
      .max(65535)
      .parse(process.env.DACLIFY_TEST_UI_PORT ?? 5198),
    api = 'http://127.0.0.1:' + apiPort,
    email = `${crypto.randomUUID()}@example.test`,
    password = 'owned disposable kit password';
  await page.request.post(`${api}/fixture/options`, {
    headers: { origin: 'http://127.0.0.1:' + uiPort },
    data: { assisted: true, failStorage: false },
  });
  await page.goto('/account');
  const quick = page.locator('.quick-signup');
  await quick.getByRole('checkbox').check();
  await quick.getByRole('button', { name: 'Continue with email', exact: true }).click();
  await quick.getByLabel('Email address', { exact: true }).fill(email);
  await quick.getByRole('button', { name: 'Send code', exact: true }).click();
  await expect(quick.getByLabel('Email code', { exact: true })).toBeVisible();
  const code = z
    .object({ code: z.string() })
    .parse(
      await (
        await page.request.get(`${api}/fixture/code?email=${encodeURIComponent(email)}`)
      ).json(),
    ).code;
  await quick.getByLabel('Email code', { exact: true }).fill(code);
  await quick.getByRole('button', { name: 'Verify email and create account', exact: true }).click();
  const panel = page.locator('.assisted-opt-out');
  await expect(
    panel.getByRole('button', { name: 'Turn off Daclify-assisted recovery', exact: true }),
  ).toBeVisible();
  await panel
    .getByRole('button', { name: 'Turn off Daclify-assisted recovery', exact: true })
    .click();
  await panel.getByRole('button', { name: 'Keep assisted recovery', exact: true }).click();
  await expect(
    panel.getByRole('button', { name: 'Turn off Daclify-assisted recovery', exact: true }),
  ).toBeVisible();
  await panel
    .getByRole('button', { name: 'Turn off Daclify-assisted recovery', exact: true })
    .click();
  await panel.getByLabel('Backup vault password', { exact: true }).fill(password);
  await panel.getByRole('button', { name: 'Create independent recovery kit', exact: true }).click();
  const recoveryCode = await panel.getByLabel('Backup recovery code', { exact: true }).inputValue();
  const download = page.waitForEvent('download');
  await panel
    .getByRole('button', { name: 'Download independent recovery kit', exact: true })
    .click();
  const path = await (await download).path();
  if (!path) throw new Error('Missing kit download');
  const kit = RecoveryKitSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  expect(await unlockVault(kit.localEnvelope, password)).toEqual(
    await recoverVault(kit.recoveryEnvelope, recoveryCode),
  );
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: 'Confirm assisted recovery off', exact: true }).click();
  await expect(panel.getByText('Daclify-assisted recovery off', { exact: true })).toBeVisible();
  await expect(panel.getByText(/cannot erase keys or documents already recovered/)).toBeVisible();
  await expect(
    page.getByText('Ready to sign actions and open your private documents.', { exact: true }),
  ).toBeVisible();
});
