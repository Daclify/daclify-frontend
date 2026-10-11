<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { z } from 'zod';
import {
  Landmark,
  Vote,
  Users,
  Server,
  RefreshCw,
  Search,
  ArrowUpRight,
  ArrowLeft,
} from '@lucide/vue';
import TelosProducers from '../components/TelosProducers.vue';
import { NativeAccountSchema, SessionSchema } from '@daclify/core-protocol';
import {
  TelosVoteInputSchema,
  TelosBallotPageSchema,
  TelosBallotDetailSchema,
  type TelosBallot,
  type TelosBallotKind,
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
const search = ref(''),
  detailHeading = ref<HTMLHeadingElement>();
const recordButtons = ref<HTMLButtonElement[]>([]);
const section = computed(() =>
  route.query.section === 'elections'
    ? 'elections'
    : route.query.section === 'producers'
      ? 'producers'
      : 'ballots',
);
const kind = computed<TelosBallotKind>(() =>
  section.value === 'elections'
    ? route.query.publisher === 'all'
      ? 'elections'
      : 'foundation'
    : 'ballots',
);
const sourceLabel = computed(
  () => page.value?.source.environment ?? state.network?.environment ?? 'Connecting',
);
const openCount = computed(
  () => page.value?.ballots.filter((b) => status(b) === 'Open').length ?? 0,
);
const heading = computed(() =>
  section.value === 'elections'
    ? kind.value === 'foundation'
      ? 'Foundation elections'
      : 'Network elections'
    : 'Network ballots',
);
function navigate(value: 'ballots' | 'elections' | 'producers') {
  void router.replace({ query: { section: value } });
}
function selectBallot(name: string) {
  void router.replace({ query: { ...route.query, ballot: name } });
}
async function closeDetails() {
  const name = detail.value?.ballot.ballot_name;
  await router.replace({ query: { ...route.query, ballot: undefined } });
  await nextTick();
  recordButtons.value.find((button) => button.dataset.ballot === name)?.focus();
}
function publisher(ballot: TelosBallot) {
  return ballot.publisher === 'tf' && ['election', 'leaderboard'].includes(ballot.category)
    ? 'Telos Foundation'
    : ballot.publisher;
}
const results = computed(() => {
  const entries =
    detail.value?.ballot.options.map((o) => ({
      ...o,
      weight: BigInt(o.value.replace('.', '').split(' ')[0] ?? '0'),
    })) ?? [];
  entries.sort((a, b) =>
    a.weight > b.weight ? -1 : a.weight < b.weight ? 1 : a.key.localeCompare(b.key),
  );
  const largest = entries[0]?.weight ?? 0n;
  return entries.map((o) => ({
    ...o,
    width: largest ? Number((o.weight * 10000n) / largest) / 100 : 0,
  }));
});
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
        (b.title + ' ' + b.ballot_name + ' ' + b.publisher)
          .toLowerCase()
          .includes(search.value.toLowerCase()) &&
        (filter.value === 'all' ||
          (filter.value === 'open'
            ? status(b) === 'Open'
            : ['Closed', 'Archived', 'Cancelled', 'Awaiting closure'].includes(status(b)))),
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
  if (section.value === 'producers') return;
  const revision = ++readRevision;
  const selectedKind = kind.value,
    issuer = resolveApiUrl('/');
  loading.value = true;
  error.value = '';
  if (!cursor) page.value = undefined;
  try {
    const seen = new Set<string>();
    for (let scanned = 0; scanned < 8; scanned++) {
      if (cursor) {
        if (seen.has(cursor)) throw new Error('TELOS_CURSOR_INVALID');
        seen.add(cursor);
      }
      const result = await api.telosBallots(cursor, selectedKind);
      if (disposed || revision !== readRevision || issuer !== resolveApiUrl('/')) return;
      if (page.value && JSON.stringify(page.value.source) !== JSON.stringify(result.source))
        throw new Error('TELOS_CHAIN_MISMATCH');
      const records = new Map((page.value?.ballots ?? []).map((b) => [b.ballot_name, b]));
      for (const ballot of result.ballots) records.set(ballot.ballot_name, ballot);
      page.value = { ...result, ballots: [...records.values()] };
      if (result.ballots.length || !result.nextCursor) break;
      cursor = result.nextCursor;
    }
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
    await nextTick();
    if (disposed || revision !== voteRevision) return;
    detailHeading.value?.focus();
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
watch([section, kind], () => {
  ++readRevision;
  loading.value = false;
  filter.value = 'all';
  search.value = '';
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
    <header class="governance-hero">
      <div class="hero-title">
        <div class="hero-icon"><Landmark :size="27" aria-hidden="true" /></div>
        <div>
          <p class="eyebrow">A VOICE IN THE TELOS NETWORK</p>
          <h1>Telos DAO</h1>
        </div>
      </div>
      <div class="hero-copy">
        <p>
          Follow the decisions. Meet the candidates.<br />Take part with your Telos Zero account.
        </p>
        <span class="network-badge"><span aria-hidden="true">●</span> {{ sourceLabel }}</span>
      </div>
      <RouterLink class="guide-link" to="/docs/telos-network-ballots"
        >How voting works <ArrowUpRight :size="15" aria-hidden="true"
      /></RouterLink>
    </header>
    <nav class="governance-nav" aria-label="Governance views">
      <button :aria-pressed="section === 'ballots'" :disabled="busy" @click="navigate('ballots')">
        <Vote :size="18" aria-hidden="true" /> Ballots
      </button>
      <button
        :aria-pressed="section === 'elections'"
        :disabled="busy"
        @click="navigate('elections')"
      >
        <Users :size="18" aria-hidden="true" /> Elections
      </button>
      <button
        :aria-pressed="section === 'producers'"
        :disabled="busy"
        @click="navigate('producers')"
      >
        <Server :size="18" aria-hidden="true" /> Block Producers
      </button>
    </nav>
    <TelosProducers v-if="section === 'producers'" />
    <template v-else>
      <div class="records-heading">
        <div>
          <p class="eyebrow">
            {{ section === 'elections' ? 'CHOOSE WHO REPRESENTS YOU' : 'DECISIONS ON THE NETWORK' }}
          </p>
          <h2>{{ heading }}</h2>
          <p>
            {{
              section === 'elections'
                ? 'Candidates, voting periods and retained election results.'
                : 'Proposals and recorded outcomes from Telos Decide.'
            }}
          </p>
        </div>
        <button class="secondary" :disabled="loading || busy" @click="refreshRecords">
          <RefreshCw :size="15" aria-hidden="true" /> Refresh records
        </button>
      </div>
      <div
        v-if="section === 'elections'"
        class="election-types"
        role="group"
        aria-label="Election publisher"
      >
        <button
          class="secondary"
          :aria-pressed="kind === 'foundation'"
          :disabled="busy"
          @click="router.replace({ query: { section: 'elections' } })"
        >
          Telos Foundation</button
        ><button
          class="secondary"
          :aria-pressed="kind === 'elections'"
          :disabled="busy"
          @click="router.replace({ query: { section: 'elections', publisher: 'all' } })"
        >
          All network elections
        </button>
      </div>
      <div v-if="page" class="record-summary" aria-label="Loaded record summary">
        <div>
          <span>Records loaded</span><strong>{{ page.ballots.length }}</strong>
        </div>
        <div>
          <span>Open in these records</span><strong>{{ openCount }}</strong>
        </div>
        <div class="summary-source">
          <span>Voting source</span><strong>Telos Decide</strong
          ><small>{{ page.source.environment }} · telos.decide</small>
        </div>
      </div>
      <p v-if="error" class="governance-error" role="alert">{{ error }}</p>
      <section aria-label="Telos ballots">
        <div class="records-toolbar">
          <div class="status-filters" role="group" aria-label="Ballot filter">
            <button :aria-pressed="filter === 'all'" @click="filter = 'all'">All ballots</button
            ><button :aria-pressed="filter === 'open'" @click="filter = 'open'">Open</button
            ><button :aria-pressed="filter === 'history'" @click="filter = 'history'">
              History
            </button>
          </div>
          <label class="records-search"
            ><Search :size="16" aria-hidden="true" /><span class="sr-only"
              >Search loaded records</span
            ><input v-model="search" type="search" placeholder="Search loaded records"
          /></label>
        </div>
        <p v-if="loading" class="loading-records" role="status">Loading Telos records…</p>
        <div v-if="!loading && page && !visible.length" class="empty-records">
          <Vote :size="24" aria-hidden="true" />
          <h3>No matching records loaded</h3>
          <p>
            {{
              page.nextCursor
                ? 'More contract records remain. Continue loading to find further ballots or elections.'
                : 'Try another filter or check back for new contract records.'
            }}
          </p>
        </div>
        <ul class="ballot-list">
          <li
            v-for="ballot in visible"
            :key="ballot.ballot_name"
            :class="{ selected: detail?.ballot.ballot_name === ballot.ballot_name }"
          >
            <div class="record-topline">
              <span>{{
                ballot.category === 'proposal'
                  ? 'PROPOSAL'
                  : publisher(ballot) === 'Telos Foundation'
                    ? 'FOUNDATION ELECTION'
                    : 'NETWORK ELECTION'
              }}</span
              ><span class="record-status" :class="{ open: status(ballot) === 'Open' }">{{
                status(ballot)
              }}</span>
            </div>
            <button
              ref="recordButtons"
              :data-ballot="ballot.ballot_name"
              class="record-title"
              :disabled="busy"
              @click="selectBallot(ballot.ballot_name)"
            >
              {{ ballot.title || ballot.ballot_name }}
            </button>
            <p class="record-description">
              {{ ballot.description || 'View candidates and recorded voting totals.' }}
            </p>
            <div class="record-meta">
              <span>{{ publisher(ballot) }}</span
              ><span>{{ ballot.total_voters.toLocaleString() }} voters</span>
            </div>
            <div class="record-bottom">
              <span>Voting ends {{ new Date(ballot.end_time + 'Z').toLocaleDateString() }}</span
              ><span aria-hidden="true"
                >View {{ ballot.category === 'proposal' ? 'ballot' : 'election' }} ↗</span
              >
            </div>
          </li>
        </ul>
        <button
          v-if="page?.nextCursor"
          class="secondary load-more"
          :disabled="loading || busy"
          @click="load(page.nextCursor)"
        >
          Load more records
        </button>
        <p class="records-footnote">
          History shows records still retained by the contract on {{ sourceLabel }}. Publishers and
          voting rules are shown for each record.
        </p>
      </section>
      <article v-if="detail" class="ballot-detail" aria-label="Selected ballot">
        <div class="detail-topline">
          <button class="secondary" :disabled="busy" @click="closeDetails">
            <ArrowLeft :size="15" aria-hidden="true" /> Back to records</button
          ><span class="record-status">{{ status(detail.ballot) }}</span>
        </div>
        <div>
          <p class="eyebrow">
            {{ detail.ballot.category === 'proposal' ? 'BALLOT DETAILS' : 'ELECTION DETAILS' }}
          </p>
          <h2 ref="detailHeading" tabindex="-1">
            {{ detail.ballot.title || detail.ballot.ballot_name }}
          </h2>
          <p class="detail-description">{{ detail.ballot.description }}</p>
        </div>
        <dl class="detail-facts">
          <div>
            <dt>Published by</dt>
            <dd>{{ publisher(detail.ballot) }}</dd>
          </div>
          <div>
            <dt>Voting period</dt>
            <dd>{{ date(detail.ballot.begin_time) }}<br />{{ date(detail.ballot.end_time) }}</dd>
          </div>
          <div>
            <dt>Voters</dt>
            <dd>{{ detail.ballot.total_voters.toLocaleString() }}</dd>
          </div>
          <div>
            <dt>Selections per vote</dt>
            <dd>{{ detail.ballot.min_options }} to {{ detail.ballot.max_options }}</dd>
          </div>
        </dl>
        <section class="recorded-results" aria-label="Recorded voting totals">
          <h3>
            {{
              detail.ballot.category === 'proposal'
                ? 'Recorded outcome'
                : 'Candidates and recorded votes'
            }}
          </h3>
          <p>Totals reported by the contract. Bars compare each option with the highest total.</p>
          <ul>
            <li v-for="option in results" :key="option.key">
              <div>
                <strong>{{ option.key }}</strong
                ><span>{{ option.value }}</span>
              </div>
              <div class="result-track" aria-hidden="true">
                <span :style="{ width: option.width + '%' }"></span>
              </div>
            </li>
          </ul>
        </section>
        <p v-if="status(detail.ballot) === 'Awaiting closure'" class="detail-note">
          The voting period has ended. These recorded totals await ballot closure.
        </p>
        <p v-if="detail.ballot.category === 'leaderboard'" class="detail-note">
          This election’s history is available here. Its voting path has not been qualified in
          Daclify.
        </p>
        <details class="contract-details">
          <summary>Voting rules and contract record</summary>
          <dl>
            <dt>Ballot</dt>
            <dd>{{ detail.ballot.ballot_name }}</dd>
            <dt>Publisher account</dt>
            <dd>{{ detail.ballot.publisher }}</dd>
            <dt>Voting method</dt>
            <dd>{{ detail.ballot.voting_method }} · {{ detail.ballot.treasury_symbol }}</dd>
            <dt>Ballot settings</dt>
            <dd>
              {{
                detail.ballot.settings
                  .map((s) => s.key + ': ' + (s.value ? 'enabled' : 'disabled'))
                  .join(' · ')
              }}
            </dd>
            <dt>Source</dt>
            <dd>{{ detail.source.environment }} · {{ detail.source.contract }}</dd>
          </dl>
          <a v-if="contentLink" :href="contentLink" target="_blank" rel="noopener noreferrer"
            >Ballot content</a
          >
          <p v-else-if="detail.ballot.content" class="content-reference">
            Content reference: {{ detail.ballot.content }}
          </p>
        </details>
        <form v-if="status(detail.ballot) === 'Open'" @submit.prevent="vote">
          <fieldset :disabled="busy || !canVote">
            <legend>Choose your vote</legend>
            <label
              v-for="option in detail.ballot.options"
              :key="option.key"
              class="checkbox vote-option"
              ><input v-model="options" type="checkbox" :value="option.key" />{{
                option.key
              }}</label
            >
          </fieldset>
          <p>
            Continuing creates or opens your Daclify account paired with this Telos Zero wallet.
          </p>
          <p>
            If you already use Daclify with another sign-in method,
            <RouterLink to="/account">pair your wallet in Account</RouterLink> first to keep the
            same account.
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
    </template>
  </div>
</template>
<style scoped>
.telos-governance {
  max-width: 1150px;
  margin: 0 auto;
  padding: 1.8rem;
  display: grid;
  gap: 1.6rem;
}
.governance-hero {
  position: relative;
  padding: 1.9rem 2rem;
  background: var(--surface-brand);
  border: 1px solid var(--border-warm);
  border-radius: 18px;
}
.hero-title {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.hero-title h1 {
  font-size: clamp(1.8rem, 4vw, 2.5rem);
  letter-spacing: -0.045em;
  margin: 0.35rem 0;
}
.eyebrow {
  font-size: 0.68rem;
  letter-spacing: 0.12em;
  color: var(--accent-amber);
  font-weight: 700;
  margin: 0;
}
.hero-icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border: 1px solid var(--border-warm);
  border-radius: 15px;
  background: var(--accent-soft);
  color: var(--accent-amber);
  flex-shrink: 0;
}
.hero-copy {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1.1rem;
}
.hero-copy p {
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.65;
  font-size: 0.93rem;
}
.network-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid var(--border-warm);
  border-radius: 99px;
  padding: 0.4rem 0.75rem;
  font-size: 0.74rem;
  color: var(--accent-amber);
  text-transform: capitalize;
}
.network-badge span {
  font-size: 0.5rem;
}
.guide-link {
  position: absolute;
  top: 2rem;
  right: 2rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
}
.governance-nav {
  display: flex;
  gap: 0.5rem;
  border-bottom: 1px solid var(--border-default);
  padding-bottom: 0.85rem;
}
.governance-nav button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  padding: 0.85rem 1.15rem;
  font-weight: 600;
  border-radius: 10px;
}
.governance-nav button[aria-pressed='true'] {
  color: var(--accent-amber);
  background: var(--accent-soft);
  border-color: var(--border-warm);
}
.records-heading {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 1rem;
}
.records-heading h2 {
  margin: 0.35rem 0 0.6rem;
  font-size: 1.5rem;
  letter-spacing: -0.03em;
}
.records-heading p:last-child {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.85rem;
}
.records-heading button,
.detail-topline button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.election-types {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.election-types button[aria-pressed='true'] {
  background: var(--accent-soft);
  color: var(--accent-amber);
  border-color: var(--border-warm);
}
.record-summary {
  display: grid;
  grid-template-columns: 1fr 1fr 1.4fr;
  border: 1px solid var(--border-default);
  border-radius: 12px;
  background: var(--surface-panel);
}
.record-summary > div {
  padding: 1.2rem 1.5rem;
  display: grid;
  gap: 0.6rem;
}
.record-summary > div + div {
  border-left: 1px solid var(--border-default);
}
.record-summary span,
.record-summary small {
  font-size: 0.74rem;
  color: var(--text-muted);
}
.record-summary strong {
  font-size: 1.65rem;
  font-weight: 600;
}
.summary-source strong {
  font-size: 1rem;
}
.records-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.2rem;
}
.status-filters {
  display: flex;
  gap: 0.2rem;
  padding: 0.25rem;
  border-radius: 9px;
  border: 1px solid var(--border-default);
  background: var(--surface-panel);
}
.status-filters button {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.8rem;
  padding: 0.6rem 0.85rem;
  border-radius: 6px;
}
.status-filters button[aria-pressed='true'] {
  background: var(--surface-raised);
  color: var(--text-primary);
}
.records-search {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid var(--border-control);
  border-radius: 9px;
  padding: 0.2rem 0.8rem;
  color: var(--text-muted);
}
.records-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  background: transparent;
  font-size: 0.8rem;
}
.ballot-list {
  padding: 0;
  margin: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}
.ballot-list li {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.3rem;
  border: 1px solid var(--border-default);
  border-radius: 14px;
  background: var(--surface-panel);
  min-width: 0;
}
.ballot-list li:hover,
.ballot-list li.selected {
  border-color: var(--border-warm);
}
.record-topline {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  align-items: center;
}
.record-topline > span:first-child {
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}
.record-status {
  display: inline-block;
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
  padding: 0.25rem 0.55rem;
  border-radius: 6px;
  font-size: 0.68rem;
  white-space: nowrap;
}
.record-status.open {
  color: var(--accent-amber);
  border-color: var(--border-warm);
  background: var(--accent-soft);
}
.record-title {
  color: var(--text-primary);
  font-size: 1.08rem;
  font-weight: 650;
  text-align: left;
  background: transparent;
  border: 0;
  padding: 0;
  line-height: 1.5;
  border-radius: 3px;
  overflow-wrap: anywhere;
}
.record-title:hover {
  color: var(--accent-amber);
}
.record-description {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.7;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.record-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  font-size: 0.74rem;
  margin-top: auto;
  color: var(--text-secondary);
}
.record-bottom {
  border-top: 1px solid var(--border-default);
  padding-top: 0.9rem;
  display: flex;
  justify-content: space-between;
  gap: 0.6rem;
  font-size: 0.68rem;
  color: var(--text-muted);
}
.record-bottom span:last-child {
  color: var(--accent-amber);
}
.load-more {
  margin-top: 1.2rem;
}
.records-footnote {
  color: var(--text-muted);
  font-size: 0.74rem;
  line-height: 1.7;
  margin-bottom: 0;
}
.empty-records {
  text-align: center;
  border: 1px dashed var(--border-default);
  padding: 2rem 1rem;
  border-radius: 14px;
  color: var(--text-muted);
}
.empty-records h3 {
  color: var(--text-primary);
  font-size: 1rem;
}
.empty-records p,
.loading-records {
  font-size: 0.82rem;
}
.ballot-detail {
  border: 1px solid var(--border-warm);
  background: var(--surface-panel);
  border-radius: 16px;
  padding: 1.7rem;
  display: grid;
  gap: 1.5rem;
  min-width: 0;
}
.detail-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.ballot-detail h2 {
  font-size: 1.6rem;
  margin: 0.65rem 0;
  overflow-wrap: anywhere;
}
.detail-description {
  color: var(--text-secondary);
  line-height: 1.8;
  font-size: 0.87rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.detail-facts {
  display: grid;
  grid-template-columns: 1fr 2fr 1fr 1fr;
  margin: 0;
  gap: 1rem;
  padding: 1.2rem 0;
  border-top: 1px solid var(--border-default);
  border-bottom: 1px solid var(--border-default);
}
.detail-facts dt {
  font-size: 0.7rem;
  color: var(--text-muted);
  margin-bottom: 0.5rem;
}
.detail-facts dd {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.recorded-results h3 {
  font-size: 1rem;
  margin: 0;
}
.recorded-results p {
  color: var(--text-muted);
  font-size: 0.74rem;
  line-height: 1.7;
}
.recorded-results ul {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 1.1rem;
}
.recorded-results li > div:first-child {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.8rem;
  margin-bottom: 0.5rem;
  overflow-wrap: anywhere;
}
.result-track {
  height: 5px;
  background: var(--surface-soft);
  border-radius: 5px;
  overflow: hidden;
}
.result-track span {
  display: block;
  height: 100%;
  background: var(--accent-gradient);
  border-radius: 5px;
}
.detail-note {
  background: var(--accent-soft);
  border: 1px solid var(--border-warm);
  border-radius: 9px;
  padding: 1rem;
  font-size: 0.82rem;
  line-height: 1.7;
  margin: 0;
}
.contract-details {
  font-size: 0.8rem;
  line-height: 1.7;
  color: var(--text-muted);
}
.contract-details summary {
  cursor: pointer;
  color: var(--text-secondary);
}
.contract-details dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.5rem 1rem;
}
.contract-details dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.content-reference,
code {
  overflow-wrap: anywhere;
}
.ballot-detail form {
  display: grid;
  gap: 0.8rem;
  font-size: 0.85rem;
  line-height: 1.8;
}
.ballot-detail fieldset {
  border: 1px solid var(--border-default);
  border-radius: 10px;
}
.vote-option {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin: 0.7rem 0;
  min-height: 44px;
}
.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.8rem;
  font-size: 0.82rem;
}
.governance-error {
  color: var(--state-danger);
}
@media (max-width: 700px) {
  .telos-governance {
    padding: 1rem;
    gap: 1.25rem;
  }
  .governance-hero {
    padding: 1.3rem;
  }
  .guide-link {
    position: static;
    margin-top: 1rem;
  }
  .hero-title {
    gap: 0.8rem;
  }
  .hero-copy {
    align-items: start;
  }
  .hero-copy p {
    font-size: 0.8rem;
  }
  .hero-icon {
    width: 45px;
    height: 45px;
    border-radius: 12px;
  }
  .governance-nav {
    gap: 0.2rem;
  }
  .governance-nav button {
    flex: 1;
    padding: 0.7rem 0.4rem;
    font-size: 0.76rem;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .records-heading {
    flex-direction: column;
  }
  .records-toolbar {
    flex-direction: column;
  }
  .record-summary > div {
    padding: 1rem 0.7rem;
  }
  .record-summary span {
    font-size: 0.65rem;
  }
  .record-summary strong {
    font-size: 1.2rem;
  }
  .summary-source strong {
    font-size: 0.8rem;
  }
  .summary-source small {
    font-size: 0.62rem;
  }
  .ballot-list {
    grid-template-columns: 1fr;
  }
  .ballot-detail {
    padding: 1.2rem;
  }
  .detail-facts {
    grid-template-columns: 1fr 1fr;
  }
  .contract-details dl {
    grid-template-columns: 1fr;
  }
}
</style>
