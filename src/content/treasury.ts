import {
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
