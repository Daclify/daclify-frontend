import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { Catalog, ModulePermissions, ModuleStateSchema } from '@daclify/modules';
import { ModuleCodeHashes } from '@daclify/modules/sdk';
import {
  AccountSchema,
  ApiRoutes,
  LoginMessageSchema,
  RecoveryKitSchema,
} from '@daclify/core-protocol';
import { instructionDigest } from '@daclify/core-protocol/sdk';
import {
  GrantsActionSchemas,
  DecideActionSchemas,
  grantsAbi,
  decideAbi,
} from '@daclify/modules/sdk';
import { ABI, PublicKey, Serializer, Signature } from '@wharfkit/antelope';
import { z } from 'zod';
import { createVault } from '../../src/auth/vault';
import { moduleFixture } from './fixtures/module-design';

test.use({ timezoneId: 'UTC' });

async function fixture(page: Page, visitor = false) {
  const state = await moduleFixture(page, true, visitor);
  for (const id of ['grants-rounds', 'works'] as const) {
    const manifest = Catalog.find((module) => module.id === id);
    if (!manifest) throw new Error('Grant fixture manifest missing');
    state.modules.modules.push({
      manifest,
      deployment: {
        id,
        account: id === 'grants-rounds' ? 'grants' : 'works',
        version: manifest.version,
        codeHash: ModuleCodeHashes[id],
      },
      enabled: true,
      installed: true,
      compatible: true,
      codeVerified: true,
      actions: [...ModulePermissions[id].actions],
      grants: [...ModulePermissions[id].grants],
    });
  }
  const now = Math.floor(Date.now() / 1000);
  Object.assign(
    state.modules,
    ModuleStateSchema.parse({
      ...state.modules,
      rounds: [
        {
          id: '90',
          dao_id: '1',
          creator: '1',
          document_id: '42',
          document_version: 2,
          rules_revision: '1',
          applications_close: now + 7 * 86400,
          review_close: now + 14 * 86400,
          awards_close: now + 21 * 86400,
          maximum: '100.0000 TLOS',
          awarded: '100000',
          allow_agents: false,
          works: 'works',
          closed: false,
        },
      ],
      applications: [
        {
          id: '91',
          dao_id: '1',
          round_id: '90',
          contributor: '1',
          document_id: '42',
          document_version: 1,
          revision: '1',
          payments: ['10.0000 TLOS', '25.0000 TLOS'],
          dues: [now + 15 * 86400, now + 25 * 86400],
          term_start: now + 10 * 86400,
          term_end: now + 30 * 86400,
          status: 1,
          consent_at: now,
          decision_doc: '0',
          decision_version: 0,
          project_id: '0',
          funding_ballot: '0',
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
            memberId: '1',
            accountName: 'alice',
            profile: { name: 'alice', fullName: 'Alice Gardener' },
          },
        ],
        next: null,
      },
    }),
  );
  return state;
}

