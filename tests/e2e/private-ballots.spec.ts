import { expect, test, type Page, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ApiRoutes } from '@daclify/core-protocol';
import { ModuleApiRoutes, BallotMetadataV3Schema, BallotMetadataV4Schema } from '@daclify/modules';
const password = 'owned private ballot browser fixture';
async function createPrivateDao(page: Page) {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/account');
  await page.getByRole('button', { name: 'New Account', exact: true }).click();
  await page.getByRole('button', { name: 'Own Keys', exact: true }).click();
  await page.getByLabel('Vault password', { exact: true }).fill(password);
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
  await page.getByLabel('DAO name', { exact: true }).fill('Private ballot fixture ' + Date.now());
  await page.getByLabel('Description', { exact: true }).fill('Owned synthetic privacy fixture.');
  await page.getByRole('button', { name: 'Review free DAO setup', exact: true }).click();
  await page.getByRole('button', { name: 'Create this DAO', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/dao\/\d+$/);
  const id = new URL(page.url()).pathname.split('/')[2];
  if (!id) throw Error('fixture DAO missing');
  await page
    .getByRole('navigation', { name: 'DAO sections' })
    .getByRole('link', { name: 'Decide', exact: true })
    .click();
  const network = ApiRoutes.network.response.parse(
    await (await page.request.get(ApiRoutes.network.path)).json(),
  );
  expect(network.capabilities).toContain('private-ballot-content-v1');
  return id;
}
function watchCanaries(page: Page, canaries: string[]) {
  const leaked: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith('/v1/')) return;
    let text = (request.postData() ?? '') + request.url();
    if (path === ApiRoutes.relay.path) {
      const parsed = ApiRoutes.relay.input.safeParse(request.postDataJSON());
      if (parsed.success) text += Buffer.from(parsed.data.request.data, 'hex').toString('utf8');
    }
    if (canaries.some((value) => text.includes(value))) leaked.push(path);
  });
  return leaked;
}
async function ballotForm(page: Page, title: string, description: string, options: string[]) {
  await page.getByRole('button', { name: 'Open a ballot', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Open a ballot', exact: true });
  await form.getByLabel('Private ballot title', { exact: true }).fill(title);
  await form.getByLabel('Private explanation', { exact: true }).fill(description);
  await form.getByLabel('Ballot type', { exact: true }).selectOption('poll');
  for (let i = 0; i < options.length; i++)
    await form.getByLabel(`Choice ${i + 1}`, { exact: true }).fill(options[i] ?? '');
  return form;
}
async function moduleState(page: Page, daoId: string) {
  return ModuleApiRoutes.state.response.parse(
    await (await page.request.get(ModuleApiRoutes.state.path.replace(':id', daoId))).json(),
  );
}
async function unlockReturn(page: Page, daoId: string) {
  await page.getByRole('link', { name: 'Unlock account to read', exact: true }).first().click();
  await page.getByLabel('Password for this device', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await expect(page.getByText('Vault unlocked', { exact: true })).toBeVisible();
  if (new URL(page.url()).pathname !== `/dao/${daoId}/decide`) {
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole('link', { name: 'My DAO', exact: true }).click();
    await page.locator(`a[href="/dao/${daoId}"]`).first().click();
    await page
      .getByRole('navigation', { name: 'DAO sections' })
      .getByRole('link', { name: 'Decide', exact: true })
      .click();
  }
}
async function assertNoStoredCanary(page: Page, canaries: string[]) {
  expect(
    await page.evaluate(
      (values) =>
        [localStorage, sessionStorage].every((storage) =>
          Object.values(storage).every(
            (value) => !values.some((text) => String(value).includes(text)),
          ),
        ),
      canaries,
    ),
  ).toBe(true);
}
async function submit(form: Locator) {
  await form.getByRole('button', { name: 'Open ballot', exact: true }).click();
  await expect(form).not.toBeVisible({ timeout: 45000 });
}
test('encrypts custom choices, requires local reading, signs the frozen choice and clears wording on lock', async ({
  page,
}) => {
  test.setTimeout(150000);
  const daoId = await createPrivateDao(page),
    title = 'Hidden ballot title ' + Date.now(),
    explanation = 'Hidden ballot explanation ' + '💫'.repeat(700),
    options = ['Hidden choice Garden', 'Hidden choice Hall', 'Hidden choice Online'],
    canaries = [title, 'Hidden ballot explanation', ...options],
    leaked = watchCanaries(page, canaries);
  const form = await ballotForm(page, title, explanation, options);
  await submit(form);
  await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Vote ' + options[1], exact: true })).toHaveCount(
    0,
  );
  const state = await moduleState(page, daoId),
    ballot = state.ballots[0];
  if (!ballot) throw Error('fixture ballot missing');
  expect(BallotMetadataV4Schema.parse(JSON.parse(ballot.metadata))).toMatchObject({
    schemaVersion: 4,
    options: [0, 1, 2],
    privateContent: { documentId: ballot.id },
  });
  expect(state.ballotDefinitions.find((row) => row.ballot_id === ballot.id)?.version).toBe(3);
  expect(canaries.some((value) => JSON.stringify(state).includes(value))).toBe(false);
  await page.getByRole('button', { name: 'Read private ballot', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByText(explanation, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Vote ' + options[1], exact: true }).click();
  await expect(page.getByText('Your vote: ' + options[1], { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export ballot and votes', exact: true }).click();
  const path = await (await download).path();
  if (!path) throw Error('export missing');
  const exported = readFileSync(path, 'utf8');
  expect(canaries.some((value) => exported.includes(value))).toBe(false);
  await assertNoStoredCanary(page, canaries);
  await page.getByRole('button', { name: 'Open a ballot', exact: true }).click();
  const publicForm = page.getByRole('dialog', { name: 'Open a ballot', exact: true });
  await publicForm.getByLabel('Publish ballot wording publicly', { exact: true }).check();
  const checkbox = await publicForm
    .getByLabel('Publish ballot wording publicly', { exact: true })
    .boundingBox();
  expect(checkbox?.width).toBeLessThanOrEqual(24);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(
    publicForm.getByText(
      'The title, explanation and every choice will be public permanently on chain.',
      { exact: true },
    ),
  ).toBeVisible();
  await publicForm
    .getByLabel('Public ballot title', { exact: true })
    .fill('Deliberately public ballot');
  await publicForm
    .getByLabel('Public explanation', { exact: true })
    .fill('This wording is deliberately public.');
  await publicForm.getByLabel('Ballot type', { exact: true }).selectOption('proposal');
  await submit(publicForm);
  expect(
    (await moduleState(page, daoId)).ballots.some(
      (row) =>
        BallotMetadataV3Schema.safeParse(JSON.parse(row.metadata)).data?.publicDisclosure === true,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Vote ' + options[1], exact: true })).toHaveCount(
    0,
  );
  expect(await page.title()).not.toContain(title);
  await unlockReturn(page, daoId);
  await page.getByRole('button', { name: 'Read private ballot', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  expect(leaked).toEqual([]);
});
test('reconciles a lost successful opening after reload without a second ballot or signature', async ({
  page,
}) => {
  test.setTimeout(150000);
  const daoId = await createPrivateDao(page),
    title = 'Hidden retry ballot ' + Date.now(),
    options = ['Hidden retry A', 'Hidden retry B', 'Hidden retry C'],
    canaries = [title, 'Hidden retry explanation', ...options],
    leaked = watchCanaries(page, canaries);
  let openings = 0,
    interrupted = false;
  await page.route('**' + ApiRoutes.relay.path, async (route) => {
    const body = ApiRoutes.relay.input.parse(route.request().postDataJSON());
    if (body.request.action === 'openpoll') {
      openings++;
      if (!interrupted) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        interrupted = true;
        await route.abort('failed');
        return;
      }
    }
    await route.continue();
  });
  const form = await ballotForm(page, title, 'Hidden retry explanation', options);
  await form.getByRole('button', { name: 'Open ballot', exact: true }).click();
  await expect.poll(() => interrupted).toBe(true);
  await expect(
    form.getByRole('button', { name: 'Finish private ballot', exact: true }),
  ).toBeEnabled();
  expect((await moduleState(page, daoId)).ballots).toHaveLength(1);
  await assertNoStoredCanary(page, canaries);
  await page.reload();
  await unlockReturn(page, daoId);
  await page.getByRole('button', { name: 'Open a ballot', exact: true }).click();
  const resumed = page.getByRole('dialog', { name: 'Open a ballot', exact: true });
  await resumed
    .getByRole('button', { name: 'Review unfinished private ballot', exact: true })
    .click();
  await expect(resumed.getByText('Ballot already opened', { exact: true })).toBeVisible();
  expect((await moduleState(page, daoId)).ballots).toHaveLength(1);
  expect(openings).toBe(1);
  expect(
    await page.evaluate(
      () =>
        Object.keys(sessionStorage).filter((key) => key.includes('daclify.private-ballot-draft.v1'))
          .length,
    ),
  ).toBe(0);
  await assertNoStoredCanary(page, canaries);
  expect(leaked).toEqual([]);
});
