import type { PlatformStatus } from '@daclify/core-protocol';
import { Authority, type API } from '@wharfkit/antelope';

export type ContractReading = NonNullable<PlatformStatus['chain']>['contracts'][number];
export type PermissionReading = ContractReading['permissions'][number];
export interface PermissionNode {
  id: string;
  kind: 'permission' | 'key' | 'account' | 'code' | 'wait';
  label: string;
  detail: string;
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
export interface PermissionBranch {
  permission: PermissionReading;
  children: PermissionBranch[];
}

export function permissionGraph(contract: ContractReading) {
  const nodes: PermissionNode[] = [],
    edges: PermissionEdge[] = [];
  const permissions = new Map(contract.permissions.map((p) => [p.name, p]));
  const visited = new Set<string>();
  const ordered: PermissionReading[] = [];
  const branch = (permission: PermissionReading): PermissionBranch => {
    visited.add(permission.name);
    ordered.push(permission);
    const children: PermissionBranch[] = [];
    for (const child of permissions.values())
      if (child.parent === permission.name && !visited.has(child.name))
        children.push(branch(child));
    return { permission, children };
  };
  const roots: PermissionBranch[] = [];
  for (const permission of permissions.values())
    if (!permissions.has(permission.parent) && !visited.has(permission.name))
      roots.push(branch(permission));
  // Preserve detached cycles once, without recursing back into an ancestor.
  for (const permission of permissions.values())
    if (!visited.has(permission.name)) roots.push(branch(permission));
  ordered.forEach((permission) => {
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
    });
    if (permissions.has(permission.parent))
      edges.push({ from: 'permission:' + permission.parent, to: id, kind: 'hierarchy' });
    const add = (node: PermissionNode, weight: number) => {
      if (!nodes.some((existing) => existing.id === node.id)) nodes.push(node);
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
  return { nodes, edges, roots };
}

export function permissionActionLinks(
  permission: PermissionReading,
  readings: API.v1.AccountPermission[] = [],
): string[] | undefined {
  const reading = readings.find((entry) => entry.perm_name.toString() === permission.name);
  if (!reading?.linked_actions || reading.parent.toString() !== permission.parent) return;
  try {
    const authority = Authority.from({
      threshold: permission.threshold,
      keys: permission.keys,
      accounts: permission.accounts.map(({ actor, permission, weight }) => ({
        permission: { actor, permission },
        weight,
      })),
      waits: permission.waits.map(({ seconds, weight }) => ({ wait_sec: seconds, weight })),
    });
    if (!reading.required_auth.equals(authority)) return;
    return reading.linked_actions.map(
      (link) => link.account.toString() + '::' + (link.action?.toString() || '*'),
    );
  } catch {
    return;
  }
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

export interface ContractConnection {
  from: string;
  to: string;
  kind: 'delegation' | 'action';
  descriptions: string[];
}

export function contractConnections(
  contracts: ContractReading[],
  readings: Readonly<Record<string, Pick<API.v1.AccountObject, 'permissions'>>> = {},
): ContractConnection[] {
  const accounts = new Set(contracts.map((contract) => contract.account));
  const connections = new Map<string, ContractConnection>();
  const add = (from: string, to: string, kind: ContractConnection['kind'], description: string) => {
    if (from === to || !accounts.has(to)) return;
    const id = kind + ':' + from + ':' + to;
    const existing = connections.get(id);
    if (existing) existing.descriptions.push(description);
    else connections.set(id, { from, to, kind, descriptions: [description] });
  };
  for (const contract of contracts)
    for (const permission of contract.permissions) {
      const authority = contract.account + '@' + permission.name;
      for (const account of permission.accounts)
        add(
          contract.account,
          account.actor,
          'delegation',
          authority +
            ' → ' +
            account.actor +
            '@' +
            account.permission +
            ' · weight ' +
            account.weight,
        );
      for (const link of permissionActionLinks(
        permission,
        readings[contract.account]?.permissions,
      ) ?? [])
        add(contract.account, link.split('::')[0] ?? '', 'action', authority + ' → ' + link);
    }
  return [...connections.values()];
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
