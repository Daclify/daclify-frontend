import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.route('**/v1/**', (route) =>
    route.fulfill({
      status: 503,
      json: { code: 'SERVICE_UNAVAILABLE', message: 'Unconnected UI fixture' },
    }),
  );
});

test('assistant formats Markdown while HTML, tracking images and unsafe links remain inert', async ({
  page,
}) => {
  await page.route('**/v1/docs/agent', (route) => route.fulfill({ json: { configured: true } }));
  let trackingRequests = 0;
  await page.route('https://tracker.example/**', (route) => {
    trackingRequests++;
    return route.abort();
  });
  const answer = [
    '## Telos at a glance',
    '**Telos Zero** and *Telos EVM*.',
    '- Native accounts\n- Ethereum tools',
    '1. Choose a network\n2. Check your wallet',
    'Use `cleos`.',
    '```txt\n<img src=x onerror=alert(1)>\n```',
    'Learn [Telos introduction](https://docs.telos.net/overview/what-is-telos/introduction/).',
    '<https://docs.telos.net/zero/telos_zero/>',
    '[unsafe](javascript:alert(1)) [data](data:text/html,evil) [credentials](https://user:pass@docs.telos.net/private)',
    '<img src="https://tracker.example/image" onerror=alert(1)>',
    '![Tracking image](https://tracker.example/pixel)',
    '<script>globalThis.daxiUnsafe = true</script>',
  ].join('\n\n');
  await page.route('**/v1/docs/ask', (route) =>
    route.fulfill({
      json: {
        status: 'answered',
        topicId: 'telos',
        title: 'Telos guide',
        answer,
      },
    }),
  );
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const assistant = page.getByRole('region', { name: 'Daxi assistant' });
  await assistant.getByLabel('Question', { exact: true }).fill('Tell me about Telos');
  await assistant.getByRole('button', { name: 'Ask', exact: true }).click();
  const reply = assistant.locator('.help-message.assistant');
  await expect(reply.getByRole('heading', { name: 'Telos at a glance' })).toBeVisible();
  await expect(reply.locator('strong').filter({ hasText: 'Telos Zero' })).toHaveCount(1);
  await expect(reply.locator('em')).toHaveText('Telos EVM');
  await expect(reply.locator('ul > li')).toHaveText(['Native accounts', 'Ethereum tools']);
  await expect(reply.locator('ol > li')).toHaveText(['Choose a network', 'Check your wallet']);
  await expect(reply.locator('pre code')).toHaveText('<img src=x onerror=alert(1)>\n');
  const source = reply.getByRole('link', { name: 'Telos introduction', exact: true });
  await expect(source).toHaveAttribute(
    'href',
    'https://docs.telos.net/overview/what-is-telos/introduction/',
  );
  await expect(source).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(source).toHaveAttribute('target', '_blank');
  await expect(
    reply.getByRole('link', { name: 'https://docs.telos.net/zero/telos_zero/', exact: true }),
  ).toBeVisible();
  await expect(reply.locator('img,script,iframe')).toHaveCount(0);
  await expect(
    reply.locator('a[href^="javascript:"],a[href^="data:"],a[href*="user:pass"]'),
  ).toHaveCount(0);
  expect(trackingRequests).toBe(0);
  expect(await page.evaluate(() => 'daxiUnsafe' in globalThis)).toBe(false);
  expect((await new AxeBuilder({ page }).include('#help-window').analyze()).violations).toEqual([]);
  await assistant.screenshot({ path: test.info().outputPath('formatted-answer.png') });
  await page.reload();
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(assistant.locator('ul > li')).toHaveText(['Native accounts', 'Ethereum tools']);
});

