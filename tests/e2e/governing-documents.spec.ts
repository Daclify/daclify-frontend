import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ABI, PublicKey, Serializer, Signature } from '@wharfkit/antelope';
import { z } from 'zod';
import {
  AccountSchema,
  ApiRoutes,
  DaoContentSchema,
  DaoRefSchema,
  DaoSummarySchema,
  GovernanceStateSchema,
  LoginMessageSchema,
  RecoveryKitSchema,
  UserMembershipSchema,
  contentDomain,
  VERSION,
} from '@daclify/core-protocol';
import { Catalog, ModuleApiRoutes, ModulePermissions, ModuleStateSchema } from '@daclify/modules';
import { decideAbi, DecideActionSchemas, ModuleCodeHashes } from '@daclify/modules/sdk';
import { instructionDigest } from '@daclify/core-protocol/sdk';
import { createVault, sha256Hex, sealContent } from '../../src/auth/vault';

test('registers and adopts an exact constitution version, then signs one member acceptance', async ({
  page,
}) => {
  test.setTimeout(90000);
  const password = 'document test vault password',
    vault = await createVault(password);
  const dao = DaoRefSchema.parse({
    chainId: 'ab'.repeat(32),
    contract: 'daclifycore',
    daoId: '1',
    interfaceVersion: 1,
  });
  const account = AccountSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    custody: 'user-controlled',
    signingKey: vault.signingPublicKey,
    encryptionKey: vault.encryptionPublicKey,
  });
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
    signingKey: vault.signingPublicKey,
  });
  const summary = DaoSummarySchema.parse({
    reference: dao,
    title: 'Constitution DAO',
    description: 'Synthetic governing documents',
    privacy: 'public',
    owner: 'alice',
    token: { chainId: dao.chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
    members: 1,
    available: '0',
    reserved: '0',
    claims: '0',
    keyEpoch: '0',
  });
  const metadata = '{"title":"Our constitution","rule":"One member, one vote"}';
  const records = DaoContentSchema.parse({
    dao,
    members: [],
    epochs: [],
    keyGrants: [],
    documents: [
      {
        id: '1',
        document_id: '7',
        version: 1,
        author: '1',
        cid: '',
        metadata,
        commitment: await sha256Hex(new TextEncoder().encode(metadata)),
        bytes: new TextEncoder().encode(metadata).length,
        envelope_version: 0,
        key_epoch: '0',
      },
    ],
  });
  const manifest = Catalog.find((m) => m.id === 'decide');
  if (!manifest) throw new Error('FIXTURE_MANIFEST');
  const module = {
    manifest,
    deployment: {
      id: 'decide',
      account: 'decide',
      version: manifest.version,
      codeHash: ModuleCodeHashes.decide,
    },
    installed: true,
    enabled: true,
    compatible: true,
    codeVerified: true,
    actions: ModulePermissions.decide.actions,
    grants: ModulePermissions.decide.grants,
  };
  const data = ModuleApiRoutes.documents.response.parse({
    dao,
    available: true,
    module,
    registrations: [],
    changes: [],
    acceptances: [],
    acceptedAdoptionIds: [],
    ballots: [],
    votes: [],
    next: null,
  });
  await page.addInitScript(
    (kit) => {
      localStorage.setItem('daclify.vault.v1', kit);
      sessionStorage.setItem('daclify.csrf', 'c'.repeat(43));
    },
    JSON.stringify(
      RecoveryKitSchema.parse({
        version: 1,
        localEnvelope: vault.localEnvelope,
        recoveryEnvelope: vault.recoveryEnvelope,
        signingPublicKey: vault.signingPublicKey,
        encryptionPublicKey: vault.encryptionPublicKey,
      }),
    ),
  );
  let loginMessage = '',
    available = true;
  const actions: string[] = [];
  await page.route('**/v1/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (path === '/v1/network')
      return route.fulfill({
        json: {
          chainId: dao.chainId,
          rpcUrl: 'https://rpc.example',
          runtime: dao.contract,
          hub: null,
          environment: 'testnet',
          interfaceVersion: 1,
          coreVersion: VERSION,
          capabilities: ['governance-policy'],
        },
      });
    if (path === '/v1/sign-in/session') return route.fulfill({ json: { account } });
    if (path === '/v1/me/memberships') return route.fulfill({ json: { memberships: [member] } });
    if (path === '/v1/daos') return route.fulfill({ json: { daos: [summary], next: null } });
    if (path === '/v1/auth/challenge') {
      const input = ApiRoutes.challenge.input.parse(route.request().postDataJSON()),
        id = crypto.randomUUID(),
        expires = new Date(Date.now() + 300000).toISOString();
      loginMessage = JSON.stringify(
        LoginMessageSchema.parse({
          ...input,
          domain: 'daclify.login.v3',
          origin: new URL(page.url()).origin,
          audience: url.origin,
          challenge: id,
          expires,
        }),
      );
      return route.fulfill({ json: { id, message: loginMessage, expires } });
    }
    if (path === '/v1/auth/login')
      return route.fulfill({ json: { account, csrfToken: 'c'.repeat(43) } });
    if (path === '/v1/daos/1/content') return route.fulfill({ json: records });
    if (path === '/v1/daos/1/private-access')
      return route.fulfill({
        json: { dao, privacy: summary.privacy, historyPolicy: 'from-join', keyEpoch: '1' },
      });
    if (path === '/v1/daos/1/modules')
      return route.fulfill({
        json: ModuleStateSchema.parse({
          dao,
          modules: [module],
          ballots: [],
          votes: [],
          projects: [],
          milestones: [],
          schedules: [],
          controls: [],
          executions: [],
          entries: [],
        }),
      });
    if (path === '/v1/daos/1/governance')
      return route.fulfill({
        json: GovernanceStateSchema.parse({
          dao,
          policy: null,
          actors: [],
          sessions: [],
          guardian: null,
          budget: null,
        }),
      });
    if (path === '/v1/daos/1/governing-documents')
      return route.fulfill({
        json: {
          ...data,
          available,
          ...(url.searchParams.has('adoptionId') ? {} : { acceptances: [] }),
        },
      });
    if (path === '/v1/relay') {
      const input = ApiRoutes.relay.input.parse(route.request().postDataJSON());
      expect(input.request.target).toBe('decide');
      expect(input.request.nonce).toBe(member.nonce);
      expect(
        Signature.from(input.sig).verifyDigest(
          instructionDigest(input.request),
          PublicKey.from(vault.signingPublicKey),
        ),
      ).toBe(true);
      const decoded = z.record(z.string(), z.unknown()).parse(
        Serializer.objectify(
          Serializer.decode({
            abi: ABI.from(decideAbi),
            type: input.request.action,
            data: input.request.data,
          }),
        ),
      );
      for (const key of [
        'dao_id',
        'member_id',
        'document_id',
        'register_id',
        'expected_revision',
        'ballot_id',
        'proposal_id',
        'adoption_id',
      ]) {
        if (typeof decoded[key] === 'number') decoded[key] = String(decoded[key]);
      }
      if (input.request.action === 'regdoc') {
        const args = DecideActionSchemas.regdoc.parse(decoded);
        data.registrations.push({
          id: '1',
          dao_id: '1',
          document_id: args.document_id,
          category: args.category,
          approval: args.approval,
          track_acceptance: args.track_acceptance,
          revision: '0',
          adopted_id: '0',
          pending_id: '0',
        });
      } else if (input.request.action === 'proposedoc') {
        const args = DecideActionSchemas.proposedoc.parse(decoded),
          reg = data.registrations[0],
          document = records.documents[0];
        if (!reg || !document) throw new Error('FIXTURE_DOCUMENT');
        expect(args.document_version).toBe(1);
        data.changes.push({
          id: '1',
          dao_id: '1',
          register_id: '1',
          document_id: '7',
          document_version: 1,
          commitment: document.commitment,
          source_hash: ModuleCodeHashes.decide,
          expected_revision: '0',
          policy_revision: '0',
          ballot_id: '0',
          proposer: '1',
          proposed_at: Math.floor(Date.now() / 1000),
          deadline: Math.floor(Date.now() / 1000) + 604800,
          adopted_at: 0,
          adopted_by: '0',
          status: 0,
        });
        reg.pending_id = '1';
      } else if (input.request.action === 'adoptdoc') {
        const args = DecideActionSchemas.adoptdoc.parse(decoded),
          reg = data.registrations[0],
          change = data.changes[0];
        if (!reg || !change) throw new Error('FIXTURE_ADOPTION');
        expect(args.proposal_id).toBe('1');
        reg.pending_id = '0';
        reg.adopted_id = '1';
        reg.revision = '1';
        change.status = 1;
        change.adopted_by = '1';
        change.adopted_at = Math.floor(Date.now() / 1000);
      } else if (input.request.action === 'ackdoc') {
        const args = DecideActionSchemas.ackdoc.parse(decoded);
        expect(args.adoption_id).toBe(data.registrations[0]?.adopted_id);
        expect(data.acceptances).toHaveLength(0);
        data.acceptances.push({
          id: '1',
          dao_id: '1',
          adoption_id: args.adoption_id,
          member_id: '1',
          accepted_at: Math.floor(Date.now() / 1000),
        });
        data.acceptedAdoptionIds.push(args.adoption_id);
      } else throw new Error('Unexpected governing document action');
      actions.push(input.request.action);
      member.nonce = String(BigInt(member.nonce) + 1n);
      return route.fulfill({ json: { transactionId: 'ab'.repeat(32) } });
    }
    return route.fulfill({
      status: 503,
      json: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic service unavailable' },
    });
  });
  await page.goto('/account');
  await page.getByLabel('Vault password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(page.getByText('Keys unlocked', { exact: true })).toBeVisible();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name: 'My DAO', exact: true }).click();
  await page
    .getByRole('link', { name: /Constitution DAO/ })
    .first()
    .click();
  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  await page.getByRole('tab', { name: 'Constitution & legal', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Constitution and legal documents', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Register managed document', exact: true }).click();
  await page.getByLabel('Managed document', { exact: true }).selectOption('7');
  await page.getByRole('button', { name: 'Register document', exact: true }).click();
  await page.getByRole('button', { name: 'Propose version', exact: true }).click();
  await expect(page.getByText('Awaiting administrator approval', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adopt version 1', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Open proposed version 1', exact: true }).click();
  await page.getByRole('button', { name: 'Adopt version 1', exact: true }).click();
  await expect(page.getByText('Adopted version 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign acceptance', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Open adopted version 1', exact: true }).click();
  await page.getByLabel('I reviewed and accept version 1.', { exact: true }).check();
  const previous = data.changes[0],
    registered = data.registrations[0],
    oldDocument = records.documents[0];
  if (!previous || !registered || !oldDocument) throw new Error('FIXTURE_ADOPTION');
  const amended = '{"title":"Amended constitution","rule":"New adopted terms"}';
  const amendedHash = await sha256Hex(new TextEncoder().encode(amended));
  records.documents.push({
    ...oldDocument,
    id: '2',
    version: 2,
    metadata: amended,
    commitment: amendedHash,
    bytes: new TextEncoder().encode(amended).length,
  });
  data.changes.push({
    ...previous,
    id: '2',
    document_version: 2,
    commitment: amendedHash,
    expected_revision: '1',
  });
  registered.adopted_id = '2';
  registered.revision = '2';
  await page.getByRole('button', { name: 'Sign acceptance', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Constitution and legal documents' }).getByRole('alert'),
  ).toContainText('A different version is now adopted.');
  expect(actions).toEqual(['regdoc', 'proposedoc', 'adoptdoc']);
  await expect(page.getByText('Adopted version 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign acceptance', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: 'Constitution & legal', exact: true }).click();
  await page.getByRole('button', { name: 'Open adopted version 2', exact: true }).click();
  await page.getByLabel('I reviewed and accept version 2.', { exact: true }).check();
  await page.getByRole('button', { name: 'Sign acceptance', exact: true }).click();
  await expect(page.getByText('You accepted version 2.', { exact: true })).toBeVisible();
  expect(actions).toEqual(['regdoc', 'proposedoc', 'adoptdoc', 'ackdoc']);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  available = false;
  await page.reload();
  await page.getByRole('tab', { name: 'Constitution & legal', exact: true }).click();
  await expect(
    page.getByText('Formal document management is unavailable for this deployment.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Register document', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Library', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Amended constitution · version 2', exact: true }),
  ).toBeVisible();
  available = true;
  summary.privacy = 'encrypted-user-controlled';
  summary.keyEpoch = '1';
  data.acceptedAdoptionIds = [];
  const privateKey = crypto.getRandomValues(new Uint8Array(32));
  const encrypted = JSON.stringify(
    await sealContent(
      new TextEncoder().encode('Private constitution must remain unread'),
      privateKey,
      contentDomain(dao, '7', 2, '1'),
    ),
  );
  const protectedDocument = records.documents[1],
    adopted = data.changes[1];
  if (!protectedDocument || !adopted) throw new Error('FIXTURE_PRIVATE');
  protectedDocument.metadata = encrypted;
  protectedDocument.commitment = await sha256Hex(new TextEncoder().encode(encrypted));
  protectedDocument.bytes = new TextEncoder().encode(encrypted).length;
  protectedDocument.envelope_version = 1;
  protectedDocument.key_epoch = '1';
  adopted.commitment = protectedDocument.commitment;
  records.epochs = [{ epoch: '1', commitment: await sha256Hex(privateKey), creator: '1' }];
  await page.goto('/account');
  await page.getByLabel('Vault password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(page.getByText('Keys unlocked', { exact: true })).toBeVisible();
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name: 'My DAO', exact: true }).click();
  await page
    .getByRole('link', { name: /Constitution DAO/ })
    .first()
    .click();
  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  await page.getByRole('tab', { name: 'Constitution & legal', exact: true }).click();
  await page.getByRole('button', { name: 'Open adopted version 2', exact: true }).click();
  await expect(page.getByLabel('I reviewed and accept version 2.', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Sign acceptance', exact: true })).toBeDisabled();
  await expect(
    page.getByText('Private constitution must remain unread', { exact: false }),
  ).toHaveCount(0);
  expect(actions).toHaveLength(4);
});