test('Grants separates rounds and applications with readable popups and safe milestone rows', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/dao/1/grants-rounds');
  const rounds = page.getByRole('tab', { name: 'Rounds', exact: true });
  await expect(rounds).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Grant status', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Grants rounds', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Grants rules and help' })).toHaveAttribute(
    'href',
    '/docs/grants-rounds?dao=1',
  );
  const list = page.getByRole('tabpanel', { name: 'Rounds', exact: true });
  await expect(list.getByRole('heading', { name: 'Council rules', exact: true })).toBeVisible();
  await expect(list.getByText('Accepting applications', { exact: true })).toBeVisible();
  await page.getByLabel('Search grants', { exact: true }).fill('absent title');
  await expect(list.getByRole('heading', { name: 'Council rules', exact: true })).toHaveCount(0);
  await page.getByLabel('Search grants', { exact: true }).clear();
  await page.getByRole('button', { name: 'Create grant round', exact: true }).click();
  const round = page.getByRole('dialog', { name: 'Create grant round', exact: true });
  const rules = round.getByLabel('Round rules', { exact: true });
  await expect(rules).toBeFocused();
  await rules.selectOption('12');
  await expect(rules.locator('option[value="12"]')).toHaveText('Council rules · version 2');
  await expect(rules).not.toContainText('Private title must stay hidden');
  await round.getByRole('button', { name: 'Next', exact: true }).click();
  const cap = round.getByLabel('Funding limit (TLOS)', { exact: true });
  await expect(cap).toHaveValue('');
  await cap.fill('100');
  await round.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(round.getByText('100 TLOS', { exact: true })).toBeVisible();
  await expect(round.getByText(/Creating this round reserves no Treasury funds/)).toBeVisible();
  await round.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create grant round', exact: true })).toBeFocused();
  await list.getByRole('button', { name: 'Apply to this round', exact: true }).click();
  const application = page.getByRole('dialog', { name: 'Apply for a grant', exact: true });
  await expect(application.getByLabel('Proposal document', { exact: true })).toHaveValue('');
  await application.getByLabel('Proposal document', { exact: true }).selectOption('11');
  await application.getByLabel('Milestone 1 amount (TLOS)', { exact: true }).fill('10');
  await application.getByRole('button', { name: 'Add milestone', exact: true }).click();
  await application.getByLabel('Milestone 2 amount (TLOS)', { exact: true }).fill('25');
  await expect(application.getByRole('status', { name: 'Total requested' })).toHaveText('35 TLOS');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await application.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('tab', { name: 'Applications', exact: true }).click();
  const applications = page.getByRole('tabpanel', { name: 'Applications', exact: true });
  await expect(applications.getByText('Alice Gardener · alice', { exact: true })).toBeVisible();
  await applications.getByRole('button', { name: 'Review application', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review application', exact: true });
  await expect(review.getByLabel('Review record', { exact: true })).toHaveValue('');
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Apply for a grant', exact: true }).click();
  await expect(application.getByLabel('Proposal document', { exact: true })).toHaveValue('11');
  await expect(application.getByRole('status', { name: 'Total requested' })).toHaveText('35 TLOS');
  await application.getByRole('button', { name: 'Cancel', exact: true }).click();
  await rounds.click();
  await page.getByRole('button', { name: 'Create grant round', exact: true }).click();
  await expect(rules).toHaveValue('12');
  await round.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(cap).toHaveValue('100');
  await round.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('grants-rounds.png'), fullPage: true });
});

