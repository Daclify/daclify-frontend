import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ApiRoutes, ErrorSchema, NetworkSchema } from '@daclify/core-protocol';

// These read-only fixtures exercise presentation; they do not emulate a chain.
const network = NetworkSchema.parse({
  chainId: '11'.repeat(32),
  rpcUrl: 'http://127.0.0.1:18888',
  runtime: 'daclifycore',
  hub: null,
  environment: 'local',
  interfaceVersion: 1,
  coreVersion: '0.1.0-alpha.1',
  capabilities: [],
});
const signedOut = ErrorSchema.parse({ code: 'AUTH_REQUIRED', message: 'Sign in to continue.' });

test.beforeEach(async ({ page }) => {
  await page.route(`**${ApiRoutes.network.path}`, (route) => route.fulfill({ json: network }));
  await page.route(`**${ApiRoutes.daos.path}`, (route) =>
    route.fulfill({ json: ApiRoutes.daos.response.parse({ daos: [] }) }),
  );
  await page.route(`**${ApiRoutes.me.path}`, (route) =>
    route.fulfill({ status: 401, json: signedOut }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your DAO hub' })).toBeVisible();
  await expect(page.getByText('local network', { exact: true })).toBeAttached();
});

test('hub filter buttons remain comfortable touch targets', async ({ page }) => {
  for (const name of ['All DAOs', 'My communities']) {
    const button = page.getByRole('button', { name, exact: true });
    const box = await button.boundingBox();
    expect(box, `${name} is visible`).not.toBeNull();
    expect(box?.height, `${name} touch target`).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('button', { name: 'My communities', exact: true }).click();
  await expect(page.getByRole('button', { name: 'My communities', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('shared destructive controls retain readable contrast in every variant', async ({ page }) => {
  // Render the public shared-style variants without invoking a destructive action.
  await page.locator('#main').evaluate((main) => {
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.setAttribute('aria-label', 'Shared control contrast fixture');
    for (const [index, variant] of ['danger', 'secondary danger', 'text-button danger'].entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = variant;
      button.textContent = `Destructive control ${index + 1}`;
      panel.append(button);
    }
    main.append(panel);
  });
  const scan = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(scan.violations).toEqual([]);
  for (let index = 1; index <= 3; index++) {
    await page.getByRole('button', { name: `Destructive control ${index}`, exact: true }).hover();
    expect(
      (await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()).violations,
    ).toEqual([]);
  }
});

test('keyboard navigation and forms remain usable on desktop and mobile', async ({ page }) => {
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await page.getByLabel('Vault password', { exact: true }).fill('visual fixture not saved');
  await expect(page.getByLabel('Vault password', { exact: true })).toHaveValue(
    'visual fixture not saved',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
});

test('community cards and documentation fit a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const communities = ApiRoutes.daos.response.parse({
    daos: [
      {
        reference: {
          chainId: network.chainId,
          contract: 'daclifycore',
          daoId: '1',
          interfaceVersion: 1,
        },
        title: 'Community design fixture',
        description: 'Synthetic display data for checking responsive community cards.',
        privacy: 'encrypted-user-controlled',
        owner: 'display-fixture',
        token: { chainId: network.chainId, contract: 'eosio.token', symbol: 'SYS', precision: 4 },
        members: 20,
        available: '0',
        reserved: '0',
        claims: '0',
        keyEpoch: '1',
      },
    ],
  });
  await page.route(`**${ApiRoutes.daos.path}`, (route) => route.fulfill({ json: communities }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Community design fixture' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('link', { name: 'Documentation', exact: true }).click();
  await expect(page.locator('.docs-content')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('network errors stay readable and retry remains reachable with reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(`**${ApiRoutes.network.path}`, (route) =>
    route.fulfill({
      status: 503,
      json: ErrorSchema.parse({ code: 'CHAIN_UNAVAILABLE', message: 'Fixture node unavailable.' }),
    }),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('The blockchain node is unavailable.');
  const retry = page.getByRole('button', { name: 'Retry connection', exact: true });
  await retry.focus();
  await expect(retry).toBeFocused();
  expect(await retry.evaluate((button) => getComputedStyle(button).transitionDuration)).toBe('0s');
  await retry.hover();
  expect(await retry.evaluate((button) => getComputedStyle(button).transform)).toBe('none');
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
});
