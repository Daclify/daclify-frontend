import { afterEach, expect, it, vi } from 'vitest';
import { newDocumentId } from '../../src/content/document-identity';

afterEach(() => vi.restoreAllMocks());

it('generates a bounded positive identity and retries collisions with loaded versions', () => {
  let attempt = 0;
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
    if (array instanceof Uint32Array) array.set([0, ++attempt === 1 ? 42 : 43]);
    return array;
  });
  expect(newDocumentId([{ document_id: '42' }])).toBe('43');
});

it('refuses zero or persistent collisions instead of replacing an existing document', () => {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
    if (array instanceof Uint32Array) array.fill(0);
    return array;
  });
  expect(() => newDocumentId([])).toThrow('DOCUMENT_ID_UNAVAILABLE');
});

it('preserves full uint64 precision when generating an identity', () => {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
    if (array instanceof Uint32Array) array.fill(0xffffffff);
    return array;
  });
  expect(newDocumentId([])).toBe('18446744073709551615');
});
