import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { PrivateKey, PublicKey, Signature } from '@wharfkit/antelope';
import {
  NetworkSchema,
  ContactRecoveryStateSchema,
  ContactRecoveryOfferSchema,
  VERSION,
  RecoveryKitSchema,
} from '@daclify/core-protocol';
import { contactRequestCommitment } from '@daclify/core-protocol/sdk';
const target = {
  dao: {
    chainId: 'ab'.repeat(32),
    contract: 'daclifycore',
    daoId: '1',
    interfaceVersion: 1 as const,
  },
  memberId: '1',
};
const code = Buffer.from(JSON.stringify(target)).toString('base64url');
const publicKey = PrivateKey.generate('K1').toPublic().toString();
const encryption = { kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'B'.repeat(43) };
function state(supported = true) {
  return ContactRecoveryStateSchema.parse({
    target,
    supported,
    documentsAllowed: false,
    nextPacketId: '1',
    member: supported
      ? {
          id: '1',
          native_account: '',
          signing_key: publicKey,
          encryption_key: JSON.stringify(encryption),
          custody: 0,
          nonce: '3',
          credits: '42',
          claim: '0',
          stake: '0',
          active: true,
          admin: true,
          reviewer: false,
          join_epoch: '1',
        }
      : null,
    policy: supported
      ? {
          member_id: '1',
          revision: '1',
          next_request: '0',
          owner_key: publicKey,
          contacts: [1, 2, 3].map((i) => ({
            signing_key: PrivateKey.generate('K1').toPublic().toString(),
            encryption_key: JSON.stringify({ ...encryption, x: String(i).repeat(43) }),
          })),
          accepted: 7,
          documents: false,
        }
      : null,
    pending: null,
    result: null,
    packets: [],
    next: null,
  });
}
test('lost-device recovery is available signed out, stores only encrypted keys and creates a valid replacement proof', async ({
  page,
}) => {
  const recovery = state();
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/network')
      return route.fulfill({
        json: NetworkSchema.parse({
          chainId: target.dao.chainId,
          interfaceVersion: 1,
          runtime: 'daclifycore',
          rpcUrl: 'https://rpc.example',
          hub: null,
          environment: 'testnet',
          coreVersion: VERSION,
          capabilities: ['trusted-contact-recovery-v1'],
        }),
      });
    if (path === '/v1/daos') return route.fulfill({ json: { daos: [], next: null } });
    if (path === '/v1/sign-in/session') return route.fulfill({ status: 204 });
    if (path === '/v1/sign-in/options')
      return route.fulfill({
        json: {
          telegram: { configured: false },
          email: { delivery: 'unavailable' },
          passkey: { rpId: 'localhost' },
        },
      });
    if (path === '/v1/recovery/contacts/state') return route.fulfill({ json: recovery });
    return route.fulfill({
      status: 503,
      json: { code: 'SERVICE_UNAVAILABLE', message: 'Fixture unavailable' },
    });
  });
  await page.goto('/account');
  await page.getByText('Trusted-contact recovery', { exact: true }).click();
  await page.getByLabel('Membership recovery code').fill(code);
  await page.getByRole('button', { name: 'Load recovery', exact: true }).click();
  await expect(page.getByText('Contacts accepted: 3/3.', { exact: false })).toBeVisible();
  await page
    .getByLabel('New device vault password')
    .fill('disposable replacement browser password');
  await page.getByRole('button', { name: 'Prepare replacement device', exact: true }).click();
  const offer = ContactRecoveryOfferSchema.parse(
    JSON.parse(
      Buffer.from(
        await page.getByLabel('Send this public recovery offer to your contacts').inputValue(),
        'base64url',
      ).toString(),
    ),
  );
  expect(
    Signature.from(offer.newSignature).verifyDigest(
      contactRequestCommitment(offer.request),
      PublicKey.from(offer.request.signing_key),
    ),
  ).toBe(true);
  const persisted = await page.evaluate(() => localStorage.getItem('daclify.contact-recovery.v1'));
  expect(persisted).not.toContain('PVT_K1_');
  expect(persisted).not.toContain('encryptionPrivateKey');
  const downloading = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export pending replacement backup', exact: true })
    .click();
  const download = await downloading;
  const path = await download.path();
  if (!path) throw new Error('CONTACT_BACKUP_DOWNLOAD');
  const backup = await readFile(path);
  expect(JSON.parse(backup.toString())).toEqual(JSON.parse(persisted ?? 'null'));
  await expect(
    page.getByRole('button', { name: 'Clear this device’s pending setup' }),
  ).toBeDisabled();
  await page.getByRole('checkbox', { name: /I exported the pending replacement backup/ }).check();
  await page.getByRole('button', { name: 'Clear this device’s pending setup' }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('daclify.contact-recovery.v1')))
    .toBeNull();
  const upload = page.getByLabel('Resume an exported replacement backup');
  await upload.setInputFiles({
    name: 'wrong-identity.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ ...JSON.parse(backup.toString()), oldKey: 'different identity' }),
    ),
  });
  await expect(page.getByRole('alert')).toContainText('another recovery identity');
  await upload.setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/json',
    buffer: backup,
  });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('daclify.contact-recovery.v1')))
    .toBe(persisted);
  expect(await page.evaluate(() => localStorage.getItem('daclify.vault.v1'))).toBeNull();
  await page.getByRole('button', { name: 'Prepare replacement device', exact: true }).click();
  const resumed = ContactRecoveryOfferSchema.parse(
    JSON.parse(
      Buffer.from(
        await page.getByLabel('Send this public recovery offer to your contacts').inputValue(),
        'base64url',
      ).toString(),
    ),
  );
  expect(resumed.request.signing_key).toBe(offer.request.signing_key);
  const kit = RecoveryKitSchema.parse(JSON.parse(backup.toString()).kit);
  await page.getByRole('checkbox', { name: /I exported the pending replacement backup/ }).check();
  await page.getByRole('button', { name: 'Clear this device’s pending setup' }).click();
  await upload.setInputFiles({
    name: 'ordinary-kit.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(kit)),
  });
  await expect(page.getByRole('alert')).toContainText('pending replacement');
  if (!recovery.member || !recovery.policy) throw new Error('CONTACT_FIXTURE');
  recovery.member.signing_key = kit.signingPublicKey;
  recovery.member.encryption_key = JSON.stringify(kit.encryptionPublicKey);
  recovery.policy.owner_key = kit.signingPublicKey;
  recovery.identity = {
    id: '1',
    dao_id: '1',
    signing_key: kit.signingPublicKey,
    origin_key: publicKey,
  };
  recovery.result = {
    member_id: '1',
    request: offer.request,
    old_signing_key: publicKey,
    completed: Math.floor(Date.now() / 1000),
    document_epoch: '1',
    documents_approved: false,
    future_grants: false,
    identity_id: '1',
  };
  await page.getByRole('button', { name: 'Load recovery', exact: true }).click();
  await upload.setInputFiles({
    name: 'ordinary-kit.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(kit)),
  });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('daclify.contact-recovery.v1')))
    .not.toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('daclify.vault.v1'))).toBeNull();
  await expect(page.getByText('Document key backups', { exact: true })).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page }).include('.contact-recovery').analyze();
  expect(accessibility.violations).toEqual([]);
});
test('unsupported contracts give a clear message without offering recovery actions', async ({
  page,
}) => {
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/network')
      return route.fulfill({
        json: {
          chainId: target.dao.chainId,
          runtime: 'daclifycore',
          rpcUrl: 'https://rpc.example',
          hub: null,
          environment: 'testnet',
          interfaceVersion: 1,
          coreVersion: VERSION,
          capabilities: [],
        },
      });
    if (path === '/v1/daos') return route.fulfill({ json: { daos: [], next: null } });
    if (path === '/v1/sign-in/session') return route.fulfill({ status: 204 });
    if (path === '/v1/recovery/contacts/state') return route.fulfill({ json: state(false) });
    return route.fulfill({
      status: 503,
      json: { code: 'SERVICE_UNAVAILABLE', message: 'Fixture unavailable' },
    });
  });
  await page.goto('/account');
  await page.getByText('Trusted-contact recovery', { exact: true }).click();
  await page.getByLabel('Membership recovery code').fill(code);
  await page.getByRole('button', { name: 'Load recovery', exact: true }).click();
  await expect(
    page.getByText('This deployment needs the trusted-contact recovery contract update.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Prepare replacement device', exact: true }),
  ).toHaveCount(0);
});
