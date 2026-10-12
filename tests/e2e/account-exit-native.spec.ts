import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  RecoveryKitSchema,
  DaoRefSchema,
  DaoContentSchema,
  ExitReportSchema,
} from '@daclify/core-protocol';
import { createVault } from '../../src/auth/vault';
const FixtureSchema = z.strictObject({ dao: DaoRefSchema, memberId: z.string() });

test('deletes hosted login and leaves two real native DAOs using the original signing credentials', async ({
  page,
}) => {
  test.setTimeout(120000);
  const api = 'http://127.0.0.1:' + (process.env.DACLIFY_TEST_API_PORT ?? '3008'),
    origin = 'http://127.0.0.1:' + (process.env.DACLIFY_TEST_UI_PORT ?? '5178'),
    password = 'owned account departure browser password',
    vault = await createVault(password),
    kit = RecoveryKitSchema.parse({
      version: 1,
      localEnvelope: vault.localEnvelope,
      recoveryEnvelope: vault.recoveryEnvelope,
      signingPublicKey: vault.signingPublicKey,
      encryptionPublicKey: vault.encryptionPublicKey,
    }),
    { token } = z
      .strictObject({ token: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(
        JSON.parse(
          await readFile('../daclify-backend-core/.artifacts/native/browser-owner.json', 'utf8'),
        ),
      ),
    daos: Array<z.infer<typeof FixtureSchema>> = [];
  for (let index = 0; index < 2; index++) {
    const response = await page.request.post(api + '/fixture/dao', {
      headers: { 'x-fixture-token': token, origin },
      data: {
        signingKey: vault.signingPublicKey,
        encryptionKey: vault.encryptionPublicKey,
        admin: false,
      },
    });
    expect(response.status(), await response.text()).toBe(200);
    daos.push(FixtureSchema.parse(await response.json()));
  }
  await page.addInitScript(
    (record) => localStorage.setItem('daclify.vault.v1', JSON.stringify(record)),
    kit,
  );
  await page.goto('/account?returnTo=/account/exit');
  const main = page.getByRole('main');
  const login = main.getByRole('button', { name: 'Login', exact: true });
  await expect(login).toBeVisible();
  await login.click();
  await main.getByLabel('Vault password', { exact: true }).fill(password);
  await main.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/account\/exit$/);
  await expect(page.getByRole('button', { name: 'Sign departure from this DAO only' })).toHaveCount(
    2,
  );
  await page.getByLabel('Exit choice').selectOption('delete-account');
  await page.getByLabel('I reviewed every DAO and authorize the selected account action.').check();
  await page.getByRole('button', { name: 'Confirm hosted account deletion', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Account exit report', exact: true }),
  ).toBeVisible();
  expect((await page.request.get(api + '/v1/me', { headers: { origin } })).status()).toBe(401);
  for (let index = 0; index < 2; index++) {
    await page
      .getByRole('button', { name: 'Sign current profile removal', exact: true })
      .nth(index)
      .click();
    await page.getByRole('button', { name: 'Sign departure', exact: true }).nth(index).click();
    await expect
      .poll(async () => {
        const fixture = daos[index];
        if (!fixture) throw Error('FIXTURE');
        const response = await page.request.get(api + '/v1/daos/' + fixture.dao.daoId + '/content');
        expect(response.status()).toBe(200);
        return DaoContentSchema.parse(await response.json()).members.find(
          (member) => member.id === fixture.memberId,
        )?.active;
      })
      .toBe(false);
  }
  const saved = await page.evaluate(() => {
      const key = Object.keys(localStorage).find(
        (key) =>
          key.startsWith('daclify.exit.v1:') &&
          !key.endsWith(':pending') &&
          !key.endsWith(':settlement'),
      );
      return key ? JSON.parse(localStorage.getItem(key) ?? 'null') : null;
    }),
    local = z.object({ operation: z.object({ statusCapability: z.string() }) }).parse(saved),
    response = await page.request.post(api + '/v1/account-exit/status', {
      headers: { origin },
      data: { capability: local.operation.statusCapability },
    });
  expect(response.status()).toBe(200);
  await expect
    .poll(
      async () => {
        const current = await page.request.post(api + '/v1/account-exit/status', {
          headers: { origin },
          data: { capability: local.operation.statusCapability },
        });
        expect(current.status()).toBe(200);
        return ExitReportSchema.parse(await current.json())
          .components.filter((component) => component.id.startsWith('membership:'))
          .map((component) => component.state);
      },
      { timeout: 20000 },
    )
    .toEqual(['confirmed', 'confirmed']);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Account exit report', exact: true }),
  ).toBeVisible();
  expect((await page.request.get(api + '/v1/me', { headers: { origin } })).status()).toBe(401);
});
