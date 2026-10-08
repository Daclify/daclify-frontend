import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../src/api/client';
import { configureNetworks } from '../../src/api/networks';
import { BrandingUploadSchema } from '@daclify/core-protocol';
const dao = {
  chainId: 'ab'.repeat(32),
  contract: 'daclifycore',
  daoId: '1',
  interfaceVersion: 1 as const,
};
afterEach(() => {
  vi.unstubAllGlobals();
  configureNetworks(null);
});
it('requires public image consent and rejects an upload receipt from another DAO or slot', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  configureNetworks(null);
  const input = BrandingUploadSchema.parse({
    dao,
    requestId: '00000000-0000-4000-8000-000000000001',
    slot: 'logo',
    bytes: 8,
    commitment: 'cd'.repeat(32),
    mediaType: 'image/png',
    content: 'iVBORw0KGgo=',
    publicConsent: true,
  });
  const receipt = {
    dao,
    requestId: input.requestId,
    slot: 'logo',
    image: {
      cid: 'bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      bytes: 8,
      commitment: input.commitment,
      mediaType: input.mediaType,
    },
  };
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
  expect(BrandingUploadSchema.safeParse({ ...input, publicConsent: false }).success).toBe(false);
  for (const response of [
    { ...receipt, slot: 'cover' },
    { ...receipt, dao: { ...dao, daoId: '2' } },
    { ...receipt, image: { ...receipt.image, commitment: 'ef'.repeat(32) } },
  ]) {
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }));
    await expect(api.uploadBranding(input)).rejects.toThrow('UPLOAD_RECEIPT');
  }
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify(receipt), { status: 200 }));
  expect(await api.uploadBranding(input)).toEqual(receipt);
});
