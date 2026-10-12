import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
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

      await page.goto(origin + '/account?returnTo=%2Fhub%3Fmine%3D1');
      const main = page.getByRole('main');
      const checkLayout = async () => {
        assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
      };
      await expect(
        main.getByRole('group', { name: 'Account options' }).getByRole('button'),
      ).toHaveCount(3);
      for (const label of ['Login', 'New Account', 'Restore Account'])
        await expect(main.getByRole('button', { name: label, exact: true })).toBeVisible();
      await checkLayout();
      await page.screenshot({
        path: `.artifacts/public/account-entry-${viewport.width}.png`,
        fullPage: true,
      });
      await main.getByRole('button', { name: 'Login', exact: true }).click();
      await expect(main.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
      await expect(main.getByRole('button', { name: 'E-Mail', exact: true })).toBeVisible();
      await checkLayout();
      await main.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(main.getByRole('button', { name: 'Login', exact: true })).toBeFocused();
      await main.getByRole('button', { name: 'New Account', exact: true }).click();
      await expect(
        main.getByRole('heading', { name: 'New to Daclify?', exact: true }),
      ).toBeVisible();
      const choices = main.getByRole('group', { name: 'Create with:' });
      await expect(choices.getByRole('button')).toHaveText([
        'E-Mail',
        'Telegram',
        'Telos Zero',
        'Own Keys',
      ]);
      await expect(choices.getByRole('button', { name: 'E-Mail', exact: true })).toBeDisabled();
      await expect(choices.getByRole('button', { name: 'Telegram', exact: true })).toBeDisabled();
      await checkLayout();
      await page.screenshot({
        path: `.artifacts/public/account-new-${viewport.width}.png`,
        fullPage: true,
      });
      await choices.getByRole('button', { name: 'Telos Zero', exact: true }).click();
      await expect(
        main.getByRole('button', { name: 'Create with Telos Zero', exact: true }),
      ).toBeEnabled();
      await choices.getByRole('button', { name: 'Own Keys', exact: true }).click();
      await expect(main.getByLabel('Vault password', { exact: true })).toBeFocused();
      await checkLayout();
      await main.getByRole('button', { name: 'Back', exact: true }).click();
      await main.getByRole('button', { name: 'Restore Account', exact: true }).click();
      await expect(main.getByLabel('Encrypted recovery kit', { exact: true })).toBeFocused();
      await checkLayout();
      await main.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(
        main.getByRole('button', { name: 'Restore Account', exact: true }),
      ).toBeFocused();
      assert.equal(new URL(page.url()).searchParams.get('returnTo'), '/hub?mine=1');

      const menu = page.getByRole('button', { name: 'Menu', exact: true });
      if (await menu.isVisible()) await menu.click();
      const navigation = page
        .getByRole('complementary', { name: 'Primary navigation' })
        .getByRole('navigation');
      const links = (await navigation.locator(':scope > a').allTextContents()).map((value) =>
        value.trim(),
      );
      assert.equal(links[links.indexOf('Daclify DAO') + 1], 'Telos DAO');
      await navigation.getByRole('link', { name: 'My DAO', exact: true }).click();
      await expect(page).toHaveURL(origin + '/hub?mine=1');
      await expect(main.locator('a[href="/telos"]')).toHaveCount(0);
      if (await menu.isVisible()) await menu.click();
      await navigation.getByRole('link', { name: 'Telos DAO', exact: true }).click();
      await expect(page).toHaveURL(origin + '/telos');
      await expect(main.getByRole('heading', { name: 'Telos DAO', exact: true })).toBeVisible();
      await expect(main.locator('.ballot-list li').first()).toBeVisible({ timeout: 25000 });
      await main.getByRole('button', { name: 'History', exact: true }).click();
      await expect(main.locator('.ballot-list li').first()).toBeVisible();
      await main.locator('.ballot-list button').first().click();
      await expect(main.getByRole('article', { name: 'Selected ballot' })).toBeVisible();
      await expect(main.getByRole('region', { name: 'Recorded voting totals' })).toBeVisible();
      await expect(main.getByRole('group', { name: 'Choose your vote' })).toHaveCount(0);
      await expect(
        main.getByRole('button', { name: 'Vote with Telos Zero', exact: true }),
      ).toHaveCount(0);
      await expect(
        main.getByText('Continuing creates or opens your Daclify account', { exact: false }),
      ).toHaveCount(0);
      await checkLayout();
      await page.screenshot({
        path: `.artifacts/public/telos-dao-${viewport.width}.png`,
        fullPage: true,
      });
      await main.getByRole('button', { name: 'Elections', exact: true }).click();
      await expect(
        main.getByRole('heading', { name: 'Foundation elections', exact: true }),
      ).toBeVisible();
      await expect(main.locator('.ballot-list li').first()).toBeVisible({ timeout: 30000 });
      await main.locator('.ballot-list button').first().click();
      await expect(main.getByRole('region', { name: 'Recorded voting totals' })).toBeVisible();
      const electionTitle = main
        .getByRole('article', { name: 'Selected ballot' })
        .getByRole('heading', { level: 2 });
      await expect(electionTitle).toBeFocused();
      assert.equal(
        await electionTitle.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return box.top >= 0 && box.bottom <= innerHeight;
        }),
        true,
      );
      await checkLayout();
      await page.screenshot({
        path: `.artifacts/public/telos-elections-${viewport.width}.png`,
        fullPage: true,
      });
      await main.getByRole('button', { name: 'Back to records', exact: true }).click();
      await expect(main.locator('.ballot-list button').first()).toBeFocused();
      await main.getByRole('button', { name: 'Block Producers', exact: true }).click();
      const producers = main.getByRole('region', { name: 'Block producer standings' });
      await expect(producers.locator('.producer-list li').first()).toBeVisible({ timeout: 25000 });
      await expect(producers).toContainText('producers in the active schedule');
      await expect(producers).toContainText('Source: eosio');
      await checkLayout();
      await page.screenshot({
        path: `.artifacts/public/telos-producers-${viewport.width}.png`,
        fullPage: true,
      });

      await page.goto(origin + '/status');
      await page.getByRole('tab', { name: 'Contracts', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Contracts and service accounts' }),
      ).toBeVisible();
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
      await page.getByRole('link', { name: 'Decide', exact: true }).click();
      const ballots = main.getByRole('tab', { name: 'Ballots', exact: true });
      const elections = main.getByRole('tab', { name: 'Elections', exact: true });
      await expect(ballots).toHaveAttribute('aria-selected', 'true');
      await expect(main.getByRole('heading', { name: 'Decide', exact: true })).toHaveCount(0);
      await expect(
        main.getByRole('link', { name: 'Ballot rules and help', exact: true }),
      ).toBeVisible();
      await expect(main.getByRole('button', { name: 'Open a ballot', exact: true })).toBeDisabled();
      await expect(main.getByRole('dialog', { name: 'Open a ballot', exact: true })).toHaveCount(0);
      await elections.click();
      await expect(elections).toHaveAttribute('aria-selected', 'true');
      await expect(main.getByRole('heading', { name: 'DAO elections', exact: true })).toBeVisible();
      await expect(main.getByRole('button', { name: 'Sign and schedule election' })).toHaveCount(0);
      await checkLayout();
      await page.screenshot({
        path: `.artifacts/public/decide-elections-${viewport.width}.png`,
        fullPage: true,
      });
      await ballots.click();
      await expect(ballots).toHaveAttribute('aria-selected', 'true');
      await expect(
        main.getByRole('heading', { name: 'DAO elections', exact: true }),
      ).not.toBeVisible();
      await checkLayout();
      await page.screenshot({
        path: `.artifacts/public/decide-ballots-${viewport.width}.png`,
        fullPage: true,
      });
      for (const path of [
        '/v1/network',
        '/v1/daos',
        '/v1/platform/status',
        '/v1/telos/ballots',
        '/v1/sign-up/options',
      ]) {
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
