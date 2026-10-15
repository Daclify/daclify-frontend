import { expect, it } from 'vitest';
import { Bytes } from '@wharfkit/antelope';
import { generateVaultSecrets } from '../../src/auth/vault';
import {
  sealAccountReceipt,
  openAccountReceipt,
  receiptDomain,
} from '../../src/quick-ballots/receipts';
const context = {
  chainId: '11'.repeat(32),
  runtime: 'daclifycore1',
  source: 'quickvote',
  ballotId: '1',
  definitionHash: '22'.repeat(32),
  identity: '33'.repeat(32),
  revision: '1',
  ciphertext: 'ab'.repeat(192),
};
it('encrypts an own-choice receipt under 1024 bytes and binds it to the exact account, revision and ciphertext', async () => {
  const owner = await generateVaultSecrets(),
    other = await generateVaultSecrets(),
    key = owner.encryptionPrivateKey;
  const publicKey = { kty: key.kty, crv: key.crv, x: key.x, y: key.y };
  const receipt = await sealAccountReceipt(context, publicKey, 1);
  expect(receipt.length / 2).toBeLessThanOrEqual(1024);
  const decoded = new TextDecoder().decode(Bytes.from(receipt).array);
  expect(decoded).not.toContain('"choice"');
  expect(decoded).not.toContain(key.d);
  expect(await openAccountReceipt(context, key, receipt)).toBe(1);
  await expect(openAccountReceipt(context, other.encryptionPrivateKey, receipt)).rejects.toThrow();
  for (const patch of [
    { identity: '44'.repeat(32) },
    { revision: '2' },
    { ciphertext: 'cd'.repeat(192) },
    { source: 'otherballot' },
  ])
    await expect(openAccountReceipt({ ...context, ...patch }, key, receipt)).rejects.toThrow();
  expect(receiptDomain(context)).not.toBe(receiptDomain({ ...context, ballotId: '2' }));
});

it('protects wallet-only receipts with a nonextractable device key and rejects another device or source', async () => {
  const { sealDeviceReceipt, openDeviceReceipt } = await import('../../src/quick-ballots/receipts');
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const other = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const receipt = await sealDeviceReceipt(context, key, 0);
  expect(await openDeviceReceipt(context, key, receipt)).toBe(0);
  await expect(openDeviceReceipt(context, other, receipt)).rejects.toThrow();
  await expect(openDeviceReceipt({ ...context, revision: '2' }, key, receipt)).rejects.toThrow();
  await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  const extractable = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  await expect(sealDeviceReceipt(context, extractable, 1)).rejects.toThrow('QUICK_DEVICE_KEY');
});