test('handbook assistant shows a source and renders model text safely', async ({ page }) => {
  await page.route('**/v1/docs/agent', (route) => route.fulfill({ json: { configured: true } }));
  let answered = false;
  await page.route('**/v1/docs/ask', (route) => {
    expect(route.request().postDataJSON()).toEqual({
      question: answered ? 'Unrelated question?' : 'Are documents encrypted?',
    });
    const json = answered
      ? {
          status: 'outside',
          topicId: null,
          title: null,
          answer: 'I can help with Daclify, Telos and DAOs.',
        }
      : {
          status: 'answered',
          topicId: 'privacy',
          title: 'What encryption protects',
          answer: '<img src=x onerror=alert(1)> Encrypted in the browser.',
        };
    answered = true;
    return route.fulfill({ json });
  });
  await page.goto('/docs');
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const assistant = page.getByRole('region', { name: 'Daxi assistant' });
  await expect(assistant.getByText(/Do not include secrets or private content/)).toBeVisible();
  await assistant.getByLabel('Question', { exact: true }).fill('Are documents encrypted?');
  await assistant.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(
    assistant.getByText('<img src=x onerror=alert(1)> Encrypted in the browser.', { exact: true }),
  ).toBeVisible();
  await expect(assistant.locator('img')).toHaveCount(0);
  await expect(
    assistant.getByRole('link', { name: 'Open What encryption protects' }),
  ).toHaveAttribute('href', '/docs/privacy');
  await assistant.getByLabel('Question', { exact: true }).fill('Unrelated question?');
  await assistant.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(
    assistant.getByText('I can help with Daclify, Telos and DAOs.', { exact: true }),
  ).toBeVisible();
  await expect(assistant.getByRole('link', { name: /^Open / })).toHaveCount(1);
  await page.getByRole('button', { name: 'Minimize help' }).click();
  await expect(assistant).toBeHidden();
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(
    assistant.getByText('I can help with Daclify, Telos and DAOs.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(
    page.getByText('I can help with Daclify, Telos and DAOs.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm clear', exact: true }).click();
  await expect(assistant.getByRole('link', { name: /^Open / })).toHaveCount(0);
});

test('handbook assistant distinguishes missing config from a failed status request', async ({
  page,
}) => {
  let unavailable = false;
  await page.route('**/v1/docs/agent', (route) =>
    unavailable
      ? route.fulfill({
          status: 503,
          json: { code: 'SERVICE_UNAVAILABLE', message: 'Temporarily unavailable' },
        })
      : route.fulfill({ json: { configured: false } }),
  );
  await page.goto('/docs');
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const assistant = page.getByRole('region', { name: 'Daxi assistant' });
  await expect(assistant.getByText('Daxi is not configured on this server.')).toBeVisible();
  await expect(assistant.getByLabel('Question', { exact: true })).toHaveCount(0);
  unavailable = true;
  await page.reload();
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(assistant.getByRole('alert')).toBeVisible();
  await expect(assistant.getByText('Daxi is not configured on this server.')).toHaveCount(0);
  await expect(assistant.getByLabel('Question', { exact: true })).toHaveCount(0);
});

test('Daxi answers a Telos question and opens its reviewed source guide', async ({ page }) => {
  await page.route('**/v1/docs/agent', (route) => route.fulfill({ json: { configured: true } }));
  await page.route('**/v1/docs/ask', (route) => {
    expect(route.request().postDataJSON()).toEqual({
      question: 'How are Telos Zero and EVM different?',
    });
    return route.fulfill({
      json: {
        status: 'answered',
        topicId: 'telos',
        title: 'Telos Zero and Telos EVM explained',
        answer: 'Telos Zero uses Antelope; Telos EVM supports Ethereum-compatible applications.',
      },
    });
  });
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const assistant = page.getByRole('region', { name: 'Daxi assistant' });
  await expect(assistant.getByText(/I'm Daxi\. Ask me about Daclify, Telos or DAOs/)).toBeVisible();
  await assistant
    .getByLabel('Question', { exact: true })
    .fill('How are Telos Zero and EVM different?');
  await assistant.getByRole('button', { name: 'Ask', exact: true }).click();
  await assistant.getByRole('link', { name: 'Open Telos Zero and Telos EVM explained' }).click();
  await expect(page).toHaveURL(/\/docs\/telos$/);
  await page.getByRole('button', { name: 'Minimize help' }).click();
  const sources = page.locator('.guide-sources');
  await expect(sources.getByRole('heading', { name: 'Sources & further reading' })).toBeVisible();
  await expect(sources.getByRole('link', { name: 'Telos Zero' })).toHaveAttribute(
    'href',
    'https://docs.telos.net/zero/telos_zero/',
  );
  await expect(sources.getByRole('link', { name: 'Telos Zero' })).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );
  await expect(sources.getByText('· Reviewed 2026-10-09')).toHaveCount(3);
});
