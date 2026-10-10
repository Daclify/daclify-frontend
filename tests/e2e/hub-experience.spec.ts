import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import {
  AccountSchema,
  ApiRoutes,
  DaoSummarySchema,
  DirectoryEntrySchema,
  ErrorSchema,
  NetworkSchema,
  UserMembershipSchema,
  VERSION,
  type DaoSummary,
  type DirectoryEntry,
  type UserMembership,
} from '@daclify/core-protocol';

// Canonical synthetic HTTP fixtures: no chain, sign-in provider or operator is contacted.
const network = NetworkSchema.parse({
  chainId: 'ab'.repeat(32),
  rpcUrl: 'https://rpc.example',
  runtime: 'daclifycore',
  hub: 'daclifyhub',
  environment: 'testnet',
  interfaceVersion: 1,
  coreVersion: VERSION,
  capabilities: [],
});
const account = AccountSchema.parse({
  id: '11111111-1111-4111-8111-111111111111',
  custody: 'user-controlled',
  signingKey: null,
  encryptionKey: null,
});
const daos = [
  {
    title: 'Ocean Commons',
    purpose: 'community',
    members: 1,
    privacy: 'public',
    description: 'Restore our coastline through shared decisions and local action.',
  },
  {
    title: 'Builders Guild',
    purpose: 'team',
    members: 24,
    privacy: 'encrypted-user-controlled',
    description: 'A cooperative for people building useful open-source tools.',
  },
  {
    title: 'Garden Network',
    purpose: 'ngo-grants',
    members: 8,
    privacy: 'public',
    description: 'Support neighbourhood gardens with community-led grants.',
  },
].map((identity, index) =>
  DaoSummarySchema.parse({
    ...identity,
    reference: {
      chainId: network.chainId,
      contract: network.runtime,
      daoId: String(index + 1),
      interfaceVersion: 1,
    },
    owner: 'alice',
    token: { chainId: network.chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
    available: '0',
    reserved: '0',
    claims: '0',
    keyEpoch: '1',
  }),
);
const entries = [
  {
    title: 'Independent Ocean Lab',
    purpose: 'community',
    portal: { mode: 'daclify', apiOrigin: 'https://operator.example' },
  },
  {
    title: 'Guild Portal',
    purpose: 'gaming-guild',
    portal: { mode: 'external', url: 'https://guild.example/dao' },
  },
].map((identity, index) =>
  DirectoryEntrySchema.parse({
    ...identity,
    reference: {
      chainId: network.chainId,
      contract: 'othercore',
      daoId: String(index + 4),
      interfaceVersion: 1,
    },
    description: 'An independently operated community connected through the Hub.',
    privacy: 'public',
    operator: 'Independent team',
    codeHash: 'cd'.repeat(32),
    abiHash: 'ef'.repeat(32),
    source: 'hub-registry',
    verification: 'owner-registered',
  }),
);
const unavailable = ErrorSchema.parse({
  code: 'SERVICE_UNAVAILABLE',
  message: 'Fixture unavailable.',
});
async function fixture(
  page: Page,
  options: {
    daos?: DaoSummary[];
    entries?: DirectoryEntry[];
    signedIn?: boolean;
    memberships?: UserMembership[];
  } = {},
) {
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === ApiRoutes.network.path) return route.fulfill({ json: network });
    if (path === ApiRoutes.daos.path)
      return route.fulfill({ json: { daos: options.daos ?? daos } });
    if (path === '/v1/hub/directory')
      return route.fulfill({
        json: { entries: options.entries ?? entries, next: null, skipped: 0 },
      });
    if (path === ApiRoutes.me.path)
      return options.signedIn
        ? route.fulfill({ json: { account } })
        : route.fulfill({
            status: 401,
            json: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' },
          });
    if (path === '/v1/me/memberships')
      return route.fulfill({ json: { memberships: options.memberships ?? [] } });
    return route.fulfill({ status: 503, json: unavailable });
  });
}
const main = (page: Page) => page.locator('#main');

