import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Account, DaoSummary, Network, UserMembership } from '@daclify/core-protocol';
import { api, ApiFailure, friendlyError } from '../api/client';

export const useWorkspace = defineStore('workspace', () => {
  const network = ref<Network>();
  const daos = ref<DaoSummary[]>([]);
  const memberships = ref<UserMembership[]>([]);
  const account = ref<Account>();
  const loading = ref(false);
  const error = ref('');
  let sequence = 0;
  async function refresh() {
    const current = ++sequence;
    loading.value = true;
    error.value = '';
    network.value = undefined;
    memberships.value = [];
    try {
      const [info, summaries] = await Promise.all([api.network(), api.daos()]);
      if (current !== sequence) return;
      network.value = info;
      daos.value = summaries;
      try {
        const identity = await api.me();
        if (current !== sequence) return;
        account.value = identity;
        const memberRecords = await api.memberships();
        if (current !== sequence) return;
        memberships.value = memberRecords;
      } catch (cause) {
        if (current !== sequence) return;
        memberships.value = [];
        if (cause instanceof ApiFailure && cause.code === 'AUTH_REQUIRED')
          account.value = undefined;
        else throw cause;
      }
    } catch (cause) {
      if (current === sequence) {
        if (!network.value) daos.value = [];
        error.value = friendlyError(cause);
      }
    } finally {
      if (current === sequence) loading.value = false;
    }
  }
  return { network, daos, memberships, account, loading, error, refresh };
});
