import { expect, it } from 'vitest';
import { accountDestination } from '../../src/auth/destination';
it('keeps the intended local action without accepting external or account-loop destinations', () => {
  expect(accountDestination('/dao/7/documents?epoch=2')).toBe('/dao/7/documents?epoch=2');
  expect(accountDestination('/create?order=example')).toBe('/create?order=example');
  for (const value of [
    'https://example.test',
    '//example.test',
    '/\\example.test',
    '/account?returnTo=/account',
    '/\nexample.test',
    undefined,
  ])
    expect(accountDestination(value)).toBeUndefined();
});
