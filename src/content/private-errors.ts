import { friendlyError } from '../api/client';
const messages: Readonly<Record<string, string>> = {
  PRIVATE_EPOCH_CHANGED:
    'The DAO’s encryption keys changed. Review your original grants and use Reprepare before signing this unfinished record.',
  PRIVATE_RECORD_ALREADY_LINKED:
    'This record is already confirmed. Refresh it to review its original signed details.',
};
export function privateContentError(cause: unknown): string {
  return (cause instanceof Error ? messages[cause.message] : undefined) ?? friendlyError(cause);
}
