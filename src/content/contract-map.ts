import type { PlatformStatus } from '@daclify/core-protocol';

export type ContractReading = NonNullable<PlatformStatus['chain']>['contracts'][number];
export type PermissionReading = ContractReading['permissions'][number];
export interface PermissionNode {
  id: string;
  kind: 'permission' | 'key' | 'account' | 'code' | 'wait';
  label: string;
  detail: string;
  x: number;
  y: number;
  publicKey?: string;
  actor?: string;
  permission?: string;
  authority?: PermissionReading;
}
export interface PermissionEdge {
  from: string;
  to: string;
  kind: 'hierarchy' | 'key' | 'account' | 'code' | 'wait';
  weight?: number;
}

export function permissionGraph(contract: ContractReading) {
  const nodes: PermissionNode[] = [],
    edges: PermissionEdge[] = [];
  const permissions = new Map(contract.permissions.map((p) => [p.name, p]));
  const depth = (permission: PermissionReading, visited = new Set<string>()): number => {
    if (visited.has(permission.name)) return 0;
    visited.add(permission.name);
    const parent = permissions.get(permission.parent);
    return parent ? 1 + depth(parent, visited) : 0;
  };
  const ordered = [...contract.permissions].sort((a, b) => depth(a) - depth(b));
  ordered.forEach((permission, index) => {
    const id = 'permission:' + permission.name;
    nodes.push({
      id,
      kind: 'permission',
      label: contract.account + '@' + permission.name,
      detail:
        'Threshold ' +
        permission.threshold +
        (permission.parent ? ' · parent ' + permission.parent : ' · root'),
      permission: permission.name,
      authority: permission,
      x: 390,
      y: 64 + index * 104,
    });
    if (permissions.has(permission.parent))
      edges.push({ from: 'permission:' + permission.parent, to: id, kind: 'hierarchy' });
    const add = (node: Omit<PermissionNode, 'x' | 'y'>, weight: number) => {
      if (!nodes.some((existing) => existing.id === node.id)) nodes.push({ ...node, x: 24, y: 0 });
      if (node.kind !== 'permission')
        edges.push({ from: node.id, to: id, kind: node.kind, weight });
    };
    for (const key of permission.keys)
      add(
        {
          id: 'key:' + key.key,
          kind: 'key',
          label: key.key,
          detail: 'Public signing key',
          publicKey: key.key,
        },
        key.weight,
      );
    for (const account of permission.accounts)
      add(
        {
          id: 'account:' + account.actor + '@' + account.permission,
          kind: account.permission === 'eosio.code' ? 'code' : 'account',
          label: account.actor + '@' + account.permission,
          detail:
            account.permission === 'eosio.code'
              ? 'Contract code authority'
              : 'Delegated account permission',
          actor: account.actor,
          permission: account.permission,
        },
        account.weight,
      );
    for (const wait of permission.waits)
      add(
        {
          id: 'wait:' + wait.seconds,
          kind: 'wait',
          label: wait.seconds + ' second delay',
          detail: 'Delay contribution',
        },
        wait.weight,
      );
  });
  const authorities = nodes.filter((node) => node.kind !== 'permission');
  authorities.forEach((node, index) => {
    node.y = 64 + index * 104;
  });
  return {
    nodes,
    edges,
    width: 760,
    height: Math.max(ordered.length, authorities.length, 2) * 104 + 88,
  };
}

export function authorityConnections(
  contracts: ContractReading[],
  selected: ContractReading,
  node: PermissionNode,
) {
  const connections: { account: string; permission: string; weight: number; relation: string }[] =
    [];
  for (const contract of contracts)
    for (const permission of contract.permissions) {
      if (node.kind === 'key')
        for (const key of permission.keys) {
          if (key.key === node.publicKey)
            connections.push({
              account: contract.account,
              permission: permission.name,
              weight: key.weight,
              relation: 'Shared key',
            });
        }
      for (const account of permission.accounts) {
        const actor = node.kind === 'permission' ? selected.account : node.actor;
        if (actor && account.actor === actor && account.permission === node.permission)
          connections.push({
            account: contract.account,
            permission: permission.name,
            weight: account.weight,
            relation:
              node.kind === 'permission'
                ? 'Delegates to this permission'
                : 'Same delegated authority',
          });
      }
    }
  return connections;
}

export function resourceReading(
  used: bigint | undefined,
  max: bigint | undefined,
  unit: 'bytes' | 'µs',
) {
  const usage = used === undefined || used < 0n ? undefined : used;
  const capacity = max === undefined || max < -1n ? undefined : max;
  const format = (value: bigint) => value.toLocaleString('en-US') + ' ' + unit;
  const percent =
    usage !== undefined && capacity !== undefined && capacity > 0n
      ? Math.min(100, Number((usage * 10000n) / capacity) / 100)
      : undefined;
  return {
    used: usage === undefined ? 'Unknown' : format(usage),
    capacity:
      capacity === undefined
        ? 'Unknown capacity'
        : capacity === -1n
          ? 'Unlimited'
          : capacity === 0n
            ? 'No capacity'
            : format(capacity),
    percent,
    over: usage !== undefined && capacity !== undefined && capacity >= 0n && usage > capacity,
  };
}

export function releaseState(contract: ContractReading) {
  return !contract.codeHash
    ? 'Not read'
    : !contract.expectedHash
      ? 'No release pin'
      : contract.verified
        ? 'Verified'
        : 'Hash mismatch';
}
