import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  AccountSchema,
  ApiRoutes,
  LoginMessageSchema,
  RecoveryKitSchema,
} from '@daclify/core-protocol';
import { instructionDigest } from '@daclify/core-protocol/sdk';
import { DecideActionSchemas, decideAbi } from '@daclify/modules/sdk';
import { ABI, PublicKey, Serializer, Signature } from '@wharfkit/antelope';
import { createVault } from '../../src/auth/vault';
import { z } from 'zod';

import { moduleFixture as fixture } from './fixtures/module-design';

test.use({ timezoneId: 'Atlantic/Canary' });

test('ballot creation opens from the compact toolbar and preserves its draft across closing and switching tabs', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/dao/1/decide');
  const ballots = page.getByRole('tab', { name: 'Ballots', exact: true });
  const elections = page.getByRole('tab', { name: 'Elections', exact: true });
  const add = page.getByRole('button', { name: 'Open a ballot', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Open a ballot', exact: true });
  await expect(page.getByRole('heading', { name: 'Decide', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Ballot rules and help', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Rules & help/ })).toHaveCount(0);
  await expect(add.locator('svg')).toHaveCSS('width', '32px');
  await expect(add.locator('svg')).toHaveCSS('height', '32px');
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Community decision', exact: true }),
  ).toBeVisible();
  await expect(ballots).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Elections' })).not.toBeVisible();
  await page.screenshot({ path: test.info().outputPath('ballots-list.png'), fullPage: true });
  await add.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Public ballot title')).toBeFocused();
  await dialog.getByLabel('Public ballot title').fill('Keep this draft');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('ballot-popup.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(add).toBeFocused();
  await ballots.focus();
  await page.keyboard.press('ArrowRight');
  await expect(elections).toBeFocused();
  await expect(elections).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Elections' })).toBeVisible();
  await expect(dialog).not.toBeVisible();
  await page.keyboard.press('Home');
  await expect(ballots).toBeFocused();
  await add.click();
  await expect(dialog.getByLabel('Public ballot title')).toHaveValue('Keep this draft');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(add).toBeFocused();
  await page.screenshot({ path: test.info().outputPath('ballots.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('saved ballot policy displays three days and exact percentages without allowing overrides', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/dao/1/decide');
  await page.getByRole('button', { name: 'Open a ballot', exact: true }).click();
  await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('3');
  await expect(page.getByLabel('Duration unit', { exact: true })).toHaveValue('days');
  await expect(page.getByLabel('Quorum (%)', { exact: true })).toHaveValue('50');
  await expect(page.getByLabel('Approval (%)', { exact: true })).toHaveValue('50.01');
  await expect(page.getByLabel('Duration', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Quorum (%)', { exact: true })).toBeDisabled();
  await expect(page.locator('#main')).not.toContainText('basis points');
  await expect(page.locator('#main')).not.toContainText('259200');
  await page.screenshot({ path: test.info().outputPath('saved-policy.png'), fullPage: true });
});

test('custom ballot timing offers hours, days, weeks and a local closing date, and rejects invalid thresholds', async ({
  page,
}) => {
  await fixture(page, false);
  await page.clock.setFixedTime(new Date('2026-10-12T12:00:00Z'));
  await page.goto('/dao/1/decide');
  await page.getByRole('button', { name: 'Open a ballot', exact: true }).click();
  const unit = page.getByLabel('Duration unit', { exact: true });
  for (const value of ['hours', 'days', 'weeks']) {
    await unit.selectOption(value);
    await expect(unit).toHaveValue(value);
  }
  await page.getByLabel('Duration', { exact: true }).fill('2');
  await page.getByLabel('Choose a closing date', { exact: true }).check();
  const deadline = page.getByLabel('Closing date and time', { exact: true });
  await expect(deadline).toBeVisible();
  await expect(deadline).toHaveValue('2026-10-26T12:00');
  await deadline.fill('2026-10-26T13:00');
  expect(
    await deadline.evaluate((input) => input instanceof HTMLInputElement && input.checkValidity()),
  ).toBe(true);
  await expect(page.getByText(/Closes around.*Atlantic\/Canary/)).toBeVisible();
  await deadline.fill('2026-10-12T12:00');
  expect(
    await deadline.evaluate((input) => input instanceof HTMLInputElement && input.checkValidity()),
  ).toBe(false);
  await page.getByLabel('Choose a closing date', { exact: true }).uncheck();
  await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('2');
  await page.getByLabel('Quorum (%)', { exact: true }).fill('100.01');
  expect(
    await page
      .getByLabel('Quorum (%)', { exact: true })
      .evaluate((input) => input instanceof HTMLInputElement && input.checkValidity()),
  ).toBe(false);
  await page.getByLabel('Approval (%)', { exact: true }).fill('50');
  expect(
    await page
      .getByLabel('Approval (%)', { exact: true })
      .evaluate((input) => input instanceof HTMLInputElement && input.checkValidity()),
  ).toBe(false);
});

test('an invalid duration cannot switch to a calendar or leave a stale valid duration', async ({
  page,
}) => {
  await fixture(page, false);
  await page.goto('/dao/1/decide');
  await page.getByRole('button', { name: 'Open a ballot', exact: true }).click();
  const duration = page.getByLabel('Duration', { exact: true });
  await duration.fill('');
  await expect(page.getByLabel('Choose a closing date', { exact: true })).toBeDisabled();
  expect(
    await duration.evaluate((input) => input instanceof HTMLInputElement && input.checkValidity()),
  ).toBe(false);
  await duration.fill('3');
  await expect(page.getByLabel('Choose a closing date', { exact: true })).toBeEnabled();
});

test('governance settings use the same duration units and percentage controls', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/dao/1/settings?settings=governance');
  await page.getByRole('button', { name: 'Edit voting rules', exact: true }).click();
  await expect(page.getByLabel('Policy duration', { exact: true })).toHaveValue('3');
  await expect(page.getByLabel('Policy duration unit', { exact: true })).toHaveValue('days');
  await expect(page.getByLabel('Policy quorum (%)', { exact: true })).toHaveValue('50');
  await expect(page.getByLabel('Policy approval (%)', { exact: true })).toHaveValue('50.01');
  await page.getByLabel('Policy duration unit', { exact: true }).selectOption('hours');
  await expect(page.getByLabel('Policy duration', { exact: true })).toHaveValue('72');
  await expect(
    page.getByRole('button', { name: 'Sign policy update', exact: true }),
  ).toBeDisabled();
});

test('visitors can browse decisions and help but cannot open the ballot creation popup', async ({
  page,
}) => {
  await fixture(page, true, true);
  await page.goto('/dao/1/decide');
  const add = page.getByRole('button', { name: 'Open a ballot', exact: true });
  await expect(add).toBeDisabled();
  await expect(page.getByRole('dialog', { name: 'Open a ballot', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Community decision', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Ballot rules and help', exact: true }),
  ).toHaveAttribute('href', '/docs/decide?dao=1');
});

for (const action of ['open', 'newelect'] as const) {
  test(`${action} submission preserves the draft and closes its popup only after confirmed success`, async ({
    page,
  }) => {
    const state = await fixture(page),
      password = 'disposable ballot popup fixture';
    const vault = await createVault(password);
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
      expect(input.request.action).toBe(action);
      expect(input.request.target).toBe('decide');
      expect(
        Signature.from(input.sig).verifyDigest(
          instructionDigest(input.request),
          PublicKey.from(vault.signingPublicKey),
        ),
      ).toBe(true);
      const fields = z.record(z.string(), z.unknown()).parse(
        Serializer.objectify(
          Serializer.decode({
            abi: ABI.from(decideAbi),
            type: action,
            data: input.request.data,
          }),
        ),
      );
      for (const key of ['dao_id', 'member_id', 'ballot_id', 'election_id', 'document_id'])
        if (typeof fields[key] === 'number') fields[key] = String(fields[key]);
      if (action === 'open') {
        expect(DecideActionSchemas.open.parse(fields)).toMatchObject({
          dao_id: '1',
          member_id: '1',
          duration: 259200,
          quorum: 5000,
          approval: 5001,
        });
      } else {
        expect(DecideActionSchemas.newelect.parse(fields)).toMatchObject({
          dao_id: '1',
          member_id: '1',
          title: 'Retry decision',
          document_id: '42',
          document_version: 2,
          seats: 1,
        });
      }
      attempts++;
      if (attempts === 1)
        return route.fulfill({
          status: 503,
          json: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic unavailable relay' },
        });
      await held;
      if (action === 'open') {
        const decoded = DecideActionSchemas.open.parse(fields);
        const existing = state.modules.ballots[0];
        if (!existing) throw new Error('Fixture ballot missing');
        state.modules.ballots.push({
          ...existing,
          id: decoded.ballot_id,
          metadata: decoded.metadata,
        });
      } else {
        const decoded = DecideActionSchemas.newelect.parse(fields);
        state.modules.elections.push({
          id: decoded.election_id,
          dao_id: '1',
          creator: '1',
          title: decoded.title,
          document_id: decoded.document_id,
          document_version: decoded.document_version,
          document_commitment: 'bb'.repeat(32),
          policy_revision: '1',
          nomination_close: decoded.nomination_close,
          term_start: decoded.term_start,
          term_end: decoded.term_end,
          seats: decoded.seats,
          status: 0,
          candidates: [],
        });
      }
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
    await page.getByRole('link', { name: 'Decide', exact: true }).click();
    const popupName = action === 'open' ? 'Open a ballot' : 'Election and term rules';
    if (action === 'newelect')
      await page.getByRole('tab', { name: 'Elections', exact: true }).click();
    await page.getByRole('button', { name: popupName, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: popupName, exact: true });
    const title = dialog.getByLabel(
      action === 'open' ? 'Public ballot title' : 'Representative title',
    );
    const submit = dialog.getByRole('button', {
      name: action === 'open' ? 'Open ballot' : 'Schedule election',
      exact: true,
    });
    await title.fill('Retry decision');
    if (action === 'open')
      await dialog
        .getByLabel('Public explanation')
        .fill('A decision explanation preserved across the failed signature.');
    if (action === 'newelect') {
      await dialog.getByLabel('Election rules', { exact: true }).selectOption('12');
      const original = await dialog.getByLabel('Term starts', { exact: true }).inputValue();
      await dialog
        .getByLabel('Term starts', { exact: true })
        .fill(await dialog.getByLabel('Nominations close', { exact: true }).inputValue());
      await expect(submit).toBeDisabled();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await dialog.getByLabel('Term starts', { exact: true }).fill(original);
    }
    await submit.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(title).toHaveValue('Retry decision');
    if (action === 'newelect')
      await expect(dialog.getByLabel('Election rules', { exact: true })).toHaveValue('12');
    await submit.click();
    await expect.poll(() => attempts).toBe(2);
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole('article').getByRole('heading', { name: /^Retry decision/ }),
    ).toBeVisible();
  });
}

test('Elections plus opens friendly election setup and preserves its selected document version', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/dao/1/decide');
  await page.getByRole('tab', { name: 'Elections', exact: true }).click();
  const add = page.getByRole('button', { name: 'Election and term rules', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Election and term rules', exact: true });
  await expect(dialog).not.toBeVisible();
  await add.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Election purpose')).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Open a ballot', exact: true })).not.toBeVisible();
  const rules = dialog.getByLabel('Election rules', { exact: true });
  await expect(rules.locator('option')).toContainText([
    'Choose a published document',
    'Council rules · version 2',
    'Council rules · version 1',
    'Private document #43 · version 1',
  ]);
  await expect(dialog.getByText('Private title must stay hidden', { exact: false })).toHaveCount(0);
  await rules.selectOption('12');
  await dialog.getByLabel('Representative title').fill('Neighbourhood council');
  await expect(
    dialog.getByRole('button', { name: 'Schedule election', exact: true }),
  ).toBeDisabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('election-popup.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(add).toBeFocused();
  await add.click();
  await expect(rules).toHaveValue('12');
  await expect(dialog.getByLabel('Representative title')).toHaveValue('Neighbourhood council');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('tab', { name: 'Ballots', exact: true }).click();
  await page.getByRole('button', { name: 'Open a ballot', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Open a ballot', exact: true })).toBeVisible();
});

test('ordinary members can vote in Elections but cannot open administrator election setup', async ({
  page,
}) => {
  const state = await fixture(page);
  state.member.admin = false;
  await page.goto('/dao/1/decide');
  await expect(page.getByRole('button', { name: 'Open a ballot', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: 'Elections', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Election and term rules', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('dialog', { name: 'Election and term rules', exact: true }),
  ).toHaveCount(0);
});

test('election documents recover from a failed read and explain an empty document library', async ({
  page,
}) => {
  const state = await fixture(page);
  let fail = true;
  await page.route('**/v1/daos/1/content', (route) =>
    route.fulfill(
      fail
        ? {
            status: 503,
            json: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic document outage' },
          }
        : { json: { ...state.content, documents: [] } },
    ),
  );
  await page.goto('/dao/1/decide');
  await page.getByRole('tab', { name: 'Elections', exact: true }).click();
  await page.getByRole('button', { name: 'Election and term rules', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Election and term rules', exact: true });
  await expect(dialog.getByRole('alert')).toBeVisible();
  fail = false;
  await dialog.getByRole('button', { name: 'Retry documents', exact: true }).click();
  await expect(dialog.getByText('No published documents yet.', { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole('link', { name: 'Open DAO documents', exact: true }),
  ).toHaveAttribute('href', '/dao/1/documents');
  await expect(
    dialog.getByRole('button', { name: 'Schedule election', exact: true }),
  ).toBeDisabled();
});

test('term recall chooses a published reason beside the term and keeps identifiers out of inputs', async ({
  page,
}) => {
  const state = await fixture(page);
  state.modules.terms.push({
    id: '77',
    dao_id: '1',
    election_id: '50',
    member_id: '1',
    title: 'Neighbourhood council',
    starts: Math.floor(Date.now() / 1000) - 600,
    ends: Math.floor(Date.now() / 1000) + 86400,
    recalled: false,
    recalled_at: 0,
    recall_doc: '0',
    recall_version: 0,
  });
  const first = state.modules.terms[0];
  if (!first) throw new Error('Fixture term missing');
  state.modules.terms.push({ ...first, id: '78', member_id: '2' });
  await page.goto('/dao/1/decide');
  await page.getByRole('tab', { name: 'Elections', exact: true }).click();
  const term = page.getByRole('article').filter({
    has: page.getByRole('heading', { name: 'Neighbourhood council · member 1', exact: true }),
  });
  await expect(term.getByLabel('Reason for ending the term', { exact: true })).not.toBeVisible();
  await term.getByText('End this term early', { exact: true }).click();
  await term.getByLabel('Reason for ending the term', { exact: true }).selectOption('12');
  await expect(term.getByLabel('Reason for ending the term', { exact: true })).toHaveValue('12');
  await expect(term.getByRole('button', { name: 'End term', exact: true })).toBeDisabled();
  const other = page.getByRole('article').filter({
    has: page.getByRole('heading', { name: 'Neighbourhood council · member 2', exact: true }),
  });
  await other.getByText('End this term early', { exact: true }).click();
  await expect(other.getByLabel('Reason for ending the term', { exact: true })).toHaveValue('');
  await expect(term.getByLabel('Reason for ending the term', { exact: true })).toHaveValue('12');
  await expect(page.getByLabel('Recall reason document ID')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
