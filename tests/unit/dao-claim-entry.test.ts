import { expect, it } from 'vitest';
import {
  accountEntryDestination,
  saveClaimDestination,
  takeClaimDestination,
} from '../../src/auth/dao-claim-entry';
const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
};
it('keeps claim secrets out of shared portal account links', () => {
  const tab = storage(),
    token = 'c'.repeat(43);
  const destination = accountEntryDestination('/claim-dao#' + token, tab, 'https://api.example/');
  expect(destination.includes(token)).toBe(false);
  expect(destination.startsWith('/claim-dao?resume=')).toBe(true);
  expect(accountEntryDestination('/create?order=example', tab, 'https://api.example/')).toBe(
    '/create?order=example',
  );
});
it('passes only an opaque checkpoint through account entry and consumes the secret once', () => {
  const tab = storage(),
    secret = 'a'.repeat(43);
  const path = saveClaimDestination(tab, secret, 'https://api.example/', 1000);
  expect(path).not.toContain(secret);
  const checkpoint = new URL(path, 'https://app.example').searchParams.get('resume');
  expect(takeClaimDestination(tab, checkpoint, 'https://api.example/', 1001)).toBe(secret);
  expect(takeClaimDestination(tab, checkpoint, 'https://api.example/', 1002)).toBeUndefined();
});
it('rejects expired, malformed and different-API checkpoints', () => {
  for (const [scope, now] of [
    ['https://foreign.example/', 1001],
    ['https://api.example/', 3601000],
  ] as const) {
    const tab = storage(),
      path = saveClaimDestination(tab, 'b'.repeat(43), 'https://api.example/', 1000);
    const checkpoint = new URL(path, 'https://app.example').searchParams.get('resume');
    expect(takeClaimDestination(tab, checkpoint, scope, now)).toBeUndefined();
  }
  expect(() => saveClaimDestination(storage(), 'invalid', 'https://api.example/')).toThrow();
});
