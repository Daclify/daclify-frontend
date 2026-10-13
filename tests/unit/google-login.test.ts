import { afterEach, expect, it, vi } from 'vitest';
import { mountGoogleButton } from '../../src/auth/google-login';
import { z } from 'zod';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('accepts a bounded Google credential with its fresh nonce and ignores callbacks after dismissal', () => {
  let loaded: (() => void) | null = null,
    callback: ((response: unknown) => void) | undefined,
    nonce = '';
  const script = {
    src: '',
    async: false,
    set onload(value: (() => void) | null) {
      loaded = value;
    },
    onerror: null,
    remove: () => {},
  };
  const host = { clientWidth: 280, replaceChildren: () => {} };
  vi.stubGlobal('document', {
    createElement: (name: string) => (name === 'script' ? script : host),
    head: { append: () => {} },
  });
  vi.stubGlobal('window', {
    google: {
      accounts: {
        id: {
          initialize: (options: { nonce: string; callback: (response: unknown) => void }) => {
            nonce = options.nonce;
            callback = options.callback;
          },
          renderButton: () => {},
        },
      },
    },
  });
  const proofs: Array<{ credential: string; nonce: string }> = [],
    errors: unknown[] = [];
  const dispose = mountGoogleButton(
    document.createElement('div'),
    'owned-client',
    (credential, nonce) => proofs.push({ credential, nonce }),
    (cause) => errors.push(cause),
  );
  expect(script.src).toBe('https://accounts.google.com/gsi/client');
  if (!loaded) throw Error('Google load handler missing');
  const load = z.custom<() => void>((value) => typeof value === 'function').parse(loaded);
  load();
  expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
  callback?.({ credential: 'owned-signed-proof' });
  expect(proofs).toEqual([{ credential: 'owned-signed-proof', nonce }]);
  callback?.({ credential: 'x'.repeat(16385) });
  expect(errors).toHaveLength(1);
  dispose();
  callback?.({ credential: 'ignored-after-close' });
  expect(proofs).toHaveLength(1);
});
