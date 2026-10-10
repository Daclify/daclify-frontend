import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.route('**/v1/**', (route) =>
    route.fulfill({
      status: 503,
      json: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic unavailable service.' },
    }),
  );
  await page.route('**/v1/docs/agent', (route) => route.fulfill({ json: { configured: true } }));
});

async function openHelp(page: Page) {
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  return page.getByRole('complementary', { name: 'Daxi Help', exact: true });
}

const answer = {
  status: 'answered',
  topicId: 'overview',
  title: 'Daclify overview',
  answer: 'A DAO lets a community make decisions together.',
};

test('starter questions fill the composer without sending and keyboard submission prevents duplicates', async ({
  page,
}) => {
  let sends = 0;
  await page.route('**/v1/docs/ask', (route) => {
    sends++;
    expect(route.request().postDataJSON()).toEqual({ question: 'What is a DAO?' });
    return route.fulfill({ json: answer });
  });
  const help = await openHelp(page);
  await help.getByRole('button', { name: 'What is a DAO?', exact: true }).click();
  const question = help.getByLabel('Question', { exact: true });
  await expect(question).toHaveValue('What is a DAO?');
  await expect(question).toBeFocused();
  expect(sends).toBe(0);
  await question.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(sends).toBe(0);
  await question.press('Enter');
  await expect(question).toHaveValue('What is a DAO?\n');
  expect(sends).toBe(0);
  await question.press('Control+Enter');
  await question.press('Control+Enter');
  await expect(help.getByText(answer.answer, { exact: true })).toBeVisible();
  expect(sends).toBe(1);
  await expect(help.getByRole('button', { name: 'What is a DAO?', exact: true })).toHaveCount(0);
  await question.fill('What is a DAO?');
  await question.press('Meta+Enter');
  await expect(help.locator('.help-message.assistant')).toHaveCount(2);
  expect(sends).toBe(2);
});

test('a failed answer can be retried without duplicating the question or losing a new draft', async ({
  page,
}) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let sends = 0;
  await page.route('**/v1/docs/ask', async (route) => {
    sends++;
    expect(route.request().postDataJSON()).toEqual({ question: 'What is a DAO?' });
    if (sends === 1) {
      await gate;
      return route.fulfill({
        status: 503,
        json: { code: 'DOCS_AGENT_FAILED', message: 'Synthetic failure.' },
      });
    }
    return route.fulfill({ json: answer });
  });
  const help = await openHelp(page);
  const question = help.getByLabel('Question', { exact: true });
  await question.fill('What is a DAO?');
  await help.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(help.getByRole('status')).toContainText('checking the guides');
  await question.fill('How do I pair my wallet?');
  release();
  await help.getByRole('button', { name: 'Retry answer', exact: true }).click();
  await expect(help.getByText(answer.answer, { exact: true })).toBeVisible();
  await expect(question).toHaveValue('How do I pair my wallet?');
  await expect(help.locator('.help-message.user')).toHaveCount(1);
  await expect(help.getByRole('alert')).toHaveCount(0);
  expect(sends).toBe(2);
});

test('availability failures have an in-place retry and delayed availability focuses the composer', async ({
  page,
}) => {
  let available = false;
  await page.route('**/v1/docs/agent', (route) =>
    available
      ? route.fulfill({ json: { configured: true } })
      : route.fulfill({
          status: 503,
          json: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic failure.' },
        }),
  );
  const help = await openHelp(page);
  await expect(help.getByRole('alert')).toBeVisible();
  available = true;
  await help.getByRole('button', { name: 'Retry connection', exact: true }).click();
  await expect(help.getByLabel('Question', { exact: true })).toBeFocused();
  await expect(help.getByRole('alert')).toHaveCount(0);
});

test('clearing needs confirmation and canceled clearing retains the conversation', async ({
  page,
}) => {
  await page.route('**/v1/docs/ask', (route) => route.fulfill({ json: answer }));
  const help = await openHelp(page);
  await help.getByLabel('Question', { exact: true }).fill('What is a DAO?');
  await help.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(help.getByText(answer.answer, { exact: true })).toBeVisible();
  await help.getByRole('button', { name: 'Clear conversation', exact: true }).click();
  await expect(help.getByText(answer.answer, { exact: true })).toBeVisible();
  await help.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(help.getByText(answer.answer, { exact: true })).toBeVisible();
  await help.getByRole('button', { name: 'Clear conversation', exact: true }).click();
  await help.getByRole('button', { name: 'Confirm clear', exact: true }).click();
  await expect(help.locator('.help-message')).toHaveCount(0);
  await expect(help.getByLabel('Question', { exact: true })).toBeFocused();
  await page.reload();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(help.locator('.help-message')).toHaveCount(0);
});

