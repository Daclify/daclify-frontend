import { z } from 'zod';
import { Bytes } from '@wharfkit/antelope';
import {
  ChainIdSchema,
  IdSchema,
  EncryptionPublicKeySchema,
  EncryptionPrivateKeySchema,
  EpochGrantSchema,
} from '@daclify/core-protocol';
import { QuickBallotDomainSchema } from '@daclify/modules';
import { createEpochGrant, openEpochGrant } from '../auth/vault';

const ContextSchema = QuickBallotDomainSchema.extend({
  ballotId: IdSchema,
  definitionHash: ChainIdSchema,
  memberId: IdSchema,
});
const GrantSchema = z
  .string()
  .max(1536)
  .regex(/^(?:[0-9a-f]{2})+$/);
function domain(value: unknown) {
  const context = ContextSchema.parse(value);
  return JSON.stringify([
    'daclify.quick-ballot.grant.v1',
    context.chainId,
    context.runtime,
    context.source,
    context.ballotId,
    context.definitionHash,
    context.memberId,
  ]);
}
export async function createBallotGrant(
  context: unknown,
  recipient: string,
  secret: string,
): Promise<string> {
  if (new TextEncoder().encode(recipient).length > 256) throw Error('QUICK_READER_KEY');
  const parsed: unknown = JSON.parse(recipient);
  const key = Bytes.from(
    z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .parse(secret),
  ).array;
  const grant = await createEpochGrant(
    EncryptionPublicKeySchema.parse(parsed),
    key,
    domain(context),
  );
  return GrantSchema.parse(Bytes.from(new TextEncoder().encode(JSON.stringify(grant))).hexString);
}
export async function openBallotGrant(
  context: unknown,
  privateKey: unknown,
  ciphertext: string,
): Promise<string> {
  const parsed: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(
      Bytes.from(GrantSchema.parse(ciphertext)).array,
    ),
  );
  return Bytes.from(
    await openEpochGrant(
      EncryptionPrivateKeySchema.parse(privateKey),
      EpochGrantSchema.parse(parsed),
      domain(context),
    ),
  ).hexString;
}
