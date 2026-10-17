import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  ApiRoutes,
  PrivateRecordPayloadSchema,
  PrivateRecordReferenceSchema,
} from '@daclify/core-protocol';
import {
  createPrivateDao,
  watchCanaries,
  assertNoStoredCanary,
  ballotForm,
  submit,
} from './fixtures/private-content';

test('keeps every descriptive record family out of API traffic, stored orders, logs, URLs and browser storage', async ({
  page,
}) => {
  test.setTimeout(180000);
  const marker = 'Private café ' + Date.now(),
    values = [marker];
  const leaks = watchCanaries(page, values),
    consoleLeaks: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes(marker)) consoleLeaks.push(message.type());
  });
  const daoId = await createPrivateDao(page);
  const network = ApiRoutes.network.response.parse(
    await (await page.request.get(ApiRoutes.network.path)).json(),
  );
  const dao = { chainId: network.chainId, contract: network.runtime, daoId, interfaceVersion: 1 };
  const payloads = z.array(PrivateRecordPayloadSchema).parse([
    {
      schemaVersion: 1,
      kind: 'dao-identity',
      source: dao.contract,
      recordId: daoId,
      body: {
        title: marker + ' identity',
        description: marker + ' mission ' + 'x'.repeat(3600),
        summary: marker + ' summary',
      },
    },
    {
      schemaVersion: 1,
      kind: 'ballot-content',
      source: 'decide',
      recordId: '910002',
      body: {
        title: marker + ' proposal',
        description: marker + ' explanation',
        semantics: 'poll',
        options: [marker + ' garden', marker + ' hall'],
      },
    },
    {
      schemaVersion: 1,
      kind: 'payroll-label',
      source: 'payroll',
      recordId: '910003',
      body: { purpose: 'agreed', label: marker + ' agreed pay' },
    },
    {
      schemaVersion: 1,
      kind: 'payroll-label',
      source: 'payroll',
      recordId: '910003',
      body: { purpose: 'display', label: marker + ' display pay' },
    },
    {
      schemaVersion: 1,
      kind: 'agent-description',
      source: dao.contract,
      recordId: '1',
      body: { operatorLabel: marker + ' operator', description: marker + ' instructions' },
    },
    {
      schemaVersion: 1,
      kind: 'quick-question',
      source: 'quickvote',
      recordId: '910006',
      body: { question: marker + ' question', explanation: marker + ' details' },
    },
  ]);
  const result: unknown = await page.evaluate(
    async ({ dao, payloads }) => {
      const path = '/src/content/publish-private-record.ts',
        readerPath = '/src/content/private-records.ts',
        apiPath = '/src/api/client.ts';
      const publisher: unknown = await import(path),
        reader: unknown = await import(readerPath),
        apiModule: unknown = await import(apiPath);
      if (
        !publisher ||
        typeof publisher !== 'object' ||
        !('publishPrivateRecord' in publisher) ||
        typeof publisher.publishPrivateRecord !== 'function' ||
        !reader ||
        typeof reader !== 'object' ||
        !('readPrivateRecord' in reader) ||
        typeof reader.readPrivateRecord !== 'function' ||
        !apiModule ||
        typeof apiModule !== 'object' ||
        !('api' in apiModule)
      )
        throw Error('OWNED_MODULE_REQUIRED');
      const client = apiModule.api;
      if (
        !client ||
        typeof client !== 'object' ||
        !('content' in client) ||
        typeof client.content !== 'function'
      )
        throw Error('OWNED_CLIENT_REQUIRED');
      const references = [],
        opened = [];
      for (const [index, payload] of payloads.entries()) {
        const reference: unknown = await publisher.publishPrivateRecord(
          dao,
          '1',
          String(910001 + index),
          1,
          payload,
          true,
        );
        const records: unknown = await client.content(dao.daoId);
        references.push(reference);
        opened.push(await reader.readPrivateRecord(dao, '1', reference, records, payload));
      }
      return { references, opened };
    },
    { dao, payloads },
  );
  const published = z
    .object({
      references: z.array(PrivateRecordReferenceSchema),
      opened: z.array(PrivateRecordPayloadSchema),
    })
    .parse(result);
  expect(published.opened).toEqual(payloads);
  await page
    .getByRole('navigation', { name: 'DAO sections' })
    .getByRole('link', { name: 'Settings', exact: true })
    .click();
  await page.getByRole('button', { name: 'Edit private details', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit private DAO details', exact: true });
  await editor.getByLabel('Private DAO name', { exact: true }).fill(marker + ' identity');
  await editor.getByLabel('Private description', { exact: true }).fill(marker + ' mission');
  await editor.getByLabel('Private summary', { exact: true }).fill(marker + ' summary');
  await editor.getByRole('button', { name: 'Save private details', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: marker + ' identity', exact: true }),
  ).toBeVisible();
  await page.route('**/v1/docs/agent', (route) => route.fulfill({ json: { configured: true } }));
  let asked = false;
  await page.route('**/v1/docs/ask', (route) => {
    expect(route.request().postDataJSON()).toEqual({ question: 'How do encrypted records work?' });
    asked = true;
    return route.fulfill({
      json: {
        status: 'answered',
        topicId: 'privacy',
        title: 'Privacy',
        answer: 'Private content is opened in your browser.',
      },
    });
  });
  const helpMenu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await helpMenu.isVisible()) await helpMenu.click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const assistant = page.getByRole('region', { name: 'Daxi assistant' });
  await assistant.getByLabel('Question', { exact: true }).fill('How do encrypted records work?');
  await assistant.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(
    assistant.getByText('Private content is opened in your browser.', { exact: true }),
  ).toBeVisible();
  expect(asked).toBe(true);
  await page.getByRole('button', { name: 'Minimize help', exact: true }).click();
  const content = ApiRoutes.content.response.parse(
    await (await page.request.get(ApiRoutes.content.path.replace(':id', daoId))).json(),
  );
  expect(JSON.stringify(content)).not.toContain(marker);
  const owner = z
    .object({ token: z.string() })
    .parse(
      JSON.parse(
        readFileSync('../daclify-backend-core/.artifacts/native/browser-owner.json', 'utf8'),
      ),
    );
  const projections = await page.request.get(
    'http://localhost:' +
      (process.env.DACLIFY_TEST_API_PORT ?? 3008) +
      '/fixture/private-projections',
    { headers: { 'x-fixture-token': owner.token } },
  );
  expect(projections.ok()).toBe(true);
  expect(await projections.text()).not.toContain(marker);
  expect(
    readFileSync(
      '../daclify-backend-core/.superpowers/sdd/2026-10-16-maximum-content-privacy/browser-fixture.log',
      'utf8',
    ),
  ).not.toContain(marker);
  await assertNoStoredCanary(page, values);
  expect(page.url()).not.toContain(marker);
  expect(await page.title()).not.toContain(marker);
  expect(leaks).toEqual([]);
  expect(consoleLeaks).toEqual([]);
  const reference = published.references[0];
  if (!reference) throw Error('HOSTED_REFERENCE_REQUIRED');
  expect(
    content.documents.find(
      (row) => row.document_id === reference.documentId && row.version === reference.version,
    )?.cid,
  ).toBeTruthy();
  const path = ApiRoutes.documentBytes.path
    .replace(':id', daoId)
    .replace(':documentId', reference.documentId)
    .replace(':version', String(reference.version));
  await page.route('**' + path, (route) =>
    route.fulfill({
      status: 503,
      json: { code: 'SERVICE_UNAVAILABLE', message: 'Owned missing encrypted source' },
    }),
  );
  const refused: unknown = await page.evaluate(
    async ({ dao, reference, payload }) => {
      const readerPath = '/src/content/private-records.ts',
        apiPath = '/src/api/client.ts';
      const reader: unknown = await import(readerPath),
        apiModule: unknown = await import(apiPath);
      if (
        !reader ||
        typeof reader !== 'object' ||
        !('readPrivateRecord' in reader) ||
        typeof reader.readPrivateRecord !== 'function' ||
        !apiModule ||
        typeof apiModule !== 'object' ||
        !('api' in apiModule)
      )
        throw Error('OWNED_MODULE_REQUIRED');
      const client = apiModule.api;
      if (
        !client ||
        typeof client !== 'object' ||
        !('content' in client) ||
        typeof client.content !== 'function'
      )
        throw Error('OWNED_CLIENT_REQUIRED');
      const records: unknown = await client.content(dao.daoId);
      try {
        await reader.readPrivateRecord(dao, '1', reference, records, payload);
        return { ok: true };
      } catch (cause) {
        return {
          ok: false,
          code:
            cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
              ? cause.code
              : 'UNEXPECTED_FAILURE',
        };
      }
    },
    { dao, reference, payload: payloads[0] },
  );
  expect(refused).toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
  await page.reload();
  await assertNoStoredCanary(page, values);
  expect(await page.locator('body').textContent()).not.toContain(marker);
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Your account', exact: true })
    .click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.goBack();
  expect(await page.locator('body').textContent()).not.toContain(marker);
});

