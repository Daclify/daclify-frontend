import { afterEach, expect, it, vi } from 'vitest';
import {
  ApiRoutes,
  DaoRefSchema,
  DEFAULT_STORAGE_PRICING,
  StorageBillingRoutes,
  storagePricingHash,
} from '@daclify/core-protocol';
import { api } from '../../src/api/client';
import { configureNetworks } from '../../src/api/networks';
const dao = DaoRefSchema.parse({
  chainId: 'ab'.repeat(32),
  contract: 'daclifycore',
  daoId: '7',
  interfaceVersion: 1,
});
const usage = {
  dao,
  capacityBytes: '100000000',
  verifiedBytes: '22',
  reservedBytes: '0',
  totalBytes: '22',
  objects: 1,
  references: 2,
  cleanup: 'disabled',
};
const ram = ApiRoutes.ramUsage.response.parse({
  dao,
  observation: 'disabled',
  enforcement: 'disabled',
  policy: null,
  totalObservedBytes: null,
  purchasedBytes: '0',
  read: {
    startedAt: '2026-10-08T00:00:00.000Z',
    completedAt: '2026-10-08T00:00:01.000Z',
    atomic: false,
  },
  payers: [
    {
      payer: dao.contract,
      moduleId: null,
      sourceVerified: true,
      usage: null,
      purchasedBytes: '0',
      globalQuotaBytes: null,
      globalUsedBytes: '9007199254740993',
    },
  ],
});
it('reads exact RAM byte strings and rejects unknown observation presented as zero or foreign DAO data', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  configureNetworks(null);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(ram));
  vi.stubGlobal('fetch', fetcher);
  expect(await api.ramUsage(dao)).toEqual(ram);
  expect(fetcher.mock.calls[0]?.[0]).toContain(ApiRoutes.ramUsage.path.replace(':id', dao.daoId));
  expect(fetcher.mock.calls[0]?.[1]?.credentials).toBe('include');
  for (const bad of [
    { ...ram, dao: { ...dao, contract: 'other' } },
    { ...ram, totalObservedBytes: '0' },
    { ...ram, purchasedBytes: '1' },
  ]) {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json(bad)));
    await expect(api.ramUsage(dao)).rejects.toThrow();
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  configureNetworks(null);
});
it('reads producer-owned storage counters with an authenticated browser request', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  configureNetworks(null);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(usage));
  vi.stubGlobal('fetch', fetcher);
  expect(await api.storageUsage(dao)).toEqual(usage);
  expect(fetcher.mock.calls[0]?.[0]).toContain(ApiRoutes.storageUsage.path.replace(':id', '7'));
  expect(fetcher.mock.calls[0]?.[1]?.credentials).toBe('include');
});
it('rejects counters from another deployment and malformed negative values', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  configureNetworks(null);
  for (const response of [
    { ...usage, dao: { ...dao, contract: 'other' } },
    { ...usage, verifiedBytes: '-1' },
  ]) {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json(response)));
    await expect(api.storageUsage(dao)).rejects.toThrow();
  }
});
const billing = {
  dao,
  configured: false,
  currentPricing: null,
  subscription: null,
  funding: {
    state: 'free',
    pricing: DEFAULT_STORAGE_PRICING,
    units: 0,
    paidThrough: null,
    graceEndsAt: null,
    uploadCapacityBytes: '100000000',
    retainedCapacityBytes: '100000000',
  },
};
it('reads canonical billing status and rejects another deployment', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(billing));
  vi.stubGlobal('fetch', fetcher);
  expect(await api.storageBilling(dao)).toEqual({ ...billing, notices: [], noticeDelivery: false });
  expect(fetcher.mock.calls[0]?.[0]).toContain(StorageBillingRoutes.storageBillingStatus.path);
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ...billing, dao: { ...dao, contract: 'other' } })),
  );
  await expect(api.storageBilling(dao)).rejects.toThrow('DAO_REFERENCE');
});
it('refuses a storage approval without a fresh account-control signer', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
  await expect(
    api.storageApprove({
      schemaVersion: 1,
      requestId: crypto.randomUUID(),
      dao,
      units: 1,
      pricingHash: storagePricingHash(DEFAULT_STORAGE_PRICING),
      monthlyUsdCents: 100,
      recurringConsent: true,
      acceptCurrentPricing: false,
    }),
  ).rejects.toThrow('ACCOUNT_CONTROL_REQUIRED');
  expect(fetcher).not.toHaveBeenCalled();
});
