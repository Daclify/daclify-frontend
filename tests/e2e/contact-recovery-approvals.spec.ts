import { z } from 'zod';
import { test, expect, type Browser, type Page, type BrowserContext } from '@playwright/test';
import { ABI, PublicKey, Serializer, Signature } from '@wharfkit/antelope';
import {
  ApiRoutes,
  ContactRecoveryStateSchema,
  ContactRecoverySubmitSchema,
  ContactIdentitySchema,
  LoginMessageSchema,
  VERSION,
  type Account,
  RecoveryKitSchema,
} from '@daclify/core-protocol';
import {
  runtimeAbi,
  RuntimeActionSchemas,
  instructionDigest,
  contactRecoveryDigest,
  contactRequestCommitment,
} from '@daclify/core-protocol/sdk';
import { createVault } from '../../src/auth/vault';
// HTTP fixtures verify real signatures; compiled-WASM/native tests establish contract authority and timing.
test('three contacts enroll, two approve a replacement fingerprint, and surviving control cancels', async ({
  browser,
  viewport,
  isMobile,
  hasTouch,
}) => {
  test.slow();
  const password = 'disposable contact workflow vault password';
  const vaults = await Promise.all([
    createVault(password),
    createVault(password),
    createVault(password),
    createVault(password),
  ]);
  const original = vaults[0];
  if (!original) throw new Error('CONTACT_FIXTURE');
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
  const state = ContactRecoveryStateSchema.parse({
    target,
    supported: true,
    documentsAllowed: false,
    nextPacketId: '1',
    member: {
      id: '1',
      native_account: '',
      signing_key: original.signingPublicKey,
      encryption_key: JSON.stringify(original.encryptionPublicKey),
      custody: 0,
      nonce: '0',
      credits: '42',
      stake: '0',
      claim: '0',
      active: true,
      admin: true,
      reviewer: false,
      join_epoch: '1',
    },
    policy: null,
    pending: null,
    result: null,
    packets: [],
    next: null,
  });
  const relayActions: string[] = [];
  const contexts: BrowserContext[] = [];
  async function screen(browser: Browser, index: number, unlocked = true): Promise<Page> {
    const context = await browser.newContext({ viewport, isMobile, hasTouch });
    contexts.push(context);
    const page = await context.newPage(),
      vault = vaults[index];
    if (!vault) throw new Error('CONTACT_FIXTURE');
    if (index === 0 && unlocked) await page.clock.install();
    const account: Account = {
      id: crypto.randomUUID(),
      custody: 'user-controlled',
      signingKey: vault.signingPublicKey,
      encryptionKey: vault.encryptionPublicKey,
    };
    await page.route('**/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname,
        receipt = { transactionId: 'ab'.repeat(32) };
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
            capabilities: ['trusted-contact-recovery-v1'],
          },
        });
      if (path === '/v1/daos') return route.fulfill({ json: { daos: [], next: null } });
      if (path === '/v1/sign-in/session' || path === '/v1/me')
        return unlocked ? route.fulfill({ json: { account } }) : route.fulfill({ status: 204 });
      if (path === '/v1/me/memberships')
        return route.fulfill({
          json: {
            memberships:
              index === 0 && unlocked
                ? [
                    {
                      dao: target.dao,
                      memberId: '1',
                      nonce: state.member?.nonce ?? '0',
                      active: true,
                      admin: true,
                      reviewer: false,
                      credits: '42',
                      claim: '0',
                      stake: '0',
                      nativeAccount: '',
                      custody: 'user-controlled',
                      signingKey: original.signingPublicKey,
                    },
                  ]
                : [],
          },
        });
      if (path === ApiRoutes.challenge.path) {
        const input = ApiRoutes.challenge.input.parse(route.request().postDataJSON()),
          id = crypto.randomUUID(),
          expires = new Date(Date.now() + 300000).toISOString();
        return route.fulfill({
          json: {
            id,
            expires,
            message: JSON.stringify(
              LoginMessageSchema.parse({
                ...input,
                domain: 'daclify.login.v3',
                origin: new URL(page.url()).origin,
                audience: new URL(route.request().url()).origin,
                challenge: id,
                expires,
              }),
            ),
          },
        });
      }
      if (path === ApiRoutes.login.path)
        return route.fulfill({ json: { account, csrfToken: 'a'.repeat(43) } });
      if (path === '/v1/recovery/contacts/state') return route.fulfill({ json: state });
      if (path === '/v1/relay') {
        const input = RuntimeActionSchemas.submit.parse(route.request().postDataJSON());
        expect(
          Signature.from(input.sig).verifyDigest(
            instructionDigest(input.request),
            PublicKey.from(original.signingPublicKey),
          ),
        ).toBe(true);
        relayActions.push(input.request.action);
        if (input.request.action === 'setcontacts') {
          const fields = z.record(z.string(), z.unknown()).parse(
            Serializer.objectify(
              Serializer.decode({
                abi: ABI.from(runtimeAbi),
                type: 'setcontacts',
                data: input.request.data,
              }),
            ),
          );
          const data = RuntimeActionSchemas.setcontacts.parse({
            ...fields,
            dao_id: String(fields.dao_id),
            member_id: String(fields.member_id),
          });
          expect(data.documents).toBe(false);
          expect(data.contacts).toHaveLength(3);
          state.policy = {
            member_id: '1',
            revision: '1',
            next_request: '0',
            owner_key: original.signingPublicKey,
            contacts: data.contacts,
            accepted: 0,
            documents: false,
          };
        } else if (input.request.action === 'cancelrec') state.pending = null;
        else throw new Error('Unexpected owner action');
        if (!state.member) throw new Error('CONTACT_FIXTURE');
        state.member.nonce = String(BigInt(state.member.nonce) + 1n);
        return route.fulfill({ json: receipt });
      }
      if (path === '/v1/recovery/contacts/submit') {
        const input = ContactRecoverySubmitSchema.parse(route.request().postDataJSON()),
          policy = state.policy;
        if (!policy || input.action === 'finishrec') throw new Error('CONTACT_FIXTURE');
        const { proof, sig } = input.data,
          identity = policy.contacts[proof.contact];
        if (!identity) throw new Error('CONTACT_FIXTURE');
        expect(proof.action).toBe(input.action);
        expect(proof.chain_id).toBe(target.dao.chainId);
        expect(proof.dao_id).toBe('1');
        expect(proof.member_id).toBe('1');
        expect(proof.revision).toBe(policy.revision);
        expect(
          Signature.from(sig).verifyDigest(
            contactRecoveryDigest(proof),
            PublicKey.from(identity.signing_key),
          ),
        ).toBe(true);
        if (input.action === 'acceptcont') policy.accepted |= 1 << proof.contact;
        else if (input.action === 'startrecover') {
          expect(policy.accepted).toBe(7);
          expect(
            Signature.from(input.data.new_sig).verifyDigest(
              contactRequestCommitment(input.data.request),
              PublicKey.from(input.data.request.signing_key),
            ),
          ).toBe(true);
          expect(proof.data_hash).toBe(contactRequestCommitment(input.data.request).toString());
          state.pending = {
            member_id: '1',
            request: input.data.request,
            old_signing_key: original.signingPublicKey,
            approvals: 1 << proof.contact,
            execute_after: 0,
          };
          policy.next_request = input.data.request.request_id;
        } else if (input.action === 'approverec') {
          const pending = state.pending;
          if (!pending) throw new Error('CONTACT_FIXTURE');
          expect(proof.data_hash).toBe(contactRequestCommitment(pending.request).toString());
          pending.approvals |= 1 << proof.contact;
          pending.execute_after = Math.floor(Date.now() / 1000) + 172800;
        } else throw new Error('Unexpected contact action');
        return route.fulfill({ json: receipt });
      }
      return route.fulfill({
        status: 503,
        json: { code: 'SERVICE_UNAVAILABLE', message: 'Fixture unavailable' },
      });
    });
    if (unlocked)
      await page.addInitScript(
        (kit) => localStorage.setItem('daclify.vault.v1', JSON.stringify(kit)),
        RecoveryKitSchema.parse({
          version: 1,
          localEnvelope: vault.localEnvelope,
          recoveryEnvelope: vault.recoveryEnvelope,
          signingPublicKey: vault.signingPublicKey,
          encryptionPublicKey: vault.encryptionPublicKey,
        }),
      );
    await page.goto('/account');
    if (unlocked) {
      await page.getByLabel('Vault password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
      await expect(page.getByText('Keys unlocked', { exact: true })).toBeVisible();
    }
    await page.getByText('Trusted-contact recovery', { exact: true }).click();
    await page.getByLabel('Membership recovery code').fill(code);
    await page.getByRole('button', { name: 'Load recovery', exact: true }).click();
    return page;
  }
  try {
    const owner = await screen(browser, 0);
    await expect(owner.getByRole('checkbox', { name: /Allow these contacts/ })).toBeDisabled();
    for (const index of [1, 2, 3]) {
      const v = vaults[index];
      if (!v) throw new Error('CONTACT_FIXTURE');
      const identity = ContactIdentitySchema.parse({
        signingKey: v.signingPublicKey,
        encryptionKey: v.encryptionPublicKey,
      });
      await owner
        .getByLabel(`Contact ${index} public code`)
        .fill(Buffer.from(JSON.stringify(identity)).toString('base64url'));
    }
    await owner.getByRole('button', { name: 'Save three contacts', exact: true }).click();
    await expect(owner.getByText('Contacts accepted: 0/3.', { exact: false })).toBeVisible();
    const helpers: Page[] = [];
    for (const index of [1, 2, 3]) {
      const page = await screen(browser, index);
      helpers.push(page);
      await page
        .getByRole('button', { name: 'Accept being a recovery contact', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: 'Accept being a recovery contact', exact: true }),
      ).toHaveCount(0);
    }
    const receiver = await screen(browser, 0, false);
    await receiver.getByLabel('New device vault password').fill(password);
    await receiver.getByRole('button', { name: 'Prepare replacement device', exact: true }).click();
    const offer = await receiver
      .getByLabel('Send this public recovery offer to your contacts')
      .inputValue();
    for (const page of helpers.slice(0, 2)) {
      await page.getByRole('button', { name: 'Load recovery', exact: true }).click();
      await page.getByLabel('Replacement device’s recovery offer').fill(offer);
      await expect(
        page.getByRole('button', { name: 'Approve replacement device', exact: true }),
      ).toBeDisabled();
      await page.getByRole('checkbox', { name: /I verified this person/ }).check();
      await page.getByLabel('Replacement device’s recovery offer').fill(offer + ' ');
      await expect(
        page.getByRole('checkbox', { name: /I verified this person/ }),
      ).not.toBeChecked();
      await expect(
        page.getByRole('button', { name: 'Approve replacement device', exact: true }),
      ).toBeDisabled();
      await page.getByRole('checkbox', { name: /I verified this person/ }).check();
      await page.getByRole('button', { name: 'Approve replacement device', exact: true }).click();
      await expect(
        page.getByRole('checkbox', { name: /I verified this person/ }),
      ).not.toBeChecked();
    }
    await owner.clock.fastForward(30000);
    await expect(owner.getByText('Approvals: 2/2.', { exact: false })).toBeVisible();
    await owner.getByRole('button', { name: 'Cancel recovery', exact: true }).click();
    await expect(owner.getByRole('button', { name: 'Cancel recovery', exact: true })).toHaveCount(
      0,
    );
    expect(relayActions).toEqual(['setcontacts', 'cancelrec']);
    expect(state.member).toMatchObject({
      id: '1',
      credits: '42',
      admin: true,
      signing_key: original.signingPublicKey,
    });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
