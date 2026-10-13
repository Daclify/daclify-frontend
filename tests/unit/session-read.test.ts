import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountSchema } from '@daclify/core-protocol';
import { api } from '../../src/api/client';
import { configureNetworks } from '../../src/api/networks';

beforeEach(() => {
  configureNetworks(null);
  vi.stubGlobal('sessionStorage', { getItem: () => null });
});
afterEach(() => {
  vi.unstubAllGlobals();
  configureNetworks(null);
});
it('treats the successful signed-out response as unauthenticated without a protected probe', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(api.me()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  expect(fetcher.mock.calls).toHaveLength(1);
  expect(fetcher.mock.calls[0]?.[0]).toContain('/v1/sign-in/session');
  expect(fetcher.mock.calls[0]?.[1]?.credentials).toBe('include');
  expect(fetcher.mock.calls[0]?.[1]?.method).toBe('GET');
});
it('validates the canonical account and keeps service failures distinct from sign-out', async () => {
  const account = AccountSchema.parse({
    id: '00000000-0000-4000-8000-000000000001',
    custody: 'user-controlled',
    signingKey: null,
    encryptionKey: null,
  });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ account }));
  vi.stubGlobal('fetch', fetcher);
  expect(await api.me()).toEqual(account);
  fetcher.mockResolvedValue(
    Response.json({ code: 'SERVICE_UNAVAILABLE', message: 'Unavailable' }, { status: 503 }),
  );
  await expect(api.me()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  fetcher.mockResolvedValue(Response.json(null));
  await expect(api.me()).rejects.not.toMatchObject({ code: 'AUTH_REQUIRED' });
});
