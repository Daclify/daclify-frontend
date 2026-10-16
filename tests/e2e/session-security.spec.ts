import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  AccountSchema,
  ApiRoutes,
  VERSION,
  type Account,
  type VaultSecrets,
} from '@daclify/core-protocol';
import { PrivateKey, Signature, PublicKey } from '@wharfkit/antelope';
import { makeInstruction, encodeAction, instructionDigest } from '@daclify/core-protocol/sdk';
import { generateVaultSecrets } from '../../src/auth/vault';

async function fixture(context: BrowserContext, remainingMs = 43_200_000) {
  const keys = await generateVaultSecrets();
  const account = AccountSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    custody: 'user-controlled',
    signingKey: PrivateKey.from(keys.signingKey).toPublic().toString(),
    encryptionKey: {
      kty: 'EC',
      crv: 'P-256',
      x: keys.encryptionPrivateKey.x,
      y: keys.encryptionPrivateKey.y,
    },
  });
  let signedOut = false;
  await context.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === ApiRoutes.network.path)
      return route.fulfill({
        json: {
          chainId: 'ab'.repeat(32),
          rpcUrl: 'https://rpc.example',
          runtime: 'daclifycore',
          hub: null,
          environment: 'testnet',
          interfaceVersion: 1,
          coreVersion: VERSION,
          capabilities: [],
        },
      });
    if (path === '/v1/daos') return route.fulfill({ json: { daos: [], next: null } });
    if (path === '/v1/sign-in/session')
      return signedOut
        ? route.fulfill({ status: 204 })
        : route.fulfill({
            json: { account },
            headers: {
              'x-daclify-session-ms': String(remainingMs),
              'access-control-expose-headers': 'x-daclify-session-ms',
            },
          });
    if (path === '/v1/me/memberships') return route.fulfill({ json: { memberships: [] } });
    return route.fulfill({
      status: 503,
      json: { code: 'SERVICE_UNAVAILABLE', message: 'Fixture unavailable' },
    });
  });
  return {
    account,
    keys,
    expire: () => {
      signedOut = true;
    },
  };
}

test('ordinary portal use keeps keys unlocked past ten minutes until sign-in expires', async ({
  context,
  page,
}) => {
  const bundle = await fixture(context);
  await page.clock.install();
  await unlock(page, bundle);
  await page.clock.fastForward(11 * 60_000);
  await page.keyboard.press('Tab');
  expect(await inspect(page)).toMatchObject({ unlocked: true, canSign: true });
  await page.clock.fastForward(43_200_001);
  expect(await inspect(page)).toMatchObject({ unlocked: false, canSign: false });
});

test('activity cannot prolong a nearly expired sign-in or reopen locked keys', async ({
  context,
  page,
}) => {
  const bundle = await fixture(context, 60_000);
  await page.clock.install();
  await unlock(page, bundle);
  await page.clock.fastForward(50_000);
  await page.keyboard.press('Tab');
  expect(await inspect(page)).toMatchObject({ unlocked: true, canSign: true });
  await page.clock.fastForward(10_001);
  await page.keyboard.press('Tab');
  expect(await inspect(page)).toMatchObject({ unlocked: false, canSign: false });
});

async function unlock(page: Page, bundle: { account: Account; keys: VaultSecrets }) {
  await page.goto('/mcp/oauth/consent');
  await expect(
    page.getByRole('heading', { name: 'Connect a hosted AI harness', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = '/src/state/workspace.ts';
        const { useWorkspace }: typeof import('../../src/state/workspace') = await import(path);
        return !!useWorkspace().account && !useWorkspace().loading;
      }),
    )
    .toBe(true);
  await page.evaluate(
    async ({ account, keys }) => {
      const statePath = '/src/state/workspace.ts',
        sessionPath = '/src/auth/session.ts';
      const { useWorkspace }: typeof import('../../src/state/workspace') = await import(statePath);
      const session: typeof import('../../src/auth/session') = await import(sessionPath);
      useWorkspace().account = account;
      if (!account.signingKey || !account.encryptionKey) throw Error('FIXTURE_KEYS');
      sessionStorage.setItem('daclify.csrf', 'c'.repeat(43));
      await session.installCreatedVault(
        account,
        keys,
        {
          version: 1,
          id: crypto.randomUUID(),
          credentialKey: 'email:security-fixture@example.com',
          mode: 'daclify-assisted',
          salt: btoa('\0'.repeat(32)),
          origin: location.origin,
          accountId: account.id,
          signingPublicKey: account.signingKey,
          encryptionPublicKey: account.encryptionKey,
        },
        () => {},
      );
    },
    { account: bundle.account, keys: bundle.keys },
  );
  expect(await inspect(page)).toMatchObject({ unlocked: true, canSign: true });
}

