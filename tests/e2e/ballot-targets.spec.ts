import { expect, test } from '@playwright/test';
import { Checksum256 } from '@wharfkit/antelope';
import { DecideTableSchemas, ballotCommitment, makeBallotExport } from '@daclify/modules/sdk';
import { moduleFixture } from './fixtures/module-design';
test('reviews and exports the frozen funding target and rejects altered payments', async ({
  page,
}) => {
  const state = await moduleFixture(page),
    ballot = state.modules.ballots[0],
    document = state.content.documents[0];
  if (!ballot || !document) throw Error('Fixture ballot document');
  document.commitment = Checksum256.hash(new TextEncoder().encode(document.metadata)).toString();
  ballot.metadata = JSON.stringify({
    schemaVersion: 3,
    semantics: 'proposal',
    title: 'Fixed garden funding',
    description: 'Fund the agreed milestone.',
    options: ['Reject', 'Approve'],
  });
  const execution = {
    ballot_id: ballot.id,
    dao_id: '1',
    works: 'works',
    project_id: '7',
    commitment: '00'.repeat(32),
    works_hash: '00'.repeat(32),
    policy_revision: '0',
    deadline: ballot.closes + 3600,
    executed: false,
  };
  const target = DecideTableSchemas.votetargets.parse({
    ballot_id: ballot.id,
    dao_id: '1',
    version: 1,
    work: {
      project: {
        id: '7',
        dao_id: '1',
        creator: '1',
        contributor: '2',
        document_id: document.document_id,
        document_version: 1,
        milestones: ['8'],
        status: 0,
      },
      milestones: [
        {
          id: '8',
          dao_id: '1',
          project_id: '7',
          quantity: '3.0000 TLOS',
          due: ballot.closes + 7200,
          status: 0,
          submission_doc: '0',
          submission_version: 0,
          review_doc: '0',
          review_version: 0,
          reviewer: '0',
        },
      ],
      document_commitment: document.commitment,
    },
    released: false,
  });
  const definition = {
    ballot_id: ballot.id,
    dao_id: '1',
    version: 2,
    purpose: 3,
    policy_revision: '0',
    policy_hash: '00'.repeat(32),
    commitment: '00'.repeat(32),
  };
  definition.commitment = ballotCommitment({
    chainId: state.dao.chainId,
    runtime: state.dao.contract,
    decide: 'decide',
    ballot,
    definition,
    execution,
    target,
  });
  state.modules.executions = [execution];
  state.modules.ballotTargets = [target];
  state.modules.ballotDefinitions = [definition];
  const exported = makeBallotExport({
    dao: state.modules.dao,
    decide: 'decide',
    ballot,
    definition,
    execution,
    target,
    votes: [],
  });
  await page.route('**/v1/daos/1/ballots/9/export', (route) => route.fulfill({ json: exported }));
  await page.goto('/dao/1/decide');
  const card = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Fixed garden funding' }) });
  await expect(card.getByText(/Milestone 8: 3.0000 TLOS/)).toBeVisible();
  const reviewed = card.getByLabel('I reviewed these exact terms and evidence');
  await expect(reviewed).toBeDisabled();
  await card.getByRole('button', { name: 'Open verified supporting document' }).click();
  await card.getByLabel('I reviewed this document version').check();
  await reviewed.check();
  const downloading = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Export ballot and votes' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('ballot-9.json');
  await expect(card.getByText('All recorded live votes are included.')).toBeVisible();
  if (!target.work?.milestones[0]) throw Error('Fixture target');
  target.work.milestones[0].quantity = '4.0000 TLOS';
  await page.reload();
  await expect(card.getByRole('alert')).toContainText(/do not match/i);
  await expect(card.getByRole('button', { name: 'Vote Approve', exact: true })).toBeDisabled();
});
test('shows frozen court eligibility and requires every evidence version before acknowledging a dispute', async ({
  page,
}) => {
  const state = await moduleFixture(page),
    ballot = state.modules.ballots[0],
    document = state.content.documents[0];
  if (!ballot || !document) throw Error('Fixture court');
  document.commitment = Checksum256.hash(new TextEncoder().encode(document.metadata)).toString();
  const zero = '00'.repeat(32),
    rules = {
      decide: 'decide',
      decide_hash: zero,
      backup: '3',
      representative: '1',
      kind: 0,
      quorum: 5000,
      approval: 5001,
      review_seconds: 60,
      challenge_seconds: 60,
      vote_seconds: 60,
      backup_seconds: 60,
    };
  const dispute = DecideTableSchemas.arbplans.parse({
    ballot_id: ballot.id,
    dao_id: '1',
    quantity: '5.0000 TLOS',
    due: ballot.closes,
    executed: false,
    version: 1,
    cursor: '3',
    scanned: 3,
    ready: true,
    voters: [{ member_id: '3', weight: '1' }],
    protection: {
      id: '8',
      source: 'works',
      source_id: '8',
      project_id: '7',
      recipient: '2',
      version: 1,
      source_hash: zero,
      terms: zero,
      rules,
      cutoff: ballot.closes,
      reviewer: '1',
      reviewers: ['1'],
      state: 4,
      deadline: ballot.closes + 60,
      ballot_id: ballot.id,
      decision_hash: zero,
      consent_outcome: 2,
      consent_mask: 0,
      submission_doc: '42',
      submission_version: 1,
      submission_commitment: document.commitment,
      review_doc: '42',
      review_version: 1,
      review_commitment: document.commitment,
      challenge_doc: '0',
      challenge_version: 0,
      challenge_commitment: zero,
    },
  });
  ballot.metadata = JSON.stringify({
    schemaVersion: 3,
    semantics: 'poll',
    title: 'Disputed milestone',
    description: 'Decide the fixed amount.',
    options: ['Cancel unpaid milestone', 'Pay contributor'],
  });
  const definition = {
    ballot_id: ballot.id,
    dao_id: '1',
    version: 1,
    purpose: 6,
    policy_revision: '0',
    policy_hash: zero,
    commitment: zero,
  };
  definition.commitment = ballotCommitment({
    chainId: state.dao.chainId,
    runtime: state.dao.contract,
    decide: 'decide',
    ballot,
    definition,
    dispute,
  });
  state.modules.arbitrationPlans = [dispute];
  state.modules.ballotDefinitions = [definition];
  await page.goto('/dao/1/decide');
  const court = page.getByRole('region', { name: 'Exact ballot terms' });
  await expect(page.getByText('You are not in this ballot’s eligible voter list.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vote Pay contributor' })).toBeDisabled();
  const review = page.getByLabel('I reviewed these exact terms and evidence');
  await expect(review).toBeDisabled();
  for (const container of await court
    .locator('div')
    .filter({ has: page.getByRole('heading', { level: 4 }) })
    .all()) {
    const open = container.getByRole('button', { name: 'Open verified supporting document' });
    if ((await open.count()) === 1) {
      await open.click();
      await container.getByLabel('I reviewed this document version').check();
    }
  }
  await expect(review).toBeEnabled();
  await review.check();
  await expect(page.getByRole('button', { name: 'Vote Pay contributor' })).toBeDisabled();
  ballot.status = 3;
  dispute.ready = false;
  dispute.cursor = '256';
  dispute.scanned = 256;
  state.modules.ballotDefinitions = [];
  await page.route('**/v1/works/arbitration', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      obligationId: '8',
      operation: 'open-vote',
    });
    ballot.status = 0;
    dispute.ready = true;
    dispute.cursor = '3';
    dispute.scanned = 3;
    state.modules.ballotDefinitions = [definition];
    return route.fulfill({
      json: { transactionId: 'ab'.repeat(32), ballotId: ballot.id, state: 4 },
    });
  });
  await page.reload();
  await expect(page.getByText('Preparing eligible voters', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vote Pay contributor' })).toHaveCount(0);
  await expect(page.getByText(/256 member records checked/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue preparing voters', exact: true }).click();
  await expect(page.getByText('Preparing eligible voters', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Vote Pay contributor' })).toBeDisabled();
});
