import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  AccountSchema,
  ContentEnvelopeSchema,
  contentDomain,
  epochGrantDomain,
  ApiRoutes,
  DaoContentSchema,
  LoginMessageSchema,
  RecoveryKitSchema,
} from '@daclify/core-protocol';
import { instructionDigest, runtimeAbi, RuntimeActionSchemas } from '@daclify/core-protocol/sdk';
import {
  Catalog,
  ModulePermissions,
  ModuleStateSchema,
  ServiceOfferDocumentSchema,
} from '@daclify/modules';
import { ModuleCodeHashes, WorksActionSchemas, worksAbi } from '@daclify/modules/sdk';
import { ABI, Checksum256, PrivateKey, PublicKey, Serializer, Signature } from '@wharfkit/antelope';
import { z } from 'zod';
import {
  createVault,
  createEpochGrant,
  sealContent,
  openContent,
  sha256Hex,
} from '../../src/auth/vault';
import { moduleFixture } from './fixtures/module-design';

test.use({ timezoneId: 'UTC' });

async function fixture(page: Page, visitor = false) {
  const state = await moduleFixture(page, true, visitor);
  const manifest = Catalog.find((m) => m.id === 'works');
  if (!manifest) throw new Error('Works manifest missing');
  state.modules.modules.push({
    manifest,
    deployment: {
      id: 'works',
      account: 'works',
      version: manifest.version,
      codeHash: ModuleCodeHashes.works,
    },
    enabled: true,
    installed: true,
    compatible: true,
    codeVerified: true,
    actions: [...ModulePermissions.works.actions],
    grants: [...ModulePermissions.works.grants],
  });
  Object.assign(
    state.content,
    DaoContentSchema.parse({
      ...state.content,
      members: ['1', '2', '3'].map((id) => ({
        id,
        native_account: id === '1' ? 'alice' : 'bob',
        signing_key: PrivateKey.generate('K1').toPublic().toString(),
        encryption_key: 'key',
        custody: 0,
        nonce: '0',
        credits: '0',
        active: id !== '3',
        admin: id === '1',
        reviewer: false,
        stake: '0',
        claim: '0',
        join_epoch: '1',
      })),
    }),
  );
  const document = state.content.documents[0];
  if (!document) throw new Error('Fixture document missing');
  state.content.documents.push({
    ...document,
    id: '14',
    document_id: '44',
    metadata: JSON.stringify(
      ServiceOfferDocumentSchema.parse({
        schemaVersion: 1,
        type: 'service-offer',
        dao: state.dao,
        memberId: '2',
        title: 'Garden care',
        summary: 'Watering and planting',
        skills: ['gardening'],
      }),
    ),
    author: '2',
  });
  for (const doc of state.content.documents.filter((row) => row.envelope_version === 0)) {
    doc.commitment = Checksum256.hash(new TextEncoder().encode(doc.metadata)).toString();
    doc.bytes = new TextEncoder().encode(doc.metadata).length;
  }
  Object.assign(
    state.modules,
    ModuleStateSchema.parse({
      ...state.modules,
      projects: [
        {
          id: '90',
          dao_id: '1',
          creator: '1',
          contributor: '2',
          document_id: '42',
          document_version: 2,
          milestones: ['91'],
          status: 0,
        },
        {
          id: '92',
          dao_id: '1',
          creator: '1',
          contributor: '1',
          document_id: '43',
          document_version: 1,
          milestones: [],
          status: 1,
        },
        {
          id: '93',
          dao_id: '1',
          creator: '1',
          contributor: '2',
          document_id: '42',
          document_version: 1,
          milestones: [],
          status: 2,
        },
      ],
      milestones: [
        {
          id: '91',
          dao_id: '1',
          project_id: '90',
          quantity: '1.0000 TLOS',
          due: 0,
          status: 0,
          submission_doc: '0',
          submission_version: 0,
          review_doc: '0',
          review_version: 0,
          reviewer: '0',
        },
      ],
    }),
  );
  await page.route('**/v1/people?*', (route) =>
    route.fulfill({
      json: {
        profiles: [
          {
            id: '1',
            dao: state.dao,
            memberId: '2',
            accountName: 'bob',
            profile: { name: 'bob', fullName: 'Bob Builder' },
          },
        ],
        next: null,
      },
    }),
  );
  return state;
}

