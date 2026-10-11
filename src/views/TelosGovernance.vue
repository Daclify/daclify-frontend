<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { z } from 'zod';
import { NativeAccountSchema, SessionSchema } from '@daclify/core-protocol';
import {
  TelosVoteInputSchema,
  TelosBallotPageSchema,
  TelosBallotDetailSchema,
  type TelosBallot,
} from '@daclify/modules';
import { telosBallotSupportsVoting } from '@daclify/modules/sdk';
import { api, friendlyError } from '../api/client';
import { resolveApiUrl } from '../api/networks';
import { useWorkspace } from '../state/workspace';
import { connectNative, nativeIdentity, nativeIntentProof, nativeWallet } from '../auth/telos-zero';
import { acceptProviderSession } from '../auth/session';
import { selectedSigner } from '../auth/action-signer';
import { nativeTelosVote, confirmTelosVote, TelosVoteUnconfirmed } from '../auth/telos-governance';
const state = useWorkspace(),
  route = useRoute(),
  router = useRouter();
const page = ref<z.infer<typeof TelosBallotPageSchema>>(),
  detail = ref<z.infer<typeof TelosBallotDetailSchema>>();
const loading = ref(false),
  busy = ref(false),
  checking = ref(false),
  error = ref(''),
  notice = ref(''),
  weight = ref<string | null>(),
  filter = ref<'all' | 'open' | 'history'>('all'),
  options = ref<string[]>([]);
const pendingSchema = z.strictObject({
  transactionId: z.string().regex(/^[0-9a-f]{64}$/),
  ballot: TelosVoteInputSchema.shape.ballot,
  voter: NativeAccountSchema,
});
const pending = ref<z.infer<typeof pendingSchema>>();
let disposed = false,
  readRevision = 0,
  voteRevision = 0;
