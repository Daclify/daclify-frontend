import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ApiRoutes, NetworkSchema } from '@daclify/core-protocol';
import { quickBallotFixture } from '../helpers/quick-ballot';
import { quickArchiveFixture } from '../helpers/quick-archive';
async function fixture(
  page: Page,
  corrupt = false,
  selectedDaos: string[] = [],
  prepared?: ReturnType<typeof quickBallotFixture>,
) {
  const f = prepared ?? quickBallotFixture(false, selectedDaos);
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
    if (path === '/v1/quick-ballots/definitions')
      return route.fulfill({
        json: {
          available: true,
          experimental: true,
          domain: { chainId: f.chainId, runtime: f.runtime, source: f.source },
          ballots: [ballot],
          next: null,
        },
      });
    if (path === '/v1/quick-ballots/7/definition')
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

for (const protectedQuestion of [false, true])
  test(`records, changes and removes a signed encrypted response (${protectedQuestion ? 'private non-executive question' : 'public question'})`, async ({
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
    const { createVault, unlockVault, sealContent, createEpochGrant, sha256Hex } =
      await import('../../src/auth/vault');
    const { contentDomain, epochGrantDomain, DaoContentSchema, UserMembershipSchema } =
      await import('@daclify/core-protocol');
    const password = 'owned-quick-browser-vault-password',
      created = await createVault(password),
      secrets = await unlockVault(created.localEnvelope, password);
    const account = AccountSchema.parse({
      id: randomUUID(),
      signingKey: created.signingPublicKey,
      encryptionKey: created.encryptionPublicKey,
      custody: 'user-controlled',
    });
    const base = quickBallotFixture(false, ['1']);
    const dao = { chainId: base.chainId, contract: base.runtime, daoId: '1', interfaceVersion: 1 as const };
    const epoch = crypto.getRandomValues(new Uint8Array(32));
    const questionText = 'Private non-executive question canary';
    const metadata = JSON.stringify(
      await sealContent(
        new TextEncoder().encode(
          JSON.stringify({
            schemaVersion: 1,
            kind: 'quick-question',
            source: base.source,
            recordId: '7',
            body: { question: questionText, explanation: 'Private details' },
          }),
        ),
        epoch,
        contentDomain(dao, '7', 1, '1'),
      ),
    );
    const commitment = await sha256Hex(new TextEncoder().encode(metadata));
    const member = UserMembershipSchema.parse({
      dao,
      memberId: '2',
      nonce: '0',
      active: true,
      admin: false,
      reviewer: false,
      credits: '0',
      stake: '0',
      claim: '0',
      nativeAccount: '',
      custody: 'user-controlled',
      signingKey: account.signingKey,
    });
    const content = DaoContentSchema.parse({
      dao,
      documents: [
        {
          id: '1',
          document_id: '7',
          version: 1,
          author: '1',
          cid: '',
          metadata,
          commitment,
          envelope_version: 1,
          key_epoch: '1',
          bytes: new TextEncoder().encode(metadata).length,
        },
      ],
      epochs: [{ epoch: '1', commitment: await sha256Hex(epoch), creator: '1' }],
      keyGrants: [
        {
          id: '1',
          recipient: '2',
          grantor: '1',
          epoch: '1',
          envelope: JSON.stringify(
            await createEpochGrant(
              created.encryptionPublicKey,
              epoch,
              epochGrantDomain(dao, '1', '2'),
            ),
          ),
        },
      ],
      members: [
        {
          id: '2',
          signing_key: account.signingKey,
          encryption_key: JSON.stringify(account.encryptionKey),
          native_account: '',
          custody: 0,
          nonce: '0',
          credits: '0',
          stake: '0',
          claim: '0',
          active: true,
          admin: false,
          reviewer: false,
          join_epoch: '1',
        },
      ],
    });
    const f = await fixture(
      page,
      false,
      [],
      protectedQuestion
        ? quickBallotFixture(false, ['1'], 'unrelated fixed vote reader', {
            ...base.ballot.definition,
            protocol: 2,
            all_accounts: false,
            audience: ['1'],
            question: JSON.stringify({ documentId: '7', version: 1, commitment, keyEpoch: '1' }),
            explanation: '',
          })
        : undefined,
    );
    let missingQuestionGrant = true;
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
      if (path === ApiRoutes.memberships.path)
        return route.fulfill({ json: { memberships: protectedQuestion ? [member] : [] } });
      if (path === '/v1/daos/1/content')
        return route.fulfill({
          json: { ...content, keyGrants: missingQuestionGrant ? [] : content.keyGrants },
        });
      if (path === '/v1/daos/1/governance')
        return route.fulfill({
          json: {
            dao,
            policy: null,
            actors: [],
            sessions: [],
            guardian: null,
            budget: null,
            executives: [],
            executivePolicy: null,
          },
        });
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
      if (path === '/v1/quick-ballots/7/definition')
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
    await expect(page.getByRole('button', { name: 'Vote up', exact: true }))[
      protectedQuestion ? 'toBeDisabled' : 'toBeEnabled'
    ]();
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
    if (protectedQuestion) {
      await expect(page.getByRole('button', { name: 'Vote up', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: 'Read private question', exact: true }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.getByRole('heading', { name: questionText, exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Vote up', exact: true })).toBeDisabled();
      missingQuestionGrant = false;
      await page.getByRole('button', { name: 'Read private question', exact: true }).click();
      await expect(page.getByRole('heading', { name: questionText, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Verify totals', exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole('button', { name: 'Vote up', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Vote up', exact: true }).click();
    await expect(page.getByText('Your response: Up', { exact: true })).toBeVisible();
    await expect(page.getByText('3 responses', { exact: true })).toBeVisible();
    if (protectedQuestion)
      await page.getByRole('button', { name: 'Read private question', exact: true }).click();
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
  let former = false;
  const { encryptBallotChoice, addBallotCiphertexts } =
    await import('@daclify/modules/quick-ballot-proof');
  const { quickResponseContext } = await import('@daclify/modules/quick-ballots');
  const encrypted = encryptBallotChoice(
    quickResponseContext({
      chainId: f.chainId,
      runtime: f.runtime,
      ballotId: f.ballot.id,
      definitionHash: f.ballot.definition_hash,
      identity,
      revision: '1',
    }),
    f.ballot.key,
    1,
  );
  const previous = {
    id: '3',
    dao_id: '1',
    ballot_id: '7',
    identity,
    revision: '1',
    active: true,
    ...encrypted,
    receipt: '',
    updated_at: 2,
  };
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
    if (path === '/v1/quick-ballots/7/response')
      return route.fulfill({ json: { response: former ? previous : null } });
    return route.fallback();
  });
  await page.goto('/quick-ballots/7');
  await expect(
    page.getByText('Join one of the selected DAOs to respond.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vote up', exact: true })).toHaveCount(0);
  former = true;
  f.ballot.aggregate = addBallotCiphertexts(f.ballot.aggregate, previous.ciphertext);
  f.ballot.count++;
  f.ballot.identities++;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove response', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Vote up', exact: true })).toHaveCount(0);
});

test('an original reader restores archived grants and votes and publishes a valid late proof', async ({
  page,
}) => {
  const { randomUUID } = await import('node:crypto');
  const { AccountSchema, RecoveryKitSchema } = await import('@daclify/core-protocol');
  const { QuickBallotRoutes } = await import('@daclify/modules');
  const { verifyQuickBallotResult } = await import('@daclify/modules/quick-ballots');
  const { createVault } = await import('../../src/auth/vault');
  const { createBallotGrant } = await import('../../src/quick-ballots/keys');
  const password = 'owned-late-tally-password',
    created = await createVault(password);
  const account = AccountSchema.parse({
    id: randomUUID(),
    signingKey: created.signingPublicKey,
    encryptionKey: created.encryptionPublicKey,
    custody: 'user-controlled',
  });
  const f = quickBallotFixture(true, [], JSON.stringify(created.encryptionPublicKey));
  f.ballot.pruned = true;
  const grant = await createBallotGrant(
    {
      chainId: f.chainId,
      runtime: f.runtime,
      source: f.source,
      ballotId: f.ballot.id,
      definitionHash: f.ballot.definition_hash,
      memberId: '1',
    },
    JSON.stringify(created.encryptionPublicKey),
    f.secret,
  );
  const archives = quickArchiveFixture(f, [grant]);
  await fixture(page);
  let finalized = 0,
    archiveReads = 0;
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/sign-in/session') return route.fulfill({ json: { account } });
    if (path === ApiRoutes.memberships.path) return route.fulfill({ json: { memberships: [] } });
    if (path === '/v1/me/quick-account')
      return route.fulfill({ json: { available: false, context: null } });
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
    if (path === '/v1/quick-ballots/7/definition')
      return route.fulfill({
        json: {
          chainId: f.chainId,
          runtime: f.runtime,
          source: f.source,
          ballot: f.ballot,
          grants: null,
        },
      });
    if (path === '/v1/quick-ballots/7/responses')
      return route.fulfill({
        json: { responses: [], next: null, root: f.ballot.response_root, pruned: true },
      });
    if (path === '/v1/quick-ballots/7/archive') {
      archiveReads++;
      return route.fulfill({ json: { archives, complete: true } });
    }
    if (path === '/v1/quick-ballots/7/finalize') {
      const input = QuickBallotRoutes.quickFinalize.input.parse(route.request().postDataJSON());
      expect(Object.keys(input).sort()).toEqual([
        'expectedDefinitionHash',
        'expectedRoot',
        'proof',
        'up',
      ]);
      expect(input.expectedDefinitionHash).toBe(f.ballot.definition_hash);
      expect(input.expectedRoot).toBe(f.ballot.response_root);
      expect(JSON.stringify(input)).not.toContain(f.secret);
      const ballot = { ...f.ballot, up: input.up, final_proof: input.proof, verified: true };
      expect(
        verifyQuickBallotResult({
          chainId: f.chainId,
          runtime: f.runtime,
          source: f.source,
          ballot,
        }),
      ).toEqual({ up: 1, down: 1, count: 2 });
      Object.assign(f.ballot, ballot);
      finalized++;
      return route.fulfill({ json: { transactionId: '44'.repeat(32), prepared: true } });
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
  const publish = page.getByRole('button', { name: 'Verify and publish totals', exact: true });
  await expect(publish).toBeVisible();
  await expect(publish).toBeDisabled();
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
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(page.getByText('Totals proof verified', { exact: true })).toBeVisible();
  await expect(page.getByText('Up: 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Down: 1', { exact: true })).toBeVisible();
  expect(finalized).toBe(1);
  expect(archiveReads).toBe(1);
});
test('an executive publishes a timed public question with actual key proofs and fixed encrypted reader grants', async ({
  page,
}) => {
  const { randomUUID } = await import('node:crypto');
  const { ABI, Serializer, Signature, PublicKey } = await import('@wharfkit/antelope');
  const { z } = await import('zod');
  const {
    AccountSchema,
    RecoveryKitSchema,
    UserMembershipSchema,
    DaoSummarySchema,
    GovernanceStateSchema,
  } = await import('@daclify/core-protocol');
  const { instructionDigest, RuntimeActionSchemas } = await import('@daclify/core-protocol/sdk');
  const { Catalog, ModulePermissions, ModuleStateSchema, QuickBallotRowSchema } =
    await import('@daclify/modules');
  const {
    ModuleCodeHashes,
    QuickBallotActionSchemas,
    QuickBallotTableSchemas,
    quickvoteAbi,
    quickBallotDefinitionHash,
    quickKeyContext,
  } = await import('@daclify/modules/sdk');
  const { verifyBallotKey } = await import('@daclify/modules/quick-ballot-proof');
  const { createVault, unlockVault } = await import('../../src/auth/vault');
  const { openBallotGrant } = await import('../../src/quick-ballots/keys');
  const password = 'owned-executive-browser-password',
    created = await createVault(password),
    secrets = await unlockVault(created.localEnvelope, password),
    f = await fixture(page);
  const account = AccountSchema.parse({
    id: randomUUID(),
    signingKey: created.signingPublicKey,
    encryptionKey: created.encryptionPublicKey,
    custody: 'user-controlled',
  });
  const dao = { chainId: f.chainId, contract: f.runtime, daoId: '1', interfaceVersion: 1 };
  const member = UserMembershipSchema.parse({
    dao,
    memberId: '1',
    nonce: '0',
    active: true,
    admin: true,
    reviewer: false,
    credits: '0',
    stake: '0',
    claim: '0',
    nativeAccount: '',
    custody: 'user-controlled',
    signingKey: created.signingPublicKey,
  });
  const summary = DaoSummarySchema.parse({
    reference: dao,
    title: 'Garden DAO',
    description: 'Owned executive fixture',
    privacy: 'public',
    owner: 'alice',
    token: { chainId: f.chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
    members: 1,
    available: '0',
    reserved: '0',
    claims: '0',
    keyEpoch: '1',
    purpose: 'community',
  });
  const manifest = Catalog.find((row) => row.id === 'quick-ballots');
  if (!manifest) throw Error('QUICK_MANIFEST');
  const modules = ModuleStateSchema.parse({
    dao,
    modules: [
      {
        manifest,
        deployment: {
          id: 'quick-ballots',
          account: f.source,
          version: manifest.version,
          codeHash: ModuleCodeHashes['quick-ballots'],
        },
        enabled: true,
        installed: true,
        compatible: true,
        codeVerified: true,
        actions: ModulePermissions['quick-ballots'].actions,
        grants: ModulePermissions['quick-ballots'].grants,
      },
    ],
    ballots: [],
    votes: [],
    projects: [],
    milestones: [],
    schedules: [],
    entries: [],
    controls: [],
  });
  const governance = GovernanceStateSchema.parse({
    dao,
    policy: null,
    actors: [],
    sessions: [],
    guardian: null,
    budget: null,
    executivePolicy: {
      dao_id: '1',
      inactivity_seconds: 0,
      quorum_bps: 10000,
      revision: '1',
      last_election_start: 0,
    },
    executives: [{ member_id: '1', last_active: 1, office_epoch: '1', election_id: '0' }],
  });
  let published: ReturnType<typeof QuickBallotRowSchema.parse> | undefined,
    grants: string[] = [],
    secret = '';
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/sign-in/session') return route.fulfill({ json: { account } });
    if (path === ApiRoutes.daos.path) return route.fulfill({ json: { daos: [summary] } });
    if (path === '/v1/daos/1') return route.fulfill({ json: summary });
    if (path === ApiRoutes.memberships.path)
      return route.fulfill({ json: { memberships: [member] } });
    if (path === '/v1/me/quick-account')
      return route.fulfill({ json: { available: false, context: null } });
    if (path === '/v1/daos/1/modules') return route.fulfill({ json: modules });
    if (path === '/v1/daos/1/governance') return route.fulfill({ json: governance });
    if (path === '/v1/daos/1/quick-ballots/readers')
      return route.fulfill({
        json: {
          dao,
          readers: [
            { member_id: '1', encryption_key: JSON.stringify(created.encryptionPublicKey) },
          ],
        },
      });
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
    if (path === ApiRoutes.relay.path) {
      const input = RuntimeActionSchemas.submit.parse(route.request().postDataJSON());
      expect(
        Signature.from(input.sig).verifyDigest(
          instructionDigest(input.request),
          PublicKey.from(created.signingPublicKey),
        ),
      ).toBe(true);
      expect(input.request.target).toBe(f.source);
      expect(input.request.action).toBe('open');
      const decoded: unknown = Serializer.objectify(
        Serializer.decode({ abi: ABI.from(quickvoteAbi), type: 'open', data: input.request.data }),
      );
      const id = QuickBallotTableSchemas.qballots.shape.id,
        reader = QuickBallotActionSchemas.open.shape.definition.shape.readers.element;
      const args = QuickBallotActionSchemas.open
        .extend({
          dao_id: id,
          member_id: id,
          ballot_id: id,
          definition: QuickBallotActionSchemas.open.shape.definition.extend({
            audience: z.array(id),
            readers: z.array(reader.extend({ member_id: id })),
          }),
        })
        .parse(decoded);
      expect(args.definition).toMatchObject({
        question: 'Plant more trees?',
        explanation: 'A community question',
        all_accounts: true,
        audience: [],
      });
      expect(args.definition.closes).toBeGreaterThan(Date.now() / 1000);
      expect(args.definition.readers).toHaveLength(1);
      const definitionHash = quickBallotDefinitionHash({
        chainId: f.chainId,
        runtime: f.runtime,
        source: f.source,
        ballotId: args.ballot_id,
        daoId: '1',
        creatorId: '1',
        definition: args.definition,
      });
      expect(
        verifyBallotKey(
          quickKeyContext({
            chainId: f.chainId,
            runtime: f.runtime,
            ballotId: args.ballot_id,
            definitionHash,
          }),
          args.key,
          args.possession,
        ),
      ).toBe(true);
      secret = await openBallotGrant(
        {
          chainId: f.chainId,
          runtime: f.runtime,
          source: f.source,
          ballotId: args.ballot_id,
          definitionHash,
          memberId: '1',
        },
        secrets.encryptionPrivateKey,
        args.grants[0] ?? '',
      );
      expect(secret).toHaveLength(64);
      expect(JSON.stringify(input)).not.toContain(secret);
      published = QuickBallotRowSchema.parse({
        ...f.ballot,
        id: args.ballot_id,
        definition: args.definition,
        definition_hash: definitionHash,
        key: args.key,
        key_proof: args.possession,
        aggregate: '00'.repeat(192),
        count: 0,
        identities: 0,
      });
      grants = args.grants;
      return route.fulfill({ json: { transactionId: '44'.repeat(32) } });
    }
    if (published && path === '/v1/quick-ballots/' + published.id + '/definition')
      return route.fulfill({
        json: {
          chainId: f.chainId,
          runtime: f.runtime,
          source: f.source,
          ballot: published,
          grants: { id: published.id, dao_id: '1', grants },
        },
      });
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
  await page.goto('/quick-ballots');
  await expect(page.getByRole('button', { name: 'Ask a question', exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: 'Ask a question', exact: true }).click();
  await page.getByLabel('Question', { exact: true }).fill('Plant more trees?');
  await expect(page.getByRole('button', { name: 'Publish question', exact: true })).toBeDisabled();
  await page.getByLabel('Publish question publicly', { exact: true }).check();
  await expect(
    page.getByText('The question and details will be permanently public on chain.', {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByLabel('Details (optional)', { exact: true }).fill('A community question');
  await page
    .getByLabel('Who may respond?', { exact: true })
    .selectOption({ label: 'All Daclify users' });
  await page
    .getByLabel('Closes at (optional)', { exact: true })
    .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  await page.getByRole('button', { name: 'Publish question', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plant more trees?', exact: true })).toBeVisible();
  await expect(page.getByText('Ballot encryption verified', { exact: true })).toBeVisible();
  expect(published?.definition.readers).toHaveLength(1);
  expect(secret).toHaveLength(64);
});
