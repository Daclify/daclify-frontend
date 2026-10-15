import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ApiRoutes, NetworkSchema } from '@daclify/core-protocol';
import { quickBallotFixture } from '../helpers/quick-ballot';
async function fixture(page: Page, corrupt = false, selectedDaos: string[] = []) {
  const f = quickBallotFixture(false, selectedDaos);
  const ballot = corrupt
    ? { ...f.ballot, definition: { ...f.ballot.definition, question: 'Substituted question' } }
    : f.ballot;
  await page.route('**/networks.json', (route) => route.fulfill({ json: { mode: 'local' } }));
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === ApiRoutes.network.path)
      return route.fulfill({
        json: NetworkSchema.parse({
          chainId: f.chainId,
          runtime: f.runtime,
          rpcUrl: 'http://127.0.0.1:18888',
          hub: null,
          environment: 'local',
          interfaceVersion: 1,
          coreVersion: '0.15.0-alpha.29',
          capabilities: ['quick-ballots-v1'],
        }),
      });
    if (path === ApiRoutes.daos.path) return route.fulfill({ json: { daos: [] } });
    if (path === '/v1/sign-in/session') return route.fulfill({ status: 204 });
    if (path === '/v1/quick-ballots')
      return route.fulfill({
        json: {
          available: true,
          experimental: true,
          domain: { chainId: f.chainId, runtime: f.runtime, source: f.source },
          ballots: [ballot],
          next: null,
        },
      });
    if (path === '/v1/quick-ballots/7')
      return route.fulfill({
        json: { chainId: f.chainId, runtime: f.runtime, source: f.source, ballot, grants: null },
      });
    return route.fulfill({
      status: 404,
      json: { code: 'FIXTURE_UNKNOWN', message: 'Owned browser fixture has no such route' },
    });
  });
  return f;
}
test('shows a compact public ballot with verified encryption, participation and a sign-in path', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/quick-ballots/7');
  await expect(page.getByRole('heading', { name: 'Quick ballots', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Should we plant more trees?', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('2 responses', { exact: true })).toBeVisible();
  await expect(page.getByText('Ballot encryption verified', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in to vote', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vote up', exact: true })).toHaveCount(0);
  await expect(page.getByText('Up: 1', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const accessibility = await new AxeBuilder({ page }).include('main').analyze();
  expect(accessibility.violations).toEqual([]);
});
test('refuses a substituted question instead of enabling voting or claiming verified encryption', async ({
  page,
}) => {
  await fixture(page, true);
  await page.goto('/quick-ballots/7');
  await expect(page.getByRole('alert')).toContainText('could not be verified');
  await expect(page.getByText('Ballot encryption verified', { exact: true })).toHaveCount(0);
});
test('keeps its wallet-only receipt key nonextractable and persistent in this browser', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/quick-ballots/7');
  const ciphertext = await page.evaluate(async (path) => {
    const module: unknown = await import(path);
    if (
      typeof module !== 'object' ||
      module === null ||
      !('receiptDeviceKey' in module) ||
      typeof module.receiptDeviceKey !== 'function'
    )
      throw Error('FIXTURE_DEVICE_KEY');
    const key: unknown = await module.receiptDeviceKey('owned-browser-receipt', true);
    if (!(key instanceof CryptoKey) || key.extractable) throw Error('FIXTURE_DEVICE_KEY');
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: new Uint8Array(12) },
      key,
      Uint8Array.of(1),
    );
    return [...new Uint8Array(encrypted)];
  }, '/src/quick-ballots/device-key.ts');
  await page.reload();
  expect(
    await page.evaluate(
      async ({ path, ciphertext }) => {
        const module: unknown = await import(path);
        if (
          typeof module !== 'object' ||
          module === null ||
          !('receiptDeviceKey' in module) ||
          typeof module.receiptDeviceKey !== 'function'
        )
          throw Error('FIXTURE_DEVICE_KEY');
        const key: unknown = await module.receiptDeviceKey('owned-browser-receipt', false);
        if (!(key instanceof CryptoKey) || key.extractable) throw Error('FIXTURE_DEVICE_KEY');
        const plaintext = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: new Uint8Array(12) },
          key,
          new Uint8Array(ciphertext),
        );
        return [...new Uint8Array(plaintext)];
      },
      { path: '/src/quick-ballots/device-key.ts', ciphertext },
    ),
  ).toEqual([1]);
});

