import type { FullConfig } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { NetworkSchema } from '@daclify/core-protocol';
import { RuntimeCodeHash } from '@daclify/core-protocol/sdk';
import { ModuleCodeHashes } from '@daclify/modules/sdk';

export default async function checkBrowserFixture(config: FullConfig): Promise<void> {
  const { nativeFixture } = z
    .object({
      nativeFixture: z.enum([
        'daclify-research-native',
        'daclify-research-paid-native',
        'daclify-resources-native',
      ]),
    })
    .parse(config.metadata);
  const fixture = z
    .object({
      container: z.literal(nativeFixture),
      chainId: z.string().regex(/^[0-9a-f]{64}$/),
      mode: z.literal('portable').optional(),
      url: z
        .string()
        .regex(/^http:\/\/127\.0\.0\.1:[0-9]{4,5}$/)
        .optional(),
    })
    .parse(
      JSON.parse(await readFile('../daclify-backend-core/.artifacts/native/network.json', 'utf8')),
    );
  const port = z.coerce
    .number()
    .int()
    .min(1024)
    .max(65535)
    .parse(process.env.DACLIFY_TEST_API_PORT ?? 3008);
  const response = await fetch(`http://127.0.0.1:${port}/v1/network`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('BROWSER_FIXTURE_API_UNAVAILABLE');
  const network = NetworkSchema.parse(await response.json());
  if (network.environment !== 'local' || network.chainId !== fixture.chainId)
    throw new Error('BROWSER_FIXTURE_CHAIN_MISMATCH');
  if (fixture.mode === 'portable') {
    if (
      nativeFixture !== 'daclify-research-paid-native' ||
      !fixture.url ||
      network.rpcUrl !== fixture.url
    )
      throw new Error('BROWSER_FIXTURE_CHAIN_MISMATCH');
    const { token } = z
      .strictObject({ token: z.string().regex(/^[0-9a-f]{64}$/) })
      .parse(
        JSON.parse(
          await readFile('../daclify-backend-core/.artifacts/native/browser-owner.json', 'utf8'),
        ),
      );
    const checked = await fetch(`http://127.0.0.1:${port}/fixture/native-check`, {
      headers: { 'x-fixture-token': token },
      signal: AbortSignal.timeout(10000),
    });
    if (!checked.ok) throw new Error('BROWSER_FIXTURE_SIGNER_UNAVAILABLE');
    z.strictObject({
      chainId: z.literal(fixture.chainId),
      runtimeCodeHash: z.literal(RuntimeCodeHash),
      activityCodeHash: z.literal(ModuleCodeHashes.activity),
      paidCreation: z.literal(true),
    }).parse(await checked.json());
    return;
  }
  try {
    execFileSync('npm', ['exec', '--', 'tsx', 'tools/native/unlock.ts'], {
      cwd: '../daclify-backend-core',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error('BROWSER_FIXTURE_WALLET_UNAVAILABLE');
  }
}
