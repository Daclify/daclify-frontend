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
import { Catalog, ModulePermissions } from '@daclify/modules';
import { ModuleCodeHashes, PayrollActionSchemas, payrollAbi } from '@daclify/modules/sdk';
import { ABI, PrivateKey, PublicKey, Serializer, Signature } from '@wharfkit/antelope';
import { z } from 'zod';
import { createVault } from '../../src/auth/vault';
import { moduleFixture } from './fixtures/module-design';

test.use({ timezoneId: 'UTC' });

async function fixture(page: Page, visitor = false) {
  const state = await moduleFixture(page, true, visitor);
  const manifest = Catalog.find((module) => module.id === 'payroll');
  if (!manifest) throw new Error('Payroll manifest missing');
  state.modules.modules.push({
    manifest,
    deployment: {
      id: 'payroll',
      account: 'payroll',
      version: manifest.version,
      codeHash: ModuleCodeHashes.payroll,
    },
    enabled: true,
    installed: true,
    compatible: true,
    codeVerified: true,
    actions: [...ModulePermissions.payroll.actions],
    grants: [...ModulePermissions.payroll.grants],
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
  state.modules.schedules.push({
    id: '90',
    dao_id: '1',
    creator: '1',
    recipient: '2',
    quantity: '10.0000 TLOS',
    periods: 2,
    interval: 86400,
    starts: Math.floor(Date.now() / 1000) + 3600,
    entries: [],
  });
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

test('payroll uses an accessible Add payroll popup with readable members and an explicit total', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/dao/1');
  await expect(page.getByRole('region', { name: 'Workspace overview', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Workspace overview', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('link', { name: 'Payroll', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toHaveCount(0);
  const add = page.getByRole('button', { name: 'Add payroll', exact: true });
  await expect(add).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Payroll rules and help' })).toHaveAttribute(
    'href',
    '/docs/payroll?dao=1',
  );
  await expect(page.getByLabel('Search payrolls')).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Add payroll', exact: true });
  await expect(dialog).not.toBeVisible();
  await add.click();
  await expect(dialog).toBeVisible();
  const recipient = dialog.getByLabel('Recipient', { exact: true });
  await expect(recipient).toBeFocused();
  await recipient.selectOption('2');
  await expect(recipient.locator('option[value="2"]')).toHaveText('Bob Builder · bob');
  await expect(recipient.locator('option[value="3"]')).toHaveCount(0);
  const amount = dialog.getByLabel('Amount per installment (TLOS)', { exact: true });
  await expect(amount).toHaveValue('');
  await amount.fill('10');
  await expect(dialog.getByRole('status', { name: 'Total payroll commitment' })).toHaveText(
    '20 TLOS',
  );
  const confirmation = dialog.getByLabel('I checked the recipient, installments and total', {
    exact: true,
  });
  await confirmation.check();
  await amount.fill('11');
  await expect(confirmation).not.toBeChecked();
  await expect(dialog.getByRole('status', { name: 'Total payroll commitment' })).toHaveText(
    '22 TLOS',
  );
  await page.keyboard.press('Escape');
  await expect(add).toBeFocused();
  await add.click();
  await expect(amount).toHaveValue('11');
  await expect(recipient).toHaveValue('2');
  await expect(dialog.getByRole('button', { name: 'Commit funded payroll' })).toBeDisabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('add-payroll.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('payroll-list.png'), fullPage: true });
});

test('payroll remains readable to visitors and members who cannot add payroll', async ({
  page,
}) => {
  const state = await fixture(page, true);
  await page.goto('/dao/1/payroll');
  const add = page.getByRole('button', { name: 'Add payroll', exact: true });
  await expect(add).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Schedule 90', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Add payroll', exact: true })).toHaveCount(0);
  state.member.admin = false;
  await page.route('**/v1/me/memberships', (route) =>
    route.fulfill({ json: { memberships: [state.member] } }),
  );
  await page.reload();
  await expect(add).toBeDisabled();
  await expect(page.getByRole('dialog', { name: 'Add payroll', exact: true })).toHaveCount(0);
});

test('signed payroll checks the code pin, encodes exact installments and preserves failed drafts', async ({
  page,
}) => {
  const state = await fixture(page),
    password = 'disposable Payroll design fixture',
    vault = await createVault(password);
  const module = state.modules.modules.find((module) => module.deployment.id === 'payroll');
  if (!module) throw new Error('Payroll module missing');
  module.codeVerified = false;
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
  const firstDue = new Date(Date.now() + 3600000).toISOString().slice(0, 19);
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
    expect(input.request.action).toBe('commit');
    expect(input.request.target).toBe('payroll');
    expect(
      Signature.from(input.sig).verifyDigest(
        instructionDigest(input.request),
        PublicKey.from(vault.signingPublicKey),
      ),
    ).toBe(true);
    const fields = z.record(z.string(), z.unknown()).parse(
      Serializer.objectify(
        Serializer.decode({
          abi: ABI.from(payrollAbi),
          type: 'commit',
          data: input.request.data,
        }),
      ),
    );
    for (const key of ['dao_id', 'member_id', 'schedule_id', 'recipient'])
      if (typeof fields[key] === 'number') fields[key] = String(fields[key]);
    const decoded = PayrollActionSchemas.commit.parse(fields);
    expect(decoded).toMatchObject({
      recipient: '2',
      quantity: '10.0000 TLOS',
      periods: 3,
      interval: 604800,
      starts: Math.floor(Date.parse(firstDue + 'Z') / 1000),
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
  await page.getByRole('link', { name: 'Payroll', exact: true }).click();
  const add = page.getByRole('button', { name: 'Add payroll', exact: true });
  await add.click();
  const dialog = page.getByRole('dialog', { name: 'Add payroll', exact: true });
  await dialog.getByLabel('Recipient', { exact: true }).selectOption('2');
  const amount = dialog.getByLabel('Amount per installment (TLOS)', { exact: true });
  await amount.fill('10');
  await dialog.getByLabel('Installments', { exact: true }).fill('3');
  await dialog.getByLabel('Claim frequency (days)', { exact: true }).fill('7');
  await dialog.getByLabel('First installment due (UTC)', { exact: true }).fill(firstDue);
  const confirmation = dialog.getByLabel('I checked the recipient, installments and total', {
    exact: true,
  });
  await confirmation.check();
  const submit = dialog.getByRole('button', { name: 'Commit funded payroll', exact: true });
  await expect(submit).toBeDisabled();
  await dialog
    .locator('form')
    .evaluate((form) =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
  expect(attempts).toBe(0);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  module.codeVerified = true;
  await page.getByRole('link', { name: 'Decide', exact: true }).click();
  await page.getByRole('link', { name: 'Payroll', exact: true }).click();
  await add.click();
  await expect(submit).toBeEnabled();
  for (const invalid of ['0', '1.5', '1e3', '461168601842738']) {
    await amount.fill(invalid);
    await expect(submit).toBeDisabled();
    await expect(confirmation).not.toBeChecked();
    expect(attempts).toBe(0);
  }
  await amount.fill('10');
  await confirmation.check();
  await expect(dialog.getByRole('status', { name: 'Total payroll commitment' })).toHaveText(
    '30 TLOS',
  );
  await submit.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(amount).toHaveValue('10');
  await expect(dialog.getByLabel('Recipient', { exact: true })).toHaveValue('2');
  await expect(confirmation).toBeChecked();
  await submit.click();
  await expect.poll(() => attempts).toBe(2);
  await expect(amount).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await expect(
    dialog.getByRole('button', { name: 'Close payroll form', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Funded payroll committed' }),
  ).toBeVisible();
  await add.click();
  await expect(amount).toHaveValue('');
  await expect(dialog.getByLabel('Recipient', { exact: true })).toHaveValue('');
});

test('unavailable or foreign member records block selection while payroll schedules remain readable', async ({
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
  await page.goto('/dao/1/payroll');
  await expect(page.getByRole('heading', { name: 'Schedule 90', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add payroll', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add payroll', exact: true });
  await expect(dialog.getByRole('button', { name: 'Retry members' })).toBeVisible();
  mode = 'foreign';
  await dialog.getByRole('button', { name: 'Retry members' }).click();
  await expect(
    dialog.getByLabel('Recipient', { exact: true }).locator('option[value="2"]'),
  ).toHaveCount(0);
  mode = 'ok';
  await dialog.getByRole('button', { name: 'Retry members' }).click();
  await expect(
    dialog.getByLabel('Recipient', { exact: true }).locator('option[value="2"]'),
  ).toHaveText('Bob Builder · bob');
});
