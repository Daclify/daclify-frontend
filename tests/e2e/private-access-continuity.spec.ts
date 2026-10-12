import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { z } from 'zod';
import { ABI, PublicKey, Serializer, Signature } from '@wharfkit/antelope';
import {
  AccountSchema,
  ApiRoutes,
  DaoContentSchema,
  DaoRefSchema,
  DaoSummarySchema,
  GovernanceStateSchema,
  LoginMessageSchema,
  RecoveryKitSchema,
  UserMembershipSchema,
  contentDomain,
  epochGrantDomain,
} from '@daclify/core-protocol';
import { ModuleStateSchema } from '@daclify/modules';
import { instructionDigest, runtimeAbi, RuntimeActionSchemas } from '@daclify/core-protocol/sdk';
import { createVault, createEpochGrant, sealContent, sha256Hex } from '../../src/auth/vault';

test('grants private history, verifies it on another device, and preserves it after the creator leaves', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const password = 'one protected account fixture password';
  const vaults = [await createVault(password), await createVault(password)];
  const reference = DaoRefSchema.parse({
    chainId: 'ab'.repeat(32),
    contract: 'daclifycore',
    daoId: '1',
    interfaceVersion: 1,
  });
  const accounts = vaults.map((vault, index) =>
    AccountSchema.parse({
      id:
        index === 0
          ? '11111111-1111-4111-8111-111111111111'
          : '22222222-2222-4222-8222-222222222222',
      custody: 'user-controlled',
      signingKey: vault.signingPublicKey,
      encryptionKey: vault.encryptionPublicKey,
    }),
  );
  const originalKey = crypto.getRandomValues(new Uint8Array(32));
  const first = vaults[0];
  if (!first) throw new Error('Missing creator vault');
  const selfGrant = await createEpochGrant(
    first.encryptionPublicKey,
    originalKey,
    epochGrantDomain(reference, '1', '1'),
  );
  const metadata = JSON.stringify(
    await sealContent(
      new TextEncoder().encode('Private history survives its creator'),
      originalKey,
      contentDomain(reference, '1', 1, '1'),
    ),
  );
  const records = DaoContentSchema.parse({
    dao: reference,
    members: vaults.map((vault, index) => ({
      id: String(index + 1),
      native_account: '',
      signing_key: vault.signingPublicKey,
      encryption_key: JSON.stringify(vault.encryptionPublicKey),
      custody: 0,
      nonce: '0',
      credits: '0',
      active: true,
      admin: true,
      reviewer: false,
      stake: '0',
      claim: '0',
      join_epoch: '1',
    })),
    epochs: [{ epoch: '1', commitment: await sha256Hex(originalKey), creator: '1' }],
    keyGrants: [
      { id: '1', epoch: '1', recipient: '1', grantor: '1', envelope: JSON.stringify(selfGrant) },
    ],
    documents: [
      {
        id: '1',
        document_id: '1',
        version: 1,
        author: '1',
        cid: '',
        metadata,
        commitment: await sha256Hex(new TextEncoder().encode(metadata)),
        bytes: new TextEncoder().encode(metadata).length,
        envelope_version: 1,
        key_epoch: '1',
      },
    ],
  });
  let currentEpoch = '1',
    writes = 0,
    contentUnavailable = false;
  const abi = ABI.from(runtimeAbi);
  function summary() {
    return DaoSummarySchema.parse({
      reference,
      title: 'Continuity DAO',
      description: 'Synthetic private DAO',
      privacy: 'encrypted-user-controlled',
      owner: 'creator',
      token: { chainId: reference.chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
      members: records.members.filter((m) => m.active).length,
      available: '0',
      reserved: '0',
      claims: '0',
      keyEpoch: currentEpoch,
    });
  }
  async function device(target: Page, index: number) {
    const account = accounts[index],
      vault = vaults[index],
      memberId = String(index + 1);
    if (!account || !vault) throw new Error('Missing device fixture');
    const kit = RecoveryKitSchema.parse({
      version: 1,
      localEnvelope: vault.localEnvelope,
      recoveryEnvelope: vault.recoveryEnvelope,
      signingPublicKey: vault.signingPublicKey,
      encryptionPublicKey: vault.encryptionPublicKey,
    });
    await target.addInitScript((value) => {
      localStorage.setItem('daclify.vault.v1', value);
      sessionStorage.setItem('daclify.csrf', 'c'.repeat(43));
    }, JSON.stringify(kit));
    let loginMessage = '';
    await target.route('**/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/v1/network')
        return route.fulfill({
          json: {
            chainId: reference.chainId,
            rpcUrl: 'https://rpc.example',
            runtime: reference.contract,
            hub: null,
            environment: 'testnet',
            interfaceVersion: 1,
            coreVersion: '0.14.0-alpha.3',
            capabilities: ['governance-policy'],
          },
        });
      if (path === '/v1/daos') return route.fulfill({ json: { daos: [summary()], next: null } });
      if (path === '/v1/me') return route.fulfill({ json: { account } });
      if (path === '/v1/me/memberships') {
        const m = records.members.find((person) => person.id === memberId);
        if (!m) throw new Error('Missing member');
        return route.fulfill({
          json: {
            memberships: [
              UserMembershipSchema.parse({
                dao: reference,
                memberId,
                nonce: m.nonce,
                active: m.active,
                admin: m.admin,
                reviewer: false,
                credits: '0',
                claim: '0',
                stake: '0',
                nativeAccount: '',
                custody: 'user-controlled',
                signingKey: m.signing_key,
              }),
            ],
          },
        });
      }
      if (path === '/v1/auth/challenge') {
        const input = ApiRoutes.challenge.input.parse(route.request().postDataJSON()),
          id = crypto.randomUUID(),
          expires = new Date(Date.now() + 300000).toISOString();
        loginMessage = JSON.stringify(
          LoginMessageSchema.parse({
            ...input,
            domain: 'daclify.login.v3',
            origin: new URL(target.url()).origin,
            audience: new URL(route.request().url()).origin,
            challenge: id,
            expires,
          }),
        );
        return route.fulfill({ json: { id, message: loginMessage, expires } });
      }
      if (path === '/v1/auth/login') {
        const input = ApiRoutes.login.input.parse(route.request().postDataJSON());
        expect(
          Signature.from(input.signature).verifyMessage(
            new TextEncoder().encode(loginMessage),
            PublicKey.from(vault.signingPublicKey),
          ),
        ).toBe(true);
        return route.fulfill({ json: { account, csrfToken: 'c'.repeat(43) } });
      }
      if (path === '/v1/daos/1/content')
        return route.fulfill(
          contentUnavailable
            ? { status: 503, json: { code: 'SERVICE_UNAVAILABLE', message: 'Fixture outage' } }
            : { json: records },
        );
      if (path === '/v1/daos/1/private-access')
        return route.fulfill({
          json: {
            dao: reference,
            privacy: 'encrypted-user-controlled',
            historyPolicy: 'full-history',
            keyEpoch: currentEpoch,
          },
        });
      if (path === '/v1/daos/1/modules')
        return route.fulfill({
          json: ModuleStateSchema.parse({
            dao: reference,
            modules: [],
            ballots: [],
            votes: [],
            projects: [],
            milestones: [],
            schedules: [],
            controls: [],
            executions: [],
            entries: [],
          }),
        });
      if (path === '/v1/daos/1/governance')
        return route.fulfill({
          json: GovernanceStateSchema.parse({
            dao: reference,
            policy: null,
            actors: [],
            sessions: [],
            guardian: null,
            budget: null,
          }),
        });
      if (path === '/v1/relay') {
        const input = ApiRoutes.relay.input.parse(route.request().postDataJSON());
        expect(input.request.member_id).toBe(memberId);
        expect(
          Signature.from(input.sig).verifyDigest(
            instructionDigest(input.request),
            PublicKey.from(vault.signingPublicKey),
          ),
        ).toBe(true);
        const actor = records.members.find((m) => m.id === memberId);
        if (!actor) throw new Error('Missing actor');
        expect(input.request.nonce).toBe(actor.nonce);
        const decoded = z
          .record(z.string(), z.unknown())
          .parse(
            Serializer.objectify(
              Serializer.decode({ abi, type: input.request.action, data: input.request.data }),
            ),
          );
        for (const key of ['dao_id', 'member_id', 'recipient', 'target', 'epoch']) {
          if (typeof decoded[key] === 'number')
            decoded[key] = String(
              z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(decoded[key]),
            );
        }
        if (input.request.action === 'grantkey') {
          const args = RuntimeActionSchemas.grantkey.parse(decoded);
          records.keyGrants.push({
            id: String(records.keyGrants.length + 1),
            epoch: args.epoch,
            recipient: args.recipient,
            grantor: memberId,
            envelope: args.envelope,
          });
        } else if (input.request.action === 'setactive') {
          const args = RuntimeActionSchemas.setactive.parse(decoded),
            recipient = records.members.find((m) => m.id === args.target);
          if (!recipient) throw new Error('Missing departing member');
          recipient.active = args.active;
          currentEpoch = String(BigInt(currentEpoch) + 1n);
        } else if (input.request.action === 'commitepoch') {
          const args = RuntimeActionSchemas.commitepoch.parse(decoded);
          records.epochs.push({
            epoch: args.epoch,
            commitment: args.commitment,
            creator: memberId,
          });
          records.keyGrants.push({
            id: String(records.keyGrants.length + 1),
            epoch: args.epoch,
            recipient: memberId,
            grantor: memberId,
            envelope: args.self_grant,
          });
        } else throw new Error('Unexpected private-access mutation');
        actor.nonce = String(BigInt(actor.nonce) + 1n);
        writes++;
        return route.fulfill({ json: { transactionId: 'ab'.repeat(32) } });
      }
      return route.fulfill({
        status: 503,
        json: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic service unavailable' },
      });
    });
    await target.goto('/account');
    await target.getByLabel('Vault password', { exact: true }).fill(password);
    await target.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
    await expect(target.getByText('Keys unlocked', { exact: true })).toBeVisible();
    const menu = target.getByRole('button', { name: 'Menu', exact: true });
    if (await menu.isVisible()) await menu.click();
    await target.getByRole('link', { name: 'My DAO', exact: true }).click();
    await target
      .getByRole('link', { name: /Continuity DAO/ })
      .first()
      .click();
    await target.getByRole('link', { name: 'Members', exact: true }).click();
  }
  await device(page, 0);
  await page.getByLabel('Member', { exact: true }).selectOption('1');
  await expect(
    page.getByText(
      'No remaining administrator has every recorded grant. Prepare their private access first.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Deactivate member', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Prepare another active administrator');
  expect(writes).toBe(0);
  await page
    .getByRole('button', { name: 'Prepare private access for members', exact: true })
    .click();
  await expect(page.getByText(/Prepared 1 private-access grants/)).toBeVisible();
  expect(writes).toBe(1);
  const context = await browser.newContext();
  const recipient = await context.newPage();
  await device(recipient, 1);
  await recipient.getByRole('button', { name: 'Verify my private access', exact: true }).click();
  await expect(
    recipient.getByText('1 of 1 permitted epochs verified on this device.'),
  ).toBeVisible();
  await page.getByLabel('Administrator keeping private access').selectOption('2');
  await page
    .getByLabel(
      'This administrator verified private access and tested account recovery on another device.',
    )
    .check();
  contentUnavailable = true;
  await page.getByRole('button', { name: 'Deactivate member', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Prepare another active administrator');
  expect(writes).toBe(1);
  contentUnavailable = false;
  await page.getByRole('button', { name: 'Deactivate member', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Deactivate member', exact: true })).toHaveCount(0);
  expect(writes).toBe(2);
  await recipient.getByRole('link', { name: 'Documents', exact: true }).click();
  await recipient.getByRole('button', { name: 'Decrypt document 1', exact: true }).click();
  await expect(
    recipient.getByText('Private history survives its creator', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    recipient.getByRole('button', { name: 'Prepare private access for members', exact: true }),
  ).toBeEnabled();
  await recipient
    .getByRole('button', { name: 'Prepare private access for members', exact: true })
    .click();
  await expect(recipient.getByText('Encryption epoch ready', { exact: true })).toBeVisible();
  expect(records.epochs).toHaveLength(2);
  expect(records.documents[0]?.metadata).toBe(metadata);
  const results = await new AxeBuilder({ page: recipient }).include('main').analyze();
  expect(results.violations).toEqual([]);
  expect(await recipient.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  await context.close();
});
