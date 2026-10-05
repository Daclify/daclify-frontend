<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  formatUnits,
  type DaoSummary,
  type UserMembership,
  type Treasury,
} from '@daclify/core-protocol';
import { encodeAction, makeInstruction } from '@daclify/core-protocol/sdk';
import { api, friendlyError } from '../api/client';
import { vaultUnlocked, relayInstruction } from '../auth/session';
import { prepareExit } from '../content/treasury';
import { useWorkspace } from '../state/workspace';
const props = defineProps<{ dao: DaoSummary; member: UserMembership | undefined }>();
const workspace = useWorkspace();
const records = ref<Treasury>();
const error = ref('');
const notice = ref('');
const busy = ref(false);
const destination = ref(props.member?.nativeAccount ?? '');
const amount = ref('');
const kind = ref<'withdraw' | 'unstake'>('withdraw');
const now = ref(Math.floor(Date.now() / 1000));
const timer = setInterval(() => {
  now.value = Math.floor(Date.now() / 1000);
}, 1000);
onBeforeUnmount(() => clearInterval(timer));
function units(value: string) {
  return formatUnits(BigInt(value), props.dao.token.precision);
}
async function load() {
  try {
    records.value = await api.treasury(props.dao.reference.daoId);
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
onMounted(load);
watch(
  () => props.dao.reference.daoId,
  () => {
    records.value = undefined;
    error.value = '';
    notice.value = '';
    void load();
  },
);
async function settle(source: string, sourceId: string) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const result = await api.settle({ dao: props.dao.reference, source, sourceId });
    await workspace.refresh();
    await load();
    notice.value =
      result.state === 'already-settled' ? 'Payment was already settled.' : 'Payment settled.';
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function exit() {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await workspace.refresh();
    const member = workspace.memberships.find(
      (row) =>
        row.dao.chainId === props.dao.reference.chainId &&
        row.dao.contract === props.dao.reference.contract &&
        row.dao.daoId === props.dao.reference.daoId,
    );
    if (!member) throw new Error('MEMBER_REQUIRED');
    const data = prepareExit(props.dao, member, kind.value, destination.value, amount.value);
    await relayInstruction(
      makeInstruction(
        props.dao.reference,
        member.memberId,
        member.nonce,
        Math.floor(Date.now() / 1000) + 300,
        props.dao.reference.contract,
        kind.value,
        encodeAction(kind.value, data),
      ),
    );
    await workspace.refresh();
    await load();
    notice.value = kind.value === 'withdraw' ? 'Claim withdrawn.' : 'Stake withdrawn.';
    amount.value = '';
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="section-toolbar">
    <h2>Treasury</h2>
    <RouterLink to="/docs/treasury">Funding &amp; exit rights ↗</RouterLink>
  </div>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <p v-if="notice" class="notice" role="status">{{ notice }}</p>
  <div class="stats-grid">
    <article class="stat-card">
      <span>Available</span><strong>{{ units(dao.available) }}</strong
      ><small>{{ dao.token.symbol }} · spendable balance</small>
    </article>
    <article class="stat-card">
      <span>Reserved</span><strong>{{ units(dao.reserved) }}</strong
      ><small>Backing pending and approved obligations</small>
    </article>
    <article class="stat-card">
      <span>Internal claims</span><strong>{{ units(dao.claims) }}</strong
      ><small>Backed payments awaiting withdrawal</small>
    </article>
  </div>
  <section class="panel">
    <h3>Deposit native tokens</h3>
    <p>
      Send {{ dao.token.symbol }} from the <code>{{ dao.token.contract }}</code> token contract to
      <code>{{ dao.reference.contract }}</code
      >, using memo <code>dao:{{ dao.reference.daoId }}</code
      >.
    </p>
    <p v-if="member?.nativeAccount">
      Governance stake must be deposited from your linked account
      <code>{{ member.nativeAccount }}</code> with memo
      <code>stake:{{ dao.reference.daoId }}:{{ member.memberId }}</code
      >. Active ballots temporarily freeze stake changes.
    </p>
    <p v-else class="field-help">
      A linked native account is currently required to deposit governance stake. Internal governance
      credits remain available to walletless members.
    </p>
  </section>
  <section v-if="member" class="panel narrow">
    <h3>Your backed balances</h3>
    <p>
      Claim: {{ units(member.claim) }} {{ dao.token.symbol }} · Governance stake:
      {{ units(member.stake) }} {{ dao.token.symbol }}
    </p>
    <p class="field-help">
      Existing claims and stake exits remain available after offboarding or module removal. Stake
      withdrawals wait for active ballot locks to end.
    </p>
    <form @submit.prevent="exit">
      <label for="exit-kind">Balance to withdraw</label
      ><select id="exit-kind" v-model="kind">
        <option value="withdraw">Payment claim</option>
        <option value="unstake">Governance stake</option></select
      ><label for="exit-destination">Native payout account</label
      ><input
        id="exit-destination"
        v-model="destination"
        required
        maxlength="13"
        spellcheck="false"
      /><label for="exit-amount">Withdrawal amount ({{ dao.token.symbol }})</label
      ><input id="exit-amount" v-model="amount" inputmode="decimal" required /><button
        :disabled="
          busy || !vaultUnlocked || (kind === 'withdraw' ? member.claim : member.stake) === '0'
        "
      >
        Sign withdrawal
      </button>
    </form>
  </section>
  <h3>Payment obligations</h3>
  <p v-if="records && !records.obligations.length" class="muted">
    No payment obligations recorded.
  </p>
  <div class="dao-grid">
    <article v-for="record in records?.obligations" :key="record.id" class="panel">
      <h4>{{ record.quantity }} · member {{ record.recipient }}</h4>
      <p>
        {{ ['Reserved', 'Approved', 'Settled', 'Cancelled'][record.status] ?? 'Unknown state' }} ·
        {{ record.source }} / {{ record.source_id }}
      </p>
      <p>
        {{
          record.due ? 'Due ' + new Date(record.due * 1000).toLocaleString() : 'No scheduled delay'
        }}
      </p>
      <button
        v-if="record.status === 1 && record.due <= now"
        :disabled="busy || !workspace.account"
        @click="settle(record.source, record.source_id)"
      >
        Settle payment {{ record.id }}
      </button>
      <p v-if="record.status === 1" class="field-help">
        Settlement delivers to the recipient’s linked native account or their internal claim. It
        does not change the recipient or amount.
      </p>
    </article>
  </div>
</template>
