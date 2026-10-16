import { expect, test } from '@playwright/test';
import { ApiRoutes } from '@daclify/core-protocol';
import { QuickBallotRoutes } from '@daclify/modules';
import { payCreation } from './creation-payment';
test.use({ actionTimeout: 15000 });
for (const mode of ['normal', 'lost success', 'key change'])
  test(`publishes and reads an encrypted Quick question (${mode})`, async ({ page }) => {
    test.setTimeout(150000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('dialog', (dialog) => void dialog.accept());
    await page.goto('/account');
    await page.getByRole('button', { name: 'New Account', exact: true }).click();
    await page.getByRole('button', { name: 'Own Keys', exact: true }).click();
    await page
      .getByLabel('Vault password', { exact: true })
      .fill('owned private Quick fixture password');
    await page.getByRole('button', { name: 'Create encrypted vault', exact: true }).click();
    await page.getByLabel('I have saved my recovery kit and credential', { exact: true }).check();
    await page.getByRole('button', { name: 'Finish account setup', exact: true }).click();
    await expect(page.getByText('Vault unlocked', { exact: true })).toBeVisible();
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole('navigation').getByRole('link', { name: 'Create', exact: true }).click();
    await page
      .getByLabel('Privacy policy', { exact: true })
      .selectOption('encrypted-user-controlled');
    await page.getByLabel('DAO name', { exact: true }).fill('Owned private Quick fixture');
    await page.getByLabel('Description', { exact: true }).fill('Synthetic test only.');
    await payCreation(page, 'custom');
    const daoId = new URL(page.url()).pathname.split('/')[2];
    if (!daoId) throw Error('Owned DAO missing');
    const sections = page.getByRole('navigation', { name: 'DAO sections' });
    await sections.getByRole('link', { name: 'Modules', exact: true }).click();
    await page.getByRole('button', { name: 'Enable Quick ballots', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Disable Quick ballots', exact: true }),
    ).toBeVisible();
    await sections.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Governance', exact: true }).click();
    await page.getByRole('button', { name: 'Manage executives', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Manage executives', exact: true })
      .getByRole('button', { name: 'Sign executive appointment', exact: true })
      .click();
    await expect(
      page.getByRole('dialog', { name: 'Manage executives', exact: true }),
    ).not.toBeVisible();
    const network = ApiRoutes.network.response.parse(
      await (await page.request.get(ApiRoutes.network.path)).json(),
    );
    expect(network.capabilities).toContain('private-quick-question-v1');
    if (await menu.isVisible()) await menu.click();
    await page
      .getByRole('navigation')
      .getByRole('link', { name: 'Quick ballots', exact: true })
      .click();
    await page.getByRole('button', { name: 'Ask a question', exact: true }).click();
    await page.getByLabel('Originating DAO', { exact: true }).selectOption(daoId);
    const question = 'Secret Quick question canary ' + Date.now(),
      explanation = 'Secret Quick explanation canary ' + 'x'.repeat(3800),
      leaks: string[] = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (!path.startsWith('/v1/')) return;
      let value = (request.postData() ?? '') + request.url();
      if (path === ApiRoutes.relay.path) {
        const relay = ApiRoutes.relay.input.safeParse(request.postDataJSON());
        if (relay.success) value += Buffer.from(relay.data.request.data, 'hex').toString('utf8');
      }
      if (value.includes(question) || value.includes('Secret Quick explanation canary'))
        leaks.push(path);
    });
    await page.getByLabel('Question', { exact: true }).fill(question);
    await page.getByLabel('Details (optional)', { exact: true }).fill(explanation);
    await expect(page.getByLabel('Publish question publicly', { exact: true })).not.toBeChecked();
    let openings = 0,
      attempts = 0;
    await page.route('**' + ApiRoutes.relay.path, async (route) => {
      const input = ApiRoutes.relay.input.parse(route.request().postDataJSON());
      if (input.request.action !== 'open') return route.continue();
      attempts++;
      if (mode === 'key change' && attempts === 1)
        return route.fulfill({
          status: 503,
          json: { code: 'SERVICE_UNAVAILABLE', message: 'Owned interrupted opening' },
        });
      openings++;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      if (mode === 'lost success') return route.abort('failed');
      return route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Publish question', exact: true }).click();
    if (mode === 'key change') {
      await expect(page.getByRole('alert')).toBeVisible();
      await page.evaluate(
        async ({ daoId, network }) => {
          const publishPath = '/src/content/publish-private-record.ts',
            sessionPath = '/src/auth/session.ts';
          const publication: unknown = await import(publishPath),
            session: unknown = await import(sessionPath);
          if (
            !publication ||
            typeof publication !== 'object' ||
            !('sendPrivateAction' in publication) ||
            typeof publication.sendPrivateAction !== 'function' ||
            !session ||
            typeof session !== 'object' ||
            !('preparePrivateEpoch' in session) ||
            typeof session.preparePrivateEpoch !== 'function'
          )
            throw Error('FIXTURE_MODULE');
          const dao = {
            chainId: network.chainId,
            contract: network.runtime,
            daoId,
            interfaceVersion: 1,
          };
          const actor = { runtime: dao.contract, dao_id: daoId, member_id: '1' };
          await publication.sendPrivateAction(dao, '1', 'rotateepoch', actor, true);
        },
        { daoId, network },
      );
      await page.getByText('Reprepare after key or reader changes', { exact: true }).click();
      await page.getByRole('button', { name: 'Reprepare unopened question', exact: true }).click();
      await expect(
        page.getByText('Encrypted question prepared with the same ballot ID.', { exact: false }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Publish question', exact: true }).click();
    }
    await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/quick-ballots\/\d+$/);
    const id = new URL(page.url()).pathname.split('/')[2];
    if (!id) throw Error('Owned ballot missing');
    const detail = QuickBallotRoutes.quickDetail.response.parse(
      await (
        await page.request.get(QuickBallotRoutes.quickDetail.path.replace(':ballotId', id))
      ).json(),
    );
    expect(detail.ballot.definition).toMatchObject({
      protocol: 2,
      all_accounts: false,
      audience: [daoId],
      explanation: '',
    });
    expect(JSON.stringify(detail)).not.toContain(question);
    if (mode === 'key change')
      expect(JSON.parse(detail.ballot.definition.question)).toMatchObject({
        version: 2,
        keyEpoch: '2',
      });
    await expect(page.getByRole('heading', { name: question, exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Read private question', exact: true }).click();
    await expect(page.getByRole('heading', { name: question, exact: true })).toBeVisible();
    await expect(page.getByText(explanation, { exact: true })).toBeVisible();
    expect(leaks).toEqual([]);
    expect(openings).toBe(1);
    expect(pageErrors).toEqual([]);
    expect(
      await page.evaluate(
        (text) =>
          [localStorage, sessionStorage].every((storage) =>
            Object.values(storage).every((value) => !String(value).includes(text)),
          ),
        question,
      ),
    ).toBe(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: question, exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'Unlock account to read question', exact: true }),
    ).toBeVisible();
  });
