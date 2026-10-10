import { describe, expect, it } from 'vitest';
import { API, PrivateKey } from '@wharfkit/antelope';
import {
  authorityConnections,
  permissionActionLinks,
  permissionGraph,
  resourceReading,
  type ContractReading,
} from '../../src/content/contract-map';

const contract: ContractReading = {
  account: 'core.we',
  moduleId: null,
  codeHash: null,
  expectedHash: null,
  verified: false,
  ramBytes: 4096,
  ramUsed: 1024,
  permissions: [
    {
      name: 'execctx',
      parent: 'active',
      threshold: 1,
      keys: [],
      accounts: [{ actor: 'core.we', permission: 'eosio.code', weight: 1 }],
      waits: [],
    },
    {
      name: 'active',
      parent: 'owner',
      threshold: 2,
      keys: [{ key: 'public-key', weight: 1 }],
      accounts: [{ actor: 'alice', permission: 'active', weight: 1 }],
      waits: [{ seconds: 120, weight: 1 }],
    },
    {
      name: 'owner',
      parent: '',
      threshold: 3,
      keys: [{ key: 'public-key', weight: 2 }],
      accounts: [],
      waits: [],
    },
  ],
};
describe('observed permission relationships', () => {
  it('keeps descendants under their own parent and retains detached or cyclic permissions', () => {
    const p = (name: string, parent: string) => ({
      name,
      parent,
      threshold: 1,
      keys: [],
      accounts: [],
      waits: [],
    });
    const graph = permissionGraph({
      ...contract,
      permissions: [
        p('claim', 'active'),
        p('spend', 'owner'),
        p('active', 'owner'),
        p('owner', ''),
        p('orphan', 'unread'),
        p('a', 'b'),
        p('b', 'a'),
      ],
    });
    expect(graph.roots.map((branch) => branch.permission.name)).toEqual(['owner', 'orphan', 'a']);
    expect(graph.roots[0]?.children.map((branch) => branch.permission.name)).toEqual([
      'spend',
      'active',
    ]);
    expect(graph.roots[0]?.children[1]?.children[0]?.permission.name).toBe('claim');
    expect(graph.roots[2]?.children[0]?.permission.name).toBe('b');
    expect(graph.roots[2]?.children[0]?.children).toEqual([]);
  });
  it('orders a permission hierarchy and preserves shared signer weights separately', () => {
    const graph = permissionGraph(contract);
    expect(graph.nodes.filter((n) => n.kind === 'permission').map((n) => n.label)).toEqual([
      'core.we@owner',
      'core.we@active',
      'core.we@execctx',
    ]);
    expect(graph.nodes.filter((n) => n.kind === 'key')).toHaveLength(1);
    expect(
      graph.edges.filter((e) => e.kind === 'key').map((e) => ({ to: e.to, weight: e.weight })),
    ).toEqual([
      { to: 'permission:owner', weight: 2 },
      { to: 'permission:active', weight: 1 },
    ]);
    expect(graph.edges.filter((e) => e.kind === 'hierarchy')).toEqual([
      { from: 'permission:owner', to: 'permission:active', kind: 'hierarchy' },
      { from: 'permission:active', to: 'permission:execctx', kind: 'hierarchy' },
    ]);
    expect(graph.nodes.find((n) => n.label === 'core.we@eosio.code')?.kind).toBe('code');
    expect(graph.edges.find((e) => e.kind === 'wait')?.weight).toBe(1);
  });
  it('does not invent missing parent nodes or omit permissions in a cyclic input', () => {
    const graph = permissionGraph({
      ...contract,
      permissions: [
        { name: 'a', parent: 'b', threshold: 1, keys: [], accounts: [], waits: [] },
        { name: 'b', parent: 'a', threshold: 1, keys: [], accounts: [], waits: [] },
        { name: 'c', parent: 'unread', threshold: 1, keys: [], accounts: [], waits: [] },
      ],
    });
    expect(graph.nodes.filter((n) => n.kind === 'permission')).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    expect(graph.nodes.some((n) => n.label.endsWith('@unread'))).toBe(false);
  });
  it('distinguishes shared keys, delegated permissions and delays without inferring control', () => {
    const works: ContractReading = {
      ...contract,
      account: 'works',
      permissions: [
        {
          name: 'active',
          parent: 'owner',
          threshold: 4,
          keys: [{ key: 'public-key', weight: 1 }],
          accounts: [{ actor: 'core.we', permission: 'execctx', weight: 2 }],
          waits: [],
        },
      ],
    };
    const graph = permissionGraph(contract);
    const key = graph.nodes.find((n) => n.kind === 'key'),
      permission = graph.nodes.find((n) => n.label === 'core.we@execctx'),
      wait = graph.nodes.find((n) => n.kind === 'wait');
    if (!key || !permission || !wait)
      throw new Error('Fixture needs key, permission and wait nodes');
    expect(authorityConnections([contract, works], contract, key)).toEqual([
      { account: 'core.we', permission: 'active', weight: 1, relation: 'Shared key' },
      { account: 'core.we', permission: 'owner', weight: 2, relation: 'Shared key' },
      { account: 'works', permission: 'active', weight: 1, relation: 'Shared key' },
    ]);
    expect(authorityConnections([contract, works], contract, permission)).toEqual([
      {
        account: 'works',
        permission: 'active',
        weight: 2,
        relation: 'Delegates to this permission',
      },
    ]);
    expect(authorityConnections([contract, works], contract, wait)).toEqual([]);
  });
});
describe('reported permission action links', () => {
  const key = PrivateKey.generate('K1').toPublic().toString();
  const permission = {
    name: 'claimer',
    parent: 'active',
    threshold: 1,
    keys: [{ key, weight: 1 }],
    accounts: [],
    waits: [],
  };
  const reading = (threshold = 1, parent = 'active', weight = 1) =>
    API.v1.AccountPermission.from({
      perm_name: 'claimer',
      parent,
      required_auth: { threshold, keys: [{ key, weight }], accounts: [], waits: [] },
      linked_actions: [{ account: 'eosio', action: 'claimrewards' }, { account: 'works' }],
    });
  it('shows reported action links only when the parent and authority match the status permission', () => {
    expect(permissionActionLinks(permission, [reading()])).toEqual([
      'eosio::claimrewards',
      'works::*',
    ]);
    expect(permissionActionLinks(permission, [reading(2)])).toBeUndefined();
    expect(permissionActionLinks(permission, [reading(1, 'owner')])).toBeUndefined();
    expect(permissionActionLinks(permission, [reading(1, 'active', 2)])).toBeUndefined();
    expect(permissionActionLinks(permission, [])).toBeUndefined();
    const withoutLinks = API.v1.AccountPermission.from({
      perm_name: 'claimer',
      parent: 'active',
      required_auth: reading().required_auth,
    });
    expect(permissionActionLinks(permission, [withoutLinks])).toBeUndefined();
  });
});
describe('account resource display', () => {
  it.each([
    {
      used: 0n,
      max: 0n,
      usage: '0 bytes',
      capacity: 'No capacity',
      percent: undefined,
      over: false,
    },
    {
      used: 3n,
      max: 0n,
      usage: '3 bytes',
      capacity: 'No capacity',
      percent: undefined,
      over: true,
    },
    {
      used: 1024n,
      max: -1n,
      usage: '1,024 bytes',
      capacity: 'Unlimited',
      percent: undefined,
      over: false,
    },
    {
      used: undefined,
      max: undefined,
      usage: 'Unknown',
      capacity: 'Unknown capacity',
      percent: undefined,
      over: false,
    },
    {
      used: -2n,
      max: -2n,
      usage: 'Unknown',
      capacity: 'Unknown capacity',
      percent: undefined,
      over: false,
    },
    { used: 150n, max: 100n, usage: '150 bytes', capacity: '100 bytes', percent: 100, over: true },
    {
      used: 9223372036854775806n,
      max: 9223372036854775807n,
      usage: '9,223,372,036,854,775,806 bytes',
      capacity: '9,223,372,036,854,775,807 bytes',
      percent: 99.99,
      over: false,
    },
  ])('keeps $usage / $capacity exact and gives valid meter semantics', (row) => {
    expect(resourceReading(row.used, row.max, 'bytes')).toEqual({
      used: row.usage,
      capacity: row.capacity,
      percent: row.percent,
      over: row.over,
    });
  });
});
