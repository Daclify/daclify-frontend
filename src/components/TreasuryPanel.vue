<script setup lang="ts">
import SpendingReportPanel from './SpendingReportPanel.vue';
import WorkspaceDialog from './WorkspaceDialog.vue';
import WorkspaceActions from './WorkspaceActions.vue';
import WorkspaceTabs from './WorkspaceTabs.vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  formatUnits,
  type DaoSummary,
  type UserMembership,
  type Treasury,
} from '@daclify/core-protocol';
import { encodeAction, makeInstruction } from '@daclify/core-protocol/sdk';
import { api, friendlyError } from '../api/client';
import { relayInstruction } from '../auth/session';
import { canSignMember } from '../auth/action-signer';
import {
  connectNative,
  nativeWallet,
  nativeIdentity,
  nativeTokenPreparation,
} from '../auth/telos-zero';
const signerReady = computed(() => canSignMember(props.member));
import { prepareExit, prepareExternalEvidence } from '../content/treasury';
import { useWorkspace } from '../state/workspace';
const props = defineProps<{ dao: DaoSummary; member: UserMembership | undefined }>();
const workspace = useWorkspace();
const section = ref('payments'),
  search = ref(''),
  status = ref('');
const popup = ref(false),
  mode = ref<'deposit' | 'withdrawal' | 'statement'>('deposit');
const statementFor = ref<Treasury['obligations'][number]>();
const names = ref(new Map<string, string>());
const popupTitle = computed(() =>
  mode.value === 'deposit'
    ? 'Deposit tokens'
    : mode.value === 'withdrawal'
      ? 'Withdraw your balance'
      : 'Record external payment statement',
);
const visiblePayments = computed(
  () =>
    records.value?.obligations.filter(
      (row) =>
        (!status.value || String(row.status) === status.value) &&
        [memberName(row.recipient), row.source, row.source_id, row.quantity]
          .join(' ')
          .toLowerCase()
          .includes(search.value.trim().toLowerCase()),
    ) ?? [],
);
function memberName(id: string) {
  return names.value.get(id) ?? `Member ${id}`;
}
function open(modeValue: typeof mode.value, record?: Treasury['obligations'][number]) {
  mode.value = modeValue;
  statementFor.value = record;
  popup.value = true;
}
async function loadNames() {
  const context = JSON.stringify(props.dao.reference),
    found = new Map<string, string>();
  try {
    const content = await api.content(props.dao.reference.daoId);
    if (JSON.stringify(content.dao) !== context) throw new Error('DAO_REFERENCE');
    for (const person of content.members)
      found.set(person.id, person.native_account || `Member ${person.id}`);
    let after: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await api.people({
        daoId: props.dao.reference.daoId,
        ...(after ? { after } : {}),
      });
      for (const person of page.profiles) {
        if (JSON.stringify(person.dao) !== context) throw new Error('DAO_REFERENCE');
        found.set(
          person.memberId,
          person.profile.fullName ||
            person.profile.name ||
            found.get(person.memberId) ||
            `Member ${person.memberId}`,
        );
      }
      after = page.next ?? undefined;
      if (after && seen.has(after)) throw new Error('CHAIN_RESPONSE_INVALID');
      if (after) seen.add(after);
    } while (after && alive && context === JSON.stringify(props.dao.reference));
  } catch {
    /* Payment records remain usable when public profiles are unavailable. */
  }
  if (alive && context === JSON.stringify(props.dao.reference)) names.value = found;
}
const records = ref<Treasury>();
const error = ref('');
const notice = ref('');
const busy = ref(false);
const destination = ref(props.member?.nativeAccount ?? '');
const amount = ref('');
const kind = ref<'withdraw' | 'unstake'>('withdraw');
const draftChain = ref<Record<string, string>>({});
const draftPayer = ref<Record<string, string>>({});
const draftReference = ref<Record<string, string>>({});
const now = ref(Math.floor(Date.now() / 1000));
let readRevision = 0,
  alive = true;
