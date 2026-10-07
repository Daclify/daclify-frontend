import type { FullConfig } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { NetworkSchema } from '@daclify/core-protocol';

export default async function checkBrowserFixture(config: FullConfig): Promise<void> {
  const { nativeFixture } = z
    .object({ nativeFixture: z.enum(['daclify-research-native', 'daclify-research-paid-native']) })
    .parse(config.metadata);
  const fixture = z
    .object({ container: z.literal(nativeFixture), chainId: z.string().regex(/^[0-9a-f]{64}$/) })
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
}
