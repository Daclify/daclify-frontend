import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ApiRoutes } from '@daclify/core-protocol';
import { ModuleApiRoutes } from '@daclify/modules';
import { payCreation } from './creation-payment';
const owner = z
  .object({ token: z.string() })
  .parse(
    JSON.parse(
      readFileSync('../daclify-backend-core/.artifacts/native/browser-owner.json', 'utf8'),
    ),
  );
test.use({ actionTimeout: 15000 });
async function create(page: Page) {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/account');
  await page.getByRole('button', { name: 'New Account', exact: true }).click();
  await page.getByRole('button', { name: 'Own Keys', exact: true }).click();
  await page
    .getByLabel('Vault password', { exact: true })
    .fill('owned private module fixture password');
  await page.getByRole('button', { name: 'Create encrypted vault', exact: true }).click();
  await page.getByLabel('I have saved my recovery kit and credential', { exact: true }).check();
  await page.getByRole('button', { name: 'Finish account setup', exact: true }).click();
  await expect(page.getByText('Vault unlocked', { exact: true })).toBeVisible();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation').getByRole('link', { name: 'Create', exact: true }).click();
  await page
    .getByLabel('Privacy policy', { exact: true })
    .selectOption('encrypted-user-controlled');
  await page.getByLabel('DAO name', { exact: true }).fill('Owned private module fixture');
  await page.getByLabel('Description', { exact: true }).fill('Synthetic testing only.');
}
async function modules(page: Page, id: string) {
  return ModuleApiRoutes.state.response.parse(
    await (await page.request.get(ModuleApiRoutes.state.path.replace(':id', id))).json(),
  );
}
test('private payroll names stay encrypted while immutable terms and approved installments survive a display rename', async ({
  page,
}) => {
  test.setTimeout(150000);
  await create(page);
  await payCreation(page, 'custom');
  const id = new URL(page.url()).pathname.split('/')[2];
  if (!id) throw Error('Owned DAO missing');
  const funded = await page.request.post(
    'http://127.0.0.1:' + (process.env.DACLIFY_TEST_API_PORT ?? 3008) + '/fixture/fund-dao',
    {
      headers: { 'x-fixture-token': owner.token, origin: new URL(page.url()).origin },
      data: { daoId: id },
    },
  );
  expect(funded.ok()).toBe(true);
  const canaries = [
      'Secret payroll agreed canary',
      'Secret payroll display canary',
      'Secret payroll terms canary',
    ] as const,
    leaks: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith('/v1/')) return;
    let value = (request.postData() ?? '') + request.url();
    if (path === ApiRoutes.relay.path) {
      const relay = ApiRoutes.relay.input.safeParse(request.postDataJSON());
      if (relay.success) value += Buffer.from(relay.data.request.data, 'hex').toString('utf8');
    }
    if (canaries.some((canary) => value.includes(canary))) leaks.push(path);
  });
  const sections = page.getByRole('navigation', { name: 'DAO sections' });
  await sections.getByRole('link', { name: 'Documents', exact: true }).click();
  await page.getByRole('button', { name: 'Add document', exact: true }).click();
  const doc = page.getByRole('dialog', { name: 'Add document', exact: true });
  await doc.getByText('Other formats', { exact: true }).click();
  await doc.getByLabel('Document format', { exact: true }).selectOption('json');
  await doc
    .getByLabel('JSON content', { exact: true })
    .fill(JSON.stringify({ terms: canaries[2] }));
  await doc.getByRole('button', { name: 'Encrypt and publish JSON', exact: true }).click();
  await expect(doc).not.toBeVisible();
  const content = ApiRoutes.content.response.parse(
    await (await page.request.get(ApiRoutes.content.path.replace(':id', id))).json(),
  );
  const terms = content.documents.at(-1);
  if (!terms) throw Error('Owned terms missing');
  await sections.getByRole('link', { name: 'Modules', exact: true }).click();
  await page.getByRole('button', { name: 'Enable Payroll', exact: true }).click();
  await sections.getByRole('link', { name: 'Payroll', exact: true }).click();
  await page.getByRole('button', { name: 'Add payroll', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Add payroll', exact: true });
  await form.getByLabel('Recipient', { exact: true }).selectOption('1');
  await form.getByLabel('Amount per installment (TLOS)', { exact: true }).fill('1');
  await form.getByLabel('Payroll name', { exact: true }).fill(canaries[0] ?? '');
  await form.getByLabel('Terms document', { exact: true }).selectOption(terms.id);
  const review = form.getByRole('button', {
    name: 'Open verified supporting document',
    exact: true,
  });
  if (await review.isVisible()) {
    await review.click();
    await form.getByLabel('I reviewed this document version', { exact: true }).check();
  }
  await form.getByLabel('I checked the recipient, installments and total', { exact: true }).check();
  let commitments = 0;
  await page.route('**' + ApiRoutes.relay.path, async (route) => {
    const input = ApiRoutes.relay.input.parse(route.request().postDataJSON());
    if (input.request.action === 'commitpriv') {
      commitments++;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort('failed');
    } else await route.continue();
  });
  await form.getByRole('button', { name: 'Commit funded payroll', exact: true }).click();
  await expect(form).not.toBeVisible({ timeout: 45000 });
  const before = await modules(page, id),
    schedule = before.schedules[0];
  if (!schedule) throw Error('Owned schedule missing');
  expect(before.schedules).toHaveLength(1);
  expect(commitments).toBe(1);
  expect(before.controls[0]?.label).toBe('Private payroll');
  expect(before.payrollTerms[0]?.schema_version).toBe(2);
  const recordUrl = ModuleApiRoutes.privatePayroll.path
    .replace(':id', id)
    .replace(':schedule', schedule.id);
  const original = ModuleApiRoutes.privatePayroll.response.parse(
    await (await page.request.get(recordUrl)).json(),
  );
  expect(original.agreed).toEqual(original.display);
  await page.getByRole('button', { name: 'Read private payroll names', exact: true }).click();
  await expect(page.getByRole('heading', { name: canaries[0], exact: true })).toBeVisible();
  await page.getByLabel('Private display name', { exact: true }).fill(canaries[1] ?? '');
  await page.getByRole('button', { name: 'Save private display name', exact: true }).click();
  await expect(page.getByRole('heading', { name: canaries[1], exact: true })).toBeVisible();
  const renamed = ModuleApiRoutes.privatePayroll.response.parse(
      await (await page.request.get(recordUrl)).json(),
    ),
    after = await modules(page, id);
  expect(renamed.agreed).toEqual(original.agreed);
  expect(renamed.display).not.toEqual(original.display);
  expect(after.schedules).toEqual(before.schedules);
  expect(after.payrollTerms).toEqual(before.payrollTerms);
  expect(after.controls[0]?.paused).toBe(before.controls[0]?.paused);
  expect(JSON.stringify(after)).not.toMatch(/Secret payroll/);
  expect(leaks).toEqual([]);
  expect(
    await page.evaluate(
      (values) =>
        [sessionStorage, localStorage].every((storage) =>
          Object.values(storage).every(
            (value) => !values.some((canary) => String(value).includes(canary)),
          ),
        ),
      canaries,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: canaries[1], exact: true })).toHaveCount(0);
});
test('guarded founders keep their original account keys and encrypt the operating name', async ({
  page,
}) => {
  test.setTimeout(120000);
  await create(page);
  await page.getByLabel('DAO purpose', { exact: true }).selectOption('custom');
  await page.getByLabel('Participants', { exact: true }).selectOption('agents-guarded');
  await page
    .getByRole('button', { name: 'Use this account as the founding agent', exact: true })
    .click();
  const signing = await page
    .getByLabel('Founding agent signing public key', { exact: true })
    .inputValue();
  const name = 'Secret guarded operator canary ' + Date.now(),
    leaks: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith('/v1/')) return;
    let value = (request.postData() ?? '') + request.url();
    if (path === ApiRoutes.relay.path) {
      const relay = ApiRoutes.relay.input.safeParse(request.postDataJSON());
      if (relay.success) value += Buffer.from(relay.data.request.data, 'hex').toString('utf8');
    }
    if (value.includes(name)) leaks.push(path);
  });
  await page.getByLabel('Private agent operating name', { exact: true }).fill(name);
  await page.getByLabel('Maximum per milestone / installment (TLOS)', { exact: true }).fill('5');
  await page.getByLabel('Maximum commitments per UTC day (TLOS)', { exact: true }).fill('10');
  await page.getByLabel('Human guardian account', { exact: true }).fill('alice');
  await page.getByRole('button', { name: 'Review free DAO setup', exact: true }).click();
  await page.getByRole('button', { name: 'Create this DAO', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/dao\/\d+$/);
  const id = new URL(page.url()).pathname.split('/')[2];
  if (!id) throw Error('Owned DAO missing');
  const members = ApiRoutes.memberships.response.parse(
    await (await page.request.get(ApiRoutes.memberships.path)).json(),
  ).memberships;
  expect(members.find((member) => member.dao.daoId === id)).toMatchObject({
    memberId: '1',
    signingKey: signing,
    active: true,
  });
  const governance = ApiRoutes.governance.response.parse(
    await (await page.request.get(ApiRoutes.governance.path.replace(':id', id))).json(),
  );
  expect(governance.actors[0]?.operator_label).toBe('Agent');
  expect(JSON.stringify(governance)).not.toContain(name);
  await page
    .getByRole('navigation', { name: 'DAO sections' })
    .getByRole('link', { name: 'Settings', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Governance', exact: true }).click();
  await page.getByText('Advanced: agents and automation access', { exact: true }).click();
  await page.getByRole('button', { name: 'Read private operating details', exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  expect(leaks).toEqual([]);
  await page.getByRole('button', { name: 'Lock keys', exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
});
