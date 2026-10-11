import { expect, it, vi } from 'vitest';
import { PeopleRoutes, PublicMemberSchema } from '@daclify/core-protocol';
import {
  loadPublicMemberBatch,
  profileContacts,
  activityText,
} from '../../src/state/public-people';
const page = (dao: string, next: { daoId: string; after: string } | null) =>
  PeopleRoutes.members.response.parse({
    members: [
      PublicMemberSchema.parse({
        dao: { chainId: 'ab'.repeat(32), contract: 'daclifycore', daoId: dao, interfaceVersion: 1 },
        id: '1',
        native_account: 'alice',
        active: true,
        profile: null,
      }),
    ],
    next,
  });
it('automatically reads successive DAOs and exposes progressive pages', async () => {
  const load = vi
    .fn()
    .mockResolvedValueOnce(page('1', { daoId: '4', after: '0' }))
    .mockResolvedValueOnce(page('4', null));
  const append = vi.fn();
  await loadPublicMemberBatch(load, append);
  expect(load.mock.calls).toEqual([[undefined], [{ daoId: '4', after: '0' }]]);
  expect(append).toHaveBeenCalledTimes(2);
  expect(append.mock.calls[1]?.[0].next).toBeNull();
});
it('bounds a batch at 20 requests while preserving a continuation', async () => {
  let dao = 0;
  const load = vi.fn(async () => page(String(++dao), { daoId: String(dao + 1), after: '0' }));
  const append = vi.fn();
  await loadPublicMemberBatch(load, append);
  expect(load).toHaveBeenCalledTimes(20);
  expect(append.mock.calls[19]?.[0].next).toEqual({ daoId: '21', after: '0' });
});
it('rejects non-advancing or backwards cursors without committing the invalid page', async () => {
  for (const next of [
    { daoId: '4', after: '2' },
    { daoId: '3', after: '0' },
  ]) {
    const append = vi.fn();
    await expect(
      loadPublicMemberBatch(async () => page('4', next), append, { daoId: '4', after: '2' }),
    ).rejects.toThrow('CHAIN_RESPONSE_INVALID');
    expect(append).not.toHaveBeenCalled();
  }
});
it('keeps committed pages when a later request fails and permits retrying its cursor', async () => {
  const load = vi
    .fn()
    .mockResolvedValueOnce(page('1', { daoId: '4', after: '0' }))
    .mockRejectedValueOnce(new Error('Unavailable'));
  const append = vi.fn();
  await expect(loadPublicMemberBatch(load, append)).rejects.toThrow('Unavailable');
  expect(append).toHaveBeenCalledTimes(1);
  await loadPublicMemberBatch(async () => page('4', null), append, { daoId: '4', after: '0' });
  expect(append).toHaveBeenCalledTimes(2);
});
it('ignores responses after the selected deployment changes', async () => {
  let current = true;
  const append = vi.fn();
  await loadPublicMemberBatch(
    async () => {
      current = false;
      return page('1', null);
    },
    append,
    null,
    () => current,
  );
  expect(append).not.toHaveBeenCalled();
});
it('uses only published contact fields and gives malformed values no executable link', () => {
  const contacts = profileContacts({
    name: 'alice',
    email: 'alice@example.org',
    telegram: '@alice12',
    website: 'https://example.org',
    facebook: 'https://facebook.com/alice',
  });
  expect(contacts.map((c) => c.href)).toEqual([
    'mailto:alice%40example.org',
    'https://t.me/alice12',
    'https://example.org',
    'https://facebook.com/alice',
  ]);
  expect(
    profileContacts({
      name: 'alice',
      email: 'x\nBcc: victim@example.org',
      telegram: 'javascript:alert(1)',
      website: 'javascript:alert(1)',
    }).every((c) => !c.href),
  ).toBe(true);
});
it('uses actual DAO activity and keeps unknown history explicit', () => {
  expect(activityText(null, 1_800_000_000)).toBe('DAO activity not recorded');
  expect(activityText(1_799_999_400, 1_800_000_000)).toBe('Last DAO action 10 minutes ago');
  expect(activityText(1_800_000_030, 1_800_000_000)).toBe('Last DAO action just now');
});