test('records, changes and removes a signed encrypted response and refreshes the displayed count', async ({
  page,
}) => {
  // HTTP source fixture, with actual vault encryption, K1 operation signatures and BLS choice proofs.
  const { randomUUID } = await import('node:crypto');
  const { PrivateKey, Signature, Serializer, ABI } = await import('@wharfkit/antelope');
  const { z } = await import('zod');
  const { QuickAccountRoutes, QuickAccountPreparedSchema, AccountSchema, RecoveryKitSchema } =
    await import('@daclify/core-protocol');
  const { QuickAuthCodeHash, quickAccountIdentity, quickAccountRequest, quickAccountDigest } =
    await import('@daclify/core-protocol/sdk');
  const { ModuleCodeHashes } = await import('@daclify/modules/sdk');
  const { QuickBallotResponseSchema } = await import('@daclify/modules');
  const { quickvoteAbi, quickResponseContext } = await import('@daclify/modules/quick-ballots');
  const { verifyBallotChoice, addBallotCiphertexts, subtractBallotCiphertexts } =
    await import('@daclify/modules/quick-ballot-proof');
  const { createVault, unlockVault } = await import('../../src/auth/vault');
  const f = await fixture(page),
    password = 'owned-quick-browser-vault-password',
    created = await createVault(password),
    secrets = await unlockVault(created.localEnvelope, password);
  const account = AccountSchema.parse({
    id: randomUUID(),
    signingKey: created.signingPublicKey,
    encryptionKey: created.encryptionPublicKey,
    custody: 'user-controlled',
  });
  const anchor = { kind: 'key' as const, publicKey: created.signingPublicKey },
    identity = quickAccountIdentity(f.chainId, f.runtime, anchor);
  const record = {
    id: '1',
    identity,
    approval: { kind: 3, credential: '' },
    epoch: '0',
    nonce: '0',
    active: true,
    deactivated_at: 0,
  };
  const context = () => ({
    chainId: f.chainId,
    runtime: f.runtime,
    authority: 'quickauth',
    authorityCodeHash: QuickAuthCodeHash,
    source: f.source,
    sourceCodeHash: ModuleCodeHashes['quick-ballots'],
    gateway: { actor: 'gateway', permission: 'active' },
    anchor,
    identity,
    frozen: true,
    record: { ...record },
  });
  const prepared = new Map<string, ReturnType<typeof QuickAccountPreparedSchema.parse>>();
  let current: ReturnType<typeof QuickBallotResponseSchema.parse> | null = null;
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/sign-in/session') return route.fulfill({ json: { account } });
    if (path === ApiRoutes.memberships.path) return route.fulfill({ json: { memberships: [] } });
    if (path === ApiRoutes.challenge.path) {
      const id = randomUUID(),
        expires = new Date(Date.now() + 120000).toISOString(),
        origin = new URL(route.request().url()).origin;
      return route.fulfill({
        json: {
          id,
          expires,
          message: JSON.stringify({
            domain: 'daclify.login.v3',
            origin,
            audience: origin,
            challenge: id,
            expires,
            signingKey: account.signingKey,
            encryptionKey: account.encryptionKey,
          }),
        },
      });
    }
    if (path === ApiRoutes.login.path)
      return route.fulfill({ json: { account, csrfToken: 'c'.repeat(43) } });
    if (path === '/v1/quick-ballots/7/response')
      return route.fulfill({ json: { response: current } });
    if (path === '/v1/quick-ballots/7')
      return route.fulfill({
        json: {
          chainId: f.chainId,
          runtime: f.runtime,
          source: f.source,
          ballot: f.ballot,
          grants: null,
        },
      });
    if (path === QuickAccountRoutes.quickAccountStatus.path)
      return route.fulfill({ json: { available: true, context: context() } });
    if (path === QuickAccountRoutes.quickAccountPrepare.path) {
      const input = QuickAccountRoutes.quickAccountPrepare.input.parse(
        route.request().postDataJSON(),
      );
      expect(input.expectedIdentity).toBe(identity);
      expect(JSON.stringify(input)).not.toContain('"choice"');
      const expires = Math.floor(Date.now() / 1000) + 120,
        request = quickAccountRequest(context(), input.intent, expires),
        value = QuickAccountPreparedSchema.parse({
          ...request,
          id: randomUUID(),
          context: context(),
          expiresAt: new Date(expires * 1000).toISOString(),
        });
      prepared.set(value.id, value);
      return route.fulfill({ json: value });
    }
    if (path === QuickAccountRoutes.quickAccountSubmit.path) {
      const input = QuickAccountRoutes.quickAccountSubmit.input.parse(
          route.request().postDataJSON(),
        ),
        value = prepared.get(input.id);
      if (!value || value.action !== 'qsubmit') throw Error('FIXTURE_OPERATION');
      expect(
        Serializer.decode({ type: Signature, data: input.proof }).verifyDigest(
          quickAccountDigest(value.action, value.request),
          PrivateKey.from(secrets.signingKey).toPublic(),
        ),
      ).toBe(true);
      const data = z
        .object({
          ballot_id: z.coerce.string(),
          expected_revision: z.coerce.string(),
          ciphertext: z.string().optional(),
          proof: z.string().optional(),
          receipt: z.string().optional(),
        })
        .parse(
          Serializer.objectify(
            Serializer.decode({
              abi: ABI.from(quickvoteAbi),
              type: value.request.action,
              data: value.request.data,
            }),
          ),
        );
      expect(data.expected_revision).toBe(current?.revision ?? '0');
      const revision = String(BigInt(current?.revision ?? '0') + 1n);
      if (value.request.action === 'respond') {
        if (!data.ciphertext || !data.proof || !data.receipt) throw Error('FIXTURE_RESPONSE');
        expect(
          verifyBallotChoice(
            quickResponseContext({
              chainId: f.chainId,
              runtime: f.runtime,
              ballotId: f.ballot.id,
              definitionHash: f.ballot.definition_hash,
              identity,
              revision,
            }),
            f.ballot.key,
            data.ciphertext,
            data.proof,
          ),
        ).toBe(true);
        if (current?.active)
          f.ballot.aggregate = subtractBallotCiphertexts(f.ballot.aggregate, current.ciphertext);
        else f.ballot.count++;
        if (!current) f.ballot.identities++;
        f.ballot.aggregate = addBallotCiphertexts(f.ballot.aggregate, data.ciphertext);
        current = QuickBallotResponseSchema.parse({
          id: '3',
          dao_id: '1',
          ballot_id: '7',
          identity,
          revision,
          active: true,
          ciphertext: data.ciphertext,
          proof: data.proof,
          receipt: data.receipt,
          updated_at: 2,
        });
      } else {
        if (!current?.active) throw Error('FIXTURE_RESPONSE');
        f.ballot.aggregate = subtractBallotCiphertexts(f.ballot.aggregate, current.ciphertext);
        f.ballot.count--;
        current = { ...current, revision, active: false, ciphertext: '', proof: '', receipt: '' };
      }
      record.nonce = String(BigInt(record.nonce) + 1n);
      return route.fulfill({ json: { transactionId: '44'.repeat(32), state: 'confirmed' } });
    }
    return route.fallback();
  });
  const kit = RecoveryKitSchema.parse({
    version: 1,
    localEnvelope: created.localEnvelope,
    recoveryEnvelope: created.recoveryEnvelope,
    signingPublicKey: created.signingPublicKey,
    encryptionPublicKey: created.encryptionPublicKey,
  });
  await page.addInitScript(
    (value) => localStorage.setItem('daclify.vault.v1', JSON.stringify(value)),
    kit,
  );
  await page.goto('/quick-ballots/7');
  await expect(page.getByRole('button', { name: 'Vote up', exact: true })).toBeEnabled();
  await page.evaluate(
    async ({ password, account }) => {
      const path = '/src/auth/session.ts',
        module: unknown = await import(path);
      if (
        typeof module !== 'object' ||
        module === null ||
        !('unlockAndLogin' in module) ||
        typeof module.unlockAndLogin !== 'function'
      )
        throw Error('FIXTURE_UNLOCK');
      await module.unlockAndLogin(password, account, 'recover');
    },
    { password, account },
  );
  await expect(page.getByRole('button', { name: 'Vote up', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Vote up', exact: true }).click();
  await expect(page.getByText('Your response: Up', { exact: true })).toBeVisible();
  await expect(page.getByText('3 responses', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Vote down', exact: true }).click();
  await expect(page.getByText('Your response: Down', { exact: true })).toBeVisible();
  await expect(page.getByText('3 responses', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove response', exact: true }).click();
  await expect(page.getByText('2 responses', { exact: true })).toBeVisible();
  await expect(page.getByText('Your response: Down', { exact: true })).toHaveCount(0);
  expect(record.nonce).toBe('3');
  expect(prepared.size).toBe(3);
});

test('offers selected-DAO participation only to its active members', async ({ page }) => {
  const { PrivateKey } = await import('@wharfkit/antelope');
  const { QuickAuthCodeHash, quickAccountIdentity } = await import('@daclify/core-protocol/sdk');
  const { ModuleCodeHashes } = await import('@daclify/modules/sdk');
  const f = await fixture(page, false, ['1']),
    anchor = { kind: 'key', publicKey: PrivateKey.generate('K1').toPublic().toString() },
    identity = quickAccountIdentity(f.chainId, f.runtime, anchor);
  let former=false;
  const {encryptBallotChoice,addBallotCiphertexts}=await import('@daclify/modules/quick-ballot-proof');
  const {quickResponseContext}=await import('@daclify/modules/quick-ballots');
  const encrypted=encryptBallotChoice(quickResponseContext({chainId:f.chainId,runtime:f.runtime,ballotId:f.ballot.id,definitionHash:f.ballot.definition_hash,identity,revision:'1'}),f.ballot.key,1);
  const previous={id:'3',dao_id:'1',ballot_id:'7',identity,revision:'1',active:true,...encrypted,receipt:'',updated_at:2};
  const account = {
    id: '11111111-1111-4111-8111-111111111111',
    signingKey: anchor.publicKey,
    custody: 'user-controlled',
    encryptionKey: { kty: 'EC', crv: 'P-256', x: 'x'.repeat(43), y: 'y'.repeat(43) },
  };
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/sign-in/session') return route.fulfill({ json: { account } });
    if (path === ApiRoutes.memberships.path) return route.fulfill({ json: { memberships: [] } });
    if (path === '/v1/me/quick-account')
      return route.fulfill({
        json: {
          available: true,
          context: {
            chainId: f.chainId,
            runtime: f.runtime,
            source: f.source,
            authority: 'quickauth',
            authorityCodeHash: QuickAuthCodeHash,
            sourceCodeHash: ModuleCodeHashes['quick-ballots'],
            gateway: { actor: 'gateway', permission: 'active' },
            anchor,
            identity,
            frozen: true,
            record: {
              id: '1',
              identity,
              approval: { kind: 3, credential: '' },
              epoch: '0',
              nonce: '0',
              active: true,
              deactivated_at: 0,
            },
          },
        },
      });
    if (path === '/v1/quick-ballots/7/response') return route.fulfill({ json: { response: former?previous:null } });
    return route.fallback();
  });
  await page.goto('/quick-ballots/7');
  await expect(
    page.getByText('Join one of the selected DAOs to respond.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vote up', exact: true })).toHaveCount(0);
  former=true;f.ballot.aggregate=addBallotCiphertexts(f.ballot.aggregate,previous.ciphertext);f.ballot.count++;f.ballot.identities++;
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.getByRole('button',{name:'Remove response',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Vote up',exact:true})).toHaveCount(0);
});
