import { describe, expect, it } from 'vitest';
import { ApiFailure, friendlyError } from '../../src/api/client';

const serviceMessages: Record<string, string> = {
  AUTH_REQUIRED: 'Sign in to continue.',
  AUTH_INVALID: 'The login proof expired or was already used. Try again.',
  KEY_CHANGE_REQUIRED:
    'This account uses a different encryption key. Use its original recovery kit.',
  CSRF_REQUIRED: 'Refresh your session by signing in again.',
  CHAIN_ACTION_REJECTED:
    'The contract rejected the action. Refresh the DAO and check your permissions.',
  CHAIN_UNAVAILABLE: 'The blockchain node is unavailable. Try again later.',
  CUSTODY_POLICY: 'This DAO requires user-controlled keys.',
  RESULT_LIMIT:
    'This deployment exceeds the current read limit. Configure an indexed read service.',
  STORAGE_UNCONFIGURED: 'Hosted storage is not configured on this service.',
  STORAGE_QUOTA: 'The DAO storage allowance is full. Existing documents remain available.',
  UPLOAD_PENDING:
    'Upload completion is uncertain. Keep the request ID and check completion before starting another upload.',
  UPLOAD_REQUEST_CONFLICT:
    'This request ID belongs to different file data. Resume its original upload.',
  UPLOAD_UNKNOWN: 'No upload record was found for this request and account.',
  UPLOAD_FAILED: 'This upload requires operator review.',
  MEMBER_REQUIRED: 'An active DAO membership is required for this action.',
  DOCUMENT_VERSION:
    'This document version is already in use. Refresh the DAO before preparing another version.',
};

const localMessages: Record<string, string> = {
  VAULT_LOCKED: 'Unlock your vault to use your keys.',
  EPOCH_UNAVAILABLE: 'Ask a DAO administrator for a key grant for this epoch.',
  EPOCH_KEY_MISMATCH:
    'The key grant does not match the DAO epoch. Ask an administrator to resolve it.',
  DOCUMENT_INTEGRITY: 'The document failed its integrity check and was not opened.',
  FILE_EMPTY: 'Choose a file that contains data.',
  FILE_REQUIRED: 'Choose a document file.',
  FILE_TOO_LARGE:
    'The stored file exceeds 5 MiB. Private file encryption and encoding reduce the maximum original size.',
  FILE_METADATA: 'The filename or media type is not supported.',
  UPLOAD_RECEIPT: 'The upload receipt does not match this DAO or file request.',
  PAYROLL_START: 'Choose a future UTC start time and submit before it is due.',
  AMOUNT_REQUIRED: 'Enter a positive token amount.',
  INSUFFICIENT_EXIT_BALANCE: 'The amount exceeds the selected claim or stake balance.',
  PAYOUT_DESTINATION: 'Choose an existing native account other than this runtime.',
  DAO_REFERENCE: 'The account and DAO deployment references do not match.',
};

describe('readable failure copy', () => {
  it('maps known service and local failures and keeps every other failure generic', () => {
    for (const [code, message] of Object.entries(serviceMessages)) {
      expect(friendlyError(new ApiFailure(code))).toBe(message);
    }
    for (const [code, message] of Object.entries(localMessages)) {
      expect(friendlyError(new Error(code))).toBe(message);
    }
    expect(friendlyError(new Error('MEMBER_REQUIRED'))).toBe(
      'An active DAO membership is required for this action.',
    );
    expect(friendlyError(new Error('DOCUMENT_VERSION'))).toBe(
      'This document version is already in use. Refresh before preparing another version.',
    );
    expect(friendlyError(new Error('VAULT_UNLOCK_FAILED'))).toBe(
      'The vault could not be unlocked. Check your password or recovery kit.',
    );
    expect(friendlyError(new Error('SOMETHING_ELSE'))).toBe(
      'The request could not be completed. Check your connection and try again.',
    );
    expect(friendlyError(undefined)).toBe(
      'The request could not be completed. Check your connection and try again.',
    );
  });
});
