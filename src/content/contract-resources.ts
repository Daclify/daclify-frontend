import { z } from 'zod';
import { ABI, APIClient, Action, Checksum256, Serializer, type API } from '@wharfkit/antelope';
import {
  ChainIdSchema,
  IdSchema,
  MAX_ASSET_UNITS,
  NativeAccountSchema,
  NativeIdentitySchema,
  NetworkSchema,
  tlosAsset,
  type NativeIdentity,
  type Network,
} from '@daclify/core-protocol';
import { RuntimeTableSchemas } from '@daclify/core-protocol/sdk';

export const ResourceKindSchema = z.enum(['RAM', 'CPU', 'NET']);
export type ResourceKind = z.infer<typeof ResourceKindSchema>;
export const ResourceRateSchema = RuntimeTableSchemas.createcfg.pick({
  median: true,
  precision: true,
  observed_at: true,
});
export type ResourceRate = z.infer<typeof ResourceRateSchema>;
export const ResourcePurchaseSchema = z.strictObject({
  network: NetworkSchema,
  receiver: NativeAccountSchema,
  kind: ResourceKindSchema,
  units: IdSchema.refine((value) => BigInt(value) <= MAX_ASSET_UNITS),
  systemCodeHash: ChainIdSchema.refine((value) => value !== '00'.repeat(32)),
  systemAbiHash: ChainIdSchema,
  expires: z.int().positive().max(0xffffffff),
});
export type ResourcePurchase = z.infer<typeof ResourcePurchaseSchema>;
export type ResourceMarket = { ram: bigint; tokens: bigint };

