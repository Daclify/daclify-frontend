import { describe, expect, it } from 'vitest';
import { MiniAppConnectionSchema, type DaoSummary } from '@daclify/core-protocol';
import { connectionJson, connectionMember } from '../../src/mini-apps/connection';
import { DaoSummarySchema, UserMembershipSchema } from '@daclify/core-protocol';
const reference = {
  chainId: 'ab'.repeat(32),
  contract: 'daclifycore',
  daoId: '1',
  interfaceVersion: 1 as const,
};
const dao: DaoSummary = DaoSummarySchema.parse({
  reference,
  title: 'Garden',
  description: '',
  privacy: 'public',
  owner: 'alice',
  token: { chainId: reference.chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
  members: 1,
  available: '0',
  reserved: '0',
  claims: '0',
  keyEpoch: '0',
});
const member = UserMembershipSchema.parse({
  dao: reference,
  memberId: '1',
  nonce: '0',
  active: true,
  admin: false,
  reviewer: false,
  credits: '0',
  claim: '0',
  stake: '0',
  nativeAccount: '',
  custody: 'user-controlled',
});
const bundle = MiniAppConnectionSchema.parse({
  version: 1,
  binding: {
    schemaVersion: 1,
    chainId: reference.chainId,
    runtime: reference.contract,
    daoId: '1',
    appId: '7',
    issuer: 'https://api.example',
    clientId: '11111111-1111-4111-8111-111111111111',
  },
  callbackUrl: 'https://garden.example/login/callback',
  frontendOrigin: 'https://daclify.example',
  activityAccount: 'activity',
  releaseId: 'cd'.repeat(32),
  coreVersion: '0.14.0-alpha.9',
  modulesVersion: '0.10.0-alpha.7',
  manifestHash: 'ef'.repeat(32),
  starterUrl: 'https://api.example/v1/mini-apps/releases/' + 'cd'.repeat(32),
  diagnostics: {
    version: 1,
    checks: ['configuration', 'readiness', 'identity', 'event'].map((stage) => ({
      stage,
      status: stage === 'configuration' ? 'passed' : 'not-run',
      codes: [],
    })),
  },
});
const registered = {
  clientId: bundle.binding.clientId,
  config: { redirectUris: [bundle.callbackUrl] },
};
describe('mini app connection context', () => {
  it('selects only an active membership in the complete deployment', () => {
    expect(
      connectionMember(dao, [{ ...member, dao: { ...reference, chainId: '12'.repeat(32) } }]),
    ).toBeUndefined();
    expect(connectionMember(dao, [{ ...member, active: false }])).toBeUndefined();
    expect(connectionMember(dao, [member])).toEqual(member);
  });
  it('exports the exact verified callback and keeps login/event untested', () => {
    const output = JSON.parse(connectionJson(bundle, dao, '7', registered));
    expect(output.callbackUrl).toBe('https://garden.example/login/callback');
    expect(
      output.diagnostics.checks.filter((check: { status: string }) => check.status === 'passed'),
    ).toHaveLength(1);
  });
  it('refuses a connection returned for another app or full DAO', () => {
    expect(() => connectionJson(bundle, dao, '8', registered)).toThrow('APP_BINDING');
    expect(() =>
      connectionJson(
        bundle,
        { ...dao, reference: { ...reference, contract: 'otherdao' } },
        '7',
        registered,
      ),
    ).toThrow('APP_BINDING');
  });
});

import { ApiFailure, friendlyError } from '../../src/api/client';
it('explains an expired consent and unavailable release with a recovery action', () => {
  expect(friendlyError(new ApiFailure('APP_REQUEST_EXPIRED'))).toContain('sign in again');
  expect(friendlyError(new ApiFailure('MINI_APP_RELEASE_UNAVAILABLE'))).toContain('deployment');
});

it('refuses configuration for a different client or unregistered callback', () => {
  const app = { clientId: bundle.binding.clientId, config: { redirectUris: [bundle.callbackUrl] } };
  expect(() =>
    connectionJson(
      {
        ...bundle,
        binding: { ...bundle.binding, clientId: '22222222-2222-4222-8222-222222222222' },
      },
      dao,
      '7',
      app,
    ),
  ).toThrow('APP_BINDING');
  expect(() =>
    connectionJson({ ...bundle, callbackUrl: 'https://other.example/callback' }, dao, '7', app),
  ).toThrow('APP_CALLBACK');
});
