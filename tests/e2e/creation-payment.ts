import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { ApiRoutes } from '@daclify/core-protocol';
export function fixtureAction(account: string, action: string, data: unknown[], actor: string) {
  const network = z
    .object({
      container: z.enum([
        'daclify-v2-native',
        'daclify-dao-presets-native',
        'daclify-platform-native',
        'daclify-access-native',
        'daclify-research-native',
        'daclify-research-paid-native',
      ]),
      url: z.string().regex(/^http:\/\/127\.0\.0\.1:[0-9]{4,5}$/),
      chainId: z.string(),
    })
    .parse(
      JSON.parse(readFileSync('../daclify-backend-core/.artifacts/native/network.json', 'utf8')),
    );
  try {
    execFileSync(
      'docker',
      [
        'exec',
        network.container,
        'cleos',
        '--wallet-url',
        'http://127.0.0.1:8900',
        'push',
        'action',
        account,
        action,
        JSON.stringify(data),
        '-p',
        actor + '@active',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } catch {
    throw new Error('Disposable native fixture action rejected');
  }
}
export async function payCreation(page: Page, preset?: 'custom') {
  if (preset) {
    await page.getByLabel('DAO purpose').selectOption(preset);
    await page.getByText('Advanced governance and emergency safeguards', { exact: true }).click();
    await page.getByLabel('Ballot duration (seconds)').fill('60');
  }
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/v1/dao-orders') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Review setup payment', exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  const order = ApiRoutes.creationOrder.response.parse(await result.json());
  expect(order.state).toBe('awaiting-payment');
  expect(order.usdCents).toBe(2000);
  expect(order.method).toBe('tlos');
  await expect(page.getByRole('heading', { name: 'DAO setup payment' })).toBeVisible();
  if (!order.tlosAmount) throw new Error('Missing quote');
  fixtureAction(
    order.tokenContract,
    'transfer',
    ['alice', order.recipient, order.tlosAmount, order.memo],
    'alice',
  );
  await page.getByRole('button', { name: 'Check payment status', exact: true }).click();
  await page.getByRole('button', { name: 'Create this paid DAO', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  return order;
}
