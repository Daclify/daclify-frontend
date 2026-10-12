import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  DaoRefSchema,
  RecoveryKitSchema,
  ApiRoutes,
  MemberProfileSchema,
  EncryptedProfileSchema,
  PeopleRoutes,
} from '@daclify/core-protocol';
import { createVault } from '../../src/auth/vault';
const password = 'owned private profile browser vault';
const apiUrl = 'http://127.0.0.1:' + (process.env.DACLIFY_TEST_API_PORT ?? '3008');
const origin = 'http://127.0.0.1:' + (process.env.DACLIFY_TEST_UI_PORT ?? '5178');
async function installVault(page: Page, vault: Awaited<ReturnType<typeof createVault>>) {
  const kit = RecoveryKitSchema.parse({
    version: 1,
    localEnvelope: vault.localEnvelope,
    recoveryEnvelope: vault.recoveryEnvelope,
    signingPublicKey: vault.signingPublicKey,
    encryptionPublicKey: vault.encryptionPublicKey,
  });
  await page.addInitScript(
    (record) => localStorage.setItem('daclify.vault.v1', JSON.stringify(record)),
    kit,
  );
}
async function unlock(page: Page, destination = '/account') {
  await page.goto(
    destination === '/account'
      ? '/account'
      : '/account?returnTo=' + encodeURIComponent(destination),
  );
  const main = page.getByRole('main'),
    login = main.getByRole('button', { name: 'Login', exact: true });
  const passwordField = main.getByLabel('Vault password', { exact: true });
  await expect
    .poll(async () => (await login.isVisible()) || (await passwordField.isVisible()))
    .toBe(true);
  if (await login.isVisible()) await login.click();
  await passwordField.fill(password);
  await main.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(page).toHaveURL(origin + destination);
}
test('encrypts on the native chain, shares explicitly, clears on lock and reports removal honestly', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  const vault = await createVault(password),
    reader = await createVault(password);
  const owner = z
    .object({ token: z.string().regex(/^[0-9a-f]{64}$/) })
    .parse(
      JSON.parse(
        await readFile('../daclify-backend-core/.artifacts/native/browser-owner.json', 'utf8'),
      ),
    );
  const headers = { 'x-fixture-token': owner.token, origin };
  const created = await page.request.post(apiUrl + '/fixture/dao', {
    headers,
    data: { signingKey: vault.signingPublicKey, encryptionKey: vault.encryptionPublicKey },
  });
  expect(created.status(), await created.text()).toBe(200);
  const fixture = z.object({ dao: DaoRefSchema, memberId: z.string() }).parse(await created.json());
  const enrolled = await page.request.post(apiUrl + '/fixture/profile-member', {
    headers,
    data: {
      daoId: fixture.dao.daoId,
      signingKey: reader.signingPublicKey,
      encryptionKey: reader.encryptionPublicKey,
    },
  });
  expect(enrolled.status(), await enrolled.text()).toBe(200);
  const readerId = z.object({ memberId: z.string() }).parse(await enrolled.json()).memberId;
  await installVault(page, vault);
  await unlock(page);
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Private profile', exact: true })).toBeVisible();
  const name =
    'p' +
    fixture.dao.daoId.replace(/[0-9]/g, (digit) => 'abcdefghij'[Number(digit)] ?? 'a') +
    (testInfo.project.name.startsWith('mobile') ? 'm' : 'd');
  const secrets = [
    'Synthetic private name',
    'private@example.com',
    'Synthetic private location',
    'Synthetic private biography',
  ];
  await page.getByLabel('Account name', { exact: true }).fill(name);
  await page.getByLabel('Full name', { exact: true }).fill(secrets[0] ?? '');
  await page.getByLabel('Location', { exact: true }).fill(secrets[2] ?? '');
  await page.getByLabel('Introduction', { exact: true }).fill(secrets[3] ?? '');
  await page.getByText('Private contact & links', { exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(secrets[1] ?? '');
  await page.getByText('Profile images', { exact: true }).click();
  await expect(page.getByLabel('Avatar image CID', { exact: true })).toBeDisabled();
  const writes: string[] = [],
    bodyScans: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    const body = request.postData() ?? '';
    if (request.url().includes(ApiRoutes.relay.path)) writes.push(body);
    if (
      request.url().includes('/v1/profiles/keys/') ||
      request.url().includes(ApiRoutes.relay.path)
    )
      bodyScans.push(body);
  });
  await page.route('**/v1/profiles/keys/share', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"code":"PROFILE_KEYS_UNAVAILABLE","message":"redacted"}',
    }),
  );
  await page.getByRole('button', { name: 'Publish encrypted profile', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'profile key service is unavailable' }),
  ).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.unroute('**/v1/profiles/keys/share');
  await page.getByRole('button', { name: 'Publish encrypted profile', exact: true }).click();
  await expect(page.getByText('Encrypted profile published.', { exact: false })).toBeVisible();
  expect(writes).toHaveLength(1);
  const raw = MemberProfileSchema.parse(
    await (
      await page.request.get(`/v1/profile?daoId=${fixture.dao.daoId}&memberId=${fixture.memberId}`)
    ).json(),
  );
  const cipher = EncryptedProfileSchema.parse(JSON.parse(raw.profile ?? 'null'));
  expect(cipher.context).toMatchObject({
    chainId: fixture.dao.chainId,
    runtime: fixture.dao.contract,
    daoId: fixture.dao.daoId,
    memberId: fixture.memberId,
  });
  for (const body of bodyScans) for (const value of secrets) expect(body).not.toContain(value);
  for (const url of [
    `/v1/people?daoId=${fixture.dao.daoId}`,
    `${PeopleRoutes.members.path}?daoId=${fixture.dao.daoId}&memberId=${fixture.memberId}`,
  ]) {
    const response = await page.request.get(url);
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain(name);
    for (const value of secrets) expect(body).not.toContain(value);
  }
  const context = await browser.newContext(),
    other = await context.newPage();
  try {
    await installVault(other, reader);
    await unlock(other, `/users/${fixture.dao.daoId}/${fixture.memberId}`);
    await expect(other.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(
      other.getByText('Joining the DAO alone does not grant access.', { exact: false }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Load eligible recipients', exact: true }).click();
    await page.getByLabel(`Member ${readerId}`, { exact: true }).check();
    await page.getByRole('button', { name: 'Publish encrypted profile', exact: true }).click();
    await expect.poll(() => writes.length).toBe(2);
    await unlock(other, `/users/${fixture.dao.daoId}/${fixture.memberId}`);
    await expect(other.getByRole('heading', { name: secrets[0] ?? '', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Publish encrypted profile', exact: true }).click();
    await expect.poll(() => writes.length).toBe(3);
    await unlock(other, `/users/${fixture.dao.daoId}/${fixture.memberId}`);
    await expect(other.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(
      other.getByText('Joining the DAO alone does not grant access.', { exact: false }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
  await page.route('**/v1/profiles/*/*/keys/*', (route) =>
    route.fulfill({ status: 404, json: { code: 'PROFILE_KEY_UNAVAILABLE', message: 'redacted' } }),
  );
  await unlock(page);
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'profile key envelope is missing' }),
  ).toBeVisible();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('');
  await page.unroute('**/v1/profiles/*/*/keys/*');
  await page.getByRole('button', { name: 'Retry profile read', exact: true }).click();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue(secrets[0] ?? '');
  const profileTab = page.getByRole('tab', { name: 'Profile', exact: true });
  await profileTab.focus();
  await profileTab.press('ArrowLeft');
  await page.getByRole('tab', { name: 'Access & recovery', exact: true }).click();
  await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
  await profileTab.click();
  await expect(
    page.getByText('Unlock your account vault to read or edit your private profile.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveCount(0);
  await unlock(page);
  await profileTab.click();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue(secrets[0] ?? '');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  // Check the help transport while private fields are visible; no live model is configured.
  const questions: unknown[] = [];
  await page.route('**/v1/docs/agent', (route) => route.fulfill({ json: { configured: true } }));
  await page.route('**/v1/docs/ask', (route) => {
    questions.push(JSON.parse(route.request().postData() ?? 'null'));
    return route.fulfill({
      json: {
        status: 'answered',
        topicId: 'accounts',
        title: 'Accounts',
        answer: 'Choose recipients in your private profile editor.',
      },
    });
  });
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if ((await menu.isVisible()) && (await menu.getAttribute('aria-expanded')) === 'false')
    await menu.click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  if ((await menu.isVisible()) && (await menu.getAttribute('aria-expanded')) === 'true')
    await menu.click();
  const help = page.getByRole('complementary', { name: 'Daxi Help', exact: true });
  await help.getByLabel('Question', { exact: true }).fill('How do I choose profile recipients?');
  await help.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(
    help.getByText('Choose recipients in your private profile editor.', { exact: true }),
  ).toBeVisible();
  expect(questions).toEqual([{ question: 'How do I choose profile recipients?' }]);
  for (const value of secrets) expect(await help.innerText()).not.toContain(value);
  await help.getByRole('button', { name: 'Minimize help', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveCount(0);
  for (const value of secrets)
    expect(await page.getByRole('main').innerText()).not.toContain(value);
  await unlock(page);
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue(secrets[0] ?? '');
  await page
    .getByLabel('Remove my current profile and its service-held keys', { exact: true })
    .check();
  await page.getByRole('button', { name: 'Remove current profile', exact: true }).click();
  await expect(page.getByText('Current profile removed.', { exact: false })).toBeVisible();
  await expect(
    page.getByText('Active key envelopes removed. Backup expiry pending', { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('');
  expect(
    MemberProfileSchema.parse(
      await (
        await page.request.get(
          `/v1/profile?daoId=${fixture.dao.daoId}&memberId=${fixture.memberId}`,
        )
      ).json(),
    ).profile,
  ).toBeNull();
  for (const body of bodyScans) for (const value of secrets) expect(body).not.toContain(value);
});
