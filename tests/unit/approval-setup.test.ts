import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { AccountSchema, NetworkSchema, UserMembershipSchema } from '@daclify/core-protocol';
import { PrivateKey, Signature } from '@wharfkit/antelope';
import { Session } from '@wharfkit/session';
import { WalletPluginAnchor } from '@wharfkit/wallet-plugin-anchor';
import { instructionDigest } from '@daclify/core-protocol/sdk';
import { useWorkspace } from '../../src/state/workspace';
import { api } from '../../src/api/client';
import { configureNetworks } from '../../src/api/networks';
import {
  activateMemberWallet,
  selectedSigner,
  canSignMember,
  refreshEvmAuthorization,
} from '../../src/auth/action-signer';
import {
  preferredApproval,
  saveApprovalPreference,
  startApprovalPreferences,
} from '../../src/auth/approval-preference';
import { evmWallet } from '../../src/auth/telos-evm';
import * as evm from '../../src/auth/telos-evm';
import * as session from '../../src/auth/session';
import * as native from '../../src/auth/telos-zero';
const address = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
const accountSigning = PrivateKey.generate('K1');
const account = AccountSchema.parse({
  id: '11111111-1111-4111-8111-111111111111',
  custody: 'user-controlled',
  signingKey: accountSigning.toPublic().toString(),
  encryptionKey: { kty: 'EC', crv: 'P-256', x: 'x'.repeat(43), y: 'y'.repeat(43) },
});
const network = NetworkSchema.parse({
  chainId: 'ab'.repeat(32),
  rpcUrl: 'https://rpc.example',
  runtime: 'daclifycore',
  hub: null,
  environment: 'testnet',
  interfaceVersion: 1,
  coreVersion: '0.15.0-alpha.20',
  capabilities: ['evm-eoa-governance'],
});
const member = UserMembershipSchema.parse({
  dao: { chainId: network.chainId, contract: network.runtime, daoId: '1', interfaceVersion: 1 },
  memberId: '1',
  nonce: '1',
  active: true,
  admin: true,
  reviewer: false,
  credits: '0',
  claim: '0',
  stake: '0',
  nativeAccount: '',
  custody: 'user-controlled',
  signingKey: account.signingKey,
});
let stop = () => {};
beforeEach(() => {
  setActivePinia(createPinia());
  const entries = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  });
  vi.stubGlobal('location', { href: 'https://app.example/account?setup=approvals' });
  configureNetworks(null);
  useWorkspace().account = account;
  useWorkspace().network = network;
  evmWallet.value = { provider: { request: async () => undefined }, chainId: 41, address };
  vi.spyOn(api, 'memberships').mockResolvedValue([member]);
  vi.spyOn(api, 'evmLinks').mockResolvedValue({
    links: [{ chainId: 41, address, controlVerified: true }],
  });
  vi.spyOn(api, 'evmBinding').mockResolvedValue({ binding: null });
});
afterEach(() => {
  stop();
  preferredApproval.value = undefined;
  evmWallet.value = undefined;
  native.nativeWallet.value = undefined;
  selectedSigner.value = 'vault';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  configureNetworks(null);
});

