import { expect, it } from 'vitest';
import {
  DaoRefSchema,
  appEvidenceDomain,
  appKeyGrantDomain,
  EpochGrantSchema,
} from '@daclify/core-protocol';
import {
  createEpochGrant,
  openCommittedEpoch,
  sealContent,
  openContent,
  sha256Hex,
} from '../../src/auth/vault';
import { z } from 'zod';
it('keeps app evidence confidential and binds grants to the app, member, key and source revision', async () => {
  const dao = DaoRefSchema.parse({
      chainId: 'ab'.repeat(32),
      contract: 'daclifycore',
      daoId: '1',
      interfaceVersion: 1,
    }),
    pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ]),
    publicKey = z
      .object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: z.string(), y: z.string() })
      .parse(await crypto.subtle.exportKey('jwk', pair.publicKey)),
    privateKey = z.object({kty:z.literal('EC'),crv:z.literal('P-256'),x:z.string(),y:z.string(),d:z.string()}).parse(
      await crypto.subtle.exportKey('jwk', pair.privateKey),
    ),
    key = crypto.getRandomValues(new Uint8Array(32)),
    commitment = await sha256Hex(key),
    domain = appKeyGrantDomain(dao, '1', '9', '3');
  const grant = EpochGrantSchema.parse(await createEpochGrant(publicKey, key, domain)),
    opened = await openCommittedEpoch(privateKey, grant, domain, commitment);
  const context = {
      dao,
      appId: '1',
      keyEpoch: '9',
      sourceId: 'aa'.repeat(32),
      sourceRevision: 'bb'.repeat(32),
      eventId: 'cc'.repeat(32),
    },
    plaintext = new TextEncoder().encode('Private garden photo and instructions'),
    envelope = await sealContent(plaintext, opened, appEvidenceDomain(context));
  expect(JSON.stringify(envelope)).not.toContain('Private garden');
  expect(
    new TextDecoder().decode(await openContent(envelope, opened, appEvidenceDomain(context))),
  ).toContain('Private garden');
  await expect(
    openCommittedEpoch(privateKey, grant, appKeyGrantDomain(dao, '2', '9', '3'), commitment),
  ).rejects.toThrow();
  await expect(
    openCommittedEpoch(privateKey, grant, appKeyGrantDomain(dao, '1', '9', '4'), commitment),
  ).rejects.toThrow();
  await expect(openCommittedEpoch(privateKey, grant, domain, 'ff'.repeat(32))).rejects.toThrow();
  await expect(
    openContent(
      envelope,
      opened,
      appEvidenceDomain({ ...context, sourceRevision: 'dd'.repeat(32) }),
    ),
  ).rejects.toThrow();
});
