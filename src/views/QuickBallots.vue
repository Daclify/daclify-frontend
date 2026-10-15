<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowUp, ArrowDown, Plus, Check, RefreshCw } from '@lucide/vue';
import { Bytes } from '@wharfkit/antelope';
import {
  IdSchema,
  EncryptionPublicKeySchema,
  type QuickAccountContext,
  type GovernanceState,
} from '@daclify/core-protocol';
import { encodeQuickAnchor, decodeQuickAnchor, makeInstruction } from '@daclify/core-protocol/sdk';
import { QuickBallotDefinitionSchema, type QuickBallotResponse } from '@daclify/modules';
import {
  encodeQuickBallot,
  quickBallotDefinitionHash,
  quickKeyContext,
  quickResponseContext,
} from '@daclify/modules/quick-ballots';
import { api, friendlyError } from '../api/client';
import { resolveApiUrl } from '../api/networks';
import { useWorkspace } from '../state/workspace';
import { canSignMember, dispatchInstruction, selectedSigner } from '../auth/action-signer';
import { vaultUnlocked, openQuickGrant, readQuickReceipt } from '../auth/session';
import { nativeWallet, connectNative } from '../auth/telos-zero';
import { evmWallet, connectEvm } from '../auth/telos-evm';
import { approvalSetupLocation } from '../auth/destination';
import {
  approveQuick,
  quickUsesDefault,
  pendingQuick,
  restoreQuickPending,
  resumeQuickApproval,
} from '../quick-ballots/approval';
import { quickCrypto } from '../quick-ballots/worker';
import { createBallotGrant } from '../quick-ballots/keys';
import { archivedQuickGrants } from '../quick-ballots/archive';
import {
  sealAccountReceipt,
  sealDeviceReceipt,
  openDeviceReceipt,
  receiptKind,
} from '../quick-ballots/receipts';
import { receiptDeviceKey } from '../quick-ballots/device-key';
import ActionSigner from '../components/ActionSigner.vue';
const state = useWorkspace(),
  route = useRoute(),
  router = useRouter();
const list = ref<Awaited<ReturnType<typeof api.quickList>>>(),
  detail = ref<Awaited<ReturnType<typeof api.quickDetail>>>(),
  context = ref<QuickAccountContext>(),
  own = ref<QuickBallotResponse | null>(null),
  choice = ref<0 | 1>(),
  result = ref<{ up: number; down: number; count: number } | null>(null);
const error = ref(''),
  message = ref(''),
  progress = ref(''),
  receiptMessage = ref(''),
  busy = ref(false),
  loading = ref(false),
  verified = ref(false),
  after = ref(''),
  filter = ref(IdSchema.safeParse(route.query.dao).data ?? '');
const editor = ref(false),
  origin = ref(''),
  question = ref(''),
  explanation = ref(''),
  allAccounts = ref(false),
  audience = ref<string[]>([]),
  deadline = ref('');
const readers = ref<Awaited<ReturnType<typeof api.quickReaders>>>(),
  module = ref<Awaited<ReturnType<typeof api.moduleState>>['modules'][number]>(),
  governance = ref<GovernanceState>(),
  readerLoading = ref(false);
const now = ref(Math.floor(Date.now() / 1000)),
  clock = setInterval(() => {
    now.value = Math.floor(Date.now() / 1000);
  }, 1000);
let revision = 0,
  readerRevision = 0,
  controller = new AbortController();
