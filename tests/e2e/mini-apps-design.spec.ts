import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  ApiRoutes,
  ErrorSchema,
  NetworkSchema,
  PlatformStatusSchema,
} from '@daclify/core-protocol';

// Presentation fixtures exercise the real page; they do not establish chain or provider behavior.
const network = NetworkSchema.parse({
  chainId: '11'.repeat(32),
  rpcUrl: 'http://127.0.0.1:18888',
  runtime: 'daclifycore',
  hub: null,
  environment: 'local',
  interfaceVersion: 1,
  coreVersion: '0.1.0-alpha.1',
  capabilities: ['mini-app-directory-v1'],
});

async function openListingEditor(page: Page) {
  await page.getByText('Manage listings', { exact: true }).click();
  await page.getByRole('button', { name: 'List an app', exact: true }).click();
}
const listings = ApiRoutes.miniAppDirectory.response.parse({
  listings: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      origin: 'https://garden.example',
      title: 'Community garden',
      description: 'Plan shared tasks with your community.',
      releases: [],
      status: 'published',
      created: '2026-10-01T00:00:00Z',
      updated: '2026-10-01T00:00:00Z',
      expires: '2026-12-01T00:00:00Z',
    },
  ],
  next: null,
  publicationAvailable: true,
});
test.beforeEach(async ({ page }) => {
  await page.route('**/v1/**', (route) =>
    route.fulfill({
      status: 503,
      json: ErrorSchema.parse({ code: 'SERVICE_UNAVAILABLE', message: 'Fixture unavailable.' }),
    }),
  );
  await page.route(`**${ApiRoutes.network.path}`, (route) => route.fulfill({ json: network }));
  await page.route(`**${ApiRoutes.daos.path}`, (route) => route.fulfill({ json: { daos: [] } }));
  await page.route('**/v1/sign-in/session', (route) =>
    route.fulfill({
      json: ApiRoutes.me.response.parse({
        account: {
          id: '22222222-2222-4222-8222-222222222222',
          custody: 'user-controlled',
          signingKey: null,
          encryptionKey: null,
        },
      }),
    }),
  );
  await page.route(`**${ApiRoutes.memberships.path}`, (route) =>
    route.fulfill({ json: { memberships: [] } }),
  );
  await page.route(`**${ApiRoutes.miniAppDirectory.path}*`, (route) =>
    route.fulfill({ json: listings }),
  );
});

