import { expect, it } from 'vitest';
import { appSignInMethod, appJoinDestination } from '../../src/auth/app-entry';
const network = { chainId: 'a'.repeat(64), runtime: 'fixturecore' };
const fragment = `#daclify_method=email&daclify_chain=${'a'.repeat(64)}&daclify_runtime=fixturecore&daclify_dao=18446744073709551615`;
it('uses only the three requested sign-in preferences', () => {
  for (const method of ['email', 'telegram', 'passkey'])
    expect(appSignInMethod(method)).toBe(method);
  for (const value of ['password', '<script>', 'email,email', undefined, ['email']])
    expect(appSignInMethod(value)).toBeUndefined();
});
it('offers membership entry only in the matching full DAO namespace', () => {
  expect(appJoinDestination(fragment, network)).toBe('/dao/18446744073709551615/members');
  for (const hash of [
    fragment.replace('18446744073709551615', '18446744073709551616'),
    fragment.replace('fixturecore', 'otherruntime'),
    fragment.replace('a'.repeat(64), 'b'.repeat(64)),
    fragment + '&daclify_dao=3',
    '#daclify_dao=3',
  ])
    expect(appJoinDestination(hash, network)).toBeUndefined();
  expect(appJoinDestination(fragment, undefined)).toBeUndefined();
});
