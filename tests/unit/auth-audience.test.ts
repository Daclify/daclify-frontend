import { expect, it } from 'vitest';
import { PrivateKey } from '@wharfkit/antelope';
import { validateAuthChallenge } from '../../src/auth/audience';
const origin = 'https://app.example',
  audience = 'https://api.example',
  id = '00000000-0000-4000-8000-000000000001',
  expires = new Date(Date.now() + 300000).toISOString(),
  key = PrivateKey.generate('K1').toPublic().toString();
it('rejects signing a login challenge issued for another API or key', () => {
  const message = {
    domain: 'daclify.login.v2',
    origin,
    audience,
    challenge: id,
    signingKey: key,
    expires,
  };
  const body = { id, expires, message: JSON.stringify(message) };
  expect(() =>
    validateAuthChallenge('/v1/auth/challenge', body, { signingKey: key }, origin, audience),
  ).not.toThrow();
  expect(() =>
    validateAuthChallenge(
      '/v1/auth/challenge',
      body,
      { signingKey: key },
      origin,
      'https://other.example',
    ),
  ).toThrow('AUTH_AUDIENCE');
  expect(() =>
    validateAuthChallenge(
      '/v1/auth/challenge',
      {
        ...body,
        message: JSON.stringify({
          ...message,
          signingKey: PrivateKey.generate('K1').toPublic().toString(),
        }),
      },
      { signingKey: key },
      origin,
      audience,
    ),
  ).toThrow();
});
it('binds a control proof to its API, exact path, body and expiry', () => {
  const request = { path: '/v1/hosting/change', bodyHash: 'ab'.repeat(32) };
  const message = {
    ...request,
    domain: 'daclify.account-control.v2',
    origin,
    audience,
    accountId: id,
    signingKey: key,
    challengeId: id,
    expires,
  };
  const body = { id, expires, message: JSON.stringify(message) };
  expect(() =>
    validateAuthChallenge('/v1/account/control', body, request, origin, audience),
  ).not.toThrow();
  expect(() =>
    validateAuthChallenge(
      '/v1/account/control',
      body,
      { ...request, bodyHash: 'cd'.repeat(32) },
      origin,
      audience,
    ),
  ).toThrow();
  expect(() =>
    validateAuthChallenge(
      '/v1/account/control',
      body,
      request,
      origin,
      audience,
      Date.parse(expires) + 1,
    ),
  ).toThrow();
});
