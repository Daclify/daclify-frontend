import {
  ChainIdSchema,
  NativeAccountSchema,
  parseUnits,
  formatUnits,
  type DaoSummary,
  type UserMembership,
} from '@daclify/core-protocol';
import { RuntimeActionSchemas, type RuntimeActions } from '@daclify/core-protocol/sdk';
export function prepareExit(
  dao: DaoSummary,
  member: UserMembership,
  kind: 'withdraw' | 'unstake',
  destination: string,
  value: string,
): RuntimeActions['withdraw'] {
  const ref = dao.reference;
  if (
    member.dao.chainId !== ref.chainId ||
    member.dao.contract !== ref.contract ||
    member.dao.daoId !== ref.daoId ||
    member.dao.interfaceVersion !== ref.interfaceVersion
  )
    throw new Error('DAO_REFERENCE');
  destination = NativeAccountSchema.parse(destination);
  if (destination === ref.contract) throw new Error('PAYOUT_DESTINATION');
  const amount = parseUnits(value, dao.token.precision);
  if (amount <= 0n) throw new Error('AMOUNT_REQUIRED');
  if (amount > BigInt(kind === 'withdraw' ? member.claim : member.stake))
    throw new Error('INSUFFICIENT_EXIT_BALANCE');
  return RuntimeActionSchemas.withdraw.parse({
    runtime: ref.contract,
    dao_id: ref.daoId,
    member_id: member.memberId,
    destination,
    quantity: `${formatUnits(amount, dao.token.precision)} ${dao.token.symbol}`,
  });
}
function printable(value: string, max: number, error: string): string {
  if (value.length < 1 || value.length > max) throw new Error(error);
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === undefined || code < 0x21 || code > 0x7e) throw new Error(error);
  }
  return value;
}
export function prepareExternalEvidence(
  dao: DaoSummary,
  member: UserMembership,
  obligation: { id: string; recipient: string; quantity: string; status: number },
  chain: string,
  payer: string,
  reference: string,
): RuntimeActions['confirmext'] {
  const ref = dao.reference;
  if (
    member.dao.chainId !== ref.chainId ||
    member.dao.contract !== ref.contract ||
    member.dao.daoId !== ref.daoId ||
    member.dao.interfaceVersion !== ref.interfaceVersion
  )
    throw new Error('DAO_REFERENCE');
  if (!member.admin) throw new Error('ADMIN_REQUIRED');
  if (obligation.status !== 1) throw new Error('EVIDENCE_STATE');
  return RuntimeActionSchemas.confirmext.parse({
    runtime: ref.contract,
    dao_id: ref.daoId,
    member_id: member.memberId,
    obligation_id: obligation.id,
    chain: printable(chain, 64, 'EVIDENCE_CHAIN'),
    payer: printable(payer, 128, 'EVIDENCE_PAYER'),
    recipient: obligation.recipient,
    quantity: obligation.quantity,
    reference: ChainIdSchema.parse(reference),
  });
}
