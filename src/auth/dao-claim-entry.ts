import { z } from 'zod';
import { DaoClaimTokenSchema } from '@daclify/core-protocol';
const key = 'daclify.dao-claim-entry';
const privateFragment = z.string().regex(/^v2:[A-Za-z0-9_-]{43}:[A-Za-z0-9_-]{43}$/);
export function parseClaimFragment(value: string) {
  const legacy = DaoClaimTokenSchema.safeParse(value);
  if (legacy.success) return { token: legacy.data, contentKey: undefined };
  const parts = privateFragment.parse(value).split(':');
  return { token: DaoClaimTokenSchema.parse(parts[1]), contentKey: parts[2] };
}
let privateEntry:
  { checkpoint: string; contentKey: string; scope: string; expires: number } | undefined;
const RecordSchema = z.strictObject({
  checkpoint: z.uuid(),
  token: DaoClaimTokenSchema,
  scope: z.string(),
  expires: z.number().int(),
  sealed: z.boolean().optional(),
});
type TabStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function saveClaimDestination(
  tab: TabStorage,
  token: string,
  scope: string,
  now = Date.now(),
) {
  const secret = parseClaimFragment(token);
  const record = RecordSchema.parse({
    checkpoint: crypto.randomUUID(),
    token: secret.token,
    scope,
    expires: now + 3600000,
    ...(secret.contentKey ? { sealed: true } : {}),
  });
  tab.setItem(key, JSON.stringify(record));
  privateEntry = secret.contentKey
    ? {
        checkpoint: record.checkpoint,
        contentKey: secret.contentKey,
        scope,
        expires: record.expires,
      }
    : undefined;
  return '/claim-dao?resume=' + record.checkpoint;
}
export function accountEntryDestination(value: string, tab: TabStorage, scope: string) {
  const url = new URL(value, 'https://daclify.invalid');
  if (url.pathname !== '/claim-dao' || !url.hash) return value;
  try {
    parseClaimFragment(url.hash.slice(1));
  } catch {
    return '/claim-dao';
  }
  return saveClaimDestination(tab, url.hash.slice(1), scope);
}
export function takeClaimDestination(
  tab: TabStorage,
  checkpoint: unknown,
  scope: string,
  now = Date.now(),
): string | undefined {
  const value = tab.getItem(key);
  if (!value) return;
  try {
    const record = RecordSchema.parse(JSON.parse(value));
    if (record.checkpoint !== checkpoint) return;
    tab.removeItem(key);
    if (record.scope === scope && record.expires > now) {
      if (!record.sealed) return record.token;
      const opened = privateEntry;
      privateEntry = undefined;
      if (opened?.checkpoint === checkpoint && opened.scope === scope && opened.expires > now)
        return `v2:${record.token}:${opened.contentKey}`;
    }
  } catch {
    tab.removeItem(key);
  }
}
