import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  AccountSchema,
  ApiRoutes,
  DaoContentSchema,
  LoginMessageSchema,
  RecoveryKitSchema,
} from '@daclify/core-protocol';
import { instructionDigest } from '@daclify/core-protocol/sdk';
import {
  Catalog,
  ModulePermissions,
  ModuleStateSchema,
  ServiceOfferDocumentSchema,
} from '@daclify/modules';
import { ModuleCodeHashes, WorksActionSchemas, worksAbi } from '@daclify/modules/sdk';
import { ABI, PrivateKey, PublicKey, Serializer, Signature } from '@wharfkit/antelope';
import { z } from 'zod';
import { createVault } from '../../src/auth/vault';
import { moduleFixture } from './fixtures/module-design';

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
      payments: ['1.2500 TLOS', '2.0000 TLOS'],
      dues: [0, 0],
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
  await dialog.getByLabel(/Milestone amounts/).fill('1.25\n2');
  const submit = dialog.getByRole('button', { name: 'Propose work', exact: true });
  await dialog.getByLabel(/Milestone amounts/).fill('0');
  await submit.click();
  await expect(dialog.getByRole('alert')).toContainText('positive payment');
  expect(attempts).toBe(0);
  await dialog
    .getByLabel(/Milestone amounts/)
    .fill(Array.from({ length: 17 }, () => '1').join('\n'));
  await submit.click();
  await expect(dialog.getByRole('alert')).toContainText('between 1 and 16');
  expect(attempts).toBe(0);
  await dialog.getByLabel(/Milestone amounts/).fill('1.25\n2');
  await submit.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('Proposal document', { exact: true })).toHaveValue('12');
  await submit.click();
  await expect.poll(() => attempts).toBe(2);
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
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
