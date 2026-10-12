import { expect, it } from 'vitest';
import { friendlyError, ApiFailure } from '../../src/api/client';
it('explains the difference between recovering wallet access and recovering decryption keys', () => {
  expect(friendlyError(new ApiFailure('VAULT_IDENTITY_REQUIRED'))).toBe(
    'Set up or restore your Daclify keys before creating a DAO. Wallet recovery alone does not restore document decryption keys.',
  );
  expect(friendlyError(new ApiFailure('LAST_CONTROL_CREDENTIAL'))).toBe(
    'Pair another blockchain wallet before removing your last account-control method.',
  );
  expect(friendlyError(new ApiFailure('VAULT_ALREADY_REGISTERED'))).toBe(
    'Your original account was found. Restore that account to continue with these keys.',
  );
});

it.each(['NATIVE_LINKED', 'CREDENTIAL_LINKED'])(
  'explains how to reconnect a previously paired %s method',
  (code) => {
    const message = friendlyError(new ApiFailure(code));
    expect(message).toContain('Reconnect existing sign-ins');
    expect(message).toContain('Telos Zero');
  },
);
