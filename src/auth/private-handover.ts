import {
  DaoContentSchema,
  PrivateAccessPolicySchema,
  type DaoContent,
  type PrivateAccessPolicy,
} from '@daclify/core-protocol';
import { privateSuccessors } from './private-access';
export function validatePrivateHandover(
  input: DaoContent,
  inputPolicy: PrivateAccessPolicy,
  departing: string,
  successor: string,
  confirmedOnOtherDevice: boolean,
): void {
  const content = DaoContentSchema.parse(input),
    policy = PrivateAccessPolicySchema.parse(inputPolicy);
  if (
    JSON.stringify(content.dao) !== JSON.stringify(policy.dao) ||
    !content.epochs.some((epoch) => epoch.epoch === policy.keyEpoch)
  )
    throw Error('PRIVATE_ACCESS_CONTEXT');
  if (Object.values(content.next).some((cursor) => cursor !== null))
    throw Error('PRIVATE_ACCESS_INCOMPLETE');
  const owner = content.members.find((member) => member.id === departing),
    next = content.members.find((member) => member.id === successor);
  if (
    !confirmedOnOtherDevice ||
    !owner?.active ||
    !owner.admin ||
    !next ||
    !privateSuccessors(content, departing).some((member) => member.id === successor)
  )
    throw Error('PRIVATE_HANDOVER_REQUIRED');
  if (policy.privacy === 'encrypted-user-controlled' && next.custody !== 0)
    throw Error('CUSTODY_POLICY');
  if (
    policy.historyPolicy === 'from-join' &&
    content.epochs.some((epoch) => BigInt(epoch.epoch) < BigInt(next.join_epoch))
  )
    throw Error('PRIVATE_HANDOVER_REQUIRED');
}
