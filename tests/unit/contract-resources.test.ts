import { describe, expect, it, vi } from 'vitest';
import { ABI, APIClient, API, Serializer } from '@wharfkit/antelope';
import { NetworkSchema } from '@daclify/core-protocol';
import {
  capacityIncrease,
  resourceTotal,
  resourceUsd,
  resourceSystemAction,
  resourceMarket,
  resourceSystemAbi,
  ResourcePurchaseSchema,
  resourceAmount,
  readResourceMarket,
} from '../../src/content/contract-resources';
import { resourceAbi, resourceAccount, resourceRawAbi } from '../fixtures/resource-rpc';

const network = NetworkSchema.parse({
  chainId: 'ab'.repeat(32),
  rpcUrl: 'https://rpc.example',
  runtime: 'core.we',
  hub: null,
  environment: 'testnet',
  interfaceVersion: 1,
  coreVersion: '0.13.0-alpha.4',
  capabilities: [],
});
const purchase = {
  network,
  receiver: 'core.we',
  kind: 'RAM',
  units: '12345',
  systemCodeHash: resourceRawAbi.code_hash.toString(),
  systemAbiHash: resourceRawAbi.abi_hash.toString(),
  expires: 1791712260,
};
const identity = { chainId: network.chainId, account: 'alice', permission: 'active' as const };