test('browse leads with apps and reveals maintenance only when requested', async ({ page }) => {
  await page.goto('/mini-apps');
  const directory = page.getByRole('region', { name: 'Community app directory' });
  await expect(directory.getByRole('heading', { name: 'Community garden' })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Maintain app listing' })).toBeHidden();
  await expect(page.getByRole('form', { name: 'Report app listing' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'List an app', exact: true })).toBeHidden();
  await expect(page.getByLabel('Choose a DAO', { exact: true })).toBeHidden();
  await page.screenshot({
    path: '.artifacts/browser/mini-apps-design/browse-' + test.info().project.name + '.png',
    fullPage: true,
  });
  await openListingEditor(page);
  const form = directory.getByRole('form', { name: 'Maintain app listing' });
  await form.getByLabel('App title', { exact: true }).fill('Unsaved garden');
  await page.locator('#connect > summary').click();
  await expect(page.getByLabel('Choose a DAO', { exact: true })).toBeVisible();
  await expect(directory.getByRole('heading', { name: 'Community garden' })).toBeVisible();
  await page.locator('#connect > summary').click();
  await expect(page.getByLabel('Choose a DAO', { exact: true })).toBeHidden();
  await expect(form.getByLabel('App title', { exact: true })).toHaveValue('Unsaved garden');
});

test('old deep links select their workflow and stay keyboard accessible', async ({ page }) => {
  await page.goto('/mini-apps#connect');
  await expect(page.getByLabel('Choose a DAO', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Community garden' })).toBeVisible();
  const ai = page.locator('#ai-connections > summary');
  await ai.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('MCP connection setup is being qualified for this deployment.'),
  ).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('MCP connection setup is being qualified for this deployment.'),
  ).toBeHidden();
  await page.goto('/mini-apps#ai-connections');
  await expect(
    page.getByText('MCP connection setup is being qualified for this deployment.'),
  ).toBeVisible();
  await expect(page.getByLabel('Choose a DAO', { exact: true })).toBeHidden();
  await page.goto('/mini-apps#learn');
  await expect(page.getByText('Register the app', { exact: true })).toBeVisible();
});

test('failed directory load offers a retry and a real empty state', async ({ page }) => {
  await page.route(`**${ApiRoutes.miniAppDirectory.path}*`, (route) =>
    route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE', message: 'Unavailable.' } }),
  );
  await page.goto('/mini-apps#discover');
  const directory = page.getByRole('region', { name: 'Community app directory' });
  await expect(directory.getByRole('alert')).toBeVisible();
  await expect(directory.getByText('No apps listed yet.', { exact: true })).toBeHidden();
  await page.route(`**${ApiRoutes.miniAppDirectory.path}*`, (route) =>
    route.fulfill({ json: { ...listings, listings: [] } }),
  );
  await directory.getByRole('button', { name: 'Retry directory', exact: true }).click();
  await expect(directory.getByRole('alert')).toBeHidden();
  await expect(directory.getByText('No apps listed yet.', { exact: true })).toBeVisible();
});

test('reports are contextual and listing text cannot inject markup', async ({ page }) => {
  const title = '<img src=x onerror=alert(1)>';
  await page.route(`**${ApiRoutes.miniAppDirectory.path}*`, (route) =>
    route.fulfill({ json: { ...listings, listings: [{ ...listings.listings[0], title }] } }),
  );
  await page.goto('/mini-apps');
  const directory = page.getByRole('region', { name: 'Community app directory' });
  await expect(directory.getByRole('heading', { name: title, exact: true })).toBeVisible();
  expect(await directory.locator('img').count()).toBe(0);
  await expect(directory.getByRole('button', { name: 'Report this listing' })).toBeHidden();
  await directory.getByText('App details', { exact: true }).click();
  await directory.getByRole('button', { name: 'Report this listing' }).click();
  await expect(directory.getByRole('form', { name: 'Report app listing' })).toBeVisible();
  await expect(
    directory.getByRole('heading', { name: 'Report a listing', exact: true }),
  ).toBeFocused();
  await expect(directory.getByLabel('Reported listing ID')).toHaveValue(
    '11111111-1111-4111-8111-111111111111',
  );
});

test('page and open editor fit narrow screens and pass accessibility checks', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/mini-apps');
  await openListingEditor(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: '.artifacts/browser/mini-apps-design/editor-' + test.info().project.name + '.png',
    fullPage: true,
  });
});