test('the window, composer and controls fit narrow and short screens and enlarged text', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const help = await openHelp(page);
  for (const [width, height] of [
    [1440, 1000],
    [320, 568],
    [375, 812],
    [768, 1024],
    [812, 375],
    [812, 280],
  ]) {
    if (!width || !height) throw new Error('Invalid fixture viewport');
    await page.setViewportSize({ width, height });
    await expect
      .poll(async () => {
        const bounds = await help.boundingBox();
        return bounds ? bounds.y + bounds.height : Infinity;
      })
      .toBeLessThanOrEqual(height);
    const bounds = await help.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect(bounds?.y).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? width) + (bounds?.width ?? width)).toBeLessThanOrEqual(width);
    expect((bounds?.y ?? height) + (bounds?.height ?? height)).toBeLessThanOrEqual(height);
    expect(
      await help
        .locator('.help-window-title strong')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await expect(help.getByRole('button', { name: 'Ask', exact: true })).toBeInViewport();
    await expect(help.getByRole('button', { name: 'Minimize help', exact: true })).toBeInViewport();
    expect((await new AxeBuilder({ page }).include('#help-window').analyze()).violations).toEqual(
      [],
    );
    await help.screenshot({ path: test.info().outputPath(`help-${width}.png`) });
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await expect(help.getByRole('button', { name: 'Ask', exact: true })).toBeInViewport();
  expect(await help.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(
    await help
      .locator('.help-window-title strong')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await help.screenshot({ path: test.info().outputPath('help-enlarged-text.png') });
  await help.getByLabel('Question', { exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  const launcher = page.getByRole('button', { name: 'Help', exact: true });
  if (await launcher.isVisible()) await expect(launcher).toBeFocused();
  else await expect(menu).toBeFocused();
});

test('long answers scroll while the composer stays visible and clearing rejects a late reply', async ({
  page,
}) => {
  let sends = 0,
    release = () => {},
    completed = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/v1/docs/ask', async (route) => {
    sends++;
    if (sends === 2) await gate;
    await route.fulfill({
      json: {
        ...answer,
        answer:
          sends === 1
            ? 'A community makes decisions together. '.repeat(100)
            : 'This cleared reply must not reappear.',
      },
    });
    completed++;
  });
  const help = await openHelp(page);
  const question = help.getByLabel('Question', { exact: true });
  await question.fill('What is a DAO?');
  await help.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(help.locator('.help-message.assistant')).toHaveCount(1);
  expect(
    await help
      .locator('.help-transcript')
      .evaluate((element) => element.scrollHeight > element.clientHeight),
  ).toBe(true);
  await expect(help.getByRole('button', { name: 'Ask', exact: true })).toBeInViewport();
  await question.fill('How do I pair a wallet?');
  await help.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(help.getByRole('status')).toBeVisible();
  await help.getByRole('button', { name: 'Clear conversation', exact: true }).click();
  await help.getByRole('button', { name: 'Confirm clear', exact: true }).click();
  await expect(question).toBeFocused();
  const lateResponse = page.waitForResponse('**/v1/docs/ask');
  release();
  await (await lateResponse).finished();
  await expect.poll(() => completed).toBe(2);
  await expect(help.locator('.help-message')).toHaveCount(0);
  await expect(help.getByRole('status')).toHaveCount(0);
  await expect(help.getByRole('alert')).toHaveCount(0);
});

test('restored history opens at the latest messages and follows replies at the 100-message limit', async ({
  page,
}) => {
  await page.route('**/v1/docs/ask', (route) => route.fulfill({ json: answer }));
  const help = await openHelp(page);
  await help.getByLabel('Question', { exact: true }).fill('What is a DAO?');
  await help.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(help.getByText(answer.answer, { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith('daclify.help.v1:'));
    if (!key) throw new Error('Fixture history was not saved');
    localStorage.setItem(
      key,
      JSON.stringify(
        Array.from({ length: 100 }, (_, index) => ({
          role: index % 2 === 0 ? 'user' : 'assistant',
          text: `Stored message ${index}. ${'A long stored message. '.repeat(10)}`,
        })),
      ),
    );
  });
  await page.reload();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const transcript = help.locator('.help-transcript');
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop > 0)).toBe(true);
  await transcript.evaluate((element) => {
    element.scrollTop = 0;
  });
  await help.getByLabel('Question', { exact: true }).fill('What is a DAO?');
  await help.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(help.getByText(answer.answer, { exact: true })).toBeVisible();
  await expect(help.locator('.help-message')).toHaveCount(100);
  await expect
    .poll(() =>
      transcript.evaluate(
        (element) => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) < 2,
      ),
    )
    .toBe(true);
});
