import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ABI, PrivateKey, PublicKey, Serializer, Signature } from '@wharfkit/antelope';
import {
  AccountSchema,
  ApiRoutes,
  DaoContentSchema,
  LoginMessageSchema,
  PeopleRoutes,
  RecoveryKitSchema,
  TreasurySchema,
  HostedIntentSchema,
} from '@daclify/core-protocol';
import {
  encodeAction,
  instructionDigest,
  runtimeAbi,
  RuntimeActionSchemas,
} from '@daclify/core-protocol/sdk';
import { z } from 'zod';
import { GovernanceStateSchema } from '@daclify/core-protocol';
import { ModuleApiRoutes } from '@daclify/modules';
import { EndorseTableSchemas } from '@daclify/modules/sdk';
import { createVault } from '../../src/auth/vault';
import { moduleFixture } from './fixtures/module-design';

async function fixture(page: Page, visitor = false) {
  const state = await moduleFixture(page, true, visitor);
  const key = PrivateKey.generate('K1').toPublic().toString();
  state.content.members.push(
    ...DaoContentSchema.shape.members.parse(
      ['1', '2'].map((id) => ({
        id,
        native_account: id === '1' ? 'alice' : 'bob',
        signing_key: key,
        encryption_key: 'key',
        custody: 0,
        nonce: '0',
        credits: id === '1' ? '10' : '3',
        active: true,
        admin: id === '1',
        reviewer: id === '2',
        stake: '0',
        claim: '0',
        join_epoch: '1',
      })),
    ),
  );
  const profiles = PeopleRoutes.list.response.parse({
    profiles: ['1', '2'].map((id) => ({
      id,
      dao: state.dao,
      memberId: id,
      accountName: id === '1' ? 'alice' : 'bob',
      profile: {
        name: id === '1' ? 'alice' : 'bob',
        fullName: id === '1' ? 'Alice Adams' : 'Bob Builder',
      },
    })),
    next: null,
  });
  await page.route('**/v1/people*', (route) => route.fulfill({ json: profiles }));
  return state;
}

async function accessible(page: Page) {
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function authenticate(
  page: Page,
  state: Awaited<ReturnType<typeof fixture>>,
  section: 'Documents' | 'Members' | 'Settings',
) {
  const password = 'disposable workspace design fixture',
    vault = await createVault(password);
  Object.assign(
    state.account,
    AccountSchema.parse({
      ...state.account,
      signingKey: vault.signingPublicKey,
      encryptionKey: vault.encryptionPublicKey,
    }),
  );
  state.member.signingKey = vault.signingPublicKey;
  const own = state.content.members.find((row) => row.id === state.member.memberId);
  if (own) {
    own.signing_key = vault.signingPublicKey;
    own.encryption_key = JSON.stringify(vault.encryptionPublicKey);
  }
  await page.addInitScript(
    (kit) => localStorage.setItem('daclify.vault.v1', JSON.stringify(kit)),
    RecoveryKitSchema.parse({
      version: 1,
      localEnvelope: vault.localEnvelope,
      recoveryEnvelope: vault.recoveryEnvelope,
      signingPublicKey: vault.signingPublicKey,
      encryptionPublicKey: vault.encryptionPublicKey,
    }),
  );
  let message = '';
  await page.route('**/v1/auth/challenge', (route) => {
    const input = ApiRoutes.challenge.input.parse(route.request().postDataJSON()),
      id = crypto.randomUUID(),
      expires = new Date(Date.now() + 120000).toISOString();
    message = JSON.stringify(
      LoginMessageSchema.parse({
        ...input,
        domain: 'daclify.login.v3',
        origin: new URL(page.url()).origin,
        audience: new URL(route.request().url()).origin,
        challenge: id,
        expires,
      }),
    );
    return route.fulfill({ json: { id, expires, message } });
  });
  await page.route('**/v1/auth/login', (route) => {
    const input = ApiRoutes.login.input.parse(route.request().postDataJSON());
    expect(
      Signature.from(input.signature).verifyMessage(
        new TextEncoder().encode(message),
        PublicKey.from(vault.signingPublicKey),
      ),
    ).toBe(true);
    return route.fulfill({ json: { account: state.account, csrfToken: 'c'.repeat(43) } });
  });
  await page.goto('/account');
  await page.getByLabel('Vault password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
  await expect(page.getByText('Keys unlocked', { exact: true })).toBeVisible();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name: 'My DAO', exact: true }).click();
  await page
    .getByRole('link', { name: /Design fixture DAO/ })
    .first()
    .click();
  await page.getByRole('link', { name: section, exact: true }).click();
  return vault;
}

