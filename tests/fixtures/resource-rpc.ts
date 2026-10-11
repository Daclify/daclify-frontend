import { ABI, API, Blob as ChainBlob, Checksum256, Serializer } from '@wharfkit/antelope';

export const resourceAbi = ABI.from({
  version: 'eosio::abi/1.2',
  structs: [
    {
      name: 'buyram',
      base: '',
      fields: [
        { name: 'payer', type: 'name' },
        { name: 'receiver', type: 'name' },
        { name: 'quant', type: 'asset' },
      ],
    },
    {
      name: 'delegatebw',
      base: '',
      fields: [
        { name: 'from', type: 'name' },
        { name: 'receiver', type: 'name' },
        { name: 'stake_net_quantity', type: 'asset' },
        { name: 'stake_cpu_quantity', type: 'asset' },
        { name: 'transfer', type: 'bool' },
      ],
    },
  ],
  actions: ['buyram', 'delegatebw'].map((name) => ({ name, type: name, ricardian_contract: '' })),
});
const bytes = Serializer.encode({ object: resourceAbi });
export const resourceRawAbi = API.v1.GetRawAbiResponse.from({
  account_name: 'eosio',
  code_hash: 'cd'.repeat(32),
  abi_hash: Checksum256.hash(bytes.array),
  abi: new ChainBlob(bytes.array),
});
export function resourceAccount(name = 'core.we', quota = '10000', used = '9900') {
  return API.v1.AccountObject.from({
    account_name: name,
    head_block_num: 100,
    head_block_time: '2026-10-11T12:00:00.000',
    privileged: false,
    last_code_update: '2026-10-11T12:00:00.000',
    created: '2026-10-11T12:00:00.000',
    ram_quota: quota,
    ram_usage: used,
    net_weight: 10000,
    cpu_weight: 20000,
    cpu_limit: { used: 990, available: 10, max: 1000 },
    net_limit: { used: 10, available: 990, max: 1000 },
    permissions: [],
    core_liquid_balance: '20.0000 TLOS',
    total_resources: {
      owner: name,
      net_weight: '1.0000 TLOS',
      cpu_weight: '2.0000 TLOS',
      ram_bytes: '8600',
    },
  });
}
export const resourceInfo = {
  server_version: '12345678',
  chain_id: 'ab'.repeat(32),
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
};
