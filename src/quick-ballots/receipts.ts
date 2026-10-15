import { Bytes, Checksum256 } from '@wharfkit/antelope';
import { z } from 'zod';
import {
  ChainIdSchema,
  IdSchema,
  Uint64Schema,
  EncryptionPublicKeySchema,
  EncryptionPrivateKeySchema,
  EpochGrantSchema,
  ContentEnvelopeSchema,
} from '@daclify/core-protocol';
import { QuickBallotDomainSchema } from '@daclify/modules';
import { createEpochGrant, openEpochGrant, sealContent, openContent } from '../auth/vault';
const contextSchema = QuickBallotDomainSchema.extend({
  ballotId: IdSchema,
  definitionHash: ChainIdSchema,
  identity: ChainIdSchema,
  revision: Uint64Schema,
  ciphertext: z.string().regex(/^[0-9a-f]{384}$/),
});
const receiptSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('account'),
  grant: EpochGrantSchema,
  envelope: ContentEnvelopeSchema,
});
export const ReceiptBytesSchema = z
  .string()
  .max(2048)
  .regex(/^(?:[0-9a-f]{2})+$/);
export function receiptDomain(value: unknown) {
  const context = contextSchema.parse(value);
  return JSON.stringify([
    'daclify.quick-ballot.receipt.v1',
    context.chainId,
    context.runtime,
    context.source,
    context.ballotId,
    context.definitionHash,
    context.identity,
    context.revision,
    Checksum256.hash(Bytes.from(context.ciphertext)).toString(),
  ]);
}
export async function sealAccountReceipt(context: unknown, publicKey: unknown, choice: 0 | 1) {
  const key = crypto.getRandomValues(new Uint8Array(32)),
    domain = receiptDomain(context);
  try {
    const grant = await createEpochGrant(EncryptionPublicKeySchema.parse(publicKey), key, domain);
    const envelope = await sealContent(
      Uint8Array.of(z.union([z.literal(0), z.literal(1)]).parse(choice)),
      key,
      domain,
    );
    return ReceiptBytesSchema.parse(
      Bytes.from(
        new TextEncoder().encode(JSON.stringify({ version: 1, kind: 'account', grant, envelope })),
      ).hexString,
    );
  } finally {
    key.fill(0);
  }
}
export async function openAccountReceipt(
  context: unknown,
  privateKey: unknown,
  receipt: string,
): Promise<0 | 1> {
  const value = receiptSchema.parse(
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          Bytes.from(ReceiptBytesSchema.parse(receipt)).array,
        ),
      ),
    ),
    domain = receiptDomain(context);
  const key = await openEpochGrant(
    EncryptionPrivateKeySchema.parse(privateKey),
    value.grant,
    domain,
  );
  try {
    const plaintext = await openContent(value.envelope, key, domain);
    if (plaintext.length !== 1 || (plaintext[0] !== 0 && plaintext[0] !== 1))
      throw Error('QUICK_RECEIPT');
    return plaintext[0];
  } finally {
    key.fill(0);
  }
}

const deviceReceiptSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('device'),
  iv: z.string().regex(/^[0-9a-f]{24}$/),
  ciphertext: z.string().regex(/^[0-9a-f]{34}$/),
});
function deviceKey(value: CryptoKey) {
  if (
    value.type !== 'secret' ||
    value.extractable ||
    value.algorithm.name !== 'AES-GCM' ||
    !value.usages.includes('encrypt') ||
    !value.usages.includes('decrypt')
  )
    throw Error('QUICK_DEVICE_KEY');
  return value;
}
export async function sealDeviceReceipt(context: unknown, key: CryptoKey, choice: 0 | 1) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(receiptDomain(context)) },
    deviceKey(key),
    Uint8Array.of(z.union([z.literal(0), z.literal(1)]).parse(choice)),
  );
  return ReceiptBytesSchema.parse(
    Bytes.from(
      new TextEncoder().encode(
        JSON.stringify({
          version: 1,
          kind: 'device',
          iv: Bytes.from(iv).hexString,
          ciphertext: Bytes.from(new Uint8Array(ciphertext)).hexString,
        }),
      ),
    ).hexString,
  );
}
export async function openDeviceReceipt(
  context: unknown,
  key: CryptoKey,
  receipt: string,
): Promise<0 | 1> {
  const value = deviceReceiptSchema.parse(
    JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Bytes.from(ReceiptBytesSchema.parse(receipt)).array,
      ),
    ),
  );
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(Bytes.from(value.iv).array),
        additionalData: new TextEncoder().encode(receiptDomain(context)),
      },
      deviceKey(key),
      new Uint8Array(Bytes.from(value.ciphertext).array),
    ),
  );
  if (plaintext.length !== 1 || (plaintext[0] !== 0 && plaintext[0] !== 1))
    throw Error('QUICK_RECEIPT');
  return plaintext[0];
}
export function receiptKind(receipt: string): 'account' | 'device' {
  const value = z
    .object({ kind: z.enum(['account', 'device']) })
    .parse(
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          Bytes.from(ReceiptBytesSchema.parse(receipt)).array,
        ),
      ),
    );
  return value.kind;
}
