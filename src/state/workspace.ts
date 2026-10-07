import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { Account, DaoSummary, Network, UserMembership } from '@daclify/core-protocol';
import { api, ApiFailure, friendlyError } from '../api/client';

export const useWorkspace = defineStore('workspace', () => {
  const network = ref<Network>();
  const daos = ref<DaoSummary[]>([]);
  const memberships = ref<UserMembership[]>([]);
  const account = ref<Account>();
  const loading = ref(false);
  const error = ref('');
  let accountRevision = 0;
  watch(
    () => account.value?.id,
    () => {
      accountRevision++;
      memberships.value = [];
    },
    { flush: 'sync' },
  );
  let sequence = 0;
  async function refresh() {
    const current = ++sequence;
    let identityRevision = accountRevision;
    const stale = () => current !== sequence || identityRevision !== accountRevision;
    loading.value = true;
    error.value = '';
    let networkRead = false;
    try {
      const [info, summaries] = await Promise.all([api.network(), api.daos()]);
      if (stale()) return;
      if (
        network.value &&
        (network.value.chainId !== info.chainId || network.value.runtime !== info.runtime)
      )
        memberships.value = [];
      networkRead = true;
      network.value = info;
      daos.value = summaries;
      try {
        const identity = await api.me();
        if (stale()) return;
        account.value = identity;
        identityRevision = accountRevision;
        const memberRecords = await api.memberships();
        if (stale()) return;
        memberships.value = memberRecords;
      } catch (cause) {
        if (stale()) return;
        memberships.value = [];
        if (cause instanceof ApiFailure && cause.code === 'AUTH_REQUIRED')
          account.value = undefined;
        else throw cause;
      }
    } catch (cause) {
      if (!stale()) {
        if (!networkRead) {
          network.value = undefined;
          daos.value = [];
          memberships.value = [];
        }
        error.value = friendlyError(cause);
      }
    } finally {
      if (current === sequence) loading.value = false;
    }
  }
  return { network, daos, memberships, account, loading, error, refresh };
});