test('Works starts with a filtered work list and opens a named contributor and document popup', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/dao/1/works');
  const add = page.getByRole('button', { name: 'Propose milestone work', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Propose milestone work', exact: true });
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Works', exact: true })).toHaveCount(0);
  await expect(add.locator('svg')).toHaveCSS('width', '32px');
  await expect(
    page.getByRole('link', { name: 'Work rules and help', exact: true }),
  ).toHaveAttribute('href', '/docs/works?dao=1');
  await expect(page.getByRole('tab', { name: 'Work proposals', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const projects = page
    .getByRole('tabpanel', { name: 'Work proposals' })
    .locator('article.work-project');
  await expect(projects).toHaveCount(3);
  await page.getByLabel('Search work').fill('Bob Builder');
  await expect(projects).toHaveCount(2);
  await page.getByLabel('Work status').selectOption('0');
  await expect(projects).toHaveCount(1);
  await page.getByLabel('Filter by contributor').selectOption('1');
  await expect(page.getByRole('heading', { name: 'No matching work' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(projects).toHaveCount(3);
  await add.click();
  await expect(dialog.getByLabel('Contributor', { exact: true })).toBeFocused();
  await expect(dialog.getByLabel('Contributor', { exact: true }).locator('option')).toContainText([
    'Choose a member',
    'alice',
    'Bob Builder',
  ]);
  await expect(
    dialog.getByLabel('Contributor', { exact: true }).locator('option[value="3"]'),
  ).toHaveCount(0);
  const documents = dialog.getByLabel('Proposal document', { exact: true });
  await documents.selectOption('12');
  await expect(documents.locator('option[value="12"]')).toHaveText('Council rules · version 2');
  await expect(dialog).not.toContainText('Private title must stay hidden');
  await dialog.getByLabel('Contributor', { exact: true }).selectOption('2');
  await page.keyboard.press('Escape');
  await expect(add).toBeFocused();
  await add.click();
  await expect(documents).toHaveValue('12');
  await expect(dialog.getByRole('button', { name: 'Propose work', exact: true })).toBeDisabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('work-popup.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('work-list.png'), fullPage: true });
});

test('member services are optional offers and choose opens the same work popup with the provider selected', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/dao/1/works');
  await page.getByRole('tab', { name: 'Member services', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Garden care', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Propose work with this member', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Propose milestone work', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Contributor', { exact: true })).toHaveValue('2');
  await expect(dialog.getByLabel('Proposal document', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('failed or foreign document reads keep Works browseable and never populate a foreign proposal', async ({
  page,
}) => {
  const state = await fixture(page);
  let mode = 'failed';
  await page.route('**/v1/daos/1/content', (route) =>
    route.fulfill(
      mode === 'failed'
        ? { status: 503, json: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic read outage' } }
        : {
            json: {
              ...state.content,
              dao: mode === 'foreign' ? { ...state.dao, daoId: '2' } : state.dao,
            },
          },
    ),
  );
  await page.goto('/dao/1/works');
  await expect(page.locator('article.work-project')).toHaveCount(3);
  await page.getByRole('button', { name: 'Propose milestone work', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Propose milestone work', exact: true });
  await expect(
    dialog.getByRole('button', { name: 'Retry members and documents', exact: true }),
  ).toBeVisible();
  mode = 'foreign';
  await dialog.getByRole('button', { name: 'Retry members and documents', exact: true }).click();
  await expect(
    dialog.getByLabel('Proposal document', { exact: true }).locator('option[value="12"]'),
  ).toHaveCount(0);
  mode = 'ok';
  await dialog.getByRole('button', { name: 'Retry members and documents', exact: true }).click();
  await expect(
    dialog.getByLabel('Proposal document', { exact: true }).locator('option[value="12"]'),
  ).toHaveCount(1);
});

test('visitors can browse work and services but cannot open a proposal', async ({ page }) => {
  await fixture(page, true);
  await page.goto('/dao/1/works');
  await expect(
    page.getByRole('button', { name: 'Propose milestone work', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('dialog', { name: 'Propose milestone work', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('tab', { name: 'Member services', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Propose work with this member', exact: true }),
  ).toBeDisabled();
});

test('a signed proposal pins the chosen member and document version, retains failed drafts and blocks pending dismissal', async ({
  page,
}) => {
  const state = await fixture(page),
    password = 'disposable Works design fixture',
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
  let message = '',
    attempts = 0,
    release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/v1/auth/challenge', (route) => {
    const input = ApiRoutes.challenge.input.parse(route.request().postDataJSON()),
      id = crypto.randomUUID(),
      expires = new Date(Date.now() + 120000).toISOString(),
      origin = new URL(route.request().url()).origin;
    message = JSON.stringify(
      LoginMessageSchema.parse({
        ...input,
        domain: 'daclify.login.v3',
        origin,
        audience: origin,
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
  await page.route('**/v1/relay', async (route) => {
    const input = ApiRoutes.relay.input.parse(route.request().postDataJSON());
    expect(input.request.action).toBe('propose');
    expect(input.request.target).toBe('works');
    expect(
      Signature.from(input.sig).verifyDigest(
        instructionDigest(input.request),
        PublicKey.from(vault.signingPublicKey),
      ),
    ).toBe(true);
    const fields = z
      .record(z.string(), z.unknown())
      .parse(
        Serializer.objectify(
          Serializer.decode({ abi: ABI.from(worksAbi), type: 'propose', data: input.request.data }),
        ),
      );
    for (const key of ['dao_id', 'member_id', 'project_id', 'contributor', 'document_id'])
      if (typeof fields[key] === 'number') fields[key] = String(fields[key]);
    const decoded = WorksActionSchemas.propose.parse(fields);
    expect(decoded).toMatchObject({
      contributor: '2',
      document_id: '42',
      document_version: 2,
      payments: ['10.0000 TLOS', '20.0000 TLOS'],
      dues: [0, Math.floor(Date.parse('2030-01-02T09:00:00Z') / 1000)],
    });
    attempts++;
    if (attempts === 1)
      return route.fulfill({
        status: 503,
        json: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic relay outage' },
      });
    await held;
    state.member.nonce = '1';
    return route.fulfill({ json: { transactionId: 'ab'.repeat(32) } });
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
  await page.getByRole('link', { name: 'Works', exact: true }).click();
  await page.getByRole('button', { name: 'Propose milestone work', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Propose milestone work', exact: true });
  await dialog.getByLabel('Contributor', { exact: true }).selectOption('2');
  await dialog.getByLabel('Proposal document', { exact: true }).selectOption('12');
  const submit = dialog.getByRole('button', { name: 'Propose work', exact: true });
  const firstAmount = dialog.getByLabel('Milestone 1 amount (TLOS)', { exact: true });
  await expect(submit).toBeDisabled();
  for (const invalid of ['0', '1.25', '1e3', '461168601842739']) {
    await firstAmount.fill(invalid);
    await expect(submit).toBeDisabled();
    expect(attempts).toBe(0);
  }
  await firstAmount.fill('10');
  await dialog.getByRole('button', { name: 'Add milestone', exact: true }).click();
  const secondAmount = dialog.getByLabel('Milestone 2 amount (TLOS)', { exact: true });
  await expect(submit).toBeDisabled();
  await secondAmount.fill('20');
  await dialog
    .getByLabel('Milestone 2 due date (optional)', { exact: true })
    .fill('2030-01-02T09:00');
  await expect(dialog.getByRole('status', { name: 'Total milestone payment' })).toHaveText(
    '30 TLOS',
  );
  await expect(submit).toBeDisabled();
  const confirmation = dialog.getByLabel('I checked the milestone amounts and total', {
    exact: true,
  });
  await confirmation.check();
  await expect(submit).toBeEnabled();
  await secondAmount.fill('21');
  await expect(confirmation).not.toBeChecked();
  await expect(submit).toBeDisabled();
  await secondAmount.fill('20');
  await confirmation.check();
  await submit.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('Proposal document', { exact: true })).toHaveValue('12');
  await expect(firstAmount).toHaveValue('10');
  await expect(secondAmount).toHaveValue('20');
  await expect(confirmation).toBeChecked();
  await submit.click();
  await expect.poll(() => attempts).toBe(2);
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await expect(firstAmount).toBeDisabled();
  await expect(secondAmount).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Work proposed' })).toBeVisible();
});

test('foreign profile names are rejected and retry restores the DAO member’s readable name', async ({
  page,
}) => {
  const state = await fixture(page);
  let foreign = true;
  await page.route('**/v1/people?*', (route) =>
    route.fulfill({
      json: {
        profiles: [
          {
            id: '1',
            dao: foreign ? { ...state.dao, daoId: '2' } : state.dao,
            memberId: '2',
            accountName: 'bob',
            profile: { name: 'bob', fullName: foreign ? 'Foreign profile' : 'Bob Builder' },
          },
        ],
        next: null,
      },
    }),
  );
  await page.goto('/dao/1/works');
  await expect(page.getByRole('button', { name: 'Retry member names', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Propose milestone work', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Propose milestone work', exact: true });
  await expect(
    dialog.getByLabel('Contributor', { exact: true }).locator('option[value="2"]'),
  ).toHaveText('bob');
  await expect(page.locator('#main')).not.toContainText('Foreign profile');
  foreign = false;
  await dialog.getByRole('button', { name: 'Refresh members and documents', exact: true }).click();
  await expect(
    dialog.getByLabel('Contributor', { exact: true }).locator('option[value="2"]'),
  ).toHaveText('Bob Builder · bob');
});

test('milestone rows start empty, label whole TLOS payments and update their exact total on add or remove', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/dao/1/works');
  await page.getByRole('button', { name: 'Propose milestone work', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Propose milestone work', exact: true });
  const amount1 = dialog.getByLabel('Milestone 1 amount (TLOS)', { exact: true });
  await expect(amount1).toHaveValue('');
  await expect(dialog.getByLabel(/Milestone amounts/)).toHaveCount(0);
  await amount1.fill('10');
  await dialog.getByRole('button', { name: 'Add milestone', exact: true }).click();
  const amount2 = dialog.getByLabel('Milestone 2 amount (TLOS)', { exact: true });
  await expect(amount2).toBeFocused();
  await expect(amount2).toHaveValue('');
  await expect(dialog.getByRole('status', { name: 'Total milestone payment' })).toHaveText(
    'Complete every amount to see the total.',
  );
  await amount2.fill('25');
  await expect(dialog.getByRole('status', { name: 'Total milestone payment' })).toHaveText(
    '35 TLOS',
  );
  await dialog.getByLabel('I checked the milestone amounts and total', { exact: true }).check();
  await amount2.fill('30');
  await expect(
    dialog.getByLabel('I checked the milestone amounts and total', { exact: true }),
  ).not.toBeChecked();
  await expect(dialog.getByRole('status', { name: 'Total milestone payment' })).toHaveText(
    '40 TLOS',
  );
  await dialog.getByRole('button', { name: 'Remove milestone 1', exact: true }).click();
  await expect(dialog.getByLabel('Milestone 1 amount (TLOS)', { exact: true })).toHaveValue('30');
  await expect(dialog.getByRole('status', { name: 'Total milestone payment' })).toHaveText(
    '30 TLOS',
  );
  await expect(
    dialog.getByRole('button', { name: 'Remove milestone 1', exact: true }),
  ).toBeDisabled();
  for (const value of ['0', '-2', '1.25', '1e3', '1,000', '461168601842739']) {
    await dialog.getByLabel('Milestone 1 amount (TLOS)', { exact: true }).fill(value);
    await expect(dialog.getByRole('button', { name: 'Propose work', exact: true })).toBeDisabled();
    await expect(
      dialog.getByLabel('I checked the milestone amounts and total', { exact: true }),
    ).toBeDisabled();
    await expect(dialog.getByRole('status', { name: 'Total milestone payment' })).not.toContainText(
      'TLOS',
    );
  }
  await dialog.getByLabel('Milestone 1 amount (TLOS)', { exact: true }).fill('30');
  for (let i = 1; i < 16; i++)
    await dialog.getByRole('button', { name: 'Add milestone', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Add milestone', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel(/Milestone \d+ amount \(TLOS\)/)).toHaveCount(16);
  await dialog.getByRole('button', { name: 'Remove milestone 8', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Add milestone', exact: true })).toBeEnabled();
  await expect(dialog.getByLabel(/Milestone \d+ amount \(TLOS\)/)).toHaveCount(15);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('service authoring uses named fields and visitors cannot publish', async ({ page }) => {
  await fixture(page);
  await page.goto('/dao/1/works');
  await page.getByRole('tab', { name: 'Member services', exact: true }).click();
  await page.getByRole('button', { name: 'Offer a service', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Offer a service', exact: true });
  await expect(form.getByLabel('Service name', { exact: true })).toBeVisible();
  await expect(form.getByLabel('What you offer', { exact: true })).toBeVisible();
  await expect(
    form.getByText('This offer will be public on chain.', { exact: true }),
  ).toBeVisible();
  await expect(form.getByRole('button', { name: 'Publish offer', exact: true })).toBeDisabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('signed service publication retains an outage draft and publishes valid member-owned JSON', async ({
  page,
}) => {
  test.setTimeout(60000);
  const state = await fixture(page),
    password = 'disposable service fixture',
    vault = await createVault(password);
  state.account.signingKey = vault.signingPublicKey;
  state.account.encryptionKey = vault.encryptionPublicKey;
  state.member.signingKey = vault.signingPublicKey;
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
  let message = '',
    writes = 0;
  await page.route('**/v1/auth/challenge', (route) => {
    const input = ApiRoutes.challenge.input.parse(route.request().postDataJSON()),
      id = crypto.randomUUID(),
      expires = new Date(Date.now() + 120000).toISOString(),
      origin = new URL(page.url()).origin;
    message = JSON.stringify(
      LoginMessageSchema.parse({
        ...input,
        domain: 'daclify.login.v3',
        origin,
        audience: origin,
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
  await page.route('**/v1/relay', (route) => {
    const input = ApiRoutes.relay.input.parse(route.request().postDataJSON());
    expect(input.request.action).toBe('putjson');
    expect(input.request.target).toBe('daclifycore');
    expect(
      Signature.from(input.sig).verifyDigest(
        instructionDigest(input.request),
        PublicKey.from(vault.signingPublicKey),
      ),
    ).toBe(true);
    const native = z.coerce.string().pipe(z.string().regex(/^[0-9]+$/));
    const value = RuntimeActionSchemas.putjson
      .extend({ dao_id: native, member_id: native, document_id: native, key_epoch: native })
      .parse(
        Serializer.objectify(
          Serializer.decode({
            abi: ABI.from(runtimeAbi),
            type: 'putjson',
            data: input.request.data,
          }),
        ),
      );
    expect(value.envelope_version).toBe(0);
    expect(ServiceOfferDocumentSchema.parse(JSON.parse(value.value))).toMatchObject({
      dao: state.dao,
      memberId: '1',
      title: 'Garden support',
      summary: 'Weekly maintenance',
      skills: ['Pruning', 'Watering'],
    });
    writes++;
    if (writes === 1)
      return route.fulfill({
        status: 503,
        json: { code: 'SERVICE_UNAVAILABLE', message: 'Fixture outage' },
      });
    state.member.nonce = String(BigInt(state.member.nonce) + 1n);
    state.content.documents.push({
      id: '99',
      document_id: value.document_id,
      version: 1,
      author: '1',
      cid: '',
      metadata: value.value,
      commitment: Checksum256.hash(new TextEncoder().encode(value.value)).toString(),
      bytes: new TextEncoder().encode(value.value).length,
      envelope_version: 0,
      key_epoch: '0',
    });
    return route.fulfill({ json: { transactionId: 'ab'.repeat(32) } });
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
  await page.getByRole('link', { name: 'Works', exact: true }).click();
  await page.getByRole('tab', { name: 'Member services', exact: true }).click();
  await page.getByRole('button', { name: 'Offer a service', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Offer a service', exact: true });
  await form.getByLabel('Service name', { exact: true }).fill('Garden support');
  await form.getByLabel('What you offer', { exact: true }).fill('Weekly maintenance');
  await form.getByLabel('Skills (one per line)', { exact: true }).fill('Pruning\nWatering');
  await form.getByRole('button', { name: 'Publish offer', exact: true }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  await expect(form.getByLabel('Service name', { exact: true })).toHaveValue('Garden support');
  await form.getByRole('button', { name: 'Publish offer', exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Garden support', exact: true })).toBeVisible();
  expect(writes).toBe(2);
});

test('private services encrypt publication, read granted batches and disappear when keys lock', async ({
  page,
}) => {
  test.setTimeout(90000);
  const state = await fixture(page),
    password = 'disposable private service fixture',
    vault = await createVault(password),
    epochKey = crypto.getRandomValues(new Uint8Array(32));
  state.summary.privacy = 'encrypted-user-controlled';
  state.summary.keyEpoch = '1';
  state.account.signingKey = vault.signingPublicKey;
  state.account.encryptionKey = vault.encryptionPublicKey;
  state.member.signingKey = vault.signingPublicKey;
  const member = state.content.members.find((row) => row.id === '1');
  if (!member) throw Error('Fixture member');
  member.signing_key = vault.signingPublicKey;
  member.encryption_key = JSON.stringify(vault.encryptionPublicKey);
  state.content.epochs = [{ epoch: '1', commitment: await sha256Hex(epochKey), creator: '1' }];
  state.content.keyGrants = [
    {
      id: '1',
      epoch: '1',
      recipient: '1',
      grantor: '1',
      envelope: JSON.stringify(
        await createEpochGrant(
          vault.encryptionPublicKey,
          epochKey,
          epochGrantDomain(state.summary.reference, '1', '1'),
        ),
      ),
    },
  ];
  state.content.documents = [];
  const offer = ServiceOfferDocumentSchema.parse({
    schemaVersion: 1,
    type: 'service-offer',
    dao: state.dao,
    memberId: '1',
    title: 'Secret pruning',
    summary: 'Private community service',
    skills: [],
  });
  for (let i = 1; i <= 26; i++) {
    const metadata = JSON.stringify(
      await sealContent(
        new TextEncoder().encode(JSON.stringify(offer)),
        epochKey,
        contentDomain(state.summary.reference, String(i), 1, '1'),
      ),
    );
    state.content.documents.push({
      id: String(i),
      document_id: String(i),
      version: 1,
      author: '1',
      cid: '',
      metadata,
      bytes: new TextEncoder().encode(metadata).length,
      commitment: await sha256Hex(new TextEncoder().encode(metadata)),
      envelope_version: 1,
      key_epoch: '1',
    });
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
  let message = '',
    writes = 0;
  await page.route('**/v1/auth/challenge', (route) => {
    const input = ApiRoutes.challenge.input.parse(route.request().postDataJSON()),
      id = crypto.randomUUID(),
      expires = new Date(Date.now() + 120000).toISOString(),
      origin = new URL(page.url()).origin;
    message = JSON.stringify(
      LoginMessageSchema.parse({
        ...input,
        domain: 'daclify.login.v3',
        origin,
        audience: origin,
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
  await page.route('**/v1/relay', async (route) => {
    const input = ApiRoutes.relay.input.parse(route.request().postDataJSON());
    expect(
      Signature.from(input.sig).verifyDigest(
        instructionDigest(input.request),
        PublicKey.from(vault.signingPublicKey),
      ),
    ).toBe(true);
    const native = z.coerce.string();
    const args = RuntimeActionSchemas.putjson
      .extend({ dao_id: native, member_id: native, document_id: native, key_epoch: native })
      .parse(
        Serializer.objectify(
          Serializer.decode({
            abi: ABI.from(runtimeAbi),
            type: 'putjson',
            data: input.request.data,
          }),
        ),
      );
    expect(args.envelope_version).toBe(1);
    expect(args.value).not.toContain('Private planting');
    const text = new TextDecoder().decode(
      await openContent(
        ContentEnvelopeSchema.parse(JSON.parse(args.value)),
        epochKey,
        contentDomain(state.summary.reference, args.document_id, 1, '1'),
      ),
    );
    expect(ServiceOfferDocumentSchema.parse(JSON.parse(text)).title).toBe('Private planting');
    writes++;
    state.content.documents.push({
      id: '99',
      document_id: args.document_id,
      version: 1,
      author: '1',
      cid: '',
      metadata: args.value,
      bytes: new TextEncoder().encode(args.value).length,
      commitment: await sha256Hex(new TextEncoder().encode(args.value)),
      envelope_version: 1,
      key_epoch: '1',
    });
    state.member.nonce = '1';
    return route.fulfill({ json: { transactionId: 'ab'.repeat(32) } });
  });
  await page.goto('/dao/1/works');
  await page.getByRole('tab', { name: 'Member services', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Read encrypted offers', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Secret pruning', exact: true })).toHaveCount(0);
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
  await page.getByRole('link', { name: 'Works', exact: true }).click();
  await page.getByRole('tab', { name: 'Member services', exact: true }).click();
  await page.getByRole('button', { name: 'Read encrypted offers', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Secret pruning', exact: true })).toHaveCount(25);
  await page.getByRole('button', { name: 'Read encrypted offers (next 25)', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Secret pruning', exact: true })).toHaveCount(26);
  await page.getByRole('button', { name: 'Offer a service', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Offer a service' });
  await dialog.getByLabel('Service name', { exact: true }).fill('Private planting');
  await dialog.getByLabel('What you offer', { exact: true }).fill('Members only');
  await dialog.getByRole('button', { name: 'Publish offer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(writes).toBe(1);
  await expect(page.getByRole('heading', { name: 'Private planting', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Read encrypted offers (next 25)', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Private planting', exact: true })).toBeVisible();
  await page.evaluate(() => {
    history.pushState(history.state, '', '/account');
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  });
  await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
  await page.goto('/dao/1/works');
  await page.getByRole('tab', { name: 'Member services', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Secret pruning', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Private planting', exact: true })).toHaveCount(0);
});
test('offers exact protected terms from a signed compact agreement form', async ({ page }) => {
  test.setTimeout(60000);
  const state = await fixture(page),
    password = 'disposable protected terms',
    vault = await createVault(password),
    now = Math.floor(Date.now() / 1000),
    project = state.modules.projects.find((row) => row.id === '90');
  if (!project) throw Error('Fixture project');
  state.account.signingKey = vault.signingPublicKey;
  state.account.encryptionKey = vault.encryptionPublicKey;
  state.member.signingKey = vault.signingPublicKey;
  const backup = state.content.members.find((row) => row.id === '3');
  if (!backup) throw Error('Fixture backup');
  backup.active = true;
  state.modules.agreements.push({
    project_id: project.id,
    dao_id: '1',
    schema_version: 1,
    term_start: now,
    term_end: now + 86400 * 30,
    terms: 'ab'.repeat(32),
    accepted: false,
    accepted_at: 0,
  });
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
  let message = '',
    writes = 0;
  await page.route('**/v1/auth/challenge', (route) => {
    const input = ApiRoutes.challenge.input.parse(route.request().postDataJSON()),
      id = crypto.randomUUID(),
      expires = new Date(Date.now() + 120000).toISOString(),
      origin = new URL(page.url()).origin;
    message = JSON.stringify(
      LoginMessageSchema.parse({
        ...input,
        domain: 'daclify.login.v3',
        origin,
        audience: origin,
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
  await page.route('**/v1/relay', (route) => {
    const input = ApiRoutes.relay.input.parse(route.request().postDataJSON());
    expect(input.request.action).toBe('offerprot');
    expect(
      Signature.from(input.sig).verifyDigest(
        instructionDigest(input.request),
        PublicKey.from(vault.signingPublicKey),
      ),
    ).toBe(true);
    const native = z.coerce.string().pipe(z.string().regex(/^[0-9]+$/));
    const value = WorksActionSchemas.offerprot
      .extend({
        dao_id: native,
        member_id: native,
        project_id: native,
        backup: native,
        representative: native,
      })
      .parse(
        Serializer.objectify(
          Serializer.decode({
            abi: ABI.from(worksAbi),
            type: 'offerprot',
            data: input.request.data,
          }),
        ),
      );
    expect(value).toMatchObject({
      project_id: '90',
      decide: 'decide',
      backup: '3',
      representative: '1',
      review_seconds: 86400,
      challenge_seconds: 86400,
      vote_seconds: 172800,
      backup_seconds: 604800,
    });
    writes++;
    state.member.nonce = String(BigInt(state.member.nonce) + 1n);
    return route.fulfill({ json: { transactionId: 'ab'.repeat(32) } });
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
  await page.getByRole('link', { name: 'Works', exact: true }).click();
  const form = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Council rules · version 2', exact: true }) });
  await form.getByText('Protect this agreement', { exact: true }).click();
  await form.getByRole('combobox', { name: 'DAO representative', exact: true }).selectOption('1');
  await form
    .getByRole('combobox', { name: 'Backup decision maker', exact: true })
    .selectOption('3');
  const check = form.getByLabel('I checked the voting rules, deadlines and backup');
  await check.check();
  await form.getByLabel('Review deadline (days)').fill('2');
  await expect(check).not.toBeChecked();
  await form.getByLabel('Review deadline (days)').fill('1');
  await check.check();
  await form.getByRole('button', { name: 'Offer protected terms', exact: true }).click();
  await expect.poll(() => writes).toBe(1);
});