test('changing an existing listing clears its old origin proof', async ({ page }) => {
  await page.route(`**${ApiRoutes.miniAppListingSubmit.path}`, (route) =>
    route.fulfill({ json: { ...listings.listings[0], status: 'unverified' } }),
  );
  await page.route(`**${ApiRoutes.miniAppListingVerify.path}`, (route) =>
    route.fulfill({
      json: {
        state: 'challenge',
        proof: {
          version: 1,
          listingId: '11111111-1111-4111-8111-111111111111',
          accountId: '22222222-2222-4222-8222-222222222222',
          origin: 'https://garden.example',
          challenge: 'aa'.repeat(32),
          expires: '2026-12-01T00:00:00Z',
        },
        proofUrl: 'https://garden.example/.well-known/daclify.json',
      },
    }),
  );
  await page.goto('/mini-apps');
  await openListingEditor(page);
  const form = page.getByRole('form', { name: 'Maintain app listing' });
  await form.getByLabel('App title', { exact: true }).fill('Garden');
  await form.getByLabel('App description', { exact: true }).fill('Community garden');
  await form.getByLabel('App HTTPS origin', { exact: true }).fill('https://garden.example');
  await form.getByRole('button', { name: 'Save listing', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Listing saved');
  await form.getByRole('button', { name: 'Request origin verification' }).click();
  await expect(form.locator('pre')).toBeVisible();
  await form.getByText('Existing listing, transfer or withdrawal', { exact: true }).click();
  await form
    .getByLabel('Listing ID (existing entry or transfer)')
    .fill('33333333-3333-4333-8333-333333333333');
  await expect(form.locator('pre')).toBeHidden();
});

test('pending directory reads show loading and prevent duplicate pagination', async ({ page }) => {
  let finish = () => {};
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route(`**${ApiRoutes.miniAppDirectory.path}*`, async (route) => {
    await pending;
    await route.fulfill({ json: listings });
  });
  await page.goto('/mini-apps');
  const directory = page.getByRole('region', { name: 'Community app directory' });
  await expect(directory.getByRole('status')).toHaveText('Loading apps…');
  await directory.getByText('Manage listings', { exact: true }).click();
  await expect(directory.getByRole('button', { name: 'Refresh directory' })).toBeDisabled();
  await expect(directory.getByText('No apps listed yet.', { exact: true })).toBeHidden();
  finish();
  await expect(directory.getByRole('heading', { name: 'Community garden' })).toBeVisible();
  await expect(directory.getByRole('button', { name: 'Refresh directory' })).toBeEnabled();
});

test('switching a moderated listing clears the previous listing reports', async ({ page }) => {
  const dao = {
    chainId: network.chainId,
    contract: network.runtime,
    daoId: '1',
    interfaceVersion: 1,
  };
  await page.route(`**${ApiRoutes.memberships.path}`, (route) =>
    route.fulfill({
      json: {
        memberships: [
          {
            dao,
            memberId: '1',
            nonce: '0',
            active: true,
            admin: true,
            reviewer: false,
            credits: '0',
            claim: '0',
            stake: '0',
            nativeAccount: 'alice',
            custody: 'user-controlled',
          },
        ],
      },
    }),
  );
  await page.route('**/v1/platform/status', (route) =>
    route.fulfill({
      json: PlatformStatusSchema.parse({
        checkedAt: '2026-10-13T00:00:00Z',
        apiVersion: '0.1.0',
        moduleVersion: '0.1.0',
        chain: {
          network,
          chainId: network.chainId,
          chainMatches: true,
          headBlock: 1,
          irreversibleBlock: 1,
          headTime: '2026-10-13T00:00:00Z',
          contracts: [],
          catalogue: [],
          fees: null,
          market: null,
          creation: null,
          runtimeSettings: null,
          rateFresh: false,
          platformDao: dao,
          sharedAvailable: false,
          independentAvailable: false,
        },
        rpc: 'reachable',
        database: { state: 'reachable', migrations: [] },
        services: [],
        limits: {
          sponsoredWritesPerAccount: 1,
          sponsoredWritesGlobal: 1,
          windowMs: 1,
          uploadBytes: 0,
        },
        defaults: { sharedUsdCents: 0, independentUsdCents: 5000, tlosPremiumBps: 2000 },
      }),
    }),
  );
  await page.route(`**${ApiRoutes.miniAppDirectory.path}*`, (route) =>
    route.fulfill({
      json: {
        ...listings,
        listings: [
          ...listings.listings,
          {
            ...listings.listings[0],
            id: '33333333-3333-4333-8333-333333333333',
            title: 'Another app',
          },
        ],
      },
    }),
  );
  await page.route(`**${ApiRoutes.miniAppListingReports.path}?*`, (route) =>
    route.fulfill({
      json: {
        reports: [
          {
            reason: 'Garden report only',
            created: '2026-10-01T00:00:00Z',
            expires: '2026-12-01T00:00:00Z',
          },
        ],
        next: null,
      },
    }),
  );
  await page.goto('/mini-apps');
  const directory = page.getByRole('region', { name: 'Community app directory' });
  const moderation = directory.getByRole('region', { name: 'Directory moderation' });
  await directory.getByText('App details', { exact: true }).first().click();
  await directory.getByText('App details', { exact: true }).nth(1).click();
  await directory
    .locator('summary')
    .filter({ hasText: /^Directory moderation$/ })
    .click();
  await directory.getByRole('button', { name: 'Report this listing' }).first().click();
  await moderation.getByRole('button', { name: 'Review reports', exact: true }).click();
  await expect(moderation).toContainText('Garden report only');
  await directory.getByRole('button', { name: 'Report this listing' }).nth(1).click();
  await expect(moderation).not.toContainText('Garden report only');
});