export function capacityIncrease(capacity: bigint, percent: number): bigint {
  if (capacity <= 0n || !Number.isInteger(percent) || percent < 100 || percent > 200)
    throw new Error('RESOURCE_AMOUNT_INVALID');
  return (capacity * BigInt(percent - 100) + 99n) / 100n;
}
export function resourceValues(account: API.v1.AccountObject, kind: ResourceKind) {
  const limit = kind === 'CPU' ? account.cpu_limit : account.net_limit;
  const used = BigInt((kind === 'RAM' ? account.ram_usage : limit.used).toString());
  const capacity = BigInt((kind === 'RAM' ? account.ram_quota : limit.max).toString());
  const asset =
    kind === 'CPU' ? account.total_resources?.cpu_weight : account.total_resources?.net_weight;
  const stake =
    kind === 'RAM'
      ? null
      : asset?.symbol.toString() === '4,TLOS' && BigInt(asset.units.toString()) >= 0n
        ? BigInt(asset.units.toString())
        : null;
  return { used, capacity, stake };
}
export function resourceTotal(
  contracts: readonly { account: string; codeHash: string | null }[],
  readings: Readonly<Record<string, API.v1.AccountObject>>,
  kind: ResourceKind,
) {
  const unique = [...new Map(contracts.map((row) => [row.account, row])).values()].filter(
    (row) => row.codeHash !== '00'.repeat(32),
  );
  let used: bigint | null = 0n,
    capacity: bigint | null = 0n,
    stake: bigint | null = kind === 'RAM' ? null : 0n,
    missing = 0;
  for (const contract of unique) {
    const account = readings[contract.account];
    if (!account || account.account_name.toString() !== contract.account) {
      missing++;
      used = capacity = stake = null;
      continue;
    }
    const values = resourceValues(account, kind);
    if (used !== null) used = values.used < 0n ? null : used + values.used;
    if (capacity !== null) capacity = values.capacity < 0n ? null : capacity + values.capacity;
    if (stake !== null) stake = values.stake === null ? null : stake + values.stake;
  }
  return { accounts: unique.length, missing, used, capacity, stake };
}
export function resourceUsd(
  units: bigint,
  input: ResourceRate | null | undefined,
  now: number,
): bigint | null {
  const parsed = ResourceRateSchema.safeParse(input);
  if (!parsed.success || units < 0n || units > MAX_ASSET_UNITS || !Number.isFinite(now))
    return null;
  const rate = parsed.data,
    median = BigInt(rate.median);
  if (median <= 0n || rate.precision > 18 || rate.observed_at > now || now - rate.observed_at > 900)
    return null;
  const divisor = 10000n * 10n ** BigInt(rate.precision);
  return (units * median * 100n + divisor - 1n) / divisor;
}
export function resourceAmount(input: string): bigint {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,4}))?$/.exec(input);
  if (!match) throw new Error('RESOURCE_AMOUNT_INVALID');
  const units = BigInt(match[1] ?? '') * 10000n + BigInt((match[2] ?? '').padEnd(4, '0'));
  if (units <= 0n || units > MAX_ASSET_UNITS) throw new Error('RESOURCE_AMOUNT_INVALID');
  return units;
}
const connectorWeight = z.union([z.literal(0.5), z.string().regex(/^0\.50*$/)]);
const MarketSchema = z.object({
  rows: z
    .array(
      z.object({
        base: z.object({ balance: z.string().regex(/^[1-9][0-9]* RAM$/), weight: connectorWeight }),
        quote: z.object({
          balance: z.string().regex(/^(0|[1-9][0-9]*)\.[0-9]{4} TLOS$/),
          weight: connectorWeight,
        }),
      }),
    )
    .length(1),
  more: z.literal(false),
});
export function resourceMarket(input: unknown): ResourceMarket {
  const row = MarketSchema.parse(input).rows[0];
  if (!row) throw new Error('RESOURCE_MARKET_UNAVAILABLE');
  const ram = BigInt(row.base.balance.split(' ')[0] ?? '');
  const tokens = BigInt(row.quote.balance.replace('.', '').split(' ')[0] ?? '');
  if (tokens <= 0n || tokens > MAX_ASSET_UNITS) throw new Error('RESOURCE_MARKET_UNAVAILABLE');
  return { ram, tokens };
}
// These are external Telos system ABI layouts, checked against the live ABI before encoding.
const layouts = {
  buyram: [
    { name: 'payer', type: 'name' },
    { name: 'receiver', type: 'name' },
    { name: 'quant', type: 'asset' },
  ],
  delegatebw: [
    { name: 'from', type: 'name' },
    { name: 'receiver', type: 'name' },
    { name: 'stake_net_quantity', type: 'asset' },
    { name: 'stake_cpu_quantity', type: 'asset' },
    { name: 'transfer', type: 'bool' },
  ],
};
export function resourceSystemAbi(input: API.v1.GetRawAbiResponse | ABI): ABI {
  let abi: ABI;
  if (input instanceof ABI) abi = input;
  else {
    if (input.code_hash.toString() === '00'.repeat(32))
      throw new Error('RESOURCE_SYSTEM_UNSUPPORTED');
    if (
      input.account_name.toString() !== 'eosio' ||
      !Checksum256.hash(input.abi.array).equals(input.abi_hash)
    )
      throw new Error('RESOURCE_SYSTEM_CHANGED');
    abi = Serializer.decode({ data: input.abi.array, type: ABI });
  }
  for (const [name, expected] of Object.entries(layouts)) {
    const actions = abi.actions.filter((row) => row.name.toString() === name);
    const structs = abi.structs.filter((row) => row.name === name);
    const struct = structs[0];
    if (
      actions.length !== 1 ||
      actions[0]?.type !== name ||
      structs.length !== 1 ||
      !struct ||
      struct.base ||
      struct.fields.length !== expected.length ||
      !struct.fields.every(
        (field, index) =>
          field.name === expected[index]?.name && field.type === expected[index]?.type,
      )
    )
      throw new Error('RESOURCE_SYSTEM_UNSUPPORTED');
  }
  // Keep approved primitive layouts only; external aliases cannot change the signed payload.
  return ABI.from({
    version: 'eosio::abi/1.2',
    structs: Object.entries(layouts).map(([name, fields]) => ({ name, base: '', fields })),
    actions: Object.keys(layouts).map((name) => ({ name, type: name, ricardian_contract: '' })),
  });
}
export async function readResourceMarket(client: APIClient, network: Network) {
  const info = await client.v1.chain.get_info();
  if (info.chain_id.toString() !== network.chainId) throw new Error('RESOURCE_CHAIN_MISMATCH');
  const [system, page] = await Promise.allSettled([
    client.v1.chain.get_raw_abi('eosio'),
    client.v1.chain.get_table_rows({
      code: 'eosio',
      scope: 'eosio',
      table: 'rammarket',
      json: true,
      limit: 2,
    }),
  ]);
  if (system.status === 'rejected') throw system.reason;
  const raw = system.value;
  let market: ResourceMarket | null = null;
  if (page.status === 'fulfilled') {
    try {
      market = resourceMarket(page.value);
    } catch {
      /* RAM pricing remains unavailable. */
    }
  }
  return {
    abi: resourceSystemAbi(raw),
    market,
    codeHash: raw.code_hash.toString(),
    abiHash: raw.abi_hash.toString(),
  };
}
export function resourceSystemAction(
  value: ResourcePurchase,
  selected: NativeIdentity,
  abi: ABI,
): Action {
  const purchase = ResourcePurchaseSchema.parse(value),
    wallet = NativeIdentitySchema.parse(selected);
  if (wallet.chainId !== purchase.network.chainId || wallet.permission !== 'active')
    throw new Error('WALLET_CONTEXT_CHANGED');
  const quantity = tlosAsset(BigInt(purchase.units));
  return Action.from(
    {
      account: 'eosio',
      name: purchase.kind === 'RAM' ? 'buyram' : 'delegatebw',
      authorization: [{ actor: wallet.account, permission: wallet.permission }],
      data:
        purchase.kind === 'RAM'
          ? { payer: wallet.account, receiver: purchase.receiver, quant: quantity }
          : {
              from: wallet.account,
              receiver: purchase.receiver,
              stake_net_quantity: purchase.kind === 'NET' ? quantity : '0.0000 TLOS',
              stake_cpu_quantity: purchase.kind === 'CPU' ? quantity : '0.0000 TLOS',
              transfer: false,
            },
    },
    resourceSystemAbi(abi),
  );
}
