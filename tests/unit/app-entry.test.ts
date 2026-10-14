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

import { appInvitation } from '../../src/auth/app-entry';
it('keeps private invitation material in the fragment and rejects duplicates or partial hints', () => {
 const token='a'.repeat(43);
 expect(appInvitation('#daclify_invitation=7&daclify_token='+token)).toEqual({invitationId:'7',token});
 expect(appInvitation('#daclify_method=email')).toBeUndefined();
 for(const fragment of ['#daclify_invitation=7','#daclify_invitation=0&daclify_token='+token,'#daclify_invitation=7&daclify_token='+token+'&daclify_token='+token]) expect(()=>appInvitation(fragment)).toThrow('APP_INVITE_DOMAIN');
});