const available = computed(() => state.network?.capabilities.includes('quick-ballots-v1'));
const id = computed(() => {
  const value = IdSchema.safeParse(route.params.ballotId);
  return value.success ? value.data : undefined;
});
const daos = computed(() =>
  state.daos.filter(
    (dao) =>
      dao.reference.chainId === state.network?.chainId &&
      dao.reference.contract === state.network.runtime,
  ),
);
const memberships = computed(() =>
  state.memberships.filter(
    (member) =>
      member.active &&
      member.dao.chainId === state.network?.chainId &&
      member.dao.contract === state.network.runtime,
  ),
);
const originMember = computed(() =>
  memberships.value.find((member) => member.dao.daoId === origin.value),
);
const ballotMember = computed(() =>
  memberships.value.find((member) => member.dao.daoId === detail.value?.ballot.dao_id),
);
const open = computed(
  () =>
    !!detail.value &&
    !detail.value.ballot.closed_at &&
    (!detail.value.ballot.definition.closes || detail.value.ballot.definition.closes > now.value),
);
const setup = computed(() => approvalSetupLocation(route.fullPath, detail.value?.ballot.dao_id));
const exec = computed(() => {
  const member = editor.value ? originMember.value : ballotMember.value,
    office = governance.value?.executives.find((row) => row.member_id === member?.memberId),
    policy = governance.value?.executivePolicy;
  return (
    !!member &&
    !!office &&
    !!policy &&
    (policy.inactivity_seconds === 0 ||
      (office.last_active <= now.value &&
        now.value - office.last_active < policy.inactivity_seconds))
  );
});
const readerIndex = computed(() => {
  const key = state.account?.encryptionKey;
  if (!key || !detail.value) return -1;
  return detail.value.ballot.definition.readers.findIndex((reader) => {
    try {
      const value = EncryptionPublicKeySchema.parse(JSON.parse(reader.encryption_key));
      return value.crv === key.crv && value.x === key.x && value.y === key.y;
    } catch {
      return false;
    }
  });
});
const eligible = computed(
  () =>
    !!detail.value &&
    (detail.value.ballot.definition.all_accounts ||
      memberships.value.some((member) =>
        detail.value?.ballot.definition.audience.includes(member.dao.daoId),
      )),
);
const ready = computed(
  () => verified.value && open.value && !!context.value?.record?.active && !busy.value,
);
function name(daoId: string) {
  return daos.value.find((dao) => dao.reference.daoId === daoId)?.title ?? 'DAO ' + daoId;
}
function time(value: number) {
  return new Date(value * 1000).toLocaleString();
}
function base() {
  if (!detail.value) throw Error('QUICK_BALLOT_UNKNOWN');
  return {
    chainId: detail.value.chainId,
    runtime: detail.value.runtime,
    source: detail.value.source,
    ballotId: detail.value.ballot.id,
    definitionHash: detail.value.ballot.definition_hash,
  };
}
function deviceScope() {
  if (!context.value || !state.account) throw Error('AUTH_REQUIRED');
  return JSON.stringify([
    resolveApiUrl('/'),
    state.account.id,
    context.value.chainId,
    context.value.runtime,
    context.value.identity,
  ]);
}
function receiptContext(row: QuickBallotResponse) {
  return { ...base(), identity: row.identity, revision: row.revision, ciphertext: row.ciphertext };
}
function scope() {
  return JSON.stringify([
    state.account?.id,
    state.account?.signingKey,
    state.network?.chainId,
    state.network?.runtime,
    resolveApiUrl('/'),
    route.fullPath,
    vaultUnlocked.value,
  ]);
}
async function loadOwn(check: () => void) {
  context.value = undefined;
  own.value = null;
  choice.value = undefined;
  receiptMessage.value = '';
  if (!state.account || !detail.value) return;
  const status = await api.quickAccountStatus();
  check();
  if (!status.available) return;
  context.value = status.context;
  const response = await api.quickOwnResponse(detail.value.ballot.id, status.context.identity);
  check();
  own.value = response.response;
  if (!response.response?.active || !response.response.receipt) return;
  try {
    const row = response.response;
    if (receiptKind(row.receipt) === 'account')
      choice.value = await readQuickReceipt(receiptContext(row), row.receipt);
    else {
      const key = await receiptDeviceKey(deviceScope(), false);
      check();
      if (key) choice.value = await openDeviceReceipt(receiptContext(row), key, row.receipt);
    }
    check();
  } catch {
    check();
    receiptMessage.value =
      'Your response is recorded. Its private receipt is unavailable here; you can still change or remove it.';
  }
}
async function load() {
  const current = revision,
    check = () => {
      if (current !== revision) throw Error('QUICK_CANCELLED');
    };
  loading.value = true;
  error.value = '';
  verified.value = false;
  result.value = null;
  detail.value = undefined;
  governance.value = undefined;
  try {
    if (!available.value) return;
    list.value = await api.quickList({
      ...(after.value ? { after: after.value } : {}),
      ...(filter.value ? { daoId: filter.value } : {}),
    });
    check();
    if (!id.value) return;
    const value = await api.quickDetail(id.value);
    check();
    detail.value = value;
    const inspected = await quickCrypto(
      {
        task: 'inspect',
        detail: {
          chainId: value.chainId,
          runtime: value.runtime,
          source: value.source,
          ballot: value.ballot,
        },
      },
      controller.signal,
    );
    check();
    if (inspected.task !== 'inspect') throw Error('QUICK_CRYPTO_FAILED');
    verified.value = true;
    result.value = inspected.result;
    await loadOwn(check);
    if (ballotMember.value) {
      governance.value = await api.governance(value.ballot.dao_id);
      check();
    }
  } catch (cause) {
    if (current === revision) error.value = friendlyError(cause);
  } finally {
    if (current === revision) loading.value = false;
  }
}
watch(
  [scope, available, filter, after],
  () => {
    ++revision;
    controller.abort();
    controller = new AbortController();
    busy.value = false;
    choice.value = undefined;
    context.value = undefined;
    own.value = null;
    progress.value = '';
    message.value = '';
    if (state.account) restoreQuickPending();
    else pendingQuick.value = undefined;
    void load();
  },
  { immediate: true },
);
watch([origin, editor], async () => {
  const current = ++readerRevision;
  readers.value = undefined;
  module.value = undefined;
  if (!editor.value) {
    if (id.value) void load();
    return;
  }
  if (!origin.value) return;
  readerLoading.value = true;
  error.value = '';
  try {
    const [snapshot, modules, offices] = await Promise.all([
      api.quickReaders(origin.value),
      api.moduleState(origin.value),
      api.governance(origin.value),
    ]);
    if (current !== readerRevision) return;
    readers.value = snapshot;
    module.value = modules.modules.find((row) => row.deployment.id === 'quick-ballots');
    governance.value = offices;
    if (!audience.value.length) audience.value = [origin.value];
  } catch (cause) {
    if (current === readerRevision) error.value = friendlyError(cause);
  } finally {
    if (current === readerRevision) readerLoading.value = false;
  }
});
onBeforeUnmount(() => {
  ++revision;
  ++readerRevision;
  controller.abort();
  clearInterval(clock);
});
async function perform(action: (check: () => void, signal: AbortSignal) => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  message.value = '';
  progress.value = '';
  const current = revision,
    stamp = scope(),
    check = () => {
      if (current !== revision || stamp !== scope() || controller.signal.aborted)
        throw Error('QUICK_CANCELLED');
    };
  try {
    await action(check, controller.signal);
  } catch (cause) {
    if (current === revision) error.value = friendlyError(cause);
  } finally {
    if (current === revision) {
      busy.value = false;
      progress.value = '';
    }
  }
}
function cancel() {
  ++revision;
  controller.abort();
  controller = new AbortController();
  busy.value = false;
  choice.value = undefined;
  progress.value = '';
  void load();
}
function create() {
  editor.value = true;
  origin.value = memberships.value[0]?.dao.daoId ?? '';
}
async function publish() {
  await perform(async (check, signal) => {
    const member = originMember.value,
      snapshot = readers.value,
      source = module.value;
    if (
      !member ||
      !snapshot ||
      !source?.enabled ||
      !source.codeVerified ||
      !source.compatible ||
      !exec.value ||
      !canSignMember(member)
    )
      throw Error('EXECUTIVE_REQUIRED');
    const values = crypto.getRandomValues(new Uint32Array(2)),
      ballotId = ((BigInt(values[0] ?? 0) << 32n) | BigInt(values[1] ?? 0) || 1n).toString();
    const closes = deadline.value ? Math.floor(new Date(deadline.value).getTime() / 1000) : 0;
    if (closes && closes <= Math.floor(Date.now() / 1000)) throw Error('QUICK_DEADLINE');
    const definition = QuickBallotDefinitionSchema.parse({
      protocol: 1,
      question: question.value.trim(),
      explanation: explanation.value.trim(),
      all_accounts: allAccounts.value,
      audience: allAccounts.value
        ? []
        : [...new Set(audience.value)].sort((left, right) =>
            BigInt(left) < BigInt(right) ? -1 : 1,
          ),
      closes,
      readers: snapshot.readers,
    });
    const domain = {
      chainId: member.dao.chainId,
      runtime: member.dao.contract,
      source: source.deployment.account,
    };
    const definitionHash = quickBallotDefinitionHash({
      ...domain,
      ballotId,
      daoId: member.dao.daoId,
      creatorId: member.memberId,
      definition,
    });
    progress.value = 'Preparing encrypted ballot…';
    const key = await quickCrypto(
      {
        task: 'key',
        context: quickKeyContext({
          chainId: domain.chainId,
          runtime: domain.runtime,
          ballotId,
          definitionHash,
        }),
      },
      signal,
    );
    check();
    if (key.task !== 'key') throw Error('QUICK_CRYPTO_FAILED');
    const grants = await Promise.all(
      definition.readers.map((reader) =>
        createBallotGrant(
          { ...domain, ballotId, definitionHash, memberId: reader.member_id },
          reader.encryption_key,
          key.secret,
        ),
      ),
    );
    check();
    const current = (await api.memberships()).find(
      (row) =>
        row.dao.daoId === member.dao.daoId &&
        row.memberId === member.memberId &&
        row.dao.chainId === domain.chainId &&
        row.dao.contract === domain.runtime,
    );
    check();
    if (!current?.active) throw Error('MEMBER_INACTIVE');
    await dispatchInstruction(
      makeInstruction(
        current.dao,
        current.memberId,
        current.nonce,
        Math.floor(Date.now() / 1000) + 120,
        domain.source,
        'open',
        encodeQuickBallot('open', {
          runtime: domain.runtime,
          dao_id: current.dao.daoId,
          member_id: current.memberId,
          ballot_id: ballotId,
          definition,
          key: key.publicKey,
          possession: key.proof,
          grants,
        }),
      ),
    );
    check();
    editor.value = false;
    question.value = '';
    explanation.value = '';
    await router.push('/quick-ballots/' + ballotId);
  });
}
async function vote(value: 0 | 1) {
  await perform(async (check, signal) => {
    const currentDetail = detail.value;
    if (!currentDetail || !verified.value || !open.value) throw Error('QUICK_CLOSED');
    if (!eligible.value) throw Error('QUICK_AUDIENCE');
    const status = await api.quickAccountStatus();
    check();
    if (!status.available || !status.context.record?.active) throw Error('QUICK_APPROVAL_REQUIRED');
    const current = (await api.quickOwnResponse(currentDetail.ballot.id, status.context.identity))
      .response;
    check();
    const expected = current?.revision ?? '0',
      next = String(BigInt(expected) + 1n),
      encrypted = await quickCrypto(
        {
          task: 'vote',
          context: quickResponseContext({
            chainId: currentDetail.chainId,
            runtime: currentDetail.runtime,
            ballotId: currentDetail.ballot.id,
            definitionHash: currentDetail.ballot.definition_hash,
            identity: status.context.identity,
            revision: next,
          }),
          key: currentDetail.ballot.key,
          choice: value,
        },
        signal,
      );
    check();
    if (encrypted.task !== 'vote') throw Error('QUICK_CRYPTO_FAILED');
    const receiptCtx = {
      ...base(),
      identity: status.context.identity,
      revision: next,
      ciphertext: encrypted.ciphertext,
    };
    let receipt = '';
    try {
      if (state.account?.encryptionKey)
        receipt = await sealAccountReceipt(receiptCtx, state.account.encryptionKey, value);
      else {
        const key = await receiptDeviceKey(deviceScope(), true);
        check();
        if (key) receipt = await sealDeviceReceipt(receiptCtx, key, value);
      }
    } catch {
      check();
      receiptMessage.value =
        'Your vote can be recorded, but its private receipt could not be saved.';
    }
    check();
    const useDefault = quickUsesDefault(status.context),
      credential = useDefault
        ? decodeQuickAnchor(status.context.record.approval)
        : status.context.anchor;
    if (!credential) throw Error('QUICK_APPROVAL_REQUIRED');
    const data = Bytes.from(
      encodeQuickBallot('respond', {
        actor: {
          runtime: status.context.runtime,
          authority: status.context.authority,
          account_id: status.context.record.id,
          credential: encodeQuickAnchor(credential),
        },
        ballot_id: currentDetail.ballot.id,
        expected_revision: expected,
        ciphertext: encrypted.ciphertext,
        proof: encrypted.proof,
        receipt,
      }),
    ).hexString;
    await approveQuick(
      status.context,
      { operation: 'submit', action: 'respond', data, useDefault },
      check,
    );
    check();
    await load();
    check();
    message.value = 'Response recorded.';
  });
}
async function removeVote() {
  await perform(async (check) => {
    if (!detail.value || !own.value?.active) throw Error('QUICK_RESPONSE_REMOVED');
    const status = await api.quickAccountStatus();
    check();
    if (!status.available || !status.context.record?.active) throw Error('QUICK_APPROVAL_REQUIRED');
    const useDefault = quickUsesDefault(status.context),
      credential = useDefault
        ? decodeQuickAnchor(status.context.record.approval)
        : status.context.anchor;
    if (!credential) throw Error('QUICK_APPROVAL_REQUIRED');
    const data = Bytes.from(
      encodeQuickBallot('remove', {
        actor: {
          runtime: status.context.runtime,
          authority: status.context.authority,
          account_id: status.context.record.id,
          credential: encodeQuickAnchor(credential),
        },
        ballot_id: detail.value.ballot.id,
        expected_revision: own.value.revision,
      }),
    ).hexString;
    await approveQuick(
      status.context,
      { operation: 'submit', action: 'remove', data, useDefault },
      check,
    );
    check();
    await load();
    check();
    message.value = 'Response removed.';
  });
}
async function closeBallot() {
  await perform(async (check) => {
    const member = ballotMember.value,
      value = detail.value;
    if (!member || !value || !exec.value) throw Error('EXECUTIVE_REQUIRED');
    const current = (await api.memberships()).find(
      (row) =>
        row.memberId === member.memberId &&
        row.dao.daoId === member.dao.daoId &&
        row.dao.chainId === member.dao.chainId &&
        row.dao.contract === member.dao.contract,
    );
    check();
    if (!current) throw Error('MEMBER_INACTIVE');
    await dispatchInstruction(
      makeInstruction(
        current.dao,
        current.memberId,
        current.nonce,
        Math.floor(Date.now() / 1000) + 120,
        value.source,
        'close',
        encodeQuickBallot('close', {
          runtime: value.runtime,
          dao_id: current.dao.daoId,
          member_id: current.memberId,
          ballot_id: value.ballot.id,
        }),
      ),
    );
    check();
    await api.quickAdvance(value.ballot.id);
    check();
    await load();
  });
}
async function tally() {
  await perform(async (check, signal) => {
    const value = detail.value;
    if (!value?.ballot.prepared) throw Error('QUICK_SNAPSHOT');
    const reader = readerIndex.value;
    const recipient = value.ballot.definition.readers[reader];
    if (!recipient) throw Error('QUICK_READER_REQUIRED');
    const responses: QuickBallotResponse[] = [];
    let cursor: string | undefined;
    do {
      const page = await api.quickResponses(value.ballot.id, cursor);
      check();
      responses.push(...page.responses);
      if (responses.length > 5000 || (page.next && page.next === cursor))
        throw Error('QUICK_SNAPSHOT');
      cursor = page.next ?? undefined;
      progress.value = `Loading encrypted responses: ${responses.length} of ${value.ballot.identities}`;
    } while (cursor);
    let history: Awaited<ReturnType<typeof api.quickArchive>> = { archives: [], complete: false };
    if (!value.grants || value.ballot.pruned || responses.length < value.ballot.identities) {
      progress.value = 'Loading the verified encrypted archive…';
      history = await api.quickArchive(value.ballot.id);
      check();
    }
    const domain = {
      chainId: value.chainId,
      runtime: value.runtime,
      source: value.source,
      ballot: value.ballot,
    };
    const grants = value.grants ?? archivedQuickGrants(domain, history.archives),
      grant = grants.grants[reader];
    if (!grant) throw Error('QUICK_READER_REQUIRED');
    const secret = await openQuickGrant({ ...base(), memberId: recipient.member_id }, grant);
    check();
    const proof = await quickCrypto(
      {
        task: 'tally',
        snapshot: {
          chainId: value.chainId,
          runtime: value.runtime,
          source: value.source,
          ballot: value.ballot,
          responses,
        },
        secret,
        grants,
        archives: history.archives,
      },
      signal,
      (update) => {
        check();
        progress.value =
          update.stage === 'verify'
            ? 'Verifying every encrypted response. Large ballots can take several minutes.'
            : update.stage === 'decrypt'
              ? `Reading encrypted responses: ${update.done} of ${update.total}`
              : 'Preparing the public totals proof…';
      },
    );
    check();
    if (proof.task !== 'tally') throw Error('QUICK_CRYPTO_FAILED');
    await api.quickFinalize(value.ballot.id, {
      expectedDefinitionHash: value.ballot.definition_hash,
      expectedRoot: value.ballot.response_root,
      up: proof.up,
      proof: proof.proof,
    });
    check();
    await load();
    message.value = 'The totals proof is published.';
  });
}
async function connectWallet() {
  await perform(async (check) => {
    if (selectedSigner.value === 'evm')
      await connectEvm(state.network?.environment === 'mainnet' ? 40 : 41);
    else {
      await connectNative();
      selectedSigner.value = 'native';
    }
    check();
  });
}
async function resume() {
  await perform(async (check) => {
    await resumeQuickApproval(check);
    check();
    await load();
  });
}
</script>
<template>
  <div class="page quick-page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">COMMUNITY QUESTIONS</p>
        <h1>Quick ballots</h1>
        <p class="lead">A question. One up or down response per Daclify account.</p>
      </div>
      <button v-if="available && state.account" class="secondary" :disabled="busy" @click="create">
        <Plus aria-hidden="true" />Ask a question
      </button>
    </header>
    <p v-if="!available" class="notice">Quick ballots are unavailable on this deployment.</p>
    <template v-else>
      <p class="field-help">
        Experimental testnet feature. Questions and participation are public. Individual choices are
        encrypted for the originating DAO’s fixed readers.
        <RouterLink to="/docs/quick-ballots">Privacy and verification</RouterLink>
      </p>
      <p v-if="error" class="alert" role="alert">{{ error }}</p>
      <p v-if="message" role="status">{{ message }}</p>
      <p v-if="loading" role="status">Loading ballot…</p>
      <p v-if="progress" role="status">{{ progress }}</p>
      <button v-if="busy" class="secondary" @click="cancel">Cancel current task</button>
      <p v-if="pendingQuick" class="notice">
        An earlier approval is awaiting confirmation.
        <button class="secondary" :disabled="busy" @click="resume">Check approval</button>
      </p>
      <form v-if="editor" class="panel quick-card" @submit.prevent="publish">
        <h2>Ask a question</h2>
        <fieldset :disabled="busy || readerLoading">
          <label for="quick-origin">Originating DAO</label
          ><select id="quick-origin" v-model="origin">
            <option value="" disabled>Choose your DAO</option>
            <option v-for="member in memberships" :key="member.dao.daoId" :value="member.dao.daoId">
              {{ name(member.dao.daoId) }}
            </option>
          </select>
          <p v-if="!memberships.length" class="notice">
            Current DAO executives can create Quick ballots.
          </p>
          <p v-else-if="!readerLoading && !exec" class="notice">
            Only a current executive of this DAO can ask a question.
          </p>
          <p v-if="module && !module.enabled" class="notice">
            Enable Quick ballots in
            <RouterLink :to="'/dao/' + origin + '/modules'">this DAO’s modules</RouterLink> first.
          </p>
          <label for="quick-question">Question</label
          ><input
            id="quick-question"
            v-model="question"
            required
            maxlength="256"
            placeholder="Should we…?"
          />
          <label for="quick-explanation">Details (optional)</label
          ><textarea id="quick-explanation" v-model="explanation" maxlength="4096" rows="3" />
          <label for="quick-audience">Who may respond?</label
          ><select id="quick-audience" v-model="allAccounts">
            <option :value="false">Members of selected DAOs</option>
            <option :value="true">All Daclify users</option>
          </select>
          <template v-if="!allAccounts"
            ><label for="quick-daos">Selected DAOs (up to 20)</label
            ><select id="quick-daos" v-model="audience" multiple size="4">
              <option v-for="dao in daos" :key="dao.reference.daoId" :value="dao.reference.daoId">
                {{ dao.title }}
              </option>
            </select></template
          >
          <label for="quick-deadline">Closes at (optional)</label
          ><input id="quick-deadline" v-model="deadline" type="datetime-local" />
          <p class="field-help">Without a deadline, a current executive closes it.</p>
        </fieldset>
        <p v-if="readers" class="field-help">
          Individual votes may be read by the {{ readers.readers.length }} executives listed when
          this ballot opens. Later executive appointments do not change that list.
        </p>
        <ActionSigner :member="originMember" compact />
        <div class="button-row">
          <button
            :disabled="
              busy ||
              readerLoading ||
              !exec ||
              !module?.enabled ||
              !question.trim() ||
              (!allAccounts && !audience.length) ||
              audience.length > 20
            "
            type="submit"
          >
            Publish question</button
          ><button class="secondary" type="button" :disabled="busy" @click="editor = false">
            Cancel
          </button>
        </div>
      </form>
      <article v-if="detail" class="panel quick-card" :aria-busy="busy || loading">
        <p class="eyebrow">{{ name(detail.ballot.dao_id) }} · {{ open ? 'OPEN' : 'CLOSED' }}</p>
        <h2>{{ detail.ballot.definition.question }}</h2>
        <p v-if="detail.ballot.definition.explanation" class="explanation">
          {{ detail.ballot.definition.explanation }}
        </p>
        <p>
          {{
            detail.ballot.definition.all_accounts
              ? 'All Daclify users'
              : detail.ballot.definition.audience.map(name).join(', ')
          }}
        </p>
        <p v-if="detail.ballot.definition.closes">
          Closes {{ time(detail.ballot.definition.closes) }}
        </p>
        <p v-else-if="detail.ballot.closed_at">Closed {{ time(detail.ballot.closed_at) }}</p>
        <p v-else>A current executive closes this ballot.</p>
        <p>{{ detail.ballot.count }} responses</p>
        <p v-if="verified" class="field-help">
          <Check aria-hidden="true" />{{
            result ? 'Totals proof verified' : 'Ballot encryption verified'
          }}
        </p>
        <div v-if="result" class="quick-totals">
          <p>Up: {{ result.up }}</p>
          <p>Down: {{ result.down }}</p>
        </div>
        <p v-else-if="!open && verified" class="notice">
          No verified result{{
            detail.ballot.prepared ? ' yet.' : ' yet. The encrypted snapshot is being prepared.'
          }}
        </p>
        <template v-if="verified && open">
          <RouterLink
            v-if="!state.account"
            class="button"
            :to="{ path: '/account', query: { returnTo: route.fullPath } }"
            >Sign in to vote</RouterLink
          >
          <template v-else>
            <p v-if="!context?.record?.active" class="notice">
              <RouterLink :to="setup">Set up voting approval</RouterLink> with your existing default
              method.
            </p>
            <template v-else>
              <p v-if="!eligible" class="notice">Join one of the selected DAOs to respond.</p>
              <p v-if="choice !== undefined">Your response: {{ choice === 1 ? 'Up' : 'Down' }}</p>
              <p v-else-if="own?.active">You have responded to this ballot.</p>
              <p v-if="receiptMessage" class="field-help">{{ receiptMessage }}</p>
              <p v-if="!state.account.encryptionKey" class="field-help">
                Your private receipt is readable only in this browser profile. Changing browsers
                does not add another vote.
              </p>
              <div class="button-row">
                <button
                  v-if="eligible"
                  :disabled="!ready"
                  :aria-pressed="choice === 1"
                  @click="vote(1)"
                >
                  <ArrowUp aria-hidden="true" />Vote up</button
                ><button
                  v-if="eligible"
                  class="secondary"
                  :disabled="!ready"
                  :aria-pressed="choice === 0"
                  @click="vote(0)"
                >
                  <ArrowDown aria-hidden="true" />Vote down</button
                ><button
                  v-if="own?.active"
                  class="text-button"
                  :disabled="!ready"
                  @click="removeVote"
                >
                  Remove response
                </button>
              </div>
              <button
                v-if="
                  selectedSigner !== 'vault' &&
                  !(selectedSigner === 'native' ? nativeWallet : evmWallet)
                "
                class="secondary"
                :disabled="busy"
                @click="connectWallet"
              >
                Connect your paired wallet
              </button>
              <RouterLink class="text-button" :to="setup">Approval settings</RouterLink>
            </template>
          </template>
        </template>
        <details>
          <summary>Who can read individual votes?</summary>
          <p>
            The readers below were fixed when this ballot opened. They can retain keys and copies
            they receive.
          </p>
          <ul>
            <li v-for="reader in detail.ballot.definition.readers" :key="reader.member_id">
              <RouterLink :to="'/users/' + detail.ballot.dao_id + '/' + reader.member_id"
                >{{ name(detail.ballot.dao_id) }} · member {{ reader.member_id }}</RouterLink
              >
            </li>
          </ul>
        </details>
        <template v-if="state.account && !open && detail.ballot.prepared && !result"
          ><p class="field-help">
            An original reader with the matching unlocked account keys can publish a public proof of
            the totals.
          </p>
          <button v-if="readerIndex >= 0" :disabled="busy || !vaultUnlocked" @click="tally">
            Verify and publish totals</button
          ><RouterLink v-if="!vaultUnlocked" class="text-button" :to="setup"
            >Unlock original account keys</RouterLink
          ></template
        >
        <template v-if="state.account && ballotMember && exec && open"
          ><ActionSigner :member="ballotMember" compact /><button
            class="secondary"
            :disabled="busy || !canSignMember(ballotMember)"
            @click="closeBallot"
          >
            Close ballot
          </button></template
        >
        <div class="button-row">
          <button class="secondary" :disabled="busy" @click="load">
            <RefreshCw aria-hidden="true" />Refresh</button
          ><RouterLink to="/quick-ballots">All Quick ballots</RouterLink>
        </div>
      </article>
      <section v-if="!id && !editor" class="quick-list" aria-label="Quick ballot questions">
        <label for="quick-filter">Originating DAO</label
        ><select id="quick-filter" v-model="filter" @change="after = ''">
          <option value="">All DAOs</option>
          <option v-for="dao in daos" :key="dao.reference.daoId" :value="dao.reference.daoId">
            {{ dao.title }}
          </option>
        </select>
        <p v-if="!loading && !list?.ballots.length">No Quick ballots yet.</p>
        <article v-for="ballot in list?.ballots" :key="ballot.id" class="panel quick-card">
          <p class="eyebrow">{{ name(ballot.dao_id) }}</p>
          <h2>
            <RouterLink :to="'/quick-ballots/' + ballot.id">{{
              ballot.definition.question
            }}</RouterLink>
          </h2>
          <p>{{ ballot.count }} responses · {{ ballot.closed_at ? 'Closed' : 'Open' }}</p>
        </article>
        <div class="button-row">
          <button v-if="after" class="secondary" @click="after = ''">First page</button
          ><button v-if="list?.next" class="secondary" @click="after = list?.next ?? ''">
            Next 25 questions
          </button>
        </div>
      </section>
    </template>
  </div>
