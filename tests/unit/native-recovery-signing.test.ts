import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  Session,
  SigningRequest,
  TransactRevisions,
  Transaction,
  ABI,
  PrivateKey,
} from '@wharfkit/session';
import { WalletPluginAnchor } from '@wharfkit/wallet-plugin-anchor';
import { NetworkSchema, RecoveryContextSchema } from '@daclify/core-protocol';
import { runtimeAbi } from '@daclify/core-protocol/sdk';
import * as native from '../../src/auth/telos-zero';
import { useWorkspace } from '../../src/state/workspace';
const chainId = 'ab'.repeat(32),
  key = PrivateKey.generate('K1');
const wallet = new Session({
  chain: { id: chainId, url: 'https://native.example.test' },
  permissionLevel: 'alice@active',
  walletPlugin: new WalletPluginAnchor(),
});
const context = RecoveryContextSchema.parse({
  version: 1,
  id: crypto.randomUUID(),
  accountId: crypto.randomUUID(),
  origin: 'https://app.example.test',
  credentialKey: `native:${chainId}:alice`,
  mode: 'wallet-protected',
  signingPublicKey: key.toPublic().toString(),
  encryptionPublicKey: { kty: 'EC', crv: 'P-256', x: 'a'.repeat(43), y: 'b'.repeat(43) },
  salt: btoa('a'.repeat(32)),
});
let mutation = false;
beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('location', { href: context.origin + '/account', origin: context.origin });
  const state = useWorkspace();
  state.network = NetworkSchema.parse({
    chainId,
    runtime: 'daclifycore',
    rpcUrl: 'https://native.example.test',
    hub: null,
    environment: 'local',
    interfaceVersion: 1,
    coreVersion: '0.12.0-alpha.1',
    capabilities: [],
  });
  native.nativeWallet.value = wallet;
  mutation = false;
  vi.spyOn(wallet, 'transact').mockImplementation(async (args, options) => {
    expect(options?.broadcast).toBe(false);
    expect(options?.allowModify).toBe(false);
    if (!args.transaction) throw new Error('Recovery must supply a full fixed transaction');
    const requested = Transaction.from(args.transaction);
    expect(requested.expiration.toString()).toBe('1970-01-01T00:00:01');
    expect(Number(requested.ref_block_num)).toBe(0);
    const transaction = mutation ? Transaction.from({ ...requested, ref_block_num: 9 }) : requested;
    const request = await SigningRequest.create(
      { chainId, transaction },
      { abiProvider: { getAbi: async () => ABI.from(runtimeAbi) } },
    );
    expect(request.requiresTapos()).toBe(false);
    const resolved = request.resolve(
      new Map([['daclifycore', ABI.from(runtimeAbi)]]),
      wallet.permissionLevel,
      { chainId },
    );
    return {
      chain: wallet.chain,
      request,
      resolved,
      returns: [],
      revisions: new TransactRevisions(request),
      signatures: [key.signDigest(transaction.signingDigest(chainId))],
      signer: wallet.permissionLevel,
      transaction: resolved.resolvedTransaction,
    };
  });
});
afterEach(() => {
  native.nativeWallet.value = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function material(input: unknown): Promise<unknown> {
  const fn = Reflect.get(native, 'nativeRecoveryMaterial');
  expect(typeof fn).toBe('function');
  if (typeof fn !== 'function') throw new Error('Missing private native recovery');
  return fn(input);
}
it('signs an identical expired private transaction repeatedly without broadcasting', async () => {
  const push = vi.spyOn(wallet.client.v1.chain, 'push_transaction');
  expect(await material(context)).toEqual(await material(context));
  expect(push).not.toHaveBeenCalled();
});
it('rejects modified transaction headers instead of deriving unrecoverable material', async () => {
  mutation = true;
  await expect(material(context)).rejects.toThrow();
});
it('rejects another paired account before asking for a signature', async () => {
  await expect(material({ ...context, credentialKey: `native:${chainId}:bob` })).rejects.toThrow();
  expect(wallet.transact).not.toHaveBeenCalled();
});