async function inspect(page: Page) {
  const request = makeInstruction(
    { chainId: 'ab'.repeat(32), contract: 'daclifycore', daoId: '1', interfaceVersion: 1 },
    '1',
    '0',
    Math.floor(Date.now() / 1000) + 60,
    'daclifycore',
    'setmeta',
    encodeAction('setmeta', {
      runtime: 'daclifycore',
      dao_id: '1',
      member_id: '1',
      metadata: '{}',
    }),
  );
  const result = await page.evaluate(async (request) => {
    const sessionPath = '/src/auth/session.ts',
      statePath = '/src/state/workspace.ts';
    const session: typeof import('../../src/auth/session') = await import(sessionPath);
    const { useWorkspace }: typeof import('../../src/state/workspace') = await import(statePath);
    let signature: string | undefined;
    try {
      signature = session.signInstruction(request);
    } catch {
      /* Locked keys must not produce a signature. */
    }
    return {
      unlocked: session.vaultUnlocked.value,
      account: !!useWorkspace().account,
      key: useWorkspace().account?.signingKey,
      signature,
    };
  }, request);
  return {
    unlocked: result.unlocked,
    account: result.account,
    canSign:
      !!result.signature &&
      !!result.key &&
      Signature.from(result.signature).verifyDigest(
        instructionDigest(request),
        PublicKey.from(result.key),
      ),
  };
}

for (const outcome of ['success', 'failure'] as const) {
  test(`logout locks both tabs before a delayed ${outcome} response`, async ({ context, page }) => {
    const bundle = await fixture(context),
      other = await context.newPage();
    await unlock(page, bundle);
    await unlock(other, bundle);
    let finish: (() => void) | undefined;
    const response = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await page.route('**' + ApiRoutes.logout.path, async (route) => {
      await response;
      return outcome === 'success'
        ? route.fulfill({ status: 204 })
        : route.fulfill({
            status: 503,
            json: { code: 'SERVICE_UNAVAILABLE', message: 'Unavailable' },
          });
    });
    const pending = page.evaluate(async () => {
      const path = '/src/auth/session.ts';
      const session: typeof import('../../src/auth/session') = await import(path);
      try {
        await session.logoutAccount();
      } catch {
        /* Both outcomes must lock keys. */
      }
    });
    try {
      await expect.poll(() => inspect(page)).toMatchObject({ unlocked: false, canSign: false });
      await expect
        .poll(() => inspect(other))
        .toEqual({ unlocked: false, account: false, canSign: false });
    } finally {
      finish?.();
      await pending;
    }
  });
}

for (const channel of ['available', 'missing', 'denied'] as const) {
  test(`manual key lock reaches another tab with BroadcastChannel ${channel}`, async ({
    context,
    page,
  }) => {
    if (channel !== 'available')
      await context.addInitScript(
        (mode) =>
          Object.defineProperty(window, 'BroadcastChannel', {
            value:
              mode === 'missing'
                ? undefined
                : function () {
                    throw new DOMException('Denied', 'SecurityError');
                  },
          }),
        channel,
      );
    const bundle = await fixture(context),
      other = await context.newPage();
    await unlock(page, bundle);
    await unlock(other, bundle);
    await page.getByRole('button', { name: 'Lock keys', exact: true }).click();
    await expect
      .poll(() => inspect(other))
      .toEqual({ unlocked: false, account: true, canSign: false });
  });
}

test('a delayed logout cannot clear a different account opened while it was pending', async ({
  context,
  page,
}) => {
  const bundle = await fixture(context);
  await unlock(page, bundle);
  let finish: (() => void) | undefined;
  const response = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route('**' + ApiRoutes.logout.path, async (route) => {
    await response;
    await route.fulfill({ status: 204 });
  });
  const pending = page.evaluate(async () => {
    const path = '/src/auth/session.ts';
    const session: typeof import('../../src/auth/session') = await import(path);
    await session.logoutAccount();
  });
  try {
    await expect.poll(() => inspect(page)).toMatchObject({ unlocked: false });
    await page.evaluate(async () => {
      const path = '/src/state/workspace.ts';
      const { useWorkspace }: typeof import('../../src/state/workspace') = await import(path);
      useWorkspace().account = {
        id: '22222222-2222-4222-8222-222222222222',
        custody: 'user-controlled',
        signingKey: null,
        encryptionKey: null,
      };
      sessionStorage.setItem('daclify.csrf', 'd'.repeat(43));
    });
  } finally {
    finish?.();
    await pending;
  }
  expect(
    await page.evaluate(async () => {
      const path = '/src/state/workspace.ts';
      const { useWorkspace }: typeof import('../../src/state/workspace') = await import(path);
      return useWorkspace().account?.id;
    }),
  ).toBe('22222222-2222-4222-8222-222222222222');
  expect(await page.evaluate(() => sessionStorage.getItem('daclify.csrf'))).toBe('d'.repeat(43));
});

