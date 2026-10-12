import {
  ExitIntentSchema,
  ExitPreflightSchema,
  ExitCapabilitySchema,
  type ExitIntent,
  type ExitPreflight,
} from '@daclify/core-protocol';
export type ExitChoices = {
  mode: ExitIntent['mode'];
  memberships: Record<string, ExitIntent['memberships'][number]['choice']>;
};
export function exitMembershipKey(member: ExitPreflight['memberships'][number]): string {
  return [
    member.reference.chainId,
    member.reference.contract,
    member.reference.daoId,
    member.memberId,
  ].join(':');
}
export function buildExitIntent(input: ExitPreflight, choices: ExitChoices): ExitIntent {
  const preflight = ExitPreflightSchema.parse(input),
    known = new Set(preflight.memberships.map(exitMembershipKey));
  if (Object.keys(choices.memberships).some((key) => !known.has(key)))
    throw Error('EXIT_MEMBERSHIP_CHANGED');
  return ExitIntentSchema.parse({
    version: 1,
    mode: choices.mode,
    memberships: preflight.memberships
      .filter((member) => member.active || !preflight.nativeAvailable)
      .map((member) => {
        const choice = choices.memberships[exitMembershipKey(member)] ?? 'leave';
        if (choice === 'close' && (!member.soleMember || !member.admin))
          throw Error('EXIT_SOLE_MEMBER_REQUIRED');
        if (choice === 'handover' && !member.admin) throw Error('PRIVATE_HANDOVER_REQUIRED');
        return {
          chainId: member.reference.chainId,
          runtime: member.reference.contract,
          daoId: member.reference.daoId,
          memberId: member.memberId,
          choice,
        };
      }),
  });
}
export function newExitCapability(): string {
  return ExitCapabilitySchema.parse(
    btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', ''),
  );
}

export async function signAccountExit(
  operationId: string,
  stepId: string,
  request: import('@daclify/core-protocol/sdk').instruction,
  signingKey: string,
  nativeAccount: string,
  password: string,
): Promise<import('@daclify/core-protocol').SignedExitInstruction> {
  const { selectedSigner } = await import('./action-signer'),
    { api } = await import('../api/client'),
    { exitOperationCommitment, exitStepCommitment, encodeAction } =
      await import('@daclify/core-protocol/sdk');
  const operation = exitOperationCommitment(operationId),
    step_digest = exitStepCommitment(operationId, stepId, request),
    { assertOperatorDao, resolveApiUrl } = await import('../api/networks'),
    { useWorkspace } = await import('../state/workspace'),
    workspace = useWorkspace(),
    domain = JSON.stringify([
      workspace.account?.id,
      workspace.network?.chainId,
      workspace.network?.runtime,
      resolveApiUrl('/v1'),
      globalThis.location?.href,
    ]);
  const check = () => {
    if (
      domain !==
      JSON.stringify([
        workspace.account?.id,
        workspace.network?.chainId,
        workspace.network?.runtime,
        resolveApiUrl('/v1'),
        globalThis.location?.href,
      ])
    )
      throw Error('WALLET_CONTEXT_CHANGED');
  };
  assertOperatorDao({
    chainId: request.chain_id,
    contract: request.deployment,
    daoId: request.dao_id,
    interfaceVersion: 1,
  });
  if (selectedSigner.value === 'native') {
    const { nativeWallet, transactNative } = await import('./telos-zero'),
      { Action, Serializer } = await import('@wharfkit/antelope'),
      wallet = nativeWallet.value;
    if (
      !wallet ||
      wallet.permissionLevel.actor.toString() !== nativeAccount ||
      wallet.permissionLevel.permission.toString() !== 'active' ||
      wallet.chain.id.toString() !== request.chain_id
    )
      throw Error('EXIT_SIGNER_REQUIRED');
    const action = Action.from({
        account: request.deployment,
        name: 'exitnative',
        authorization: [wallet.permissionLevel],
        data: encodeAction('exitnative', { operation, step_digest, request }),
      }),
      result = await transactNative(
        action,
        false,
        () =>
          assertOperatorDao({
            chainId: request.chain_id,
            contract: request.deployment,
            daoId: request.dao_id,
            interfaceVersion: 1,
          }),
        [],
        60,
      );
    return {
      operation,
      step_digest,
      request,
      account: nativeAccount,
      permission: 'active',
      packedTransaction: Serializer.encode({ object: result.transaction }).hexString,
      signatures: result.signatures.map((value) => value.toString()),
    };
  }
  if (selectedSigner.value === 'evm') {
    const { evmWallet, signEvmExit } = await import('./telos-evm'),
      wallet = evmWallet.value,
      { binding } = await api.evmBinding(request.dao_id, request.member_id);
    check();
    if (
      !wallet ||
      wallet !== evmWallet.value ||
      !binding?.active ||
      binding.chain_id !== String(wallet.chainId) ||
      binding.address !== wallet.address.slice(2).toLowerCase()
    )
      throw Error('EXIT_SIGNER_REQUIRED');
    const proof = await signEvmExit(operation, step_digest, request, {
      chainId: wallet.chainId,
      address: wallet.address,
      epoch: binding.epoch,
    });
    check();
    return {
      operation,
      step_digest,
      request,
      evm_chain_id: binding.chain_id,
      address: binding.address,
      binding_epoch: binding.epoch,
      proof: proof.slice(2),
    };
  }
  const { savedVault, canUseVaultKey, signExitInstruction, signSavedExitInstruction } =
      await import('./session'),
    kit = savedVault();
  if (canUseVaultKey(signingKey)) return signExitInstruction(operationId, stepId, request);
  if (!kit || kit.signingPublicKey !== signingKey) throw Error('EXIT_SIGNER_REQUIRED');
  return signSavedExitInstruction(kit, password, operationId, stepId, request);
}