async function accessible(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('counts and filters both directory sources without an empty local section hiding independent DAOs', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/hub#communities');
  await expect(main(page).getByRole('status').filter({ hasText: /of/ })).toHaveText(
    'Showing 5 of 5 communities',
    { timeout: 1500 },
  );
  await page.getByRole('searchbox', { name: 'Search DAOs' }).fill(' ocean ');
  await expect(page).toHaveURL(/q=.*ocean.*#communities$/);
  await expect(
    main(page).getByRole('heading', { name: 'Ocean Commons', exact: true }),
  ).toBeVisible();
  await expect(
    main(page).getByRole('heading', { name: 'Independent Ocean Lab', exact: true }),
  ).toBeVisible();
  await expect(main(page).getByRole('status').filter({ hasText: /of/ })).toHaveText(
    'Showing 2 of 5 communities',
  );
  await page.getByLabel('DAO purpose filter').selectOption('gaming-guild');
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search DAOs' })).toBeFocused();
  await expect(
    main(page).getByRole('heading', { name: 'Guild Portal', exact: true }),
  ).toBeVisible();
  await expect(
    main(page).getByRole('heading', { name: 'No matching communities', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page).toHaveURL(/\/hub#communities$/);
  await expect(main(page).getByRole('status').filter({ hasText: /of/ })).toHaveText(
    'Showing 5 of 5 communities',
  );
  await page.getByLabel('Sort DAOs').selectOption('members');
  await expect(main(page).locator('.dao-card').first()).toContainText('Builders Guild');
  await accessible(page);
});

test('offers a scoped retry after a partial directory failure and keeps loaded DAOs usable', async ({
  page,
}) => {
  await fixture(page);
  let failed = true,
    attempts = 0;
  await page.route('**/v1/hub/directory', (route) => {
    attempts++;
    return failed
      ? route.fulfill({ status: 503, json: unavailable })
      : route.fulfill({ json: { entries, next: null, skipped: 0 } });
  });
  await page.goto('/hub');
  await expect(
    main(page).getByRole('heading', { name: 'Ocean Commons', exact: true }),
  ).toBeVisible();
  const retry = main(page).getByRole('button', { name: 'Retry listings', exact: true });
  await expect(retry).toBeVisible({ timeout: 1500 });
  await retry.focus();
  await expect(retry).toBeFocused();
  const previous = attempts;
  failed = false;
  await page.keyboard.press('Enter');
  await expect(
    main(page).getByRole('heading', { name: 'Independent Ocean Lab', exact: true }),
  ).toBeVisible();
  expect(attempts).toBe(previous + 1);
  await expect(retry).toHaveCount(0);
  await expect(
    main(page).getByRole('heading', { name: 'Explore communities', exact: true }),
  ).toBeFocused();
  await expect(main(page).getByRole('status').filter({ hasText: /of/ })).toHaveText(
    'Showing 5 of 5 communities',
  );
  await accessible(page);
});

test('signed-out My communities explains sign-in and preserves the return destination', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/hub?mine=1');
  await expect(
    main(page).getByRole('heading', { name: 'Sign in to see your communities', exact: true }),
  ).toBeVisible({ timeout: 1500 });
  const login = main(page).getByRole('link', { name: 'Sign in', exact: true });
  const destination = await login.getAttribute('href');
  if (!destination) throw new Error('Missing sign-in destination');
  expect(new URL(destination, page.url()).pathname).toBe('/account');
  expect(new URL(destination, page.url()).searchParams.get('returnTo')).toBe('/hub?mine=1');
  await expect(
    main(page).getByRole('heading', { name: 'No matching communities', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'All DAOs', exact: true }).click();
  await expect(
    main(page).getByRole('heading', { name: 'Ocean Commons', exact: true }),
  ).toBeVisible();
  await accessible(page);
});

test('My communities includes only current complete-reference memberships', async ({ page }) => {
  const first = daos[0],
    other = daos[1];
  if (!first || !other) throw new Error('Missing fixture DAO');
  const membership = UserMembershipSchema.parse({
    dao: first.reference,
    memberId: '1',
    nonce: '0',
    active: true,
    admin: false,
    reviewer: false,
    credits: '0',
    claim: '0',
    stake: '0',
    nativeAccount: '',
    custody: 'user-controlled',
  });
  await fixture(page, {
    signedIn: true,
    memberships: [
      membership,
      UserMembershipSchema.parse({ ...membership, active: false, dao: other.reference }),
      UserMembershipSchema.parse({
        ...membership,
        dao: { ...other.reference, contract: 'othercore' },
      }),
    ],
  });
  await page.goto('/hub?mine=1');
  await expect(main(page).locator('.dao-card')).toHaveCount(1);
  await expect(
    main(page).getByRole('link', { name: 'Open Ocean Commons', exact: true }),
  ).toHaveAttribute('href', '/dao/1');
  await expect(main(page).getByText('1 member', { exact: true })).toBeVisible();
  await expect(main(page).getByText('Member', { exact: true })).toBeVisible();
  await accessible(page);
});

test('independent cards disclose their destination and require review before connecting', async ({
  page,
}) => {
  await fixture(page);
  const operatorRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://operator.example')) operatorRequests.push(request.url());
  });
  await page.goto('/hub');
  const portal = main(page).getByRole('link', { name: /Open Guild Portal/ });
  await expect(portal).toHaveAttribute('href', 'https://guild.example/dao');
  await expect(portal).toHaveAttribute('target', '_blank');
  await expect(portal).toHaveAttribute('rel', 'noopener noreferrer');
  await main(page)
    .getByRole('button', {
      name: 'Review operator connection for Independent Ocean Lab',
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('https://operator.example');
  await expect(dialog).toContainText('service accounts');
  await expect(
    dialog.getByRole('heading', { name: 'Connect to Independent Ocean Lab', exact: true }),
  ).toBeFocused();
  await accessible(page);
  await page.screenshot({
    path: test.info().outputPath('hub-operator-review.png'),
  });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(operatorRequests).toEqual([]);
});

test('failed operator verification stays in the review dialog without corrupting listing state', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/hub');
  await main(page)
    .getByRole('button', {
      name: 'Review operator connection for Independent Ocean Lab',
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Verify and connect', exact: true }).click();
  // Synthetic hashes deliberately mismatch the pinned runtime; the real verifier rejects before a remote call.
  await expect(dialog.getByRole('alert')).toHaveText(
    'This operator does not match the registered DAO and the app’s reviewed release.',
  );
  await expect(page).toHaveURL(/\/hub$/);
  await expect(
    dialog.getByRole('button', { name: 'Verify and connect', exact: true }),
  ).toBeEnabled();
  await expect(main(page).getByRole('button', { name: 'Retry listings', exact: true })).toHaveCount(
    0,
  );
  await accessible(page);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(main(page).getByRole('status').filter({ hasText: /of/ })).toHaveText(
    'Showing 5 of 5 communities',
  );
});

test('keeps verified cover imagery and recovers from undecodable or unavailable branding', async ({
  page,
}) => {
  const original = daos[0];
  if (!original) throw new Error('Missing fixture DAO');
  const content = readFileSync('public/icons/icon-192.png');
  const image = {
    cid: 'bafkreigh2akiscaildc46y7w5q5b5lzd2nmf34jshfeh7g7qy6uxy5yzlm',
    bytes: content.length,
    mediaType: 'image/png',
    commitment: 'ab'.repeat(32),
  };
  const branded = DaoSummarySchema.parse({ ...original, branding: { logo: image, cover: image } });
  await fixture(page, { daos: [branded], entries: [] });
  await page.route('**/v1/daos/1/branding/*', (route) =>
    route.fulfill({
      json: ApiRoutes.branding.response.parse({
        content: route.request().url().endsWith('/cover')
          ? content.toString('base64')
          : Buffer.from('not an image').toString('base64'),
        mediaType: 'image/png',
      }),
    }),
  );
  await page.goto('/hub');
  const card = main(page).getByRole('link', { name: 'View Ocean Commons', exact: true });
  await expect(card.locator('.dao-cover img')).toBeVisible();
  await expect
    .poll(() =>
      card.locator('.dao-cover img').evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(192);
  await expect(card.locator('.dao-avatar')).toHaveText('OC');
  await expect(card.locator('.dao-avatar img')).toHaveCount(0);
  await expect(card).toHaveAttribute('href', '/dao/1');
  await accessible(page);
  await page.route('**/v1/daos/1/branding/*', (route) =>
    route.fulfill({ status: 503, json: unavailable }),
  );
  await page.reload();
  await expect(card.locator('.cover-symbol')).toBeVisible();
  await expect(card.locator('img')).toHaveCount(0);
  await expect(card.getByRole('heading', { name: original.title })).toBeVisible();
  await accessible(page);
});

test('deduplicates runtime registrations by the whole DAO reference', async ({ page }) => {
  const native = daos[0],
    entry = entries[0];
  if (!native || !entry) throw new Error('Missing fixture DAO');
  await fixture(page, {
    entries: [
      DirectoryEntrySchema.parse({
        ...entry,
        reference: native.reference,
        title: 'Duplicate Ocean',
      }),
      DirectoryEntrySchema.parse({
        ...entry,
        reference: { ...native.reference, contract: 'othercore' },
      }),
    ],
  });
  await page.goto('/hub');
  await expect(main(page).getByRole('status').filter({ hasText: /of/ })).toHaveText(
    'Showing 4 of 4 communities',
  );
  await expect(
    main(page).getByRole('heading', { name: 'Duplicate Ocean', exact: true }),
  ).toHaveCount(0);
  await expect(main(page).getByRole('heading', { name: entry.title, exact: true })).toBeVisible();
});

test('distinguishes an empty Hub, unmatched filters and a signed-in account without memberships', async ({
  page,
}) => {
  await fixture(page, { daos: [], entries: [] });
  await page.goto('/hub');
  await expect(
    main(page).getByRole('heading', { name: 'A place for your next community', exact: true }),
  ).toBeVisible();
  await expect(
    main(page).getByRole('link', { name: 'Create your first DAO', exact: true }),
  ).toHaveAttribute('href', '/create');
  await accessible(page);
  await page.screenshot({ path: test.info().outputPath('hub-empty.png'), fullPage: true });
  await fixture(page, { signedIn: true });
  await page.goto('/hub?mine=1');
  await expect(
    main(page).getByRole('heading', { name: 'Your next community is out there', exact: true }),
  ).toBeVisible();
  await main(page).getByRole('button', { name: 'Browse all DAOs', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search DAOs' }).fill('no-such-community');
  await expect(
    main(page).getByRole('heading', { name: 'No matching communities', exact: true }),
  ).toBeVisible();
  await main(page).getByRole('button', { name: 'Reset search and filters', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search DAOs' })).toBeFocused();
  await expect(main(page).getByRole('status').filter({ hasText: /of/ })).toHaveText(
    'Showing 5 of 5 communities',
  );
  await accessible(page);
});

test('loading and connection failure never claim the directory is empty', async ({ page }) => {
  await fixture(page, { daos: [], entries: [] });
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/v1/daos', async (route) => {
    await pending;
    await route.fulfill({ status: 503, json: unavailable });
  });
  await page.goto('/hub');
  await expect(main(page).getByText('Loading communities…', { exact: true })).toBeVisible();
  await expect(
    main(page).getByRole('heading', { name: 'A place for your next community', exact: true }),
  ).toHaveCount(0);
  if (!release) throw new Error('Missing fixture completion');
  release();
  await expect(
    main(page).getByRole('button', { name: 'Retry connection', exact: true }),
  ).toBeVisible();
  await expect(
    main(page).getByRole('heading', { name: 'A place for your next community', exact: true }),
  ).toHaveCount(0);
  await accessible(page);
});

for (const viewport of [
  { width: 1440, height: 1100 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 812, height: 375 },
]) {
  test(`readable community browser at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await fixture(page);
    await page.goto('/hub');
    await expect(
      main(page).getByRole('heading', { name: 'Ocean Commons', exact: true }),
    ).toBeVisible();
    for (const name of ['All DAOs', 'My communities']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    const search = page.getByRole('searchbox', { name: 'Search DAOs' });
    await search.focus();
    await expect(search).toBeFocused();
    const skip = await page
      .getByRole('link', { name: 'Skip to content', exact: true })
      .boundingBox();
    expect(skip).not.toBeNull();
    expect(skip && skip.y + skip.height).toBeLessThanOrEqual(0);
    // Capture from the top so offscreen fixed controls are not painted into a full-page image.
    await page.evaluate(() => window.scrollTo(0, 0));
    await accessible(page);
    await search.focus();
    await expect(search).toBeFocused();
    await page.screenshot({
      path: test.info().outputPath(`hub-${viewport.width}.png`),
      fullPage: true,
    });
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    await accessible(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: test.info().outputPath(`hub-${viewport.width}-large-text.png`),
      fullPage: true,
    });
  });
}