for (const isolation of ['account', 'network'] as const) {
  test(`key lock leaves another ${isolation} scope alone`, async ({ context, page }) => {
    const bundle = await fixture(context),
      other = await context.newPage();
    await unlock(page, bundle);
    await unlock(
      other,
      isolation === 'account'
        ? { ...bundle, account: { ...bundle.account, id: '22222222-2222-4222-8222-222222222222' } }
        : bundle,
    );
    if (isolation === 'network')
      await other.evaluate(async () => {
        const path = '/src/api/networks.ts';
        const networks: typeof import('../../src/api/networks') = await import(path);
        networks.configureNetworks({
          production: 'https://other-api.example',
          testnet: 'https://other-test.example',
        });
      });
    await page.getByRole('button', { name: 'Lock keys', exact: true }).click();
    await expect.poll(() => inspect(page)).toMatchObject({ unlocked: false });
    // A round trip confirms the other tab has processed queued browser messages.
    await other.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(await inspect(other)).toEqual({ unlocked: true, account: true, canSign: true });
  });
}

test('a definite session removal locks the vault and clears account state', async ({
  context,
  page,
}) => {
  const bundle = await fixture(context);
  const other = await context.newPage();
  await unlock(page, bundle);
  await unlock(other, bundle);
  bundle.expire();
  await page.evaluate(async () => {
    const path = '/src/state/workspace.ts';
    const { useWorkspace }: typeof import('../../src/state/workspace') = await import(path);
    await useWorkspace().refresh();
  });
  expect(await inspect(page)).toEqual({ unlocked: false, account: false, canSign: false });
  await expect
    .poll(() => inspect(other))
    .toEqual({ unlocked: false, account: false, canSign: false });
});

test('account key replacement locks the previous vault', async ({ context, page }) => {
  const bundle = await fixture(context);
  await unlock(page, bundle);
  await page.evaluate(async () => {
    const path = '/src/state/workspace.ts';
    const { useWorkspace }: typeof import('../../src/state/workspace') = await import(path);
    const state = useWorkspace();
    if (!state.account) throw Error('FIXTURE_ACCOUNT');
    state.account = {
      id: state.account.id,
      custody: 'user-controlled',
      signingKey: null,
      encryptionKey: null,
    };
  });
  expect(await inspect(page)).toEqual({ unlocked: false, account: true, canSign: false });
});

test('ignores malformed and unknown session events before accepting a real lock', async ({
  context,
  page,
}) => {
  const bundle = await fixture(context),
    other = await context.newPage();
  await unlock(page, bundle);
  await unlock(other, bundle);
  await page.evaluate(async () => {
    const path = '/src/api/networks.ts';
    const { csrfStorageKey }: typeof import('../../src/api/networks') = await import(path);
    const channel = new BroadcastChannel('daclify.session-event.v1');
    for (const value of [
      'not JSON',
      'x'.repeat(1025),
      JSON.stringify({
        type: 'unlock',
        accountId: '11111111-1111-4111-8111-111111111111',
        scope: csrfStorageKey(),
      }),
    ])
      channel.postMessage(value);
    channel.close();
  });
  expect(await inspect(other)).toEqual({ unlocked: true, account: true, canSign: true });
  await page.getByRole('button', { name: 'Lock keys', exact: true }).click();
  await expect
    .poll(() => inspect(other))
    .toEqual({ unlocked: false, account: true, canSign: false });
});

test('blocks unrelated framing while preserving top-level and popup consent', async ({
  context,
  page,
  baseURL,
}) => {
  await fixture(context);
  await page.goto('/mcp/oauth/consent');
  await expect(
    page.getByRole('heading', { name: 'Connect a hosted AI harness', exact: true }),
  ).toBeVisible();
  const opened = page.waitForEvent('popup');
  await page.evaluate(() => window.open('/mcp/oauth/consent', 'security-consent-popup'));
  const popup = await opened;
  await expect(
    popup.getByRole('heading', { name: 'Connect a hosted AI harness', exact: true }),
  ).toBeVisible();
  if (!baseURL) throw Error('BASE_URL_REQUIRED');
  const parent = new URL(baseURL);
  parent.port = String(Number(parent.port) + 1);
  parent.pathname = '/owned-security-frame';
  await context.route(parent.toString(), (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<iframe src="' + baseURL + '/mcp/oauth/consent"></iframe>',
    }),
  );
  await page.goto(parent.toString(), { waitUntil: 'networkidle' });
  await expect(
    page
      .frameLocator('iframe')
      .getByRole('heading', { name: 'Connect a hosted AI harness', exact: true }),
  ).not.toBeVisible();
  const response = await page.request.get(baseURL + '/mcp/oauth/consent');
  expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(response.headers()['x-frame-options']).toBe('DENY');
});
