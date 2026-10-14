import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { PrivateKey } from '@wharfkit/antelope';
import { z } from 'zod';
import {
  ApiRoutes,
  DaoRefSchema,
  RecoveryKitSchema,
  MemberProfileSchema,
  EncryptedProfileSchema,
  DaoContentSchema,
} from '@daclify/core-protocol';
import { createVault } from '../../src/auth/vault';
import { RuntimeTableSchemas } from '@daclify/core-protocol/sdk';

test('connects an AI delegate, publishes an encrypted profile, then deletes the account and completes native departure', async ({
  page,
}) => {
  test.setTimeout(120000);
  const api = 'http://127.0.0.1:' + (process.env.DACLIFY_TEST_API_PORT ?? '3008'),
    origin = 'http://127.0.0.1:' + (process.env.DACLIFY_TEST_UI_PORT ?? '5178'),
    password = 'owned complete lifecycle browser password',
    vault = await createVault(password);
  const kit = RecoveryKitSchema.parse({
    version: 1,
    localEnvelope: vault.localEnvelope,
    recoveryEnvelope: vault.recoveryEnvelope,
    signingPublicKey: vault.signingPublicKey,
    encryptionPublicKey: vault.encryptionPublicKey,
  });
  const { token } = z
    .strictObject({ token: z.string().regex(/^[a-f0-9]{64}$/) })
    .parse(
      JSON.parse(
        await readFile('../daclify-backend-core/.artifacts/native/browser-owner.json', 'utf8'),
      ),
    );
  const created = await page.request.post(api + '/fixture/dao', {
    headers: { 'x-fixture-token': token, origin },
    data: {
      signingKey: vault.signingPublicKey,
      encryptionKey: vault.encryptionPublicKey,
      admin: false,
    },
  });
  expect(created.status(), await created.text()).toBe(200);
  const context = z
      .strictObject({ dao: DaoRefSchema, memberId: z.string() })
      .parse(await created.json()),
    delegate = PrivateKey.generate('K1'),
    verifier = randomBytes(32).toString('base64url');
  const started = await page.request.post(api + ApiRoutes.mcpPair.path, {
    data: {
      ...context,
      scopes: ['vote'],
      delegatePublicKey: delegate.toPublic().toString(),
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    },
  });
  expect(started.status(), await started.text()).toBe(200);
  const pairing = ApiRoutes.mcpPair.response.parse(await started.json());
  await page.addInitScript(
    (record) => localStorage.setItem('daclify.vault.v1', JSON.stringify(record)),
    kit,
  );
  await page.goto('/account?returnTo=' + encodeURIComponent('/mcp/consent?request=' + pairing.id));
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Login', exact: true }).click();
  await main.getByLabel('Vault password', { exact: true }).fill(password);
  await main.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect an AI harness' })).toBeVisible();
  await page
    .getByRole('radio', { name: 'Allow the harness to perform these scoped actions automatically' })
    .check();
  await page.getByRole('button', { name: 'Approve connection', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Connection approved');
  const redeemed = await page.request.post(
    api + ApiRoutes.mcpRedeem.path.replace(':id', pairing.id),
    { data: { codeVerifier: verifier } },
  );
  expect(redeemed.status(), await redeemed.text()).toBe(200);
  const grant = ApiRoutes.mcpRedeem.response.parse(await redeemed.json());
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name: 'Your account', exact: true }).click();
  await page.getByRole('button', { name: 'Edit profile & account', exact: true }).click();
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await page
    .getByLabel('Account name', { exact: true })
    .fill('p' + context.dao.daoId.replace(/[0-9]/g, (digit) => 'abcdefghij'[Number(digit)] ?? 'a'));
  const secret = 'Owned confidential complete journey';
  await page.getByLabel('Full name', { exact: true }).fill(secret);
  await page.getByRole('button', { name: 'Publish encrypted profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: secret, exact: true })).toBeVisible();
  const profile = MemberProfileSchema.parse(
    await (
      await page.request.get(
        api + '/v1/profile?daoId=' + context.dao.daoId + '&memberId=' + context.memberId,
      )
    ).json(),
  );
  expect(profile.profile).not.toContain(secret);
  expect(EncryptedProfileSchema.parse(JSON.parse(profile.profile ?? 'null')).context.daoId).toBe(
    context.dao.daoId,
  );
  await page.getByRole('button', { name: 'Edit profile & account', exact: true }).click();
  await page
    .getByRole('link', { name: 'Leave DAOs or delete my hosted account', exact: true })
    .click();
  await page.getByLabel('Exit choice').selectOption('delete-account');
  await page.getByLabel('I reviewed every DAO and authorize the selected account action.').check();
  await page.getByRole('button', { name: 'Confirm hosted account deletion', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Account exit report', exact: true }),
  ).toBeVisible();
  expect((await page.request.get(api + '/v1/me', { headers: { origin } })).status()).toBe(401);
  const stale = await page.request.get(api + ApiRoutes.mcpLocalStatus.path, {
    headers: { authorization: 'Bearer ' + grant.token },
  });
  expect(stale.status()).toBe(401);
  await page.getByRole('button', { name: 'Sign current profile removal', exact: true }).click();
  await page.getByRole('button', { name: 'Sign departure', exact: true }).click();
  await expect
    .poll(
      async () =>
        DaoContentSchema.parse(
          await (await page.request.get(api + '/v1/daos/' + context.dao.daoId + '/content')).json(),
        ).members.find((member) => member.id === context.memberId)?.active,
    )
    .toBe(false);
  const native = z
    .object({
      url: z.string().regex(/^http:\/\/127\.0\.0\.1:[0-9]{4,5}$/),
      chainId: z.literal(context.dao.chainId),
    })
    .parse(
      JSON.parse(await readFile('../daclify-backend-core/.artifacts/native/network.json', 'utf8')),
    );
  const profileKey = ((BigInt(context.dao.daoId) << 64n) + BigInt(context.memberId)).toString();
  const removed = await page.request.post(native.url + '/v1/chain/get_table_rows', {
    data: {
      code: context.dao.contract,
      scope: context.dao.contract,
      table: 'profiles',
      json: true,
      index_position: 2,
      key_type: 'i128',
      lower_bound: profileKey,
      upper_bound: profileKey,
      limit: 2,
    },
  });
  expect(removed.status()).toBe(200);
  expect(
    z
      .object({ rows: z.array(RuntimeTableSchemas.profiles).max(1), more: z.literal(false) })
      .parse(await removed.json()).rows,
  ).toHaveLength(0);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Account exit report', exact: true }),
  ).toBeVisible();
  expect((await page.request.get(api + '/v1/me', { headers: { origin } })).status()).toBe(401);
});
