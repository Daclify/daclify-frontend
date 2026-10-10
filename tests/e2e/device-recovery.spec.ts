import { expect, test, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { PublicKey, Signature } from '@wharfkit/antelope';
import {
  AccountSchema,
  ApiRoutes,
  AccountControlMessageSchema,
  AccountControlRequestSchema,
  LoginMessageSchema,
  DeviceRecoveryRequestSchema,
  DeviceRecoveryPayloadSchema,
  RecoveryRoutes,
  VERSION,
} from '@daclify/core-protocol';
import { recoveryDeviceFingerprint } from '@daclify/core-protocol/sdk';
import { createVault } from '../../src/auth/vault';
test('approves a fresh browser without a JSON kit or vault password and transfers the original keys', async ({
  browser,
  baseURL,
  isMobile,
  viewport,
  hasTouch,
  deviceScaleFactor,
}) => {
  if (!baseURL) throw new Error('Browser origin required');
  const password = 'disposable original-device password',
    original = await createVault(password),
    origin = new URL(baseURL).origin;
  const account = AccountSchema.parse({
    id: crypto.randomUUID(),
    custody: 'user-controlled',
    signingKey: original.signingPublicKey,
    encryptionKey: original.encryptionPublicKey,
  });
  const kit = {
    version: 1,
    localEnvelope: original.localEnvelope,
    recoveryEnvelope: original.recoveryEnvelope,
    signingPublicKey: original.signingPublicKey,
    encryptionPublicKey: original.encryptionPublicKey,
  };
  const source = await browser.newContext({
      isMobile,
      viewport,
      hasTouch,
      ...(deviceScaleFactor === undefined ? {} : { deviceScaleFactor }),
    }),
    receiver = await browser.newContext({
      isMobile,
      viewport,
      hasTouch,
      ...(deviceScaleFactor === undefined ? {} : { deviceScaleFactor }),
    });
  let request: ReturnType<typeof DeviceRecoveryRequestSchema.parse> | undefined,
    payload: ReturnType<typeof DeviceRecoveryPayloadSchema.parse> | undefined,
    challenge = '';
  const intents = new Map<string, string>(),
    pollToken = 'p'.repeat(43);
  async function route(context: BrowserContext) {
    await context.addInitScript(() => sessionStorage.setItem('daclify.csrf', 'c'.repeat(43)));
    await context.route('**/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/v1/network')
        return route.fulfill({
          json: {
            chainId: 'ab'.repeat(32),
            rpcUrl: 'https://rpc.example.test',
            runtime: 'daclifycore',
            hub: null,
            environment: 'testnet',
            interfaceVersion: 1,
            coreVersion: VERSION,
            capabilities: [],
          },
        });
      if (path === '/v1/daos') return route.fulfill({ json: { daos: [], next: null } });
      if (path === '/v1/me') return route.fulfill({ json: { account } });
      if (path === '/v1/me/memberships') return route.fulfill({ json: { memberships: [] } });
      if (path === '/v1/account/recovery')
        return route.fulfill({
          json: { methods: [], assistedEver: false, configured: false, reason: 'Fixture' },
        });
      if (path === ApiRoutes.challenge.path) {
        const identity = ApiRoutes.challenge.input.parse(route.request().postDataJSON()),
          id = crypto.randomUUID(),
          expires = new Date(Date.now() + 60000).toISOString();
        challenge = JSON.stringify(
          LoginMessageSchema.parse({
            domain: 'daclify.login.v3',
            ...identity,
            origin,
            audience: origin,
            challenge: id,
            expires,
          }),
        );
        return route.fulfill({ json: { id, message: challenge, expires } });
      }
      if (path === ApiRoutes.login.path) {
        const proof = ApiRoutes.login.input.parse(route.request().postDataJSON());
        expect(
          Signature.from(proof.signature).verifyMessage(
            new TextEncoder().encode(challenge),
            PublicKey.from(original.signingPublicKey),
          ),
        ).toBe(true);
        return route.fulfill({ json: { account, csrfToken: 'c'.repeat(43) } });
      }
      if (path === RecoveryRoutes.deviceRecoveryBegin.path) {
        const incoming = RecoveryRoutes.deviceRecoveryBegin.input.parse(
          route.request().postDataJSON(),
        );
        request = DeviceRecoveryRequestSchema.parse({
          version: 1,
          id: crypto.randomUUID(),
          accountId: account.id,
          origin,
          recipient: incoming.recipient,
          fingerprint: await recoveryDeviceFingerprint(incoming.recipient),
          signingPublicKey: account.signingKey,
          encryptionPublicKey: account.encryptionKey,
          expires: new Date(Date.now() + 300000).toISOString(),
        });
        return route.fulfill({ json: { request, pollToken } });
      }
      if (path.startsWith('/v1/account/recovery/device/') && route.request().method() === 'GET')
        return route.fulfill({ json: request });
      if (path === '/v1/account/control') {
        const input = AccountControlRequestSchema.parse(route.request().postDataJSON()),
          id = crypto.randomUUID(),
          expires = new Date(Date.now() + 300000).toISOString();
        const message = JSON.stringify(
          AccountControlMessageSchema.parse({
            ...input,
            domain: 'daclify.account-control.v2',
            origin,
            audience: origin,
            accountId: account.id,
            signingKey: account.signingKey,
            challengeId: id,
            expires,
          }),
        );
        intents.set(id, message);
        return route.fulfill({ json: { id, message, expires } });
      }
      if (path === RecoveryRoutes.deviceRecoveryApprove.path) {
        const headers = route.request().headers(),
          id = headers['x-account-intent-id'] ?? '',
          message = intents.get(id);
        if (!message || !request) throw new Error('Approval must prove original account control');
        const approval = RecoveryRoutes.deviceRecoveryApprove.input.parse(
            route.request().postDataJSON(),
          ),
          control = AccountControlMessageSchema.parse(JSON.parse(message));
        expect(control.bodyHash).toBe(
          createHash('sha256')
            .update(route.request().postData() ?? '')
            .digest('hex'),
        );
        expect(
          Signature.from(headers['x-account-signature'] ?? '').verifyMessage(
            new TextEncoder().encode(message),
            PublicKey.from(original.signingPublicKey),
          ),
        ).toBe(true);
        expect(approval.fingerprint).toBe(request.fingerprint);
        expect(approval.id).toBe(request.id);
        payload = approval.payload;
        intents.delete(id);
        return route.fulfill({ json: { approved: true } });
      }
      if (path === RecoveryRoutes.deviceRecoveryPoll.path) {
        const incoming = RecoveryRoutes.deviceRecoveryPoll.input.parse(
          route.request().postDataJSON(),
        );
        expect(incoming.pollToken).toBe(pollToken);
        expect(incoming.id).toBe(request?.id);
        return route.fulfill({ json: { request, payload: payload ?? null } });
      }
      return route.fulfill({
        status: 503,
        json: { code: 'SERVICE_UNAVAILABLE', message: 'Fixture' },
      });
    });
  }
  try {
    await route(source);
    await route(receiver);
    await source.addInitScript(
      (record) => localStorage.setItem('daclify.vault.v1', JSON.stringify(record)),
      kit,
    );
    const old = await source.newPage(),
      fresh = await receiver.newPage();
    await old.goto(baseURL + '/account');
    await fresh.goto(baseURL + '/account');
    await old.getByLabel('Vault password', { exact: true }).fill(password);
    await old.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
    await expect(old.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible();
    await fresh
      .getByRole('button', { name: 'Request approval from another device', exact: true })
      .click();
    const link = await fresh.getByLabel('Approval link', { exact: true }).inputValue();
    expect(link).not.toContain(pollToken);
    expect((await new AxeBuilder({ page: fresh }).analyze()).violations).toEqual([]);
    await old.getByLabel('Approval link or request ID', { exact: true }).fill(link);
    await old.getByRole('button', { name: 'Review device request', exact: true }).click();
    await expect(
      old.getByText('Check this code against the requesting device before sharing your keys.'),
    ).toBeVisible();
    await old
      .getByRole('checkbox', { name: 'The verification codes match and I recognize this device.' })
      .check();
    await old.getByRole('button', { name: 'Approve this device', exact: true }).click();
    await expect(fresh.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(fresh.getByText(account.id, { exact: true })).toBeVisible();
    expect(await fresh.evaluate(() => localStorage.getItem('daclify.vault.v1'))).toBeNull();
    expect((await new AxeBuilder({ page: fresh }).analyze()).violations).toEqual([]);
  } finally {
    await source.close();
    await receiver.close();
  }
});
