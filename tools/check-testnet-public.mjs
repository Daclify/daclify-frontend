import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { NameQuoteSchema } from '@daclify/core-protocol';

const origin = 'https://testnet.app.daclify.com';
const apiOrigin = 'https://testnet.api.daclify.com';
const browser = await chromium.launch();
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport });
    try {
      const page = await context.newPage();
      const errors = [],
        misplaced = [],
        reads = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.origin === origin && url.pathname.startsWith('/v1/')) misplaced.push(url.pathname);
      });
      page.on('response', (response) => {
        const url = new URL(response.url());
        if (url.origin === apiOrigin)
          reads.push({
            path: url.pathname,
            status: response.status(),
            type: response.headers()['content-type'] ?? '',
          });
      });
      await page.addInitScript(() => localStorage.setItem('daclify.network', 'production'));
      await page.goto(origin + '/hub');
      await expect(page.getByRole('status', { name: 'Deployment network' })).toHaveText('Testnet');
      await expect(page.locator('#main')).toContainText('Daclify DAO', { timeout: 20000 });
      assert.deepEqual(misplaced, [], 'API requests must use the configured API origin');

      await page.goto(origin + '/status');
      await page.getByRole('tab', { name: 'Contracts', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Contracts and authorities' })).toBeVisible();
      const details = page.getByRole('region', { name: 'Contract Account Details' });
      await expect(
        details.getByRole('heading', { name: 'daclifycore1', exact: true }),
      ).toBeVisible();
      await expect(details).toContainText('Resource readings checked', { timeout: 25000 });
      for (const resource of ['RAM', 'CPU', 'NET']) {
        await expect(
          details.getByRole('meter', { name: 'daclifycore1 ' + resource + ' usage' }),
        ).toBeVisible();
      }
      await page.getByRole('button', { name: 'daclifyhubv1', exact: true }).click();
      await expect(
        details.getByRole('heading', { name: 'daclifyhubv1', exact: true }),
      ).toBeVisible();

      await page.getByRole('button', { name: 'daclifynames', exact: true }).click();
      await expect(
        details.getByRole('heading', { name: 'daclifynames', exact: true }),
      ).toBeVisible();
      const oracle = details.getByRole('article', { name: 'Permission oracle', exact: true });
      await expect(oracle).toBeVisible();
      for (const scope of ['Parent: active', 'observeprice', 'observefee']) {
        await expect(oracle).toContainText(scope);
      }
      const quote = await context.request.get(apiOrigin + '/v1/names/quote?name=permprobe123');
      assert.equal(quote.status(), 200, 'Names quotes must have a fresh observation');
      assert.equal(NameQuoteSchema.parse(await quote.json()).accountName, 'permprobe123');

      await page.goto(origin + '/daclify');
      await expect(page).toHaveURL(origin + '/dao/1');
      await expect(page.getByRole('navigation', { name: 'DAO sections' })).toBeVisible({
        timeout: 20000,
      });
      await expect(page.getByRole('heading', { name: 'Daclify DAO', exact: true })).toBeVisible();
      for (const path of ['/v1/network', '/v1/daos', '/v1/platform/status']) {
        assert.ok(
          reads.some(
            (read) =>
              read.path === path && read.status === 200 && read.type.includes('application/json'),
          ),
          path + ' must return API JSON',
        );
      }
      assert.deepEqual(misplaced, []);
      assert.deepEqual(errors, []);
      assert.deepEqual(
        reads.filter((read) => read.status >= 500),
        [],
      );
      console.log(JSON.stringify({ viewport, result: 'passed', reads, errors, misplaced }));
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
