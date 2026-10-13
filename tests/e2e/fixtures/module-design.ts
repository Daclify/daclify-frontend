import type { Page } from '@playwright/test';
import {
  AccountSchema,
  DaoSummarySchema,
  DaoContentSchema,
  GovernanceStateSchema,
  NetworkSchema,
  TreasurySchema,
  UserMembershipSchema,
  VERSION,
  defaultDaoSetup,
} from '@daclify/core-protocol';
import { governanceSettings } from '@daclify/core-protocol/sdk';
import { Catalog, ModulePermissions, ModuleStateSchema } from '@daclify/modules';
import { ModuleCodeHashes } from '@daclify/modules/sdk';

export async function moduleFixture(page: Page, savedPolicy = true, visitor = false) {
  const network = NetworkSchema.parse({
    chainId: 'ab'.repeat(32),
    rpcUrl: 'https://rpc.example',
    runtime: 'daclifycore',
    hub: null,
    environment: 'testnet',
    interfaceVersion: 1,
    coreVersion: VERSION,
    capabilities: ['governance-policy'],
  });
  const dao = {
    chainId: network.chainId,
    contract: network.runtime,
    daoId: '1',
    interfaceVersion: 1,
  };
  const summary = DaoSummarySchema.parse({
    reference: dao,
    title: 'Design fixture DAO',
    description: 'Synthetic governance UI',
    privacy: 'public',
    owner: 'alice',
    token: { chainId: dao.chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
    members: 1,
    available: '0',
    reserved: '0',
    claims: '0',
    keyEpoch: '1',
    purpose: 'community',
  });
  const account = AccountSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    custody: 'user-controlled',
    signingKey: null,
    encryptionKey: null,
  });
  const member = UserMembershipSchema.parse({
    dao,
    memberId: '1',
    nonce: '0',
    active: true,
    admin: true,
    reviewer: false,
    credits: '0',
    stake: '0',
    claim: '0',
    nativeAccount: '',
    custody: 'user-controlled',
  });
  const manifest = Catalog.find((m) => m.id === 'decide');
  if (!manifest) throw new Error('Decide manifest missing');
  const modules = ModuleStateSchema.parse({
    dao,
    modules: [
      {
        manifest,
        deployment: {
          id: 'decide',
          account: 'decide',
          version: manifest.version,
          codeHash: ModuleCodeHashes.decide,
        },
        enabled: true,
        installed: true,
        compatible: true,
        codeVerified: true,
        actions: ModulePermissions.decide.actions,
        grants: ModulePermissions.decide.grants,
      },
    ],
    ballots: [
      {
        id: '9',
        dao_id: '1',
        creator: '1',
        kind: 0,
        choices: 2,
        closes: Math.floor(Date.now() / 1000) + 86400,
        quorum: 5000,
        approval: 5001,
        denominator: '1',
        max_member: '1',
        cast: '0',
        tallies: ['0', '0'],
        status: 0,
        winner: 0,
        metadata: JSON.stringify({
          schemaVersion: 1,
          title: 'Community decision',
          options: ['Reject', 'Approve'],
        }),
      },
    ],
    votes: [],
    projects: [],
    milestones: [],
    schedules: [],
    controls: [],
    executions: [],
    entries: [],
  });
  const governance = GovernanceStateSchema.parse({
    dao,
    policy: savedPolicy
      ? { dao_id: '1', revision: '1', config: governanceSettings(defaultDaoSetup(), 'decide') }
      : null,
    actors: [],
    sessions: [],
    guardian: null,
    budget: null,
  });
  const content = DaoContentSchema.parse({
    dao,
    members: [],
    keyGrants: [],
    epochs: [],
    documents: [
      {
        id: '11',
        document_id: '42',
        version: 1,
        author: '1',
        cid: '',
        metadata: JSON.stringify({ title: 'Council rules' }),
        commitment: 'aa'.repeat(32),
        bytes: 32,
        envelope_version: 0,
        key_epoch: '0',
      },
      {
        id: '12',
        document_id: '42',
        version: 2,
        author: '1',
        cid: '',
        metadata: JSON.stringify({ title: 'Council rules' }),
        commitment: 'bb'.repeat(32),
        bytes: 32,
        envelope_version: 0,
        key_epoch: '0',
      },
      {
        id: '13',
        document_id: '43',
        version: 1,
        author: '1',
        cid: '',
        metadata: JSON.stringify({ title: 'Private title must stay hidden' }),
        commitment: 'cc'.repeat(32),
        bytes: 32,
        envelope_version: 1,
        key_epoch: '1',
      },
    ],
  });
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/network') return route.fulfill({ json: network });
    if (path === '/v1/daos') return route.fulfill({ json: { daos: [summary], next: null } });
    if (path === '/v1/sign-in/session') return route.fulfill({ json: { account } });
    if (path === '/v1/me/memberships')
      return route.fulfill({ json: { memberships: visitor ? [] : [member] } });
    if (path === '/v1/daos/1/content') return route.fulfill({ json: content });
    if (path === '/v1/daos/1/modules') return route.fulfill({ json: modules });
    if (path === '/v1/daos/1/governance') return route.fulfill({ json: governance });
    if (path === '/v1/daos/1/treasury')
      return route.fulfill({ json: TreasurySchema.parse({ dao, obligations: [], evidence: [] }) });
    if (path === '/v1/hub/directory')
      return route.fulfill({ json: { entries: [], next: null, skipped: 0 } });
    return route.fulfill({
      status: 404,
      json: { code: 'NOT_FOUND', message: 'Fixture route unavailable.' },
    });
  });
  return { account, member, modules, content, dao, governance };
}