</template>
<style scoped>
.quick-page {
  max-width: 1050px;
  margin: auto;
}
.quick-card {
  max-width: 720px;
}
.quick-card h2 {
  overflow-wrap: anywhere;
}
.quick-card fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 8px;
}
.quick-card fieldset label {
  margin-top: 10px;
}
.quick-card input,
.quick-card select,
.quick-card textarea {
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
}
.quick-card details {
  margin: 20px 0;
}
.quick-card .field-help svg {
  width: 16px;
  height: 16px;
  vertical-align: middle;
  margin-right: 6px;
}
.explanation {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.quick-totals {
  display: flex;
  gap: 28px;
  font-weight: 700;
}
.quick-list > select {
  max-width: 360px;
  margin-bottom: 20px;
}
.quick-page .button-row {
  flex-wrap: wrap;
  margin-top: 16px;
}
.page-heading {
  align-items: flex-start;
  flex-wrap: wrap;
}
.quick-card button svg,
.page-heading button svg {
  width: 18px;
  height: 18px;
  margin-right: 6px;
}
.quick-card:focus-within {
  scroll-margin-top: 80px;
}
@media (max-width: 600px) {
  .quick-card {
    padding: 20px;
  }
  .quick-totals {
    gap: 20px;
  }
}
</style>
