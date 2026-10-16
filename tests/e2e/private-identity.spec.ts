import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ApiRoutes, PrivateRecordRoutes } from '@daclify/core-protocol';
import { ModuleApiRoutes } from '@daclify/modules';
const owner = z
  .object({ token: z.string() })
  .parse(
    JSON.parse(
      readFileSync('../daclify-backend-core/.artifacts/native/browser-owner.json', 'utf8'),
    ),
  );
async function account(page: Page, navigate = true) {
  page.on('dialog', (dialog) => void dialog.accept());
  if (navigate) await page.goto('/account');
  await page.getByRole('button', { name: 'New Account', exact: true }).click();
  await page.getByRole('button', { name: 'Own Keys', exact: true }).click();
  await page
    .getByLabel('Vault password', { exact: true })
    .fill('private identity browser fixture 2026');
  await page.getByRole('button', { name: 'Create encrypted vault', exact: true }).click();
  await page.getByLabel('I have saved my recovery kit and credential', { exact: true }).check();
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === ApiRoutes.login.path);
  await page.getByRole('button', { name: 'Finish account setup', exact: true }).click();
  const session = ApiRoutes.login.response.parse(await (await response).json());
  await expect(page.getByText('Vault unlocked', { exact: true })).toBeVisible();
  return session.account;
}
async function createPage(page: Page) {
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation').getByRole('link', { name: 'Create', exact: true }).click();
  await page
    .getByLabel('Privacy policy', { exact: true })
    .selectOption('encrypted-user-controlled');
}
function canaries(page: Page, values: string[]) {
  const leaks: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/v1/')) return;
    if (
      values.some(
        (value) => (request.postData() ?? '').includes(value) || request.url().includes(value),
      )
    )
      leaks.push(url.pathname);
  });
  return leaks;
}
test('private creation publishes only ciphertext, supports hosted identity text and opens it with original browser keys', async ({
  page,
}) => {
  test.setTimeout(120000);
  await account(page);
  await createPage(page);
  const title = 'Hidden DAO canary ' + Date.now(),
    description = ('Hidden mission canary ' + Date.now() + ' ').repeat(100),
    leaks = canaries(page, [
      title,
      'Hidden mission canary',
      'Hidden edited mission',
      'Hidden private summary',
      'private-logo-canary.png',
    ]);
  await page.getByLabel('DAO name', { exact: true }).fill(title);
  await page.getByLabel('Description', { exact: true }).fill(description);
  await page.getByRole('button', { name: 'Review free DAO setup', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create this DAO', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Create this DAO', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/dao\/\d+$/);
  const id = new URL(page.url()).pathname.split('/')[2];
  const summary = ApiRoutes.dao.response.parse(
    await (await page.request.get('/v1/daos/' + id)).json(),
  );
  expect(summary.title).toBe('Private DAO');
  expect(summary.description).toBe('');
  const modules = ModuleApiRoutes.state.response.parse(
    await (await page.request.get(ModuleApiRoutes.state.path.replace(':id', id ?? ''))).json(),
  );
  expect(modules.modules.filter((row) => row.installed).length).toBeGreaterThan(0);
  expect(
    modules.modules
      .filter((row) => row.installed)
      .every((row) => row.compatible && row.codeVerified),
  ).toBe(true);
  const identity = PrivateRecordRoutes.identity.response.parse(
    await (await page.request.get('/v1/daos/' + id + '/private-identity')).json(),
  );
  expect(identity.reference).not.toBeNull();
  const content = ApiRoutes.content.response.parse(
    await (await page.request.get('/v1/daos/' + id + '/content')).json(),
  );
  expect(JSON.stringify(content)).not.toContain('Hidden mission canary');
  expect(
    content.documents.some(
      (row) =>
        row.document_id === identity.reference?.documentId &&
        !!row.cid &&
        row.envelope_version === 1,
    ),
  ).toBe(true);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'DAO sections' })
    .getByRole('link', { name: 'Settings', exact: true })
    .click();
  await page.getByRole('button', { name: 'Edit private details', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit private DAO details', exact: true }),
    updatedTitle = title + ' internal';
  await editor.getByLabel('Private DAO name', { exact: true }).fill(updatedTitle);
  await editor.getByLabel('Private description', { exact: true }).fill('Hidden edited mission');
  await editor.getByLabel('Private summary', { exact: true }).fill('Hidden private summary');
  await editor.getByRole('button', { name: 'Save private details', exact: true }).click();
  await expect(page.getByRole('heading', { name: updatedTitle, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit private details', exact: true }).click();
  await editor.getByText('Private logo and cover', { exact: true }).click();
  await editor.getByLabel('Document file', { exact: true }).setInputFiles({
    name: 'private-logo-canary.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfX8AAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await editor.getByRole('button', { name: 'Add document', exact: true }).click();
  await expect(editor.getByText('Private logo attached', { exact: false })).toBeVisible();
  await expect(
    editor.getByRole('button', { name: 'Save private details', exact: true }),
  ).toBeEnabled();
  await editor.getByRole('button', { name: 'Save private details', exact: true }).click();
  await expect(page.locator('.private-dao-logo')).toBeVisible();
  const protectedIdentity = PrivateRecordRoutes.identity.response.parse(
    await (await page.request.get('/v1/daos/' + id + '/private-identity')).json(),
  );
  expect(protectedIdentity.reference?.version).toBe(3);
  await page.getByRole('button', { name: 'Edit DAO name', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Edit DAO name', exact: true }),
    alias = 'Published public DAO ' + Date.now();
  await rename.getByLabel('New DAO name', { exact: true }).fill(alias);
  await rename.getByRole('checkbox').check();
  await rename.getByRole('button', { name: 'Sign and update name', exact: true }).click();
  await expect
    .poll(
      async () =>
        ApiRoutes.dao.response.parse(await (await page.request.get('/v1/daos/' + id)).json()).title,
    )
    .toBe(alias);
  await page.getByRole('button', { name: 'Edit directory card', exact: true }).click();
  const card = page.getByRole('dialog', { name: 'Edit directory card', exact: true });
  await card.getByLabel('Card summary', { exact: true }).fill('Deliberately public summary');
  await card.getByRole('button', { name: 'Sign and update card', exact: true }).click();
  await expect
    .poll(
      async () =>
        ApiRoutes.dao.response.parse(await (await page.request.get('/v1/daos/' + id)).json())
          .branding?.summary,
    )
    .toBe('Deliberately public summary');
  const retained = PrivateRecordRoutes.identity.response.parse(
    await (await page.request.get('/v1/daos/' + id + '/private-identity')).json(),
  );
  expect(retained.reference).toEqual(protectedIdentity.reference);
  expect(retained.metadata.schemaVersion).toBe(4);
  expect(leaks).toEqual([]);
  expect(await page.evaluate(() => document.title)).not.toContain(title);
  await page.reload();
  await expect(page.getByRole('heading', { name: updatedTitle, exact: true })).toHaveCount(0);
  await expect(page.locator('.private-dao-logo')).toHaveCount(0);
});
test('private claim links reveal their setup locally and reseal for the sole claimant without giving the issuer access', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const issuer = await account(page);
  const seed = await page.request.post(
    'http://127.0.0.1:' + (process.env.DACLIFY_TEST_API_PORT ?? 3008) + '/fixture/dao',
    {
      headers: { 'x-fixture-token': owner.token, origin: new URL(page.url()).origin },
      data: { signingKey: issuer.signingKey, encryptionKey: issuer.encryptionKey, platform: true },
    },
  );
  expect(seed.status()).toBe(200);
  await expect
    .poll(
      async () =>
        ApiRoutes.daoClaimEligibility.response.parse(
          await (await page.request.get(ApiRoutes.daoClaimEligibility.path)).json(),
        ).eligible,
    )
    .toBe(true);
  await createPage(page);
  const title = 'Hidden invited DAO ' + Date.now(),
    description = 'Hidden invited mission ' + Date.now(),
    leaks = canaries(page, [title, description]);
  await page.getByLabel('DAO name', { exact: true }).fill(title);
  await page.getByLabel('Description', { exact: true }).fill(description);
  await page.getByLabel('Approve invitation with').selectOption('vault');
  await page.getByRole('button', { name: 'Create claim link', exact: true }).click();
  const issued = page.getByLabel('Private invitation link · copy now', { exact: true });
  await expect(issued).toBeVisible();
  const link = await issued.inputValue();
  expect(new URL(link).hash).toMatch(/^#v2:/);
  const recipient = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport: page.viewportSize() ?? { width: 1280, height: 720 },
    }),
    target = await recipient.newPage(),
    recipientLeaks = canaries(target, [title, description]);
  try {
    await target.goto(link);
    await expect(target.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await target.getByRole('button', { name: 'Sign in or create an account', exact: true }).click();
    await expect.poll(() => target.url().includes(new URL(link).hash.slice(1))).toBe(false);
    const claimant = await account(target, false);
    await expect(
      target.getByRole('button', { name: 'Claim and create DAO', exact: true }),
    ).toBeEnabled();
    await target.getByRole('button', { name: 'Claim and create DAO', exact: true }).click();
    await expect(
      target.getByRole('button', { name: 'Finish private DAO setup', exact: true }),
    ).toBeVisible();
    await target.getByRole('button', { name: 'Finish private DAO setup', exact: true }).click();
    await expect.poll(() => new URL(target.url()).pathname).toMatch(/^\/dao\/\d+$/);
    const id = new URL(target.url()).pathname.split('/')[2],
      governance = ApiRoutes.governance.response.parse(
        await (await target.request.get('/v1/daos/' + id + '/governance')).json(),
      );
    expect(governance.executiveMembers.map((row) => row.signing_key)).toEqual([
      claimant.signingKey,
    ]);
    expect(governance.executiveMembers.some((row) => row.signing_key === issuer.signingKey)).toBe(
      false,
    );
    await expect(target.getByRole('heading', { name: title, exact: true })).toBeVisible();
    expect(leaks).toEqual([]);
    expect(recipientLeaks).toEqual([]);
  } finally {
    await recipient.close();
  }
});
