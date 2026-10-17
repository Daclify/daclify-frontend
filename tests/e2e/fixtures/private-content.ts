import { expect, type Page, type Locator } from '@playwright/test';
import { ApiRoutes } from '@daclify/core-protocol';
import { ModuleApiRoutes } from '@daclify/modules';
const password = 'owned private ballot browser fixture';
export async function createPrivateDao(page: Page) {
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
export function watchCanaries(page: Page, canaries: string[]) {
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
export async function ballotForm(
  page: Page,
  title: string,
  description: string,
  options: string[],
) {
  await page.getByRole('button', { name: 'Open a ballot', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Open a ballot', exact: true });
  await form.getByLabel('Private ballot title', { exact: true }).fill(title);
  await form.getByLabel('Private explanation', { exact: true }).fill(description);
  await form.getByLabel('Ballot type', { exact: true }).selectOption('poll');
  for (let i = 0; i < options.length; i++)
    await form.getByLabel(`Choice ${i + 1}`, { exact: true }).fill(options[i] ?? '');
  return form;
}
export async function moduleState(page: Page, daoId: string) {
  return ModuleApiRoutes.state.response.parse(
    await (await page.request.get(ModuleApiRoutes.state.path.replace(':id', daoId))).json(),
  );
}
export async function unlockReturn(page: Page, daoId: string) {
  await page.getByRole('link', { name: 'Unlock account to read', exact: true }).first().click();
  await page.getByLabel('Password for this device', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await expect(page.getByText('Vault unlocked', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/dao/${daoId}/decide$`));
}
export async function assertNoStoredCanary(page: Page, canaries: string[]) {
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
export async function submit(form: Locator) {
  await form.getByRole('button', { name: 'Open ballot', exact: true }).click();
  await expect(form).not.toBeVisible({ timeout: 45000 });
}
