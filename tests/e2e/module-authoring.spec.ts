import { expect, test } from '@playwright/test';
import { PrivateKey } from '@wharfkit/antelope';
import { generateKeyPairSync } from 'node:crypto';
import { JoinIdentitySchema } from '@daclify/core-protocol';
import { payCreation } from './creation-payment';
async function openMenu(page: Parameters<typeof payCreation>[0]) {
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if ((await menu.isVisible()) && (await menu.getAttribute('aria-expanded')) === 'false')
    await menu.click();
}
test('authors grant consent, an election and enforced admission through real signed UI actions', async ({
  page,
}) => {
  test.setTimeout(60000);
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/account');
  await page.getByRole('button', { name: 'New Account', exact: true }).click();
  await page.getByRole('button', { name: 'Own Keys', exact: true }).click();
  await page
    .getByLabel('Vault password', { exact: true })
    .fill('module-authoring-fixture-password');
  await page.getByRole('button', { name: 'Create encrypted vault' }).click();
  await page.getByLabel('I have saved my recovery kit and credential').check();
  await page.getByRole('button', { name: 'Finish account setup' }).click();
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  await openMenu(page);
  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await page.getByLabel('DAO name').fill('Module authoring ' + Date.now());
  await payCreation(page, 'custom');
  const dao = /\/dao\/([0-9]+)/.exec(page.url())?.[1];
  if (!dao) throw new Error('FIXTURE_DAO');

  // Use the actual Documents route selected by the workspace navigation.
  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  await page.getByLabel('Document ID', { exact: true }).fill('1');
  await page.getByLabel('JSON content').fill('{"text":"Reviewed public module terms"}');
  await page.getByRole('button', { name: 'Publish JSON', exact: true }).click();
  await expect(page.getByText('Reviewed public module terms', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Modules', exact: true }).click();
  for (const name of ['Works', 'Grants rounds', 'Endorsement admission']) {
    await page.getByRole('button', { name: 'Enable ' + name, exact: true }).click();
    await expect(page.getByText(name + ' enabled', { exact: true })).toBeVisible();
  }
  await page.getByRole('link', { name: 'Grants', exact: true }).click();
  await page.getByRole('button', { name: 'Create grant round', exact: true }).click();
  const grantRound = page.getByRole('dialog', { name: 'Create grant round', exact: true });
  await grantRound
    .getByLabel('Round rules', { exact: true })
    .selectOption({ label: 'Reviewed public module terms · version 1' });
  await grantRound.getByRole('button', { name: 'Next', exact: true }).click();
  await grantRound.getByLabel('Funding limit (TLOS)', { exact: true }).fill('5');
  await grantRound.getByRole('button', { name: 'Next', exact: true }).click();
  await grantRound
    .getByLabel('I checked the rules, funding limit and deadlines', { exact: true })
    .check();
  await grantRound.getByRole('button', { name: 'Create round', exact: true }).click();
  await expect(
    page.getByText('Grant round created. Its cap reserves no funds.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Apply to this round' }).click();
  const grantApplication = page.getByRole('dialog', { name: 'Apply for a grant', exact: true });
  await grantApplication
    .getByLabel('Proposal document', { exact: true })
    .selectOption({ label: 'Reviewed public module terms · version 1' });
  await grantApplication.getByLabel('Milestone 1 amount (TLOS)', { exact: true }).fill('1');
  const due = new Date(Date.now() + 14 * 86400000);
  await grantApplication
    .getByLabel('Milestone 1 due date', { exact: true })
    .fill(new Date(due.getTime() - due.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  await grantApplication
    .getByLabel('I checked the proposal, milestone dates and total', { exact: true })
    .check();
  await grantApplication.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText(/Draft application created/)).toBeVisible();
  await page.getByRole('button', { name: 'Review and submit', exact: true }).click();
  await page
    .getByLabel(
      'I reviewed this exact application document, compensation, term, review and cancellation rules',
    )
    .check();
  await page.getByRole('button', { name: 'Sign consent and submit' }).click();
  await expect(page.getByText(/Application submitted with explicit consent/)).toBeVisible();
  await page.getByRole('button', { name: 'Review application', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review application', exact: true });
  await review
    .getByLabel('Review record', { exact: true })
    .selectOption({ label: 'Reviewed public module terms · version 1' });
  await review
    .getByLabel('I checked this application and its review record', { exact: true })
    .check();
  await review.getByRole('button', { name: 'Save eligibility decision', exact: true }).click();
  await expect(page.getByText(/Eligibility reviewed/)).toBeVisible();
  await page.getByRole('button', { name: 'Propose funding vote', exact: true }).click();
  const fundingVote = page.getByRole('dialog', { name: 'Propose funding vote', exact: true });
  await fundingVote
    .getByLabel('I checked the application total and funding terms', { exact: true })
    .check();
  await fundingVote.getByRole('button', { name: 'Open funding vote', exact: true }).click();
  await expect(page.getByText(/Award vote opened/)).toBeVisible();
  await page.getByRole('link', { name: 'Decide', exact: true }).click();
  await page.getByRole('button', { name: 'Vote Approve', exact: true }).click();
  await expect(page.getByText('Your vote: Approve', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Elections', exact: true }).click();
  await page.getByRole('button', { name: 'Election and term rules', exact: true }).click();
  await page
    .getByLabel('Election rules', { exact: true })
    .selectOption({ label: 'Reviewed public module terms · version 1' });
  await page.getByRole('button', { name: 'Schedule election', exact: true }).click();
  await expect(
    page.getByText('Election scheduled. Members nominate themselves before the cutoff.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign self-nomination' }).click();
  await expect(page.getByText('Self-nomination recorded.', { exact: true })).toBeVisible();
  // The open vote locks membership changes; finish admission in a separate fresh DAO.
  await openMenu(page);
  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await page.getByLabel('DAO name').fill('Admission authoring ' + Date.now());
  await payCreation(page, 'custom');
  const admission = /\/dao\/([0-9]+)/.exec(page.url())?.[1];
  if (!admission) throw new Error('FIXTURE_DAO');
  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  await page.getByLabel('Document ID', { exact: true }).fill('1');
  await page.getByLabel('JSON content').fill('{"text":"Admission terms"}');
  await page.getByRole('button', { name: 'Publish JSON', exact: true }).click();
  await expect(page.getByText('Admission terms', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Modules', exact: true }).click();
  await page.getByRole('button', { name: 'Enable Endorsement admission', exact: true }).click();
  await expect(page.getByText('Endorsement admission enabled', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Members', exact: true }).click();
  await page.getByText('Configure admission policy', { exact: true }).click();
  await page.getByLabel('Admission mode').selectOption('true');
  await page.getByLabel('Required endorsements').fill('1');
  await page.getByRole('button', { name: 'Review and sign admission policy' }).click();
  await expect(page.getByText(/Admission policy updated/)).toBeVisible();
  const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
    format: 'jwk',
  });
  const identity = JoinIdentitySchema.parse({
    version: 1,
    signingKey: PrivateKey.generate('K1').toPublic().toString(),
    custody: 'user-controlled',
    encryptionKey: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
  });
  await page.getByLabel('Applicant public join identity (JSON)').fill(JSON.stringify(identity));
  await page.getByLabel('Application document ID', { exact: true }).fill('1');
  await page
    .getByLabel('I confirmed these public keys, participant identity and application terms')
    .check();
  await page.getByRole('button', { name: 'Sign sponsored application' }).click();
  await expect(page.getByText(/Application sponsored/)).toBeVisible();
  await page
    .getByLabel('I reviewed this exact revision and confirmed the applicant identity')
    .check();
  await page.getByRole('button', { name: 'Sign endorsement', exact: true }).click();
  await expect(page.getByText(/Endorsement recorded/)).toBeVisible();
  await page
    .getByLabel('I reviewed this exact revision and confirmed the applicant identity')
    .check();
  await page.getByRole('button', { name: 'Sign admission request' }).click();
  await expect(page.getByText(/Member admitted once/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /Admitted member 2/ })).toBeVisible();
});