describe('resource purchase amounts', () => {
  it.each([
    ['0.0001', 1n],
    ['1.25', 12500n],
    ['123', 1230000n],
  ])('keeps the entered TLOS amount %s exact', (value, units) => {
    expect(resourceAmount(value)).toBe(units);
  });
  it.each(['0', '-1', '1e3', '1.00001', '00.1', '+1', 'NaN'])(
    'rejects unsafe entered amount %s',
    (value) => {
      expect(() => resourceAmount(value)).toThrow();
    },
  );
  it.each([
    [10000n, 100, 0n],
    [10000n, 125, 2500n],
    [10000n, 200, 10000n],
    [101n, 125, 26n],
    [9007199254740993n, 200, 9007199254740993n],
  ])('computes the additional amount for %s at %s%%', (quota, percent, expected) => {
    expect(capacityIncrease(quota, percent)).toBe(expected);
  });
  it.each([99, 201, 125.5, NaN, Infinity])('rejects invalid slider value %s', (percent) => {
    expect(() => capacityIncrease(10000n, percent)).toThrow();
  });
  it.each([-1n, 0n])('does not invent capacity for %s', (capacity) => {
    expect(() => capacityIncrease(capacity, 200)).toThrow();
  });
  it('sums actual contract readings once, excluding known service accounts', () => {
    const total = resourceTotal(
      [
        { account: 'core.we', codeHash: 'ab'.repeat(32) },
        { account: 'core.we', codeHash: 'ab'.repeat(32) },
        { account: 'works', codeHash: 'cd'.repeat(32) },
        { account: 'relay', codeHash: '00'.repeat(32) },
      ],
      { 'core.we': resourceAccount(), works: resourceAccount('works', '20000', '1000') },
      'RAM',
    );
    expect(total).toMatchObject({ accounts: 2, missing: 0, used: 10900n, capacity: 30000n });
  });
  it('keeps missing or unlimited capacity separate from known usage', () => {
    const contracts = [
      { account: 'core.we', codeHash: 'ab'.repeat(32) },
      { account: 'works', codeHash: null },
    ];
    expect(resourceTotal(contracts, { 'core.we': resourceAccount() }, 'RAM')).toMatchObject({
      missing: 1,
      used: null,
      capacity: null,
    });
    expect(
      resourceTotal(
        contracts,
        { 'core.we': resourceAccount(), works: resourceAccount('works', '-1', '1000') },
        'RAM',
      ),
    ).toMatchObject({ missing: 0, used: 10900n, capacity: null });
  });
  it('values CPU and NET stakes rather than treating processing capacity as token amounts', () => {
    const contracts = [{ account: 'core.we', codeHash: 'ab'.repeat(32) }];
    expect(resourceTotal(contracts, { 'core.we': resourceAccount() }, 'CPU')).toMatchObject({
      used: 990n,
      capacity: 1000n,
      stake: 20000n,
    });
    expect(resourceTotal(contracts, { 'core.we': resourceAccount() }, 'NET')).toMatchObject({
      used: 10n,
      capacity: 1000n,
      stake: 10000n,
    });
  });
});
describe('resource valuation and external system boundary', () => {
  it('does not offer purchases when the system account has ABI metadata without deployed code', () => {
    const raw = API.v1.GetRawAbiResponse.from({ ...resourceRawAbi, code_hash: '00'.repeat(32) });
    expect(() => resourceSystemAbi(raw)).toThrow();
    expect(() =>
      ResourcePurchaseSchema.parse({ ...purchase, systemCodeHash: '00'.repeat(32) }),
    ).toThrow();
  });
  it('keeps system staking available when the independent RAM market read fails', async () => {
    const client = new APIClient({ url: network.rpcUrl });
    vi.spyOn(client.v1.chain, 'get_info').mockResolvedValue(
      API.v1.GetInfoResponse.from({
        server_version: '12345678',
        chain_id: network.chainId,
        head_block_num: 100,
        last_irreversible_block_num: 90,
        last_irreversible_block_id: 'ab'.repeat(32),
        head_block_id: 'ab'.repeat(32),
        head_block_time: '2026-10-11T12:00:00.000',
        head_block_producer: 'eosio',
        virtual_block_cpu_limit: 200000,
        virtual_block_net_limit: 1048576,
        block_cpu_limit: 200000,
        block_net_limit: 1048576,
      }),
    );
    vi.spyOn(client.v1.chain, 'get_raw_abi').mockResolvedValue(resourceRawAbi);
    vi.spyOn(client.v1.chain, 'get_table_rows').mockRejectedValue(new Error('RPC_UNAVAILABLE'));
    const result = await readResourceMarket(client, network);
    expect(result.market).toBeNull();
    const action = resourceSystemAction(
      ResourcePurchaseSchema.parse({ ...purchase, kind: 'CPU' }),
      identity,
      result.abi,
    );
    expect(action.name.toString()).toBe('delegatebw');
  });
  it('converts integer token units to cents with checked fresh producer rate fields', () => {
    const rate = { median: '177', precision: 4, observed_at: 1000 };
    expect(resourceUsd(1000000n, rate, 1000)).toBe(177n);
    expect(resourceUsd(1n, rate, 1000)).toBe(1n);
    expect(resourceUsd(1000000n, rate, 1900)).toBe(177n);
    expect(resourceUsd(1000000n, rate, 1901)).toBeNull();
    expect(resourceUsd(1000000n, rate, 999)).toBeNull();
    expect(resourceUsd(1000000n, { ...rate, median: '0' }, 1000)).toBeNull();
  });
  it('accepts the qualified constant-product RAM connectors and rejects other assets/weights', () => {
    const row = {
      base: { balance: '100000 RAM', weight: '0.50000000000000000' },
      quote: { balance: '100.0000 TLOS', weight: '0.50000000000000000' },
    };
    expect(resourceMarket({ rows: [row], more: false })).toEqual({
      ram: 100000n,
      tokens: 1000000n,
    });
    expect(() => resourceMarket({ rows: [row], more: true })).toThrow();
    expect(() => resourceMarket({ rows: [row, row], more: false })).toThrow();
    expect(() =>
      resourceMarket({
        rows: [{ ...row, quote: { ...row.quote, balance: '100.0000 OTHER' } }],
        more: false,
      }),
    ).toThrow();
    expect(() =>
      resourceMarket({ rows: [{ ...row, base: { ...row.base, weight: '0.25' } }], more: false }),
    ).toThrow();
  });
  it('rejects ABI changes to fixed-debit or stake ownership fields', () => {
    expect(resourceSystemAbi(resourceRawAbi).getActionType('buyram')).toBe('buyram');
    const changed = ABI.from({
      ...resourceAbi.toJSON(),
      structs: resourceAbi.structs.map((row) =>
        row.name === 'buyram' ? { ...row, fields: [{ name: 'bytes', type: 'uint32' }] } : row,
      ),
    });
    expect(() => resourceSystemAbi(changed)).toThrow();
  });
  it.each(['RAM', 'CPU', 'NET'] as const)(
    'encodes the chosen payer, receiver and fixed %s debit',
    (kind) => {
      const action = resourceSystemAction(
        ResourcePurchaseSchema.parse({ ...purchase, kind }),
        identity,
        resourceAbi,
      );
      expect(action.account.toString()).toBe('eosio');
      expect(action.authorization.map((level) => level.toString())).toEqual(['alice@active']);
      const decoded = Serializer.objectify(
        Serializer.decode({ abi: resourceAbi, type: action.name.toString(), data: action.data }),
      );
      expect(decoded).toEqual(
        kind === 'RAM'
          ? { payer: 'alice', receiver: 'core.we', quant: '1.2345 TLOS' }
          : {
              from: 'alice',
              receiver: 'core.we',
              stake_net_quantity: kind === 'NET' ? '1.2345 TLOS' : '0.0000 TLOS',
              stake_cpu_quantity: kind === 'CPU' ? '1.2345 TLOS' : '0.0000 TLOS',
              transfer: false,
            },
      );
    },
  );
  it('refuses zero or overflowing purchases and a wallet on a different chain', () => {
    expect(() => ResourcePurchaseSchema.parse({ ...purchase, units: '0' })).toThrow();
    expect(() =>
      ResourcePurchaseSchema.parse({ ...purchase, units: (1n << 62n).toString() }),
    ).toThrow();
    expect(() =>
      resourceSystemAction(
        ResourcePurchaseSchema.parse(purchase),
        { ...identity, chainId: 'ef'.repeat(32) },
        resourceAbi,
      ),
    ).toThrow();
  });
});