async function documentStorage(page: Page, state: Awaited<ReturnType<typeof fixture>>) {
  await page.route('**' + ApiRoutes.storage.path, (route) =>
    route.fulfill({
      json: ApiRoutes.storage.response.parse({
        provider: 'local-fixture',
        configured: true,
        uploadLimit: 5242880,
      }),
    }),
  );
  await page.route('**' + ApiRoutes.storageUsage.path.replace(':id', state.dao.daoId), (route) =>
    route.fulfill({
      json: ApiRoutes.storageUsage.response.parse({
        dao: state.dao,
        capacityBytes: '100000000',
        verifiedBytes: '0',
        reservedBytes: '0',
        totalBytes: '0',
        objects: 0,
        references: 0,
        cleanup: 'disabled',
      }),
    }),
  );
}

async function jsonDocument(page: Page) {
  const formats = page.getByText('Other formats', { exact: true });
  if (!(await formats.evaluate((node) => node.parentElement?.hasAttribute('open'))))
    await formats.click();
  await page.getByLabel('Document format', { exact: true }).selectOption('json');
}

test('document upload stays usable while keys are locked and offers approval in the dialog', async ({
  page,
}) => {
  const state = await fixture(page);
  await documentStorage(page, state);
  await authenticate(page, state, 'Documents');
  await page.getByRole('button', { name: 'Lock keys', exact: true }).click();
  await page.getByRole('button', { name: 'Add document', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Add document', exact: true });
  await expect(popup.getByLabel('Document file', { exact: true })).toBeVisible();
  await popup.getByLabel('Document file', { exact: true }).setInputFiles({
    name: 'Community rules.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('document fixture'),
  });
  await expect(popup.getByLabel('Document name', { exact: true })).toHaveValue(
    'Community rules.pdf',
  );
  await expect(
    popup.getByText('Recover hosted records after database loss', { exact: true }),
  ).toHaveCount(0);
  await expect(popup.getByRole('button', { name: 'Add document', exact: true })).toBeDisabled();
  await popup.screenshot({ path: `.artifacts/document-dialog-${test.info().project.name}.png` });
  await popup
    .getByLabel('Vault password', { exact: true })
    .fill('disposable workspace design fixture');
  await popup.getByRole('button', { name: 'Unlock keys', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Add document', exact: true })).toBeEnabled();
  await expect(popup.getByLabel('Document name', { exact: true })).toHaveValue(
    'Community rules.pdf',
  );
  await accessible(page);
});

test('one document approval publishes the chosen file and a failed signature retries without reuploading', async ({
  page,
}) => {
  const state = await fixture(page);
  await documentStorage(page, state);
  let uploads = 0,
    publications = 0;
  await page.route('**' + ApiRoutes.upload.path, (route) => {
    const input = ApiRoutes.upload.input.parse(route.request().postDataJSON());
    uploads++;
    expect(JSON.parse(input.metadata).filename).toBe('Community charter.pdf');
    return route.fulfill({
      json: ApiRoutes.upload.response.parse({
        ...HostedIntentSchema.strip().parse(input),
        cid: 'bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    });
  });
  const vault = await authenticate(page, state, 'Documents');
  await page.route('**' + ApiRoutes.relay.path, (route) => {
    const input = ApiRoutes.relay.input.parse(route.request().postDataJSON());
    expect(input.request.action).toBe('putdoc');
    expect(
      Signature.from(input.sig).verifyDigest(
        instructionDigest(input.request),
        PublicKey.from(vault.signingPublicKey),
      ),
    ).toBe(true);
    const decoded = z.record(z.string(), z.unknown()).parse(
      Serializer.objectify(
        Serializer.decode({
          abi: ABI.from(runtimeAbi),
          type: 'putdoc',
          data: input.request.data,
        }),
      ),
    );
    for (const key of ['dao_id', 'member_id', 'document_id', 'key_epoch'])
      if (typeof decoded[key] === 'number') decoded[key] = String(decoded[key]);
    const args = RuntimeActionSchemas.putdoc.parse(decoded);
    if (++publications === 1)
      return route.fulfill({
        status: 503,
        json: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic unavailable service' },
      });
    state.content.documents.push({
      id: '50',
      document_id: args.document_id,
      version: args.version,
      author: '1',
      cid: args.cid,
      metadata: args.metadata,
      commitment: args.commitment,
      bytes: args.bytes,
      envelope_version: args.envelope_version,
      key_epoch: args.key_epoch,
    });
    return route.fulfill({
      json: ApiRoutes.relay.response.parse({ transactionId: 'ab'.repeat(32) }),
    });
  });
  await page.getByRole('button', { name: 'Add document', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Add document', exact: true });
  await popup.getByLabel('Document file', { exact: true }).setInputFiles({
    name: 'source.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('document fixture'),
  });
  await popup.getByLabel('Document name', { exact: true }).fill('Community charter.pdf');
  await popup.getByRole('button', { name: 'Add document', exact: true }).click();
  await expect.poll(() => publications).toBe(1);
  await expect(popup.getByRole('alert')).toBeVisible();
  expect(uploads).toBe(1);
  expect(publications).toBe(1);
  await popup.getByRole('button', { name: 'Add document', exact: true }).click();
  await expect(popup).not.toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Community charter.pdf · version 1', exact: true }),
  ).toBeVisible();
  expect(uploads).toBe(1);
  expect(publications).toBe(2);
});

test('signed JSON retries keep one document identity and prevent editing or closing during publication', async ({
  page,
}) => {
  test.setTimeout(60000);
  const state = await fixture(page),
    ids: string[] = [];
  let attempts = 0,
    finish: (() => void) | undefined;
  const vault = await authenticate(page, state, 'Documents');
  await page.route('**' + ApiRoutes.relay.path, async (route) => {
    const input = ApiRoutes.relay.input.parse(route.request().postDataJSON());
    expect(input.request.action).toBe('putjson');
    expect(
      Signature.from(input.sig).verifyDigest(
        instructionDigest(input.request),
        PublicKey.from(vault.signingPublicKey),
      ),
    ).toBe(true);
    const decoded = z.record(z.string(), z.unknown()).parse(
      Serializer.objectify(
        Serializer.decode({
          abi: ABI.from(runtimeAbi),
          type: input.request.action,
          data: input.request.data,
        }),
      ),
    );
    for (const key of ['dao_id', 'member_id', 'document_id', 'key_epoch'])
      if (typeof decoded[key] === 'number') decoded[key] = String(decoded[key]);
    const args = RuntimeActionSchemas.putjson.parse(decoded);
    ids.push(args.document_id);
    expect(args.version).toBe(1);
    expect(args.value).toBe('{"title":"Stable signed draft"}');
    if (++attempts === 2)
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return route.fulfill({
      status: 503,
      json: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic unavailable service' },
    });
  });
  await page.getByRole('button', { name: 'Add document', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Add document', exact: true });
  await jsonDocument(page);
  await popup.getByLabel('JSON content', { exact: true }).fill('{"title":"Stable signed draft"}');
  await popup.getByRole('button', { name: 'Publish JSON', exact: true }).click();
  await expect(popup.getByRole('alert')).toBeVisible();
  await popup.getByRole('button', { name: 'Publish JSON', exact: true }).click();
  await expect.poll(() => attempts).toBe(2);
  await expect(popup.getByLabel('JSON content', { exact: true })).toBeDisabled();
  await expect(popup.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(popup).toBeVisible();
  finish?.();
  await expect(popup.getByRole('alert')).toBeVisible();
  expect(new Set(ids).size).toBe(1);
  await expect(popup.getByLabel('JSON content', { exact: true })).toHaveValue(
    '{"title":"Stable signed draft"}',
  );
});

test('failed signed admission retains the verified public identity in the popup', async ({
  page,
}) => {
  test.setTimeout(60000);
  const state = await fixture(page),
    applicant = await createVault('disposable applicant fixture');
  const identity = JSON.stringify({
    version: 1,
    signingKey: applicant.signingPublicKey,
    encryptionKey: applicant.encryptionPublicKey,
    custody: 'user-controlled',
  });
  await authenticate(page, state, 'Members');
  let admissions = 0;
  await page.route('**' + ApiRoutes.relay.path, (route) => {
    const input = ApiRoutes.relay.input.parse(route.request().postDataJSON());
    expect(input.request.action).toBe('addmember');
    admissions++;
    return route.fulfill({
      status: 503,
      json: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic unavailable service' },
    });
  });
  await page.getByRole('button', { name: 'Add member', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Add member', exact: true });
  await popup.getByLabel('Public join identity', { exact: true }).fill(identity);
  await popup
    .getByLabel('I confirmed these public keys, participant identity and application terms', {
      exact: true,
    })
    .check();
  await popup.getByRole('button', { name: 'Sign participant admission', exact: true }).click();
  await expect.poll(() => admissions).toBe(1);
  await expect(popup.getByRole('alert')).toBeVisible();
  await expect(popup.getByLabel('Public join identity', { exact: true })).toHaveValue(identity);
  await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Add member', exact: true }).click();
  await expect(popup.getByLabel('Public join identity', { exact: true })).toHaveValue(identity);
});

test('Treasury keeps exact balances and separates deposits from searchable payment records', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.route('**/v1/daos/1/treasury', (route) =>
    route.fulfill({
      json: TreasurySchema.parse({
        dao: state.dao,
        evidence: [],
        obligations: [
          {
            id: '1',
            source: 'works',
            source_id: '7',
            recipient: '2',
            quantity: '12.3456 TLOS',
            due: 0,
            status: 1,
          },
          {
            id: '2',
            source: 'payroll',
            source_id: '8',
            recipient: '1',
            quantity: '2.0000 TLOS',
            due: 0,
            status: 2,
          },
        ],
      }),
    }),
  );
  await page.goto('/dao/1/treasury');
  await expect(page.getByRole('tab', { name: 'Payments', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^12\.3456 TLOS/ })).toBeVisible();
  await page.getByLabel('Search payments', { exact: true }).fill('Bob');
  await expect(page.getByRole('heading', { name: /^2\.0000 TLOS/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Deposit tokens', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Deposit tokens', exact: true });
  await expect(popup).toBeVisible();
  await expect(popup.getByText('dao:1', { exact: true })).toBeVisible();
  await accessible(page);
  await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
  await accessible(page);
});

test('Documents uses titles and stable drafts instead of asking for document IDs', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/dao/1/documents');
  await expect(page.getByRole('tab', { name: 'Library', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Council rules · version 2', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Private title must stay hidden', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add document', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Add document', exact: true });
  await expect(popup).toBeVisible();
  await expect(popup.getByLabel('Document ID', { exact: true })).toHaveCount(0);
  await expect(popup.getByLabel('File document ID', { exact: true })).toHaveCount(0);
  await jsonDocument(page);
  await popup.getByLabel('JSON content', { exact: true }).fill('{"title":"A saved draft"}');
  await accessible(page);
  await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Add document', exact: true }).click();
  await expect(popup.getByLabel('JSON content', { exact: true })).toHaveValue(
    '{"title":"A saved draft"}',
  );
  await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
  await accessible(page);
});

test('Members puts role filters and tools together and initializes the named role popup', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/dao/1/members');
  await expect(page.getByRole('tab', { name: 'Directory', exact: true })).toBeVisible();
  await page.getByLabel('Member role', { exact: true }).selectOption('Reviewer');
  await expect(page.getByRole('link', { name: 'Bob Builder', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Alice Adams', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Manage Bob Builder', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Manage Bob Builder', exact: true });
  await expect(popup.getByLabel('Reviewer', { exact: true })).toBeChecked();
  await expect(popup.getByLabel('Administrator', { exact: true })).not.toBeChecked();
  await expect(popup.getByLabel('Governance credits', { exact: true })).toHaveValue('3');
  await accessible(page);
  await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
  await accessible(page);
});

test('keeps a new document draft separate from a draft revision of an existing document', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/dao/1/documents');
  await page.getByRole('button', { name: 'Add document', exact: true }).click();
  let popup = page.getByRole('dialog');
  await jsonDocument(page);
  await popup.getByLabel('JSON content', { exact: true }).fill('{"title":"New draft"}');
  await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
  const document = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Council rules · version 2', exact: true }) });
  await document.getByRole('button', { name: 'Add version', exact: true }).click();
  popup = page.getByRole('dialog', { name: 'Add document version', exact: true });
  await popup.getByLabel('JSON content', { exact: true }).fill('{"title":"Revision draft"}');
  await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Add document', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add document', exact: true })).toBeVisible();
  await expect(page.getByLabel('JSON content', { exact: true })).toHaveValue(
    '{"title":"New draft"}',
  );
});

test('Visitors can browse Members without admission or permission-changing controls', async ({
  page,
}) => {
  await fixture(page, true);
  await page.goto('/dao/1/members');
  await expect(page.getByRole('tab', { name: 'Directory', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add member', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^Manage (Alice|Bob)/ })).toHaveCount(0);
});

test('an unreadable application identity produces a useful error rather than crashing renewal', async ({
  page,
}) => {
  const state = await fixture(page),
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  state.modules.joinApplications.push(
    EndorseTableSchemas.joinapps.parse({
      id: '8',
      dao_id: '1',
      sponsor: '1',
      revision: '1',
      policy_revision: '1',
      signing_key: PrivateKey.generate('K1').toPublic().toString(),
      encryption_key: 'broken JSON',
      custody: 0,
      kind: 0,
      operator_label: '',
      document_id: '42',
      document_version: 2,
      document_commitment: 'bb'.repeat(32),
      expires: Math.floor(Date.now() / 1000) + 86400,
      witnesses: [],
      admitted: false,
      member_id: '0',
    }),
  );
  await page.route('**/v1/daos/1/governance', (route) =>
    route.fulfill({
      json: GovernanceStateSchema.parse({
        dao: state.dao,
        policy: null,
        actors: [],
        sessions: [],
        guardian: null,
        budget: null,
        admission: {
          dao_id: '1',
          revision: '1',
          mode: 1,
          source: 'endorse',
          threshold: 2,
          allow_agents: false,
          admin_override: false,
        },
      }),
    }),
  );
  await page.goto('/dao/1/members');
  await page.getByRole('tab', { name: 'Applications', exact: true }).click();
  await page.getByRole('button', { name: 'Renew application', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('public identity');
  expect(errors).toEqual([]);
});

test('switching between Members and Documents selects the correct default subtab without reloading', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/dao/1/members');
  const navigation = page.getByRole('navigation', { name: 'DAO sections' });
  await navigation.getByRole('link', { name: 'Documents', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Library', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    page.getByRole('heading', { name: 'Council rules · version 2', exact: true }),
  ).toBeVisible();
  await navigation.getByRole('link', { name: 'Members', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Directory', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('link', { name: 'Bob Builder', exact: true })).toBeVisible();
});

test('the legal register names the adopted version even when a newer library draft exists', async ({
  page,
}) => {
  const state = await fixture(page),
    module = state.modules.modules[0];
  if (!module) throw new Error('Missing Decide fixture');
  const data = ModuleApiRoutes.documents.response.parse({
    dao: state.dao,
    available: true,
    module,
    registrations: [
      {
        id: '7',
        dao_id: '1',
        document_id: '42',
        category: 0,
        approval: 0,
        track_acceptance: false,
        revision: '1',
        adopted_id: '7',
        pending_id: '0',
      },
    ],
    changes: [
      {
        id: '7',
        dao_id: '1',
        register_id: '7',
        document_id: '42',
        document_version: 1,
        commitment: 'aa'.repeat(32),
        source_hash: module.deployment.codeHash,
        expected_revision: '0',
        policy_revision: '0',
        ballot_id: '0',
        proposer: '1',
        proposed_at: 1,
        deadline: 0,
        adopted_at: 2,
        adopted_by: '1',
        status: 1,
      },
    ],
    acceptances: [],
    acceptedAdoptionIds: [],
    ballots: [],
    votes: [],
    next: null,
  });
  await page.route('**/v1/daos/1/governing-documents*', (route) => route.fulfill({ json: data }));
  await page.goto('/dao/1/documents');
  await page.getByRole('tab', { name: 'Constitution & legal', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Constitution · Council rules · version 1', exact: true }),
  ).toBeVisible();
});

test('settings shows saved values, retains cancelled edits and supports keyboard navigation', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/dao/1/settings?keep=1#configuration');
  await expect(page.getByRole('heading', { name: 'DAO settings', exact: true })).toHaveCount(0);
  const identity = page.getByRole('tab', { name: 'Identity', exact: true });
  await expect(identity).toHaveAttribute('aria-selected', 'true');
  const tabsBox = await page
    .getByRole('tablist', { name: 'DAO settings sections', exact: true })
    .boundingBox();
  const helpBox = await page
    .getByRole('link', { name: 'Settings help', exact: true })
    .boundingBox();
  if (!tabsBox || !helpBox) throw new Error('Missing settings toolbar');
  expect(helpBox.y).toBeLessThan(tabsBox.y + tabsBox.height);
  expect(helpBox.x).toBeGreaterThanOrEqual(tabsBox.x + tabsBox.width);
  await expect(page.getByRole('link', { name: 'Settings help', exact: true })).toHaveAttribute(
    'href',
    '/docs/dao-governance?dao=1',
  );
  await page.getByRole('button', { name: 'Edit DAO name', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Edit DAO name', exact: true });
  await rename.getByLabel('New DAO name', { exact: true }).fill('Cancelled name draft');
  await rename.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Edit DAO name', exact: true }).click();
  await expect(rename.getByLabel('New DAO name', { exact: true })).toHaveValue(
    'Cancelled name draft',
  );
  await page.keyboard.press('Escape');
  await expect(rename).not.toBeVisible();
  await page.getByRole('button', { name: 'Edit directory card', exact: true }).click();
  const card = page.getByRole('dialog', { name: 'Edit directory card', exact: true });
  await card.getByLabel('Card summary').fill('Cancelled public summary');
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  await identity.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/keep=1.*settings=governance.*#configuration$/);
  await expect(page.getByRole('heading', { name: 'Voting rules', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit voting rules', exact: true }).click();
  const policy = page.getByRole('dialog', { name: 'Edit voting rules', exact: true });
  await expect(policy.getByLabel('Policy quorum (%)', { exact: true })).toHaveValue('50');
  await policy.getByLabel('Policy quorum (%)', { exact: true }).fill('60');
  await policy.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('tab', { name: 'Identity', exact: true }).click();
  await page.getByRole('button', { name: 'Edit directory card', exact: true }).click();
  await expect(card.getByLabel('Card summary')).toHaveValue('Cancelled public summary');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Governance', exact: true }).click();
  await page.getByRole('button', { name: 'Edit voting rules', exact: true }).click();
  await expect(policy.getByLabel('Policy quorum (%)', { exact: true })).toHaveValue('60');
  await accessible(page);
  await page.screenshot({ path: test.info().outputPath('settings-policy.png'), fullPage: true });
});

test('signed policy updates preserve exact limits and keep failed edits while blocking pending changes', async ({
  page,
}) => {
  test.setTimeout(60000);
  const state = await fixture(page);
  const vault = await authenticate(page, state, 'Settings');
  await page.getByRole('tab', { name: 'Governance', exact: true }).click();
  await page.getByRole('button', { name: 'Edit voting rules', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Edit voting rules', exact: true });
  await popup.getByLabel('Policy duration', { exact: true }).fill('7');
  await popup.getByLabel('Policy quorum (%)', { exact: true }).fill('75');
  await popup.getByLabel('Per milestone / installment maximum (TLOS)', { exact: true }).fill('250');
  await popup.getByLabel('Daily commitment maximum (TLOS)', { exact: true }).fill('1000');
  let attempts = 0;
  let finish: (() => void) | undefined;
  const settings = state.governance.policy?.config;
  if (!settings) throw new Error('Missing governance fixture');
  await page.route('**' + ApiRoutes.relay.path, async (route) => {
    const input = ApiRoutes.relay.input.parse(route.request().postDataJSON());
    expect(input.request.action).toBe('setdaogov');
    expect(
      Signature.from(input.sig).verifyDigest(
        instructionDigest(input.request),
        PublicKey.from(vault.signingPublicKey),
      ),
    ).toBe(true);
    expect(input.request.data).toBe(
      Buffer.from(
        encodeAction('setdaogov', {
          runtime: state.dao.contract,
          dao_id: state.dao.daoId,
          member_id: state.member.memberId,
          settings: {
            ...settings,
            duration: 604800,
            quorum: 7500,
            max_commitment: '2500000',
            daily_commitment: '10000000',
          },
        }),
      ).toString('hex'),
    );
    attempts++;
    if (attempts === 1)
      return route.fulfill({
        status: 503,
        json: { code: 'SERVICE_UNAVAILABLE', message: 'Try again.' },
      });
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return route.fulfill({
      json: ApiRoutes.relay.response.parse({ transactionId: 'd'.repeat(64) }),
    });
  });
  await popup.getByRole('button', { name: 'Sign policy update', exact: true }).click();
  await expect(popup.getByRole('alert')).toBeVisible();
  await expect(popup.getByLabel('Policy quorum (%)', { exact: true })).toHaveValue('75');
  await expect(popup.getByLabel('Daily commitment maximum (TLOS)', { exact: true })).toHaveValue(
    '1000',
  );
  await popup.getByRole('button', { name: 'Sign policy update', exact: true }).click();
  await expect.poll(() => attempts).toBe(2);
  await expect(popup.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await expect(popup.getByLabel('Policy quorum (%)', { exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(popup).toBeVisible();
  finish?.();
  await expect(popup).not.toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /Policy updated/ })).toBeVisible();
  expect(attempts).toBe(2);
});
