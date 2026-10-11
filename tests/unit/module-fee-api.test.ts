import { afterEach, expect, it, vi } from 'vitest';
import {
  ModuleFeeStatusSchema,
  ModuleFeeApprovalSchema,
  moduleFeePricingHash,
} from '@daclify/core-protocol';
import { api } from '../../src/api/client';
import { configureNetworks } from '../../src/api/networks';
const dao = {
  chainId: 'ab'.repeat(32),
  contract: 'core.we',
  daoId: '1',
  interfaceVersion: 1 as const,
};
const pricing = {
  account: 'decide',
  revision: '1',
  monthlyUsdCents: 200,
  actions: ['open' as const],
};
const approval = ModuleFeeApprovalSchema.parse({
  schemaVersion: 1,
  requestId: '00000000-0000-4000-8000-000000000001',
  dao,
  account: 'decide',
  pricingHash: moduleFeePricingHash(pricing),
  monthlyUsdCents: 200,
  codeHash: 'cd'.repeat(32),
});
const status = ModuleFeeStatusSchema.parse({
  dao,
  activeMembers: 11,
  freeMembers: 10,
  configured: true,
  paymentMode: 'test',
  modules: [{ pricing, title: 'Decide', codeHash: approval.codeHash, installed: true, term: null }],
});
afterEach(() => {
  vi.unstubAllGlobals();
  configureNetworks(null);
});
it('uses authenticated canonical module access routes with exact DAO and approval binding', async () => {
  configureNetworks(null);
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(status));
  vi.stubGlobal('fetch', fetcher);
  expect(await api.moduleFeeStatus(dao)).toEqual(status);
  expect(fetcher.mock.calls[0]?.[0]).toContain('/v1/modules/billing?dao=');
  expect(fetcher.mock.calls[0]?.[1]?.credentials).toBe('include');
  const order = {
    id: approval.requestId,
    approval,
    state: 'pending',
    checkoutUrl: null,
    starts: null,
    expires: null,
    receipt: null,
  };
  fetcher.mockResolvedValue(Response.json(order));
  expect(await api.moduleFeeCheckout(approval)).toEqual(order);
  expect(fetcher.mock.calls[1]?.[1]?.method).toBe('POST');
  fetcher.mockResolvedValue(
    Response.json({ ...order, approval: { ...approval, monthlyUsdCents: 300 } }),
  );
  await expect(api.moduleFeeCheckout(approval)).rejects.toThrow();
  fetcher.mockResolvedValue(Response.json({ ...status, dao: { ...dao, daoId: '2' } }));
  await expect(api.moduleFeeStatus(dao)).rejects.toThrow();
});
