import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ApiRoutes, ErrorSchema, NetworkSchema, VERSION } from '@daclify/core-protocol';
import { CoreHelpBundle } from '@daclify/core-protocol/help';
import { Catalog, ModuleDeploymentSchema, ModuleStateSchema } from '@daclify/modules';
import { ModuleCodeHashes } from '@daclify/modules/sdk';
import { ModulesHelpBundle } from '@daclify/modules/help';

// Canonical synthetic HTTP; no provider, contract or account is contacted.
const network = NetworkSchema.parse({
  chainId: 'ab'.repeat(32),
  rpcUrl: 'https://rpc.example',
  runtime: 'daclifycore',
  hub: null,
  environment: 'testnet',
  interfaceVersion: 1,
  coreVersion: VERSION,
  capabilities: [],
});
const unavailable = ErrorSchema.parse({
  code: 'SERVICE_UNAVAILABLE',
  message: 'Synthetic fixture unavailable.',
});
function moduleData(daoId = '1') {
  return ModuleStateSchema.parse({
    dao: { chainId: network.chainId, contract: network.runtime, interfaceVersion: 1, daoId },
    modules: Catalog.map((manifest) => ({
      manifest,
      deployment: {
        id: manifest.id,
        account: 'module',
        version: manifest.version,
        codeHash: ModuleCodeHashes[ModuleDeploymentSchema.shape.id.parse(manifest.id)],
      },
      enabled: true,
      compatible: true,
      codeVerified: true,
      actions: [],
      grants: [],
    })),
    ballots: [],
    votes: [],
    projects: [],
    milestones: [],
    schedules: [],
    entries: [],
    controls: [],
  });
}
async function fixture(page: Page) {
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === ApiRoutes.network.path) return route.fulfill({ json: network });
    if (path === ApiRoutes.daos.path) return route.fulfill({ json: { daos: [], next: null } });
    if (path === '/v1/me')
      return route.fulfill({
        status: 401,
        json: ErrorSchema.parse({ code: 'AUTH_REQUIRED', message: 'Sign in.' }),
      });
    if (/^\/v1\/daos\/\d+\/modules$/.test(path))
      return route.fulfill({ json: moduleData(path.split('/')[3]) });
    return route.fulfill({ status: 503, json: unavailable });
  });
}
const main = (page: Page) => page.locator('#main');
async function accessible(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('reading starts with the guide title and follows its group without losing DAO context', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/docs/decide?dao=1');
  await expect(
    main(page).getByRole('heading', { name: 'Weights with an explicit snapshot', level: 1 }),
  ).toBeVisible();
  const related = main(page).getByRole('navigation', { name: 'Related guides' });
  await expect(
    related.getByRole('link', { name: /Next guide.*Fund work through milestones/ }),
  ).toHaveAttribute('href', '/docs/works?dao=1');
  await related.getByRole('link', { name: /Next guide.*Fund work through milestones/ }).click();
  await expect(page).toHaveURL(/\/docs\/works\?dao=1$/);
  await expect(
    main(page).getByRole('heading', { name: 'Fund work through milestones', level: 1 }),
  ).toBeFocused();
});
test('mobile contents is folded before reading and remains keyboard accessible', async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/docs/privacy?dao=1');
  const search = main(page).locator('.handbook-tools');
  await expect(search).not.toHaveAttribute('open', '');
  await search.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(main(page).getByLabel('Search guides', { exact: true })).toBeVisible();
  await search.locator('summary').click();
  const contents = main(page).locator('.docs-sidebar');
  await expect(contents).not.toHaveAttribute('open', '');
  await contents.locator('summary').first().focus();
  await page.keyboard.press('Enter');
  await expect(contents).toHaveAttribute('open', '');
  const topics = page.getByRole('navigation', { name: 'Documentation topics' });
  await topics
    .getByRole('link', { name: 'Recover keys and blockchain access', exact: true })
    .click();
  await expect(contents).not.toHaveAttribute('open', '');
  await expect(
    main(page).getByRole('heading', { name: 'Recover keys and blockchain access', level: 1 }),
  ).toBeFocused();
  await accessible(page);
});
test('search results have previews, retain filters across back/reload and keep DAO context', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/docs?dao=1');
  await main(page).getByLabel('Search guides', { exact: true }).fill('native stake');
  const result = main(page)
    .locator('.guide-result')
    .filter({ hasText: 'Weights with an explicit snapshot' });
  await expect(result).toBeVisible();
  await expect(result.locator('p')).toContainText(
    ModulesHelpBundle.topics.find((topic) => topic.id === 'decide')?.paragraphs[0] ??
      'Missing canonical guide',
  );
  await result.click();
  await expect(
    main(page).getByRole('heading', { name: 'Weights with an explicit snapshot', level: 1 }),
  ).toBeVisible();
  await page.goBack();
  await expect(main(page).getByLabel('Search guides', { exact: true })).toHaveValue('native stake');
  await page.reload();
  await expect(result).toBeVisible();
  expect(new URL(page.url()).searchParams.get('dao')).toBe('1');
});
test('failed DAO module verification can be retried without hiding the guide', async ({ page }) => {
  await fixture(page);
  let available = false;
  await page.route('**/v1/daos/1/modules?*', (route) =>
    available
      ? route.fulfill({ json: moduleData() })
      : route.fulfill({ status: 503, json: unavailable }),
  );
  await page.goto('/docs/decide?dao=1');
  await expect(
    main(page).getByRole('heading', { name: 'Weights with an explicit snapshot' }),
  ).toBeVisible();
  const retry = main(page).getByRole('button', { name: 'Retry deployment check', exact: true });
  await expect(retry).toBeVisible();
  available = true;
  await retry.click();
  await expect(
    main(page).getByText('Module guide matches the checked code and reported package version.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(retry).toHaveCount(0);
});
test('a different DAO response is rejected rather than reporting matching modules', async ({
  page,
}) => {
  await fixture(page);
  await page.route('**/v1/daos/1/modules?*', (route) => route.fulfill({ json: moduleData('2') }));
  await page.goto('/docs/decide?dao=1');
  await expect(main(page).getByText('Deployment check unavailable', { exact: true })).toBeVisible();
  await expect(
    main(page).getByText('Module guide matches the checked code and reported package version.', {
      exact: true,
    }),
  ).toHaveCount(0);
});
for (const mismatch of ['code', 'version', 'chain', 'runtime'] as const) {
  test(`module ${mismatch} mismatch stays visible before following instructions`, async ({
    page,
  }) => {
    await fixture(page);
    const data = moduleData();
    if (mismatch === 'chain') data.dao.chainId = 'cd'.repeat(32);
    if (mismatch === 'runtime') data.dao.contract = 'othercore';
    if (mismatch === 'code')
      data.modules.forEach((module) => {
        module.deployment.codeHash = 'cd'.repeat(32);
      });
    if (mismatch === 'version')
      data.modules.forEach((module) => {
        module.deployment.version = '0.2.0';
      });
    await page.route('**/v1/daos/1/modules?*', (route) =>
      route.fulfill({ json: ModuleStateSchema.parse(data) }),
    );
    await page.goto('/docs/decide?dao=1');
    await expect(
      main(page).getByRole('alert').filter({ hasText: 'Documentation version mismatch' }),
    ).toBeVisible();
    await expect(
      main(page).getByText('Module guide matches the checked code and reported package version.', {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      main(page).getByRole('heading', { name: 'Weights with an explicit snapshot', level: 1 }),
    ).toBeVisible();
  });
}
test('late verification from an earlier DAO cannot replace the current check', async ({ page }) => {
  await fixture(page);
  let reads = 0,
    release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let completions = 0;
  await page.route('**/v1/daos/1/modules?*', async (route) => {
    reads++;
    await gate;
    const old = moduleData();
    old.modules.forEach((module) => {
      module.deployment.version = '0.2.0';
    });
    await route.fulfill({ json: old });
    completions++;
  });
  await page.goto('/docs/decide?dao=1');
  await expect.poll(() => reads).toBeGreaterThan(0);
  // Synthetic browser history navigation preserves the mounted Docs instance.
  await page.evaluate(() => {
    history.pushState(history.state, '', '/docs/decide?dao=2');
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  });
  await expect(main(page).getByText('DAO 2', { exact: true })).toBeVisible();
  await expect(
    main(page).getByText('Module guide matches the checked code and reported package version.', {
      exact: true,
    }),
  ).toBeVisible();
  release();
  await expect.poll(() => completions).toBeGreaterThan(0);
  await expect(main(page).getByText('Documentation version mismatch', { exact: true })).toHaveCount(
    0,
  );
});
test('invalid DAO links never request module data and unknown guides recover through the handbook', async ({
  page,
}) => {
  await fixture(page);
  let reads = 0;
  await page.route('**/v1/daos/*/modules?*', (route) => {
    reads++;
    return route.fulfill({ json: moduleData() });
  });
  await page.goto('/docs/decide?dao=not-a-dao');
  await expect(
    main(page).getByText('The DAO reference in this help link is invalid.', { exact: true }),
  ).toBeVisible();
  await expect(
    main(page).getByRole('button', { name: 'Retry deployment check', exact: true }),
  ).toHaveCount(0);
  expect(reads).toBe(0);
  await page.goto('/docs/unknown-guide?dao=1');
  await expect(
    main(page).getByRole('heading', { name: 'Guide unavailable', level: 1 }),
  ).toBeVisible();
  await main(page).getByRole('link', { name: 'Browse available guides', exact: true }).click();
  await expect(page).toHaveURL(/\/docs\?dao=1$/);
});
test('filters, literal search text and reset preserve route context and browser history', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/docs?dao=1&collection=modules&q=all#context');
  await expect(main(page).getByLabel('Search guides', { exact: true })).toHaveValue('all');
  await expect(main(page).getByLabel('Guide collection', { exact: true })).toHaveValue('modules');
  await main(page)
    .getByLabel('Search guides', { exact: true })
    .fill('<img src=x onerror=alert(1)>');
  await expect(
    main(page).getByRole('heading', { name: 'No matching guides', exact: true }),
  ).toBeVisible();
  await expect(main(page).locator('img')).toHaveCount(0);
  await main(page)
    .locator('.handbook-empty')
    .getByRole('button', { name: 'Reset search and filters', exact: true })
    .click();
  await expect(main(page).getByLabel('Search guides', { exact: true })).toBeFocused();
  await expect(main(page).getByLabel('Guide collection', { exact: true })).toHaveValue('all');
  await expect(page).toHaveURL(/\/docs\?dao=1#context$/);
  await expect(
    main(page).getByRole('navigation', { name: 'Documentation topics', exact: true }),
  ).toHaveCount(0);
});
test('guide prose stays producer-owned and technical references load only on demand', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/docs/accounts');
  const accounts = CoreHelpBundle.topics.find((topic) => topic.id === 'accounts');
  if (!accounts) throw new Error('Canonical accounts guide missing');
  await expect(main(page).locator('.guide-body > p')).toHaveText(accounts.paragraphs);
  await expect(main(page).locator('table')).toHaveCount(0);
  await main(page).getByText('Developer and operator references', { exact: true }).click();
  await expect.poll(() => main(page).locator('table').count()).toBeGreaterThan(0);
  await main(page)
    .getByRole('navigation', { name: 'Related guides' })
    .getByRole('link', { name: /Next guide/ })
    .click();
  await expect(main(page).locator('table')).toHaveCount(0);
  await accessible(page);
});
test('handbook and reading fit phone, tablet, landscape and enlarged text', async ({ page }) => {
  test.setTimeout(60000);
  await fixture(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [width, height] of [
    [1440, 1100],
    [375, 812],
    [768, 1024],
    [812, 375],
    [320, 812],
  ]) {
    if (!width || !height) throw new Error('Invalid fixture viewport');
    await page.setViewportSize({ width, height });
    for (const path of ['/docs', '/docs/decide?dao=1']) {
      await page.goto(path);
      await expect(main(page).getByRole('heading', { level: 1 })).toBeVisible();
      await accessible(page);
      await page.screenshot({
        path: test.info().outputPath(`${path === '/docs' ? 'handbook' : 'reading'}-${width}.png`),
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/docs/decide?dao=1');
  await expect(
    main(page).getByRole('heading', { name: 'Weights with an explicit snapshot', level: 1 }),
  ).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  const article = await main(page).locator('.docs-content').boundingBox();
  expect(article?.width).toBeGreaterThan(800);
  await accessible(page);
  await page.screenshot({
    path: test.info().outputPath('reading-enlarged-text.png'),
    fullPage: true,
  });
});
test('core guides do not show unrelated module lookup failures', async ({ page }) => {
  await fixture(page);
  let moduleReads = 0;
  await page.route('**/v1/daos/1/modules?*', (route) => {
    moduleReads++;
    return route.fulfill({ status: 503, json: unavailable });
  });
  await page.goto('/docs/accounts?dao=1');
  await expect(
    main(page).getByRole('heading', { name: 'Two clearly labelled account modes', level: 1 }),
  ).toBeVisible();
  await expect(
    main(page).getByText(/Guide version matches the service’s reported version/),
  ).toBeVisible();
  await expect(main(page).getByText('Deployment check unavailable', { exact: true })).toHaveCount(
    0,
  );
  expect(moduleReads).toBe(0);
});
test('a different DAO interface cannot supply matching documentation', async ({ page }) => {
  await fixture(page);
  const data = moduleData();
  await page.route('**/v1/daos/1/modules?*', (route) =>
    // Deliberately invalid HTTP, to exercise the producer schema at the client boundary.
    route.fulfill({ json: { ...data, dao: { ...data.dao, interfaceVersion: 2 } } }),
  );
  await page.goto('/docs/decide?dao=1');
  await expect(main(page).getByText('Deployment check unavailable', { exact: true })).toBeVisible();
  await expect(
    main(page).getByText('Module guide matches the checked code and reported package version.', {
      exact: true,
    }),
  ).toHaveCount(0);
});
