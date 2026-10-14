import { z } from 'zod';
import { ABI, Checksum256, PublicKey, Serializer, Signature } from '@wharfkit/antelope';
import {
  ApiRoutes,
  LoginMessageSchema,
  RecoveryKitSchema,
  Uint64Schema,
} from '@daclify/core-protocol';
import { instructionDigest } from '@daclify/core-protocol/sdk';
import { DecideActionSchemas, decideAbi, ballotCommitment } from '@daclify/modules/sdk';
import { createVault } from '../../src/auth/vault';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { moduleFixture } from './fixtures/module-design';

const nativeId = z.coerce.string().pipe(Uint64Schema);
const nativeIds = { dao_id: nativeId, member_id: nativeId, ballot_id: nativeId };

const description = 'Pick the day when our volunteers can repair the garden gate.';
const options = ['Friday', 'Saturday', 'Sunday'];

test('shows the explanation, exact choices, own vote, tallies and winning option', async ({
  page,
}) => {
  const state = await moduleFixture(page);
  const ballot = state.modules.ballots[0];
  if (!ballot) throw new Error('FIXTURE_BALLOT');
  Object.assign(ballot, {
    choices: 3,
    cast: '12',
    denominator: '20',
    tallies: ['3', '2', '7'],
    status: 1,
    winner: 2,
    metadata: JSON.stringify({ schemaVersion: 2, title: 'Repair day', description, options }),
  });
  state.modules.votes.push({ id: '1', ballot: ballot.id, member: '1', weight: '1', choice: 2 });
  await page.goto('/dao/1/decide');
  const card = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Repair day' }) });
  await expect(card.getByText(description, { exact: true })).toBeVisible();
  await expect(card.getByText('Your vote: Sunday', { exact: true })).toBeVisible();
  await expect(card.getByText('Selected option: Sunday', { exact: true })).toBeVisible();
  for (const text of ['Friday · 3', 'Saturday · 2', 'Sunday · 7'])
    await expect(card.getByText(text, { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('offers proposal text, exact document versions and bounded custom choices', async ({
  page,
}) => {
  await moduleFixture(page);
  await page.goto('/dao/1/decide');
  await page.getByRole('button', { name: 'Open a ballot', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Open a ballot' });
  await expect(form.getByLabel('Public explanation', { exact: true })).toBeVisible();
  await expect(form.getByLabel('Supporting document (optional)', { exact: true })).toBeVisible();
  await expect(
    form
      .getByLabel('Supporting document (optional)')
      .getByRole('option', { name: 'Council rules · version 1', exact: true }),
  ).toHaveCount(1);
  await expect(form.getByText('Private title must stay hidden')).toHaveCount(0);
  await form.getByLabel('Ballot type').selectOption('poll');
  for (let i = 1; i <= 3; i++)
    await expect(form.getByLabel(`Choice ${i}`, { exact: true })).toBeVisible();
  await expect(form.getByLabel('Voting weight')).toBeDisabled();
  await expect(form.getByLabel('Duration', { exact: true })).toBeDisabled();
});

test('legacy binary voting keeps its original labels and new definitions cannot lose choices', async ({
  page,
}) => {
  const state = await moduleFixture(page);
  await page.goto('/dao/1/decide');
  await expect(page.getByRole('button', { name: 'Vote Reject', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Vote Approve', exact: true })).toHaveCount(1);
  const ballot = state.modules.ballots[0];
  if (!ballot) throw new Error('FIXTURE_BALLOT');
  ballot.choices = 3;
  ballot.tallies = ['0', '0', '0'];
  await page.reload();
  await expect(
    page.getByText('The ballot’s choice definitions are unavailable or inconsistent.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /^Vote / })).toHaveCount(0);
});

test('supporting documents open the exact pinned historical version', async ({ page }) => {
  const state = await moduleFixture(page);
  const ballot = state.modules.ballots[0];
  if (!ballot) throw new Error('FIXTURE_BALLOT');
  ballot.metadata = JSON.stringify({
    schemaVersion: 2,
    title: 'Garden decision',
    description,
    options: ['Reject', 'Approve'],
    document: { documentId: '42', version: 1, commitment: 'aa'.repeat(32) },
  });
  await page.goto('/dao/1/decide');
  await page.getByRole('link', { name: 'Council rules · version 1', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Council rules · version 1', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Council rules · version 2', exact: true }),
  ).toHaveCount(0);
});

test('signs a poll with its explanation and exact document, then records the selected option', async ({
  page,
}) => {
  test.setTimeout(60000);
  const state = await moduleFixture(page);
  const document=state.content.documents[0];if(!document)throw Error('Fixture document');
  document.commitment=Checksum256.hash(new TextEncoder().encode(document.metadata)).toString();
  const password = 'disposable ballot content fixture';
  const vault = await createVault(password);
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
  let message = '';
  await page.route('**/v1/auth/challenge', (route) => {
    const input = ApiRoutes.challenge.input.parse(route.request().postDataJSON());
    const id = crypto.randomUUID(),
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
  let opened = '',
    writes = 0;
  await page.route('**/v1/relay', (route) => {
    const body = ApiRoutes.relay.input.parse(route.request().postDataJSON());
    expect(body.request.dao_id).toBe('1');
    expect(body.request.target).toBe('decide');
    expect(
      Signature.from(body.sig).verifyDigest(
        instructionDigest(body.request),
        PublicKey.from(vault.signingPublicKey),
      ),
    ).toBe(true);
    const decoded = Serializer.decode({
      abi: ABI.from(decideAbi),
      type: body.request.action,
      data: body.request.data,
    });
    if (body.request.action === 'openpoll') {
      const input = DecideActionSchemas.openpoll.extend(nativeIds).parse(Serializer.objectify(decoded));
      expect(input.choices).toBe(3);
      expect(input.quorum).toBe(state.governance.policy?.config.quorum);
      expect(input.approval).toBe(state.governance.policy?.config.approval);
      expect(JSON.parse(input.metadata)).toEqual({
        schemaVersion: 3,
        semantics: 'poll',
        title: 'Repair day',
        description,
        options,
        document: { documentId: '42', version: 1, commitment: document.commitment },
      });
      opened = input.ballot_id;
      state.modules.ballots.push({
        id: opened,
        dao_id: '1',
        creator: '1',
        kind: input.kind,
        choices: 3,
        closes: Math.floor(Date.now() / 1000) + input.duration,
        quorum: input.quorum,
        approval: input.approval,
        denominator: '1',
        max_member: '1',
        cast: '0',
        tallies: ['0', '0', '0'],
        status: 0,
        winner: -1,
        metadata: input.metadata,
      });
      const poll=state.modules.ballots.find(row=>row.id===opened);
      if(!poll)throw Error('Fixture opened ballot');
      const definition={ballot_id:opened,dao_id:'1',version:1,purpose:1,policy_revision:'0',policy_hash:'00'.repeat(32),commitment:'00'.repeat(32)};
      definition.commitment=ballotCommitment({chainId:state.modules.dao.chainId,runtime:state.modules.dao.contract,decide:'decide',ballot:poll,definition});
      state.modules.ballotDefinitions.push(definition);
    } else {
      expect(body.request.action).toBe('votecommit');
      const input = DecideActionSchemas.votecommit.extend(nativeIds).parse(Serializer.objectify(decoded));
      expect(input.ballot_id).toBe(opened);
      expect(input.choice).toBe(1);
      state.modules.votes.push({ id: '21', ballot: opened, member: '1', weight: '1', choice: 1 });
    }
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
  await page.getByRole('link', { name: 'Decide', exact: true }).click();
  await page.getByRole('button', { name: 'Open a ballot', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Open a ballot' });
  await form.getByLabel('Public ballot title').fill('Repair day');
  await form.getByLabel('Public explanation').fill(description);
  await form.getByLabel('Ballot type').selectOption('poll');
  for (let i = 0; i < options.length; i++)
    await form.getByLabel(`Choice ${i + 1}`, { exact: true }).fill(options[i] ?? '');
  await form.getByLabel('Supporting document (optional)').selectOption('11');
  await form.getByRole('button', { name: 'Open ballot', exact: true }).click();
  await expect(page.getByText('Ballot opened', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vote Saturday', exact: true })).toBeDisabled();
  await page.getByRole('button',{name:'Open verified supporting document',exact:true}).click();
  await page.getByLabel('I reviewed this document version',{exact:true}).check();
  await page.getByRole('button', { name: 'Vote Saturday', exact: true }).click();
  await expect(page.getByText('Your vote: Saturday', { exact: true })).toBeVisible();
  expect(writes).toBe(2);
});

test('a different document commitment cannot substitute the latest version', async ({ page }) => {
  await moduleFixture(page);
  await page.goto('/dao/1/documents?document=42&version=1&commitment=' + 'dd'.repeat(32));
  await expect(
    page.getByText(/The linked document version or commitment is unavailable/),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: /Council rules/ })).toHaveCount(0);
});

test('loading ballot documents does not fetch the entire member directory', async ({ page }) => {
  await moduleFixture(page);
  let directoryReads = 0;
  await page.route('**/v1/people*', (route) => {
    directoryReads++;
    return route.fulfill({ json: { profiles: [], next: null } });
  });
  await page.goto('/dao/1/decide');
  await page.getByRole('button', { name: 'Open a ballot', exact: true }).click();
  await expect(page.getByLabel('Supporting document (optional)')).toBeEnabled();
  expect(directoryReads).toBe(0);
});

test('long custom choices fit a narrow screen without hiding vote buttons', async ({ page }) => {
  const state = await moduleFixture(page);
  const ballot = state.modules.ballots[0];
  if (!ballot) throw new Error('FIXTURE_BALLOT');
  const labels = ['W'.repeat(80), 'X'.repeat(80), 'Y'.repeat(80)];
  Object.assign(ballot, {
    choices: 3,
    tallies: ['0', '0', '0'],
    metadata: JSON.stringify({
      schemaVersion: 2,
      title: 'A long-label poll',
      description,
      options: labels,
    }),
  });
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/dao/1/decide');
  await expect(page.getByRole('button', { name: 'Vote ' + labels[0], exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('malformed supporting-document links do not substitute a latest version', async ({ page }) => {
  await moduleFixture(page);
  await page.goto('/dao/1/documents?document=42&version=not-a-version&commitment=bad');
  await expect(
    page.getByRole('alert').filter({ hasText: 'The linked document reference is invalid.' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: /Council rules/ })).toHaveCount(0);
});