test('Grants is readable to visitors and keeps lists available when documents are unavailable or foreign', async ({
  page,
}) => {
  const state = await fixture(page, true);
  let mode = 'failed';
  await page.route('**/v1/daos/1/content', (route) =>
    route.fulfill(
      mode === 'failed'
        ? { status: 503, json: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic outage' } }
        : {
            json: {
              ...state.content,
              dao: mode === 'foreign' ? { ...state.dao, daoId: '2' } : state.dao,
            },
          },
    ),
  );
  await page.goto('/dao/1/grants-rounds');
  await expect(
    page.getByRole('button', { name: 'Create grant round', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('tabpanel', { name: 'Rounds', exact: true }).getByRole('article'),
  ).toHaveCount(1);
  await page.getByRole('tab', { name: 'Applications', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply for a grant', exact: true })).toBeDisabled();
  await expect(
    page.getByRole('tabpanel', { name: 'Applications', exact: true }).getByRole('article'),
  ).toHaveCount(1);
  mode = 'foreign';
  await page.getByRole('button', { name: 'Retry documents and names', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Application 91', exact: true })).toBeVisible();
  mode = 'ok';
  await page.getByRole('button', { name: 'Retry documents and names', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Council rules', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('ordinary members cannot create or review rounds and expired rounds offer no application actions', async ({
  page,
}) => {
  const state = await fixture(page);
  state.member.admin = false;
  await page.goto('/dao/1/grants-rounds');
  await expect(
    page.getByRole('button', { name: 'Create grant round', exact: true }),
  ).toBeDisabled();
  await page.getByRole('tab', { name: 'Applications', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review application', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Apply for a grant', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Apply for a grant', exact: true });
  await expect(dialog.getByLabel('Grant round', { exact: true })).toHaveValue('90');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const round = state.modules.rounds[0];
  if (!round) throw new Error('Grant round missing');
  round.applications_close = Math.floor(Date.now() / 1000) - 1;
  await page.reload();
  await expect(
    page
      .getByRole('tabpanel', { name: 'Rounds', exact: true })
      .getByText('Reviewing applications', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply to this round', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('tab', { name: 'Applications', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit application', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Apply for a grant', exact: true }).click();
  await expect(dialog.getByText(/No rounds are accepting applications/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
});

test('a round’s application link filters its exact round rather than matching other reference numbers', async ({
  page,
}) => {
  const state = await fixture(page),
    round = state.modules.rounds[0],
    app = state.modules.applications[0];
  if (!round || !app) throw new Error('Grant fixtures missing');
  state.modules.rounds.push({ ...round, id: '92' });
  state.modules.applications.push({ ...app, id: '190', round_id: '92' });
  await page.goto('/dao/1/grants-rounds');
  await page.getByRole('button', { name: 'View applications', exact: true }).first().click();
  await expect(
    page.getByRole('tabpanel', { name: 'Applications', exact: true }).getByRole('article'),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Show all rounds', exact: true }).click();
  await expect(
    page.getByRole('tabpanel', { name: 'Applications', exact: true }).getByRole('article'),
  ).toHaveCount(2);
});

test('application editing preserves every original amount and due date and review drafts survive cancellation', async ({
  page,
}) => {
  const state = await fixture(page);
  const app = state.modules.applications[0];
  if (!app) throw new Error('Grant application fixture missing');
  app.payments[0] = '1.5000 TLOS';
  await page.goto('/dao/1/grants-rounds');
  await page.getByRole('tab', { name: 'Applications', exact: true }).click();
  await page.getByRole('button', { name: 'Edit application', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit grant application', exact: true });
  await expect(dialog.getByLabel('Milestone 1 amount (TLOS)', { exact: true })).toHaveValue('1.5');
  await expect(dialog.getByLabel('Milestone 2 amount (TLOS)', { exact: true })).toHaveValue('25');
  for (const index of [0, 1]) {
    const epoch = await dialog
      .getByLabel(`Milestone ${index + 1} due date`, { exact: true })
      .inputValue();
    expect(Math.floor(Date.parse(epoch + 'Z') / 1000)).toBe(app.dues[index]);
  }
  await expect(dialog.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  await dialog.getByLabel('Milestone 1 amount (TLOS)', { exact: true }).fill('2');
  const confirmation = dialog.getByLabel('I checked the proposal, milestone dates and total', {
    exact: true,
  });
  await confirmation.check();
  await dialog.getByLabel('Milestone 2 amount (TLOS)', { exact: true }).fill('26');
  await expect(confirmation).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Edit application', exact: true }).click();
  await expect(dialog.getByLabel('Milestone 1 amount (TLOS)', { exact: true })).toHaveValue('2');
  await expect(dialog.getByLabel('Milestone 2 amount (TLOS)', { exact: true })).toHaveValue('26');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Apply for a grant', exact: true }).click();
  const fresh = page.getByRole('dialog', { name: 'Apply for a grant', exact: true });
  await expect(fresh.getByLabel('Proposal document', { exact: true })).toHaveValue('');
  await fresh.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Review application', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review application', exact: true });
  await review.getByLabel('Review record', { exact: true }).selectOption('12');
  await review.getByLabel('Eligibility decision', { exact: true }).selectOption('false');
  await review
    .getByLabel('I checked this application and its review record', { exact: true })
    .check();
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Review application', exact: true }).click();
  await expect(review.getByLabel('Review record', { exact: true })).toHaveValue('12');
  await expect(review.getByLabel('Eligibility decision', { exact: true })).toHaveValue('false');
});

async function authenticate(page: Page, state: Awaited<ReturnType<typeof fixture>>) {
  const password = 'disposable Grants design fixture',
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
  let message = '';
  await page.route('**/v1/auth/challenge', (route) => {
    const input = ApiRoutes.challenge.input.parse(route.request().postDataJSON()),
      id = crypto.randomUUID(),
      expires = new Date(Date.now() + 120000).toISOString(),
      origin = new URL(page.url()).origin,
      audience = new URL(route.request().url()).origin;
    message = JSON.stringify(
      LoginMessageSchema.parse({
        ...input,
        domain: 'daclify.login.v3',
        origin,
        audience,
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
  await page.getByRole('link', { name: 'Grants', exact: true }).click();
  return vault;
}

function decodedRelay(input: ReturnType<typeof ApiRoutes.relay.input.parse>) {
  const fields = z.record(z.string(), z.unknown()).parse(
    Serializer.objectify(
      Serializer.decode({
        abi: ABI.from(input.request.target === 'decide' ? decideAbi : grantsAbi),
        type: input.request.action,
        data: input.request.data,
      }),
    ),
  );
  for (const key of [
    'dao_id',
    'member_id',
    'round_id',
    'application_id',
    'ballot_id',
    'project_id',
    'document_id',
  ])
    if (typeof fields[key] === 'number') fields[key] = String(fields[key]);
  return fields;
}

test('signed round creation checks code pins, preserves failed drafts and blocks edits during a pending retry', async ({
  page,
}) => {
  test.setTimeout(60000);
  const state = await fixture(page);
  const works = state.modules.modules.find((module) => module.deployment.id === 'works');
  if (!works) throw new Error('Works fixture missing');
  works.codeVerified = false;
  const vault = await authenticate(page, state);
  let attempts = 0,
    release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const roundIds: string[] = [];
  await page.route('**/v1/relay', async (route) => {
    const input = ApiRoutes.relay.input.parse(route.request().postDataJSON());
    expect(input.request.target).toBe('grants');
    expect(input.request.action).toBe('newround');
    expect(
      Signature.from(input.sig).verifyDigest(
        instructionDigest(input.request),
        PublicKey.from(vault.signingPublicKey),
      ),
    ).toBe(true);
    const args = GrantsActionSchemas.newround.parse(decodedRelay(input));
    roundIds.push(args.round_id);
    expect(args).toMatchObject({
      document_id: '42',
      document_version: 2,
      maximum: '100.0000 TLOS',
      allow_agents: false,
      works: 'works',
    });
    expect(args.applications_close).toBeLessThan(args.review_close);
    expect(args.review_close).toBeLessThan(args.awards_close);
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
  async function fillRound() {
    await page.getByRole('button', { name: 'Create grant round', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create grant round', exact: true });
    await dialog.getByLabel('Round rules', { exact: true }).selectOption('12');
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByLabel('Funding limit (TLOS)', { exact: true }).fill('100');
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog
      .getByLabel('I checked the rules, funding limit and deadlines', { exact: true })
      .check();
    return dialog;
  }
  let dialog = await fillRound();
  await expect(dialog.getByRole('button', { name: 'Create round', exact: true })).toBeDisabled();
  await dialog
    .locator('form')
    .evaluate((form) =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
  expect(attempts).toBe(0);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  works.codeVerified = true;
  await page.getByRole('link', { name: 'Decide', exact: true }).click();
  await page.getByRole('link', { name: 'Grants', exact: true }).click();
  dialog = await fillRound();
  const submit = dialog.getByRole('button', { name: 'Create round', exact: true });
  await submit.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(
    dialog.getByLabel('I checked the rules, funding limit and deadlines', { exact: true }),
  ).toBeChecked();
  await submit.click();
  await expect.poll(() => attempts).toBe(2);
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
  await expect(
    dialog.getByRole('button', { name: 'Close grant form', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog).not.toBeVisible();
  expect(new Set(roundIds).size).toBe(1);
  await page.getByRole('button', { name: 'Create grant round', exact: true }).click();
  await expect(dialog.getByLabel('Round rules', { exact: true })).toHaveValue('');
});

test('signed applications encode distinct milestones, renewed consent, exact review records and saved funding policy', async ({
  page,
}) => {
  test.setTimeout(90000);
  const state = await fixture(page);
  state.modules.applications = [];
  const vault = await authenticate(page, state);
  const round = state.modules.rounds[0];
  if (!round) throw new Error('Grant round fixture missing');
  state.modules.applications = [];
  const start = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 16),
    end = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 16);
  const dues = [15, 25].map((days) =>
    new Date(Date.now() + days * 86400000).toISOString().slice(0, 16),
  );
  const actions: string[] = [],
    applicationIds: string[] = [];
  let applicationAttempts = 0,
    fundingAttempts = 0;
  const fundingIds: string[] = [];
  await page.route('**/v1/relay', async (route) => {
    const input = ApiRoutes.relay.input.parse(route.request().postDataJSON());
    expect(
      Signature.from(input.sig).verifyDigest(
        instructionDigest(input.request),
        PublicKey.from(vault.signingPublicKey),
      ),
    ).toBe(true);
    const fields = decodedRelay(input),
      action = input.request.action;
    if (action === 'applygrant') {
      const args = GrantsActionSchemas.applygrant.parse(fields);
      applicationIds.push(args.application_id);
      expect(args).toMatchObject({
        round_id: '90',
        document_id: '42',
        document_version: 1,
        payments: ['10.0000 TLOS', '25.0000 TLOS'],
        dues: dues.map((date) => Math.floor(Date.parse(date + 'Z') / 1000)),
        term_start: Math.floor(Date.parse(start + 'Z') / 1000),
        term_end: Math.floor(Date.parse(end + 'Z') / 1000),
      });
      applicationAttempts++;
      if (applicationAttempts === 1)
        return route.fulfill({
          status: 503,
          json: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic draft relay outage' },
        });
      state.modules.applications.push({
        id: args.application_id,
        dao_id: '1',
        round_id: '90',
        contributor: '1',
        revision: '1',
        document_id: args.document_id,
        document_version: args.document_version,
        payments: args.payments,
        dues: args.dues,
        term_start: args.term_start,
        term_end: args.term_end,
        status: 0,
        consent_at: 0,
        decision_doc: '0',
        decision_version: 0,
        project_id: '0',
        funding_ballot: '0',
      });
    } else {
      const app = state.modules.applications[0];
      if (!app) throw new Error('Signed grant draft missing');
      if (action === 'amend') {
        const args = GrantsActionSchemas.amend.parse(fields);
        expect(args).toMatchObject({
          application_id: app.id,
          document_id: '42',
          document_version: 2,
          payments: ['11.0000 TLOS', '25.0000 TLOS'],
          dues: app.dues,
        });
        Object.assign(app, {
          document_version: args.document_version,
          payments: args.payments,
          revision: '2',
          status: 0,
          consent_at: 0,
          decision_doc: '0',
          decision_version: 0,
        });
      } else if (action === 'submitapp') {
        expect(GrantsActionSchemas.submitapp.parse(fields).application_id).toBe(app.id);
        app.status = 1;
        app.consent_at = Math.floor(Date.now() / 1000);
      } else if (action === 'reviewapp') {
        expect(GrantsActionSchemas.reviewapp.parse(fields)).toMatchObject({
          application_id: app.id,
          document_id: '42',
          document_version: 2,
          eligible: true,
        });
        app.status = 2;
        app.decision_doc = '42';
        app.decision_version = 2;
      } else if (action === 'openaward') {
        expect(input.request.target).toBe('decide');
        const args = DecideActionSchemas.openaward.parse(fields);
        fundingIds.push(args.ballot_id + ':' + args.project_id);
        expect(args).toMatchObject({
          application_id: app.id,
          round_id: '90',
          grants: 'grants',
          duration: 259200,
          quorum: 5000,
          approval: 5001,
        });
        fundingAttempts++;
        if (fundingAttempts === 1)
          return route.fulfill({
            status: 503,
            json: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic vote relay outage' },
          });
      } else throw new Error('Unexpected grant action ' + action);
    }
    actions.push(action);
    state.member.nonce = String(actions.length);
    return route.fulfill({ json: { transactionId: 'ab'.repeat(32) } });
  });
  await page.getByRole('button', { name: 'Apply to this round', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Apply for a grant', exact: true });
  await dialog.getByLabel('Proposal document', { exact: true }).selectOption('11');
  await dialog.getByLabel('Contribution starts', { exact: true }).fill(start);
  await dialog.getByLabel('Contribution ends', { exact: true }).fill(end);
  await dialog.getByLabel('Milestone 1 amount (TLOS)', { exact: true }).fill('10');
  await dialog.getByLabel('Milestone 1 due date', { exact: true }).fill(dues[0] ?? '');
  await dialog.getByRole('button', { name: 'Add milestone', exact: true }).click();
  await dialog.getByLabel('Milestone 2 amount (TLOS)', { exact: true }).fill('25');
  await dialog.getByLabel('Milestone 2 due date', { exact: true }).fill(dues[1] ?? '');
  await dialog.getByLabel('Milestone 1 amount (TLOS)', { exact: true }).fill('1.5');
  await expect(dialog.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  await dialog
    .locator('form')
    .evaluate((form) =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
  expect(applicationAttempts).toBe(0);
  await dialog.getByLabel('Milestone 1 amount (TLOS)', { exact: true }).fill('10');
  await dialog
    .getByLabel('I checked the proposal, milestone dates and total', { exact: true })
    .check();
  await dialog.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('Proposal document', { exact: true })).toHaveValue('11');
  await expect(dialog.getByRole('status', { name: 'Total requested' })).toHaveText('35 TLOS');
  await dialog.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(new Set(applicationIds).size).toBe(1);
  await page.getByRole('button', { name: 'Edit application', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit grant application', exact: true });
  await edit.getByLabel('Proposal document', { exact: true }).selectOption('12');
  await edit.getByLabel('Milestone 1 amount (TLOS)', { exact: true }).fill('11');
  await edit
    .getByLabel('I checked the proposal, milestone dates and total', { exact: true })
    .check();
  await edit.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(edit).not.toBeVisible();
  await page.getByRole('button', { name: 'Review and submit', exact: true }).click();
  const consent = page.getByRole('dialog', { name: 'Submit grant application', exact: true });
  await consent
    .getByLabel(
      'I reviewed this exact application document, compensation, term, review and cancellation rules',
      { exact: true },
    )
    .check();
  await consent.getByRole('button', { name: 'Sign consent and submit', exact: true }).click();
  await expect(consent).not.toBeVisible();
  await page.getByRole('button', { name: 'Review application', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review application', exact: true });
  await review.getByLabel('Review record', { exact: true }).selectOption('12');
  await review
    .getByLabel('I checked this application and its review record', { exact: true })
    .check();
  await review.getByRole('button', { name: 'Save eligibility decision', exact: true }).click();
  await expect(review).not.toBeVisible();
  await page.getByRole('button', { name: 'Propose funding vote', exact: true }).click();
  const vote = page.getByRole('dialog', { name: 'Propose funding vote', exact: true });
  await expect(vote.getByText(/quorum 50% · approval 50.01%/)).toBeVisible();
  await vote
    .getByLabel('I checked the application total and funding terms', { exact: true })
    .check();
  await vote.getByRole('button', { name: 'Open funding vote', exact: true }).click();
  await expect(vote.getByRole('alert')).toBeVisible();
  await expect(
    vote.getByLabel('I checked the application total and funding terms', { exact: true }),
  ).toBeChecked();
  await vote.getByRole('button', { name: 'Open funding vote', exact: true }).click();
  await expect(vote).not.toBeVisible();
  expect(new Set(fundingIds).size).toBe(1);
  expect(actions).toEqual(['applygrant', 'amend', 'submitapp', 'reviewapp', 'openaward']);
});