test('reviews a private supporting file without exporting it until the user chooses an unprotected copy', async ({
  page,
}) => {
  test.setTimeout(180000);
  const daoId = await createPrivateDao(page),
    canary = 'PRIVATE_LOCAL_COPY_CAFÉ_' + Date.now(),
    filename = canary + '.pdf';
  const bytes = Buffer.from('%PDF-1.4\n' + canary + '\n%%EOF\n');
  const leaks = watchCanaries(page, [canary]);
  const sections = page.getByRole('navigation', { name: 'DAO sections' });
  await sections.getByRole('link', { name: 'Documents', exact: true }).click();
  await page.getByRole('button', { name: 'Add document', exact: true }).click();
  const upload = page.getByRole('dialog', { name: 'Add document', exact: true });
  await upload
    .getByLabel('Document file', { exact: true })
    .setInputFiles({ name: filename, mimeType: 'application/pdf', buffer: bytes });
  await upload.getByLabel('Document name', { exact: true }).fill(filename);
  await upload.getByRole('button', { name: 'Add document', exact: true }).click();
  await expect(upload).not.toBeVisible({ timeout: 30000 });
  const content = ApiRoutes.content.response.parse(
    await (await page.request.get(ApiRoutes.content.path.replace(':id', daoId))).json(),
  );
  const document = content.documents.find((row) => row.cid && row.envelope_version === 1);
  if (!document) throw Error('OWNED_SUPPORTING_FILE_REQUIRED');
  await sections.getByRole('link', { name: 'Decide', exact: true }).click();
  const title = 'Private supporting copy review',
    form = await ballotForm(page, title, 'Read the protected supporting file.', [
      'Garden',
      'Hall',
      'Online',
    ]);
  await form
    .getByLabel('Supporting document (optional)', { exact: true })
    .selectOption(document.id);
  await submit(form);
  await page.getByRole('button', { name: 'Read private ballot', exact: true }).click();
  const card = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  const automatic = page.waitForEvent('download', { timeout: 1000 }).then(
    () => true,
    () => false,
  );
  await card
    .getByRole('button', { name: 'Open verified supporting document', exact: true })
    .click();
  await expect(card.getByText('The verified file is ready.', { exact: false })).toBeVisible();
  expect(await automatic).toBe(false);
  await expect(
    card.getByText('A downloaded copy is unprotected. Keep it private.', { exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Download unprotected copy', exact: true }).click();
  const saved = await download,
    path = await saved.path();
  if (!path) throw Error('LOCAL_COPY_REQUIRED');
  expect(saved.suggestedFilename()).toBe(filename);
  expect(readFileSync(path)).toEqual(bytes);
  expect(leaks).toEqual([]);
});
