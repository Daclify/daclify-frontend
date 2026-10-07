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
    'These keys belong to an existing service account. Sign out and sign in with that vault; accounts are not merged automatically.',
  );
});