it('restores the default on reload but keeps different accounts and networks separate', () => {
  stop = startApprovalPreferences();
  saveApprovalPreference({ kind: 'evm', wallet: address });
  stop();
  selectedSigner.value = 'vault';
  stop = startApprovalPreferences();
  expect(selectedSigner.value).toBe('evm');
  useWorkspace().account = { ...account, id: '22222222-2222-4222-8222-222222222222' };
  expect(preferredApproval.value).toBeUndefined();
  expect(selectedSigner.value).toBe('vault');
  useWorkspace().account = account;
  expect(selectedSigner.value).toBe('evm');
  useWorkspace().network = { ...network, chainId: 'cd'.repeat(32) };
  expect(preferredApproval.value).toBeUndefined();
});
it('does not treat corrupted browser preferences as authority', () => {
  stop = startApprovalPreferences();
  expect(() => saveApprovalPreference({ kind: 'evm', wallet: 'not a wallet' })).toThrow();
  expect(preferredApproval.value).toBeUndefined();
});
it('does not silently use another connected wallet instead of the saved default', async () => {
  stop = startApprovalPreferences();
  vi.spyOn(api, 'evmBinding').mockResolvedValue({
    binding: {
      member_id: '1',
      chain_id: '41',
      address: address.slice(2),
      epoch: '1',
      active: true,
    },
  });
  await refreshEvmAuthorization(member);
  saveApprovalPreference({ kind: 'evm', wallet: '0x' + '22'.repeat(20) });
  expect(canSignMember(member)).toBe(false);
  saveApprovalPreference({ kind: 'evm', wallet: address });
  expect(canSignMember(member)).toBe(true);
});
it('skips an already authorized wallet without requiring unlocked keys', async () => {
  vi.spyOn(api, 'evmBinding').mockResolvedValue({
    binding: {
      member_id: '1',
      chain_id: '41',
      address: address.slice(2),
      epoch: '2',
      active: true,
    },
  });
  session.lockVault();
  await expect(activateMemberWallet(member, 'evm', () => {})).resolves.toBeUndefined();
});
it('refuses an unpaired wallet before signing any DAO activation', async () => {
  vi.spyOn(api, 'evmLinks').mockResolvedValue({ links: [] });
  await expect(activateMemberWallet(member, 'evm', () => {})).rejects.toThrow(
    'EVM_LINKED_REQUIRED',
  );
});
it('requires the current membership signing key for a new authorization', async () => {
  session.lockVault();
  await expect(activateMemberWallet(member, 'evm', () => {})).rejects.toThrow('VAULT_LOCKED');
});
it('refuses an account change during a pairing lookup', async () => {
  vi.spyOn(api, 'evmLinks').mockImplementation(async () => {
    useWorkspace().account = { ...account, id: '22222222-2222-4222-8222-222222222222' };
    return { links: [{ chainId: 41, address, controlVerified: true }] };
  });
  await expect(activateMemberWallet(member, 'evm', () => {})).rejects.toThrow(
    'WALLET_CONTEXT_CHANGED',
  );
});
it('uses a refreshed nonce and preserves incoming-wallet consent when activating', async () => {
  vi.spyOn(api, 'evmBinding')
    .mockResolvedValueOnce({ binding: null })
    .mockResolvedValue({
      binding: {
        member_id: '1',
        chain_id: '41',
        address: address.slice(2),
        epoch: '1',
        active: true,
      },
    });
  vi.spyOn(api, 'memberships').mockResolvedValue([{ ...member, nonce: '8' }]);
  vi.spyOn(session, 'canUseVaultKey').mockReturnValue(true);
  vi.spyOn(evm, 'signEvmBinding').mockResolvedValue('0x' + '11'.repeat(64) + '1b');
  const requests: Parameters<typeof session.relayWithVault>[0][] = [];
  vi.spyOn(session, 'relayWithVault').mockImplementation(async (request) => {
    requests.push(request);
    return 'ab'.repeat(32);
  });
  await activateMemberWallet(member, 'evm', () => {});
  expect(requests).toHaveLength(1);
  expect(requests[0]?.nonce).toBe('8');
  expect(requests[0]?.dao_id).toBe('1');
  expect(requests[0]?.action).toBe('linkevm');
});
it('does not report a binding as enabled after a concurrent revocation', async () => {
  vi.spyOn(api, 'evmBinding')
    .mockResolvedValueOnce({
      binding: {
        member_id: '1',
        chain_id: '41',
        address: address.slice(2),
        epoch: '2',
        active: true,
      },
    })
    .mockResolvedValue({ binding: null });
  await expect(activateMemberWallet(member, 'evm', () => {})).rejects.toThrow('EVM_BINDING');
});
it('refuses an inactive membership', async () => {
  vi.spyOn(api, 'memberships').mockResolvedValue([{ ...member, active: false }]);
  await expect(activateMemberWallet(member, 'evm', () => {})).rejects.toThrow('NATIVE_UNLINKED');
});
it('refuses a network change during membership lookup', async () => {
  vi.spyOn(api, 'memberships').mockImplementation(async () => {
    useWorkspace().network = { ...network, chainId: 'cd'.repeat(32) };
    return [member];
  });
  await expect(activateMemberWallet(member, 'evm', () => {})).rejects.toThrow(
    'WALLET_CONTEXT_CHANGED',
  );
});
it('refuses a substituted member signing identity even with an unlocked account', async () => {
  vi.spyOn(session, 'canUseVaultKey').mockReturnValue(true);
  vi.spyOn(api, 'memberships').mockResolvedValue([
    { ...member, signingKey: PrivateKey.generate('K1').toPublic().toString() },
  ]);
  await expect(activateMemberWallet(member, 'evm', () => {})).rejects.toThrow('VAULT_LOCKED');
});
it('refuses a wallet change while approving the incoming binding', async () => {
  vi.spyOn(session, 'canUseVaultKey').mockReturnValue(true);
  vi.spyOn(evm, 'signEvmBinding').mockImplementation(async () => {
    evmWallet.value = undefined;
    return '0x' + '11'.repeat(64) + '1b';
  });
  await expect(activateMemberWallet(member, 'evm', () => {})).rejects.toThrow(
    'WALLET_CONTEXT_CHANGED',
  );
});
function nativeFixture() {
  native.nativeWallet.value = new Session({
    chain: { id: network.chainId, url: network.rpcUrl },
    permissionLevel: 'alice@active',
    walletPlugin: new WalletPluginAnchor(),
  });
  vi.spyOn(api, 'nativeLinks').mockResolvedValue({
    links: [{ chainId: network.chainId, account: 'alice', permission: 'active' }],
  });
}
it('uses an already enabled native wallet without unlocking the vault', async () => {
  nativeFixture();
  vi.spyOn(api, 'memberships').mockResolvedValue([{ ...member, nativeAccount: 'alice' }]);
  session.lockVault();
  await expect(activateMemberWallet(member, 'native', () => {})).resolves.toBeUndefined();
});
it('requires the native wallet pairing to match the connected account', async () => {
  nativeFixture();
  vi.spyOn(api, 'nativeLinks').mockResolvedValue({
    links: [{ chainId: network.chainId, account: 'bob', permission: 'active' }],
  });
  await expect(activateMemberWallet(member, 'native', () => {})).rejects.toThrow('NATIVE_UNLINKED');
});
it('passes original member consent and the refreshed nonce to incoming native approval', async () => {
  nativeFixture();
  vi.spyOn(api, 'memberships').mockResolvedValue([{ ...member, nonce: '8' }]);
  vi.spyOn(session, 'canUseVaultKey').mockReturnValue(true);
  const signing = accountSigning;
  vi.spyOn(session, 'signInstruction').mockImplementation((request) =>
    signing.signDigest(instructionDigest(request)).toString(),
  );
  const approved: string[] = [];
  vi.spyOn(native, 'nativeGovernance').mockImplementation(
    async (request, oldAccount, signature, check) => {
      check?.();
      expect(oldAccount).toBe('');
      expect(request.nonce).toBe('8');
      expect(request.action).toBe('linknative');
      expect(
        signature &&
          Signature.from(signature).verifyDigest(
            instructionDigest(request),
            accountSigning.toPublic(),
          ),
      ).toBe(true);
      approved.push(request.dao_id);
      return 'ab'.repeat(32);
    },
  );
  await activateMemberWallet(member, 'native', () => {});
  expect(approved).toEqual(['1']);
});
