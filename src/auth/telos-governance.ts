import { APIClient, SignedTransaction } from '@wharfkit/antelope';
import {
  TelosVotePreparationSchema,
  type TelosVotePreparation,
  type TelosBallot,
  type TelosGovernanceSource,
} from '@daclify/modules';
import { telosDecideAbi, telosVoteActions } from '@daclify/modules/sdk';
import { nativeWallet, nativeIdentity, transactNative } from './telos-zero';
import { api } from '../api/client';
import { useWorkspace } from '../state/workspace';
export class TelosVoteUnconfirmed extends Error {
  constructor(readonly transactionId: string) {
    super('TELOS_VOTE_UNCONFIRMED');
  }
}
function rules(ballot: TelosBallot): string {
  return JSON.stringify({
    ...ballot,
    total_voters: 0,
    total_delegates: 0,
    total_raw_weight: '0.0000 VOTE',
    cleaned_count: 0,
    options: ballot.options.map((o) => o.key),
  });
}
export async function nativeTelosVote(
  input: TelosVotePreparation,
  checkContext: () => void,
  onBroadcast: (id: string) => void = () => {},
): Promise<string> {
  const prepared = TelosVotePreparationSchema.parse(input),
    wallet = nativeWallet.value,
    identity = nativeIdentity(),
    state = useWorkspace();
  const source = prepared.source,
    accountId = state.account?.id,
    location = globalThis.location?.href;
  function check() {
    checkContext();
    if (
      nativeWallet.value !== wallet ||
      !wallet ||
      wallet.chain.id.toString() !== source.chainId ||
      wallet.chain.url !== source.rpcUrl ||
      identity.account !== prepared.voter.account ||
      state.network?.chainId !== source.chainId ||
      state.network.rpcUrl !== source.rpcUrl ||
      state.account?.id !== accountId ||
      globalThis.location?.href !== location
    )
      throw new Error('WALLET_CONTEXT_CHANGED');
    if (
      Date.parse(prepared.expires) <= Date.now() ||
      Date.parse(prepared.expires) > Date.now() + 60000
    )
      throw new Error('TELOS_PREPARATION_EXPIRED');
  }
  if (!wallet) throw new Error('NATIVE_WALLET_MISSING');
  const actions = telosVoteActions(source, prepared.ballot, prepared.voter, prepared.options);
  const validate = async () => {
    check();
    const [info, pins, live] = await Promise.all([
      wallet.client.v1.chain.get_info(),
      wallet.client.v1.chain.get_raw_abi(source.contract),
      api.telosPrepare({
        ballot: prepared.ballot.ballot_name,
        voter: identity.account,
        options: prepared.options,
      }),
    ]);
    check();
    if (
      info.chain_id.toString() !== source.chainId ||
      pins.account_name.toString() !== source.contract ||
      pins.code_hash.toString() !== source.codeHash ||
      pins.abi_hash.toString() !== source.abiHash
    )
      throw new Error('TELOS_VOTE_UNAVAILABLE');
    if (
      JSON.stringify(live.source) !== JSON.stringify(source) ||
      rules(live.ballot) !== rules(prepared.ballot) ||
      JSON.stringify(live.voter) !== JSON.stringify(prepared.voter) ||
      JSON.stringify(live.options) !== JSON.stringify(prepared.options)
    )
      throw new Error('TELOS_BALLOT_CHANGED');
  };
  await validate();
  const signed = await transactNative(actions, false, validate, [
    { account: source.contract, abi: telosDecideAbi },
  ]);
  check();
  if (signed.transaction.expiration.toMilliseconds() <= Date.now())
    throw new Error('TELOS_PREPARATION_EXPIRED');
  const id = signed.transaction.id.toString();
  onBroadcast(id);
  check();
  try {
    const executed = await wallet.client.v1.chain.push_transaction(
      SignedTransaction.from({ ...signed.transaction, signatures: signed.signatures }),
    );
    if (
      executed.transaction_id !== id ||
      executed.processed.id !== id ||
      executed.processed.receipt.status !== 'executed'
    )
      throw new TelosVoteUnconfirmed(id);
    return id;
  } catch {
    throw new TelosVoteUnconfirmed(id);
  }
}
export async function confirmTelosVote(
  source: TelosGovernanceSource,
  transactionId: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(transactionId)) throw new Error('TELOS_TRANSACTION_INVALID');
  const client = new APIClient({ url: source.rpcUrl });
  const info = await client.v1.chain.get_info();
  if (info.chain_id.toString() !== source.chainId) throw new Error('TELOS_CHAIN_MISMATCH');
  return (await client.v1.chain.get_transaction_status(transactionId)).state === 'IRREVERSIBLE';
}