function status(ballot: TelosBallot) {
  if (ballot.status === 'voting')
    return Date.parse(ballot.end_time + 'Z') <= Date.now()
      ? 'Awaiting closure'
      : Date.parse(ballot.begin_time + 'Z') > Date.now()
        ? 'Scheduled'
        : 'Open';
  return ballot.status === 'closed'
    ? 'Closed'
    : ballot.status === 'archived'
      ? 'Archived'
      : ballot.status === 'cancelled'
        ? 'Cancelled'
        : 'Draft';
}
const visible = computed(
  () =>
    page.value?.ballots.filter(
      (b) =>
        filter.value === 'all' ||
        (filter.value === 'open'
          ? status(b) === 'Open'
          : ['Closed', 'Archived', 'Cancelled', 'Awaiting closure'].includes(status(b))),
    ) ?? [],
);
const canVote = computed(
  () =>
    !!detail.value?.signingAvailable &&
    telosBallotSupportsVoting(detail.value.ballot) &&
    status(detail.value.ballot) === 'Open' &&
    !pending.value,
);
const contentLink = computed(() => {
  try {
    const url = new URL(detail.value?.ballot.content ?? '');
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
});
const date = (value: string) => new Date(value + 'Z').toLocaleString();
function pendingKey(current: z.infer<typeof TelosBallotDetailSchema>, issuer = resolveApiUrl('/')) {
  return (
    'daclify.telos.pending:' +
    issuer +
    ':' +
    current.source.chainId +
    ':' +
    current.source.contract +
    ':' +
    current.ballot.ballot_name
  );
}
async function load(cursor?: string) {
  const revision = ++readRevision;
  loading.value = true;
  error.value = '';
  try {
    const result = await api.telosBallots(cursor);
    if (!disposed && revision === readRevision) page.value = result;
  } catch (cause) {
    if (!disposed && revision === readRevision) error.value = friendlyError(cause);
  } finally {
    if (revision === readRevision) loading.value = false;
  }
}
function refreshRecords() {
  void load();
  void open(route.query.ballot);
}
async function open(name: unknown) {
  ++voteRevision;
  options.value = [];
  weight.value = undefined;
  detail.value = undefined;
  pending.value = undefined;
  notice.value = '';
  error.value = '';
  if (typeof name !== 'string') return;
  const revision = voteRevision;
  try {
    const result = await api.telosBallot(name);
    if (disposed || revision !== voteRevision) return;
    detail.value = result;
    try {
      const raw = sessionStorage.getItem(pendingKey(result));
      if (raw) {
        const parsed = pendingSchema.safeParse(JSON.parse(raw));
        if (parsed.success && parsed.data.ballot === name) pending.value = parsed.data;
      }
    } catch {
      /* A saved display record grants no authority. */
    }
  } catch (cause) {
    if (!disposed && revision === voteRevision) error.value = friendlyError(cause);
  }
}
watch(
  () => route.query.ballot,
  (name) => {
    void open(name);
  },
  { immediate: true },
);
watch(
  () => JSON.stringify([state.network?.chainId, state.network?.runtime]),
  () => {
    ++voteRevision;
    void load();
    void open(route.query.ballot);
  },
);
onMounted(() => {
  void load();
});
onBeforeUnmount(() => {
  disposed = true;
  ++readRevision;
  ++voteRevision;
});
async function checkConfirmation() {
  const record = pending.value,
    current = detail.value;
  if (!record || !current || checking.value) return;
  checking.value = true;
  const revision = voteRevision;
  try {
    const confirmed = await confirmTelosVote(current.source, record.transactionId);
    if (
      disposed ||
      revision !== voteRevision ||
      pending.value?.transactionId !== record.transactionId
    )
      return;
    if (confirmed) {
      notice.value = 'Vote confirmed.';
      pending.value = undefined;
      try {
        sessionStorage.removeItem(pendingKey(current));
      } catch {
        /* Confirmation does not depend on local storage. */
      }
    } else
      notice.value = 'Confirmation is still pending. Check again before attempting another vote.';
  } catch {
    if (!disposed && revision === voteRevision)
      notice.value =
        'Confirmation is unavailable. Keep the transaction reference and check again before attempting another vote.';
  } finally {
    checking.value = false;
  }
}
function remember(
  current: z.infer<typeof TelosBallotDetailSchema>,
  issuer: string,
  transactionId: string,
  voter: string,
  revision: number,
) {
  const record = { transactionId, ballot: current.ballot.ballot_name, voter };
  try {
    sessionStorage.setItem(pendingKey(current, issuer), JSON.stringify(record));
  } catch {
    /* The reference remains visible if session storage is unavailable. */
  }
  if (disposed || revision !== voteRevision || detail.value !== current) return;
  pending.value = record;
  notice.value = 'Broadcast requested. Confirmation pending.';
}
async function vote() {
  const current = detail.value;
  if (!current || !canVote.value || busy.value) return;
  const revision = ++voteRevision,
    selected = [...options.value],
    scope = resolveApiUrl('/');
  let accountId = state.account?.id,
    expectedWallet = nativeWallet.value;
  const guard = () => {
    if (
      disposed ||
      state.account?.id !== accountId ||
      nativeWallet.value !== expectedWallet ||
      revision !== voteRevision ||
      detail.value !== current ||
      resolveApiUrl('/') !== scope ||
      JSON.stringify(options.value) !== JSON.stringify(selected)
    )
      throw new Error('WALLET_CONTEXT_CHANGED');
  };
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    if (!expectedWallet) expectedWallet = await connectNative();
    guard();
    const identity = nativeIdentity();
    if (identity.chainId !== current.source.chainId) throw new Error('WALLET_CONTEXT_CHANGED');
    const challenge = await api.nativeChallenge('signup', identity.account);
    guard();
    if (
      challenge.identity.chainId !== identity.chainId ||
      challenge.identity.account !== identity.account
    )
      throw new Error('WALLET_CONTEXT_CHANGED');
    const proof = await nativeIntentProof(challenge.runtime, challenge.message);
    guard();
    const session = SessionSchema.parse(await api.nativeFinish('signup', challenge.id, proof));
    guard();
    state.account = acceptProviderSession(session.account, session.csrfToken);
    accountId = state.account.id;
    selectedSigner.value = 'native';
    const prepared = await api.telosPrepare({
      ballot: current.ballot.ballot_name,
      voter: identity.account,
      options: selected,
    });
    guard();
    weight.value = prepared.voter.weight;
    await nextTick();
    guard();
    try {
      remember(
        current,
        scope,
        await nativeTelosVote(prepared, guard, (id) =>
          remember(current, scope, id, identity.account, revision),
        ),
        identity.account,
        revision,
      );
    } catch (cause) {
      if (cause instanceof TelosVoteUnconfirmed) {
        remember(current, scope, cause.transactionId, identity.account, revision);
        if (!disposed && revision === voteRevision)
          notice.value =
            'The broadcast could not be confirmed. Check confirmation before attempting another vote.';
      } else throw cause;
    }
    if (!disposed && revision === voteRevision) await checkConfirmation();
  } catch (cause) {
    if (!disposed && revision === voteRevision) error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="telos-governance">
    <header>
      <p class="eyebrow">TELOS NETWORK GOVERNANCE</p>
      <h1>Telos governance</h1>
      <p>Browse proposals and elections. Vote with your existing Telos Zero account.</p>
      <span v-if="page" class="pill">{{ page.source.environment }}</span>
    </header>
    <p>
      History covers ballot records still retained by Telos. Publisher and voting rules belong to
      each ballot.
    </p>
    <div class="button-row">
      <RouterLink to="/hub">DAO hub</RouterLink
      ><RouterLink to="/docs/telos-network-ballots">Voting guide</RouterLink
      ><button class="secondary" :disabled="loading || busy" @click="refreshRecords">
        Refresh records
      </button>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="loading" role="status">Loading Telos ballots…</p>
    <section aria-label="Telos ballots">
      <div class="button-row" role="group" aria-label="Ballot filter">
        <button :aria-pressed="filter === 'all'" @click="filter = 'all'">All ballots</button
        ><button :aria-pressed="filter === 'open'" @click="filter = 'open'">Open</button
        ><button :aria-pressed="filter === 'history'" @click="filter = 'history'">History</button>
      </div>
      <p v-if="!loading && page && !visible.length">No matching ballots on this page.</p>
      <ul class="ballot-list">
        <li v-for="ballot in visible" :key="ballot.ballot_name">
          <button
            class="secondary"
            :disabled="busy"
            @click="router.replace({ query: { ballot: ballot.ballot_name } })"
          >
            {{ ballot.title || ballot.ballot_name }}</button
          ><span>{{ ballot.category }} · {{ status(ballot) }} · {{ date(ballot.end_time) }}</span
          ><small>Published by {{ ballot.publisher }}</small>
        </li>
      </ul>
      <button
        v-if="page?.nextCursor"
        class="secondary"
        :disabled="loading || busy"
        @click="load(page.nextCursor)"
      >
        Next records
      </button>
    </section>
    <article v-if="detail" class="ballot-detail" aria-label="Selected ballot">
      <h2>{{ detail.ballot.title || detail.ballot.ballot_name }}</h2>
      <p>{{ detail.ballot.description }}</p>
      <dl>
        <dt>Status</dt>
        <dd>{{ status(detail.ballot) }}</dd>
        <dt>Publisher</dt>
        <dd>{{ detail.ballot.publisher }}</dd>
        <dt>Ballot</dt>
        <dd>{{ detail.ballot.ballot_name }}</dd>
        <dt>Voting period</dt>
        <dd>{{ date(detail.ballot.begin_time) }} — {{ date(detail.ballot.end_time) }}</dd>
        <dt>Voting method</dt>
        <dd>{{ detail.ballot.voting_method }} · {{ detail.ballot.treasury_symbol }}</dd>
        <dt>Selections</dt>
        <dd>{{ detail.ballot.min_options }} to {{ detail.ballot.max_options }}</dd>
        <dt>Ballot settings</dt>
        <dd>
          {{
            detail.ballot.settings
              .map((s) => s.key + ': ' + (s.value ? 'enabled' : 'disabled'))
              .join(' · ')
          }}
        </dd>
      </dl>
      <a v-if="contentLink" :href="contentLink" target="_blank" rel="noopener noreferrer"
        >Ballot content</a
      >
      <p v-else-if="detail.ballot.content" class="content-reference">
        Content reference: {{ detail.ballot.content }}
      </p>
      <ul>
        <li v-for="option in detail.ballot.options" :key="option.key">
          {{ option.key }}: {{ option.value }}
        </li>
      </ul>
      <p v-if="status(detail.ballot) === 'Awaiting closure'">
        The voting period has ended. These recorded totals await ballot closure.
      </p>
      <form v-if="detail.ballot.status === 'voting'" @submit.prevent="vote">
        <fieldset :disabled="busy || !canVote">
          <legend>Choose your vote</legend>
          <label v-for="option in detail.ballot.options" :key="option.key" class="vote-option"
            ><input v-model="options" type="checkbox" :value="option.key" />{{ option.key }}</label
          >
        </fieldset>
        <p>Continuing creates or opens your Daclify account paired with this Telos Zero wallet.</p>
        <p>
          If you already use Daclify with another sign-in method,
          <RouterLink to="/account">pair your wallet in Account</RouterLink> first to keep the same
          account.
        </p>
        <p v-if="!telosBallotSupportsVoting(detail.ballot)">
          This ballot uses voting rules that this app does not support. Review it in the Telos
          voting app.
        </p>
        <p v-if="!detail.signingAvailable">
          Voting is unavailable on this connection. Ballot history remains available.
        </p>
        <p v-if="weight !== undefined">
          Voting balance:
          {{ weight ?? 'The Telos contract determines your weight when registration completes.' }}
        </p>
        <button
          :disabled="
            busy ||
            !canVote ||
            options.length < detail.ballot.min_options ||
            options.length > detail.ballot.max_options
          "
        >
          {{ busy ? 'Review in your wallet…' : 'Vote with Telos Zero' }}
        </button>
      </form>
      <p v-if="notice" role="status">{{ notice }}</p>
      <section v-if="pending" aria-label="Pending vote">
        <p>Pending transaction for {{ pending.voter }}</p>
        <code>{{ pending.transactionId }}</code
        ><button class="secondary" :disabled="checking" @click="checkConfirmation">
          {{ checking ? 'Checking…' : 'Check confirmation' }}
        </button>
      </section>
      <div v-if="state.account" class="button-row">
        <RouterLink to="/hub">Explore other DAOs</RouterLink
        ><RouterLink to="/account">Account and key setup</RouterLink>
      </div>
      <a href="https://app.telos.net/trails/ballots" target="_blank" rel="noopener noreferrer"
        >Telos voting app</a
      >
    </article>
  </div>
</template>
<style scoped>
.telos-governance {
  max-width: 960px;
  margin: 0 auto;
  padding: 1.5rem;
  display: grid;
  gap: 1rem;
}
.telos-governance header h1 {
  margin: 0.3rem 0;
}
.ballot-list {
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.8rem;
}
.ballot-list li {
  display: grid;
  gap: 0.35rem;
  padding: 1rem;
  border: 1px solid var(--line, #ddd);
  border-radius: 12px;
}
.ballot-list button {
  text-align: left;
}
.ballot-detail {
  padding: 1.25rem;
  border: 1px solid var(--line, #ddd);
  border-radius: 12px;
  display: grid;
  gap: 0.8rem;
}
.ballot-detail dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.4rem 1rem;
}
.ballot-detail dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.vote-option {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin: 0.7rem 0;
}
.content-reference,
code {
  overflow-wrap: anywhere;
}
.ballot-detail form {
  display: grid;
  gap: 0.8rem;
}
.ballot-detail fieldset {
  border: 1px solid var(--line, #ddd);
  border-radius: 8px;
}
.button-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.8rem;
}
.telos-governance button[aria-pressed='true'] {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
@media (max-width: 540px) {
  .telos-governance {
    padding: 1rem;
  }
  .ballot-detail dl {
    grid-template-columns: 1fr;
  }
  .ballot-detail dt {
    font-weight: 600;
  }
}
</style>