const timer = setInterval(() => {
  now.value = Math.floor(Date.now() / 1000);
}, 1000);
onBeforeUnmount(() => {
  alive = false;
  readRevision++;
  clearInterval(timer);
});
function units(value: string) {
  return formatUnits(BigInt(value), props.dao.token.precision);
}
async function load() {
  const revision = ++readRevision,
    context = JSON.stringify(props.dao.reference);
  try {
    const result = await api.treasury(props.dao.reference.daoId);
    if (revision !== readRevision || context !== JSON.stringify(props.dao.reference)) return;
    if (JSON.stringify(result.dao) !== context) throw new Error('DAO_REFERENCE');
    records.value = result;
  } catch (cause) {
    if (revision !== readRevision || context !== JSON.stringify(props.dao.reference)) return;
    error.value = friendlyError(cause);
  }
}
onMounted(() => {
  void load();
  void loadNames();
});
watch(
  () => JSON.stringify(props.dao.reference),
  () => {
    records.value = undefined;
    error.value = '';
    notice.value = '';
    destination.value = props.member?.nativeAccount ?? '';
    amount.value = '';
    popup.value = false;
    names.value.clear();
    section.value = 'payments';
    search.value = '';
    status.value = '';
    void load();
    void loadNames();
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
function statements(obligationId: string) {
  return records.value?.evidence.filter((row) => row.obligation_id === obligationId) ?? [];
}
function unmatchedStatements() {
  const ids = new Set(records.value?.obligations.map((row) => row.id) ?? []);
  return records.value?.evidence.filter((row) => !ids.has(row.obligation_id)) ?? [];
}
function setDraft(target: Record<string, string>, id: string, event: Event) {
  const field = event.target;
  if (!(field instanceof HTMLInputElement)) return;
  target[id] = field.value;
}
async function recordStatement(record: {
  id: string;
  recipient: string;
  quantity: string;
  status: number;
}) {
  const actor = props.member;
  if (!actor) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const data = prepareExternalEvidence(
      props.dao,
      actor,
      record,
      draftChain.value[record.id] ?? '',
      draftPayer.value[record.id] ?? '',
      draftReference.value[record.id] ?? '',
    );
    await relayInstruction(
      makeInstruction(
        props.dao.reference,
        actor.memberId,
        actor.nonce,
        Math.floor(Date.now() / 1000) + 300,
        props.dao.reference.contract,
        'confirmext',
        encodeAction('confirmext', data),
      ),
    );
    await load();
    notice.value = 'External payment statement recorded. The obligation is still unpaid.';
    popup.value = false;
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
    popup.value = false;
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function prepareReceivingWallet() {
  busy.value = true;
  error.value = '';
  notice.value = '';
  const receiver = destination.value,
    token = { ...props.dao.token };
  const context = JSON.stringify([props.dao.reference, token, receiver]);
  try {
    const check = () => {
      if (
        !alive ||
        token.chainId !== props.dao.reference.chainId ||
        context !== JSON.stringify([props.dao.reference, props.dao.token, destination.value])
      )
        throw new Error('WALLET_CONTEXT_CHANGED');
    };
    if (
      !nativeWallet.value ||
      nativeIdentity().account !== receiver ||
      nativeIdentity().chainId !== token.chainId
    )
      await connectNative();
    check();
    await nativeTokenPreparation(token, receiver, check);
    notice.value =
      'The receiving wallet’s token row was prepared. Use your Daclify account’s signing method to withdraw. Closing that row requires preparing it again.';
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="workspace-tools-toolbar">
    <WorkspaceTabs
      v-model="section"
      prefix="treasury"
      label="Treasury sections"
      :items="[
        { value: 'payments', label: 'Payments' },
        { value: 'balances', label: 'Your balances' },
        { value: 'reports', label: 'Reports' },
      ]"
    />
    <label v-if="section === 'payments'" class="workspace-tools-search"
      ><span class="sr-only">Search payments</span
      ><input v-model="search" type="search" placeholder="Recipient, payment source or amount…"
    /></label>
    <label v-if="section === 'payments'" class="workspace-tools-filter"
      ><span class="sr-only">Payment status</span
      ><select v-model="status">
        <option value="">All statuses</option>
        <option value="0">Reserved</option>
        <option value="1">Approved</option>
        <option value="2">Settled</option>
        <option value="3">Cancelled</option>
      </select></label
    >
    <WorkspaceActions
      add-label="Deposit tokens"
      help-to="/docs/treasury"
      :disabled="busy"
      @add="open('deposit')"
    />
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

  <div
    v-show="section === 'payments'"
    id="treasury-payments"
    role="tabpanel"
    aria-labelledby="treasury-tab-payments"
  >
    <p v-if="records && !records.obligations.length" class="muted">
      No payment obligations recorded.
    </p>
    <p v-if="records?.obligations.length && !visiblePayments.length" class="empty-state">
      No payments match these filters.
    </p>
    <div class="dao-grid">
      <article v-for="record in visiblePayments" :key="record.id" class="panel">
        <h2>{{ record.quantity }} · {{ memberName(record.recipient) }}</h2>
        <p>
          {{ ['Reserved', 'Approved', 'Settled', 'Cancelled'][record.status] ?? 'Unknown state' }} ·
          {{
            record.source === 'works'
              ? 'Works'
              : record.source === 'payroll'
                ? 'Payroll'
                : record.source
          }}
        </p>
        <p>
          {{
            record.due
              ? 'Due ' + new Date(record.due * 1000).toLocaleString()
              : 'No scheduled delay'
          }}
        </p>
        <button
          v-if="record.status === 1 && record.due <= now"
          :disabled="busy || !workspace.account"
          @click="settle(record.source, record.source_id)"
        >
          Settle payment
        </button>
        <p v-if="record.status === 1" class="field-help">
          Settlement delivers to the recipient’s linked native account or their internal claim. It
          does not change the recipient or amount. Native recipients must prepare their token
          balance row before settlement; an unprepared wallet leaves the payment approved and
          unpaid.
        </p>
        <details>
          <summary>Payment references</summary>
          <p class="mono wrap">
            {{ record.source }} / {{ record.source_id }} · record {{ record.id }}
          </p>
        </details>
        <ul v-if="statements(record.id).length">
          <li v-for="statement in statements(record.id)" :key="statement.id">
            {{
              statement.mode === 1
                ? 'DAO-confirmed external payment'
                : 'External statement mode ' + statement.mode
            }}. {{ statement.quantity }} from {{ statement.payer }} on {{ statement.chain }}.
            Reference {{ statement.reference }}. This statement does not settle the obligation.
          </li>
        </ul>
        <p v-else class="field-help">No external payment statement is recorded.</p>
        <button
          v-if="member?.active && member.admin && record.status === 1"
          type="button"
          class="secondary"
          :disabled="busy"
          @click="open('statement', record)"
        >
          Record external statement
        </button>
      </article>
    </div>
    <section v-if="unmatchedStatements().length" class="panel">
      <h3>Other external statements</h3>
      <ul>
        <li v-for="statement in unmatchedStatements()" :key="statement.id">
          Obligation {{ statement.obligation_id }} · {{ statement.quantity }} from
          {{ statement.payer }} on {{ statement.chain }}. Reference {{ statement.reference }}.
        </li>
      </ul>
    </section>
  </div>
  <div
    v-show="section === 'balances'"
    id="treasury-balances"
    role="tabpanel"
    aria-labelledby="treasury-tab-balances"
  >
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
      <button type="button" :disabled="busy" @click="open('withdrawal')">Withdraw</button>
    </section>
    <p v-if="!member" class="empty-state">
      Sign in with your DAO membership to view your balances.
    </p>
  </div>
  <div
    v-show="section === 'reports'"
    id="treasury-reports"
    role="tabpanel"
    aria-labelledby="treasury-tab-reports"
  >
    <SpendingReportPanel :dao="dao" :member-names="names" />
  </div>
  <WorkspaceDialog v-model:open="popup" :title="popupTitle" :busy="busy">
    <template v-if="mode === 'deposit'">
      <section class="panel">
        <h3>Fund this DAO</h3>
        <p>
          Send {{ dao.token.symbol }} from the <code>{{ dao.token.contract }}</code> token contract
          to <code>{{ dao.reference.contract }}</code
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
          A linked native account is currently required to deposit governance stake. Internal
          governance credits remain available to walletless members.
        </p>
      </section>
    </template>
    <template v-else-if="mode === 'withdrawal' && member"
      ><p>
        Available {{ kind === 'withdraw' ? 'payment claim' : 'governance stake' }}:
        {{ units(kind === 'withdraw' ? member.claim : member.stake) }} {{ dao.token.symbol }}
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
        ><input id="exit-amount" v-model="amount" inputmode="decimal" required />
        <p class="field-help">
          Before receiving a payment, this account must have a balance row for
          {{ dao.token.symbol }} ({{ dao.token.precision }} decimal places) on
          <code>{{ dao.token.contract }}</code
          >. Connect the receiving account’s native wallet to prepare it once and pay its RAM cost.
          Preparation does not withdraw funds or pair the wallet. If this is a different wallet from
          your linked signing account, switch back before signing the withdrawal.
        </p>
        <button
          type="button"
          class="secondary"
          :disabled="busy || !destination"
          @click="prepareReceivingWallet"
        >
          Prepare receiving wallet
        </button>
        <button
          type="button"
          class="secondary"
          :disabled="busy || (kind === 'withdraw' ? member.claim : member.stake) === '0'"
          @click="amount = units(kind === 'withdraw' ? member.claim : member.stake)"
        >
          Use full {{ kind === 'withdraw' ? 'payment claim' : 'stake balance' }}
        </button>
        <button
          :disabled="
            busy || !signerReady || (kind === 'withdraw' ? member.claim : member.stake) === '0'
          "
        >
          Sign withdrawal
        </button>
      </form>
    </template>
    <template v-else-if="statementFor"
      ><p>{{ statementFor.quantity }} · {{ memberName(statementFor.recipient) }}</p>
      <form
        v-if="member?.admin && statementFor?.status === 1"
        @submit.prevent="recordStatement(statementFor)"
      >
        <p class="field-help">
          Record a statement that this approved obligation was paid outside this chain. The
          statement keeps the recipient and amount already on the obligation.
        </p>
        <label :for="'evidence-chain-' + statementFor.id">External chain</label>
        <input
          :id="'evidence-chain-' + statementFor.id"
          :value="draftChain[statementFor.id] ?? ''"
          maxlength="64"
          required
          spellcheck="false"
          @input="setDraft(draftChain, statementFor.id, $event)"
        />
        <label :for="'evidence-payer-' + statementFor.id">External payer</label>
        <input
          :id="'evidence-payer-' + statementFor.id"
          :value="draftPayer[statementFor.id] ?? ''"
          maxlength="128"
          required
          spellcheck="false"
          @input="setDraft(draftPayer, statementFor.id, $event)"
        />
        <label :for="'evidence-reference-' + statementFor.id">Reference</label>
        <input
          :id="'evidence-reference-' + statementFor.id"
          :value="draftReference[statementFor.id] ?? ''"
          maxlength="64"
          required
          spellcheck="false"
          @input="setDraft(draftReference, statementFor.id, $event)"
        />
        <button :disabled="busy || !signerReady">Record external statement</button>
      </form>
    </template>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
  </WorkspaceDialog>
</template>
