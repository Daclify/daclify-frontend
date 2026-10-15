import { expect, type Page } from '@playwright/test';
import { AccountSchema, ApiRoutes, DaoContentSchema, DaoRefSchema, DaoSummarySchema, GovernanceStateSchema, LoginMessageSchema, RecoveryKitSchema, UserMembershipSchema, VERSION, ContactRecoveryStateSchema, MAX_HOSTED_CONTENT_BYTES } from '@daclify/core-protocol';
import { Catalog, ModuleApiRoutes, ModuleStateSchema, ModulePermissions } from '@daclify/modules';
import { ModuleCodeHashes } from '@daclify/modules/sdk';
import { createVault, createEpochGrant, sha256Hex } from '../../src/auth/vault';
import { epochGrantDomain } from '@daclify/core-protocol';

export async function legalFixture(page: Page, options: { encrypted?: boolean; admin?: boolean; recovery?: 'off' | 'allowed' | 'opted-in' | 'unsupported' | 'failed' | 'foreign' } = {}) {
  const password = 'disposable legal template fixture password';
  const vault = await createVault(password);
  const dao = DaoRefSchema.parse({ chainId: 'ab'.repeat(32), contract: 'daclifycore', daoId: '1', interfaceVersion: 1 });
  const account = AccountSchema.parse({ id: '11111111-1111-4111-8111-111111111111', custody: 'user-controlled', signingKey: vault.signingPublicKey, encryptionKey: vault.encryptionPublicKey });
  const member = UserMembershipSchema.parse({ dao, memberId: '1', nonce: '0', active: true, admin: options.admin ?? true, reviewer: false, credits: '0', stake: '0', claim: '0', nativeAccount: '', custody: 'user-controlled', signingKey: vault.signingPublicKey });
  const summary = DaoSummarySchema.parse({ reference: dao, title: 'Legal template DAO', description: 'Community purpose', privacy: options.encrypted ? 'encrypted-user-controlled' : 'public', owner: 'alice', token: { chainId: dao.chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 }, members: 1, available: '0', reserved: '0', claims: '0', keyEpoch: '1' });
  const epoch = crypto.getRandomValues(new Uint8Array(32));
  const records = DaoContentSchema.parse({ dao, members: [{ id: '1', native_account: '', signing_key: vault.signingPublicKey, encryption_key: JSON.stringify(vault.encryptionPublicKey), custody: 0, nonce: '0', credits: '0', active: true, admin: member.admin, reviewer: false, stake: '0', claim: '0', join_epoch: '1' }], epochs: [{ epoch: '1', commitment: await sha256Hex(epoch), creator: '1' }], keyGrants: [{ id: '1', epoch: '1', recipient: '1', grantor: '1', envelope: JSON.stringify(await createEpochGrant(vault.encryptionPublicKey, epoch, epochGrantDomain(dao, '1', '1'))) }], documents: [] });
  const manifest = Catalog.find((item) => item.id === 'decide');
  if (!manifest) throw new Error('FIXTURE_MANIFEST');
  const module = { manifest, deployment: { id: 'decide', account: 'decide', version: manifest.version, codeHash: ModuleCodeHashes.decide }, installed: true, enabled: true, compatible: true, codeVerified: true, actions: ModulePermissions.decide.actions, grants: ModulePermissions.decide.grants };
  const register = ModuleApiRoutes.documents.response.parse({ dao, available: true, module, registrations: [], changes: [], acceptances: [], acceptedAdoptionIds: [], ballots: [], votes: [], next: null });
  const governance = GovernanceStateSchema.parse({ dao, policy: null, actors: [], sessions: [], guardian: null, budget: null });
  const modules = ModuleStateSchema.parse({ dao, modules: [module], ballots: [], votes: [], projects: [], milestones: [], schedules: [], controls: [], executions: [], entries: [] });
  const writes: string[] = [];
  let loginMessage = '';
  await page.addInitScript((kit) => {
    localStorage.setItem('daclify.vault.v1', kit);
    sessionStorage.setItem('daclify.csrf', 'c'.repeat(43));
  }, JSON.stringify(RecoveryKitSchema.parse({ version: 1, localEnvelope: vault.localEnvelope, recoveryEnvelope: vault.recoveryEnvelope, signingPublicKey: vault.signingPublicKey, encryptionPublicKey: vault.encryptionPublicKey })));
  await page.route('**/v1/**', async (route) => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path === '/v1/network') return route.fulfill({ json: { chainId: dao.chainId, rpcUrl: 'https://rpc.example', runtime: dao.contract, hub: null, environment: 'testnet', interfaceVersion: 1, coreVersion: VERSION, capabilities: ['governance-policy', 'trusted-contact-recovery-v1'] } });
    if (path === '/v1/sign-in/session' || path === '/v1/me') return route.fulfill({ json: { account } });
    if (path === '/v1/me/memberships') return route.fulfill({ json: { memberships: [member] } });
    if (path === '/v1/daos') return route.fulfill({ json: { daos: [summary], next: null } });
    if (path === '/v1/daos/1') return route.fulfill({ json: summary });
    if (path === '/v1/daos/1/content') return route.fulfill({ json: records });
    if (path === '/v1/daos/1/governing-documents') return route.fulfill({ json: register });
    if (path === '/v1/daos/1/modules') return route.fulfill({ json: modules });
    if (path === '/v1/daos/1/governance') return route.fulfill({ json: governance });
    if (path === '/v1/daos/1/private-access') return route.fulfill({ json: { dao, privacy: summary.privacy, historyPolicy: 'from-join', keyEpoch: '1' } });
    if (path === '/v1/storage') return route.fulfill({ json: { provider: 'local-fixture', configured: true, uploadLimit: MAX_HOSTED_CONTENT_BYTES } });
    if (path === '/v1/recovery/contacts/state') {
      if (options.recovery === 'failed') return route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE', message: 'Fixture unavailable' } });
      return route.fulfill({ json: ContactRecoveryStateSchema.parse({ target: { dao: options.recovery === 'foreign' ? { ...dao, daoId: '2' } : dao, memberId: '1' }, supported: options.recovery !== 'unsupported', documentsAllowed: ['allowed', 'opted-in'].includes(options.recovery ?? ''), nextPacketId: '1', member: null, policy: options.recovery === 'opted-in' ? { member_id: '1', revision: '1', next_request: '0', owner_key: vault.signingPublicKey, contacts: [], accepted: 7, documents: true } : null, pending: null, result: null, packets: [], next: null }) });
    }
    if (path === '/v1/auth/challenge') {
      const input = ApiRoutes.challenge.input.parse(route.request().postDataJSON());
      const id = crypto.randomUUID(), expires = new Date(Date.now() + 300000).toISOString();
      loginMessage = JSON.stringify(LoginMessageSchema.parse({ ...input, domain: 'daclify.login.v3', origin: new URL(page.url()).origin, audience: url.origin, challenge: id, expires }));
      return route.fulfill({ json: { id, message: loginMessage, expires } });
    }
    if (path === '/v1/auth/login') return route.fulfill({ json: { account, csrfToken: 'c'.repeat(43) } });
    if (route.request().method() !== 'GET') writes.push(path);
    return route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic service unavailable' } });
  });
  async function unlock() {
    await page.goto('/account');
    await page.getByLabel('Vault password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Unlock and sign in', exact: true }).click();
    await expect(page.getByText('Keys unlocked', { exact: true })).toBeVisible();
  }
  return { account, dao, member, summary, records, register, governance, modules, vault, epoch, password, writes, unlock };
}
