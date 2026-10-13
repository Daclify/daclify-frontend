import { ref, watch } from 'vue';
import { z } from 'zod';
import { useWorkspace } from '../state/workspace';
import { resolveApiUrl } from '../api/networks';
import { selectedSigner } from './action-signer';

const PreferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('vault') }),
  z.strictObject({ kind: z.literal('native'), wallet: z.string().regex(/^[a-z1-5.]{1,12}$/) }),
  z.strictObject({ kind: z.literal('evm'), wallet: z.string().regex(/^0x[0-9a-f]{40}$/) }),
]);
export type ApprovalPreference = z.infer<typeof PreferenceSchema>;
export const preferredApproval = ref<ApprovalPreference>();
export function restorePreferredSigner(): void {
  selectedSigner.value = preferredApproval.value?.kind ?? 'vault';
}
function storageKey() {
  const state = useWorkspace();
  if (!state.account || !state.network) return;
  return (
    'daclify.approval.' +
    JSON.stringify([
      resolveApiUrl('/'),
      state.account.id,
      state.network.chainId,
      state.network.runtime,
    ])
  );
}
export function saveApprovalPreference(preference: ApprovalPreference): void {
  const key = storageKey();
  if (!key) throw new Error('AUTH_REQUIRED');
  const value = PreferenceSchema.parse(preference);
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* The choice still works for this session when storage is blocked. */
  }
  preferredApproval.value = value;
  selectedSigner.value = value.kind;
}
export function startApprovalPreferences(): () => void {
  return watch(
    storageKey,
    (key) => {
      preferredApproval.value = undefined;
      if (key) {
        try {
          const parsed = PreferenceSchema.safeParse(
            JSON.parse(localStorage.getItem(key) ?? 'null'),
          );
          if (parsed.success) preferredApproval.value = parsed.data;
        } catch {
          /* Invalid preferences do not affect account authority. */
        }
      }
      selectedSigner.value = preferredApproval.value?.kind ?? 'vault';
    },
    { immediate: true, flush: 'sync' },
  );
}
