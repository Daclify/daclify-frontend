import { z } from 'zod';
import { DaoClaimTokenSchema } from '@daclify/core-protocol';
const key = 'daclify.dao-claim-entry';
const RecordSchema = z.strictObject({
  checkpoint: z.uuid(),
  token: DaoClaimTokenSchema,
  scope: z.string(),
  expires: z.number().int(),
});
type TabStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function saveClaimDestination(
  tab: TabStorage,
  token: string,
  scope: string,
  now = Date.now(),
) {
  const record = RecordSchema.parse({
    checkpoint: crypto.randomUUID(),
    token,
    scope,
    expires: now + 3600000,
  });
  tab.setItem(key, JSON.stringify(record));
  return '/claim-dao?resume=' + record.checkpoint;
}
export function accountEntryDestination(value: string, tab: TabStorage, scope: string) {
  const url = new URL(value, 'https://daclify.invalid');
  if (url.pathname !== '/claim-dao' || !url.hash) return value;
  const token = DaoClaimTokenSchema.safeParse(url.hash.slice(1));
  return token.success ? saveClaimDestination(tab, token.data, scope) : '/claim-dao';
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
    if (record.scope === scope && record.expires > now) return record.token;
  } catch {
    tab.removeItem(key);
  }
}
