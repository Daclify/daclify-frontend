import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ApiRoutes } from '@daclify/core-protocol';
import { BallotMetadataV3Schema, BallotMetadataV4Schema } from '@daclify/modules';
import {
  createPrivateDao,
  watchCanaries,
  ballotForm,
  moduleState,
  unlockReturn,
  assertNoStoredCanary,
  submit,
} from './fixtures/private-content';
test('encrypts custom choices, requires local reading, signs the frozen choice and clears wording on lock', async ({
  page,
}) => {
  test.setTimeout(150000);
  const daoId = await createPrivateDao(page),
    title = 'Hidden ballot title ' + Date.now(),
    explanation = 'Hidden ballot explanation ' + '💫'.repeat(700),
    options = ['Hidden choice Garden', 'Hidden choice Hall', 'Hidden choice Online'],
    canaries = [title, 'Hidden ballot explanation', ...options],
    leaked = watchCanaries(page, canaries);
  const form = await ballotForm(page, title, explanation, options);
  await submit(form);
  await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Vote ' + options[1], exact: true })).toHaveCount(
    0,
  );
  const state = await moduleState(page, daoId),
    ballot = state.ballots[0];
  if (!ballot) throw Error('fixture ballot missing');
  expect(BallotMetadataV4Schema.parse(JSON.parse(ballot.metadata))).toMatchObject({
    schemaVersion: 4,
    options: [0, 1, 2],
    privateContent: { documentId: ballot.id },
  });
  expect(state.ballotDefinitions.find((row) => row.ballot_id === ballot.id)?.version).toBe(3);
  expect(canaries.some((value) => JSON.stringify(state).includes(value))).toBe(false);
  await page.getByRole('button', { name: 'Read private ballot', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByText(explanation, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Vote ' + options[1], exact: true }).click();
  await expect(page.getByText('Your vote: ' + options[1], { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export ballot and votes', exact: true }).click();
  const path = await (await download).path();
  if (!path) throw Error('export missing');
  const exported = readFileSync(path, 'utf8');
  expect(canaries.some((value) => exported.includes(value))).toBe(false);
  await assertNoStoredCanary(page, canaries);
  await page.getByRole('button', { name: 'Open a ballot', exact: true }).click();
  const publicForm = page.getByRole('dialog', { name: 'Open a ballot', exact: true });
  await publicForm.getByLabel('Publish ballot wording publicly', { exact: true }).check();
  const checkbox = await publicForm
    .getByLabel('Publish ballot wording publicly', { exact: true })
    .boundingBox();
  expect(checkbox?.width).toBeLessThanOrEqual(24);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(
    publicForm.getByText(
      'The title, explanation and every choice will be public permanently on chain.',
      { exact: true },
    ),
  ).toBeVisible();
  await publicForm
    .getByLabel('Public ballot title', { exact: true })
    .fill('Deliberately public ballot');
  await publicForm
    .getByLabel('Public explanation', { exact: true })
    .fill('This wording is deliberately public.');
  await publicForm.getByLabel('Ballot type', { exact: true }).selectOption('proposal');
  await submit(publicForm);
  expect(
    (await moduleState(page, daoId)).ballots.some(
      (row) =>
        BallotMetadataV3Schema.safeParse(JSON.parse(row.metadata)).data?.publicDisclosure === true,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Vote ' + options[1], exact: true })).toHaveCount(
    0,
  );
  expect(await page.title()).not.toContain(title);
  await unlockReturn(page, daoId);
  await page.getByRole('button', { name: 'Read private ballot', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  expect(leaked).toEqual([]);
});
test('reconciles a lost successful opening after reload without a second ballot or signature', async ({
  page,
}) => {
  test.setTimeout(150000);
  const daoId = await createPrivateDao(page),
    title = 'Hidden retry ballot ' + Date.now(),
    options = ['Hidden retry A', 'Hidden retry B', 'Hidden retry C'],
    canaries = [title, 'Hidden retry explanation', ...options],
    leaked = watchCanaries(page, canaries);
  let openings = 0,
    interrupted = false;
  await page.route('**' + ApiRoutes.relay.path, async (route) => {
    const body = ApiRoutes.relay.input.parse(route.request().postDataJSON());
    if (body.request.action === 'openpoll') {
      openings++;
      if (!interrupted) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        interrupted = true;
        await route.abort('failed');
        return;
      }
    }
    await route.continue();
  });
  const form = await ballotForm(page, title, 'Hidden retry explanation', options);
  await form.getByRole('button', { name: 'Open ballot', exact: true }).click();
  await expect.poll(() => interrupted).toBe(true);
  await expect(
    form.getByRole('button', { name: 'Finish private ballot', exact: true }),
  ).toBeEnabled();
  expect((await moduleState(page, daoId)).ballots).toHaveLength(1);
  await assertNoStoredCanary(page, canaries);
  await page.reload();
  await unlockReturn(page, daoId);
  await page.getByRole('button', { name: 'Open a ballot', exact: true }).click();
  const resumed = page.getByRole('dialog', { name: 'Open a ballot', exact: true });
  await resumed
    .getByRole('button', { name: 'Review unfinished private ballot', exact: true })
    .click();
  await expect(resumed.getByText('Ballot already opened', { exact: true })).toBeVisible();
  expect((await moduleState(page, daoId)).ballots).toHaveLength(1);
  expect(openings).toBe(1);
  expect(
    await page.evaluate(
      () =>
        Object.keys(sessionStorage).filter((key) => key.includes('daclify.private-ballot-draft.v1'))
          .length,
    ),
  ).toBe(0);
  await assertNoStoredCanary(page, canaries);
  expect(leaked).toEqual([]);
});
