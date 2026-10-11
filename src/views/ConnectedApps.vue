<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { z } from 'zod';
import {
  ApiRoutes,
  ConnectedAppConfigSchema,
  AppSourceRecordSchema,
  daoPaymentKey,
  type DaoSummary,
  type UserMembership,
} from '@daclify/core-protocol';
import { encodeAction, makeInstruction } from '@daclify/core-protocol/sdk';
import { encodeActivity, encodeDecide } from '@daclify/modules/sdk';
import type { ModuleState } from '@daclify/modules';
import { api, friendlyError } from '../api/client';
import {
  relayInstruction,
  prepareAppEpoch,
  grantAppEpoch,
  decryptAppSnapshot,
  vaultUnlocked,
} from '../auth/session';
import { readAppResponse } from '@daclify/core-protocol/connected-apps';
import { downloadFile } from '../content/files';
import { canSignMember } from '../auth/action-signer';
import { useWorkspace } from '../state/workspace';
const props = defineProps<{ dao: DaoSummary; member: UserMembership | undefined }>(),
  state = useWorkspace();
const apps = ref<z.infer<typeof ApiRoutes.connectedApps.response>>([]),
  modules = ref<ModuleState>(),
  busy = ref(false),
  error = ref(''),
  notice = ref(''),
  name = ref(''),
  appId = ref('1'),
  origins = ref(''),
  callbacks = ref(''),
  sourceApi = ref(''),
  scoped = ref<z.infer<typeof ApiRoutes.governance.response>>(),
  sourceDetails = ref(new Map<string, z.infer<typeof AppSourceRecordSchema>>()),
  grantAppId = ref('1'),
  grantEpoch = ref(''),
  grantRecipient = ref('');
const admin = computed(() => !!props.member?.active && props.member.admin),
  ready = computed(() => !!props.member?.active && canSignMember(props.member)),
  activity = computed(() =>
    modules.value?.modules.find(
      (module) =>
        module.deployment.id === 'activity' &&
        module.enabled &&
        module.codeVerified &&
        module.compatible,
    ),
  );
let generation = 0;
const context = computed(() =>
  JSON.stringify([
    props.dao.reference,
    state.account?.id,
    props.member?.memberId,
    props.member?.active,
    props.member?.admin,
    props.member?.reviewer,
    vaultUnlocked.value,
  ]),
);
async function load() {
  const started = generation;
  if (!props.member?.active) return;
  try {
    const [registered, activityState, credentials] = await Promise.all([
      api.connectedApps(props.dao.reference.daoId),
      api.moduleState(props.dao.reference.daoId, {
        ballots: 'done',
        projects: 'done',
        schedules: 'done',
        rounds: 'done',
        applications: 'done',
        joinApplications: 'done',
        elections: 'done',
        terms: 'done',
        memberId: props.member.memberId,
      }),
      api.governance(props.dao.reference.daoId),
    ]);
    if (started !== generation) return;
    if (daoPaymentKey(activityState.dao) !== daoPaymentKey(props.dao.reference))
      throw new Error('DAO_REFERENCE');
    apps.value = registered;
    modules.value = activityState;
    scoped.value = credentials;
  } catch (cause) {
    if (started === generation) error.value = friendlyError(cause);
  }
}
watch(
  context,
  () => {
    generation++;
    apps.value = [];
    modules.value = undefined;
    scoped.value = undefined;
    sourceDetails.value = new Map();
    error.value = '';
    notice.value = '';
    busy.value = false;
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => generation++);
async function signed(target: string, action: string, data: Uint8Array) {
  const started = generation;
  await state.refresh();
  if (started !== generation) throw new Error('WALLET_CONTEXT_CHANGED');
  const current = state.memberships.find(
    (member) =>
      daoPaymentKey(member.dao) === daoPaymentKey(props.dao.reference) &&
      member.memberId === props.member?.memberId,
  );
  if (!current?.active || !canSignMember(current)) throw new Error('SIGNER_REQUIRED');
  return relayInstruction(
    makeInstruction(
      current.dao,
      current.memberId,
      current.nonce,
      Math.floor(Date.now() / 1000) + 120,
      target,
      action,
      data,
    ),
  );
}
async function configure(value: z.infer<typeof ConnectedAppConfigSchema>) {
  const started = generation;
  if (!admin.value || !ready.value || busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const staged = await api.stageConnectedApp(value);
    if (started !== generation) return;
    const member = props.member;
    if (!member) throw new Error('MEMBERSHIP_REQUIRED');
    await signed(
      props.dao.reference.contract,
      'setapp',
      encodeAction('setapp', {
        runtime: props.dao.reference.contract,
        dao_id: props.dao.reference.daoId,
        member_id: member.memberId,
        app_id: value.appId,
        target: value.activityAccount,
        revision: value.revision,
        config_hash: staged.configHash,
        enabled: value.enabled,
      }),
    );
    if (started !== generation) return;
    notice.value = value.enabled ? 'App registration confirmed.' : 'App suspended.';
    await load();
  } catch (cause) {
    if (started === generation) error.value = friendlyError(cause);
  } finally {
    if (started === generation) busy.value = false;
  }
}
async function register() {
  const deployed = activity.value;
  if (!deployed) return;
  try {
    const old = apps.value.find((app) => app.config.appId === appId.value);
    await configure(
      ConnectedAppConfigSchema.parse({
        dao: props.dao.reference,
        appId: appId.value,
        revision: (BigInt(old?.native?.revision ?? '0') + 1n).toString(),
        name: name.value,
        origins: origins.value.split(/\s+/).filter(Boolean),
        redirectUris: callbacks.value.split(/\s+/).filter(Boolean),
        activityAccount: deployed.deployment.account,
        ...(sourceApi.value ? { sourceApiBase: sourceApi.value } : {}),
        enabled: true,
      }),
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function toggle(app: z.infer<typeof ApiRoutes.connectedApps.response>[number]) {
  await configure({
    ...app.config,
    revision: (BigInt(app.native?.revision ?? '0') + 1n).toString(),
    enabled: !app.native?.enabled,
  });
}
function edit(app: z.infer<typeof ApiRoutes.connectedApps.response>[number]) {
  appId.value = app.config.appId;
  name.value = app.config.name;
  origins.value = app.config.origins.join('\n');
  callbacks.value = app.config.redirectUris.join('\n');
  sourceApi.value = app.config.sourceApiBase ?? '';
}
async function review(receipt: ModuleState['activities'][number], accepted: boolean) {
  const member = props.member,
    started = generation;
  if (!member || !activity.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await signed(
      activity.value.deployment.account,
      'reviewact',
      encodeActivity('reviewact', {
        runtime: props.dao.reference.contract,
        dao_id: props.dao.reference.daoId,
        member_id: member.memberId,
        app_id: receipt.app_id,
        receipt_id: receipt.id,
        source_revision: receipt.source_revision,
        accepted,
        evidence_cid: '',
        evidence_hash: '00'.repeat(32),
        key_epoch: '0',
      }),
    );
    if (started === generation) {
      notice.value = 'Review confirmed.';
      await load();
    }
  } catch (cause) {
    if (started === generation) error.value = friendlyError(cause);
  } finally {
    if (started === generation) busy.value = false;
  }
}
function newId() {
  return (crypto.getRandomValues(new BigUint64Array(1))[0] ?? 1n).toString();
}
async function operation(work: () => Promise<void>) {
  if (busy.value) return;
  const started = generation;
  busy.value = true;
  error.value = '';
  try {
    await work();
    if (started === generation) await load();
  } catch (cause) {
    if (started === generation) error.value = friendlyError(cause);
  } finally {
    if (started === generation) busy.value = false;
  }
}
function actor() {
  if (!props.member) throw new Error('MEMBERSHIP_REQUIRED');
  return {
    runtime: props.dao.reference.contract,
    dao_id: props.dao.reference.daoId,
    member_id: props.member.memberId,
  };
}
async function revoke(id: string) {
  await operation(async () => {
    await signed(
      props.dao.reference.contract,
      'delsession',
      encodeAction('delsession', { ...actor(), session_id: id }),
    );
    notice.value = 'Recording grant revoked.';
  });
}
async function rotate(app: z.infer<typeof ApiRoutes.connectedApps.response>[number]) {
  await operation(async () => {
    const started = generation;
    if (!activity.value || !app.native?.enabled) throw new Error('APP_DISABLED');
    const content = await api.content(props.dao.reference.daoId),
      epoch = newId(),
      self = content.members.find((m) => m.id === props.member?.memberId);
    if (!self) throw new Error('MEMBERSHIP_REQUIRED');
    const prepared = await prepareAppEpoch(props.dao.reference, app.config.appId, epoch, [self]),
      own = prepared.grants[0];
    if (!own || started !== generation) throw new Error('WALLET_CONTEXT_CHANGED');
    await signed(
      activity.value.deployment.account,
      'newappkey',
      encodeActivity('newappkey', {
        ...actor(),
        app_id: app.config.appId,
        key_epoch: epoch,
        security_epoch: app.native.security_epoch,
        app_revision: app.native.revision,
        key_commitment: prepared.commitment,
        self_grant: own.envelope,
      }),
    );
    grantAppId.value = app.config.appId;
    grantEpoch.value = epoch;
    notice.value =
      'New snapshot key created with your own encrypted grant. Grant access separately to other members.';
  });
}
async function grant() {
  await operation(async () => {
    const started = generation;
    if (!activity.value || !props.member) throw new Error('MEMBERSHIP_REQUIRED');
    const [keys, content] = await Promise.all([
        api.appKeys(props.dao.reference.daoId, grantAppId.value),
        api.content(props.dao.reference.daoId),
      ]),
      key = keys.keys.find((k) => k.id === grantEpoch.value),
      own = keys.grants.find((g) => g.key_epoch === grantEpoch.value),
      recipient = content.members.find((m) => m.id === grantRecipient.value);
    if (!key || !own || !recipient) throw new Error('APP_KEY_REQUIRED');
    const envelope = await grantAppEpoch(
      props.dao.reference,
      grantAppId.value,
      props.member.memberId,
      key,
      own,
      recipient,
    );
    if (started !== generation) throw new Error('WALLET_CONTEXT_CHANGED');
    await signed(
      activity.value.deployment.account,
      'grantappkey',
      encodeActivity('grantappkey', {
        ...actor(),
        app_id: grantAppId.value,
        key_epoch: key.id,
        recipient: recipient.id,
        encryption_key: recipient.encryption_key,
        envelope,
      }),
    );
    notice.value = 'Encrypted snapshot access granted.';
  });
}
async function details(receipt: ModuleState['activities'][number]) {
  await operation(async () => {
    const started = generation,
      app = apps.value.find((a) => a.config.appId === receipt.app_id);
    if (!app) throw new Error('APP_UNKNOWN');
    const access = await api.appSourceAccess(app.clientId),
      url = new URL(access.apiBase);
    url.pathname = url.pathname.replace(/\/$/, '') + '/v1/sources/' + receipt.source_id;
    const response = await fetch(url, {
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      headers: { authorization: 'Bearer ' + access.accessToken },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('APP_SOURCE_UNAVAILABLE');
    const text = new TextDecoder().decode(await readAppResponse(response, 65536));
    const value = AppSourceRecordSchema.parse(JSON.parse(text));
    if (value.sourceId !== receipt.source_id) throw new Error('APP_SOURCE_MISMATCH');
    if (started === generation) sourceDetails.value.set(receipt.id, value);
  });
}
async function snapshot(receipt: ModuleState['activities'][number], event: Event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;
  const file = input.files[0];
  input.value = '';
  await operation(async () => {
    const started = generation;
    if (!props.member || file.size > 5 * 1024 * 1024) throw new Error('FILE_TOO_LARGE');
    const keys = await api.appKeys(props.dao.reference.daoId, receipt.app_id),
      key = keys.keys.find((k) => k.id === receipt.key_epoch),
      own = keys.grants.find((g) => g.key_epoch === receipt.key_epoch);
    if (!key || !own) throw new Error('APP_KEY_REQUIRED');
    const plaintext = await decryptAppSnapshot(
      {
        dao: props.dao.reference,
        appId: receipt.app_id,
        keyEpoch: receipt.key_epoch,
        sourceId: receipt.source_id,
        sourceRevision: receipt.source_revision,
        eventId: receipt.event_id,
      },
      props.member.memberId,
      key,
      own,
      new Uint8Array(await file.arrayBuffer()),
      receipt.evidence_hash,
    );
    if (started !== generation) throw new Error('WALLET_CONTEXT_CHANGED');
    downloadFile(plaintext, {
      version: 1,
      filename: 'activity-' + receipt.id + '.json',
      mediaType: 'application/json',
    });
    notice.value = 'Snapshot verified and decrypted.';
  });
}
async function decision(receipt: ModuleState['activities'][number]) {
  await operation(async () => {
    const started = generation,
      decide = modules.value?.modules.find(
        (m) => m.deployment.id === 'decide' && m.enabled && m.compatible && m.codeVerified,
      ),
      policy = scoped.value?.policy?.config;
    if (!decide || !policy || !activity.value) throw new Error('GOVERNANCE_POLICY_REQUIRED');
    const ballot = newId(),
      metadata = {
        type: 'connected-activity-v1',
        daoId: props.dao.reference.daoId,
        appId: receipt.app_id,
        receiptId: receipt.id,
        sourceId: receipt.source_id,
        sourceRevision: receipt.source_revision,
      };
    await signed(
      decide.deployment.account,
      'open',
      encodeDecide('open', {
        ...actor(),
        ballot_id: ballot,
        kind: policy.kind,
        choices: 2,
        duration: policy.duration,
        quorum: policy.quorum,
        approval: policy.approval,
        metadata: JSON.stringify(metadata),
      }),
    );
    if (started !== generation) throw new Error('WALLET_CONTEXT_CHANGED');
    await signed(
      activity.value.deployment.account,
      'linkdecision',
      encodeActivity('linkdecision', {
        ...actor(),
        app_id: receipt.app_id,
        receipt_id: receipt.id,
        decide: decide.deployment.account,
        ballot_id: ballot,
      }),
    );
    notice.value = 'Advisory ballot opened and linked to this exact source revision.';
  });
}
async function more() {
  const cursor = modules.value?.next.activities;
  if (!cursor) return;
  const started = generation;
  busy.value = true;
  try {
    const page = await api.moduleState(props.dao.reference.daoId, {
      activities: cursor,
      ballots: 'done',
      projects: 'done',
      schedules: 'done',
      rounds: 'done',
      applications: 'done',
      joinApplications: 'done',
      elections: 'done',
      terms: 'done',
    });
    if (started === generation && modules.value) {
      modules.value.activities.push(...page.activities);
      modules.value.activityReviews.push(...page.activityReviews);
      modules.value.activityDecisions.push(...page.activityDecisions);
      modules.value.next.activities = page.next.activities;
    }
  } catch (cause) {
    if (started === generation) error.value = friendlyError(cause);
  } finally {
    if (started === generation) busy.value = false;
  }
}
</script>
<template>
  <section class="panel">
    <div class="panel-heading">
      <h2>Connected apps</h2>
      <RouterLink to="/docs/connected-apps">Developer guide ↗</RouterLink>
    </div>
    <p v-if="!member?.active">Sign in as an active DAO member to use connected apps.</p>
    <template v-else>
      <p>Use one DAO membership across your community’s apps. Each app keeps its own database.</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <p v-if="!activity">
        Enable Community Activity in
        <RouterLink :to="`/dao/${dao.reference.daoId}/modules`">DAO modules</RouterLink> to register
        apps and record selected activity.
      </p>
      <article v-for="app in apps" :key="app.clientId" class="app-card">
        <h3>{{ app.config.name }}</h3>
        <p>
          {{
            !app.native
              ? 'Awaiting native registration'
              : app.native.enabled
                ? 'Enabled'
                : 'Suspended'
          }}
          · App {{ app.config.appId }}
        </p>
        <dl>
          <dt>Client ID</dt>
          <dd class="mono wrap">{{ app.clientId }}</dd>
          <dt>Approved origins</dt>
          <dd class="wrap">{{ app.config.origins.join(', ') }}</dd>
        </dl>
        <div v-if="admin" class="actions">
          <button class="secondary" :disabled="busy" @click="edit(app)">Edit registration</button
          ><button class="secondary" :disabled="busy || !ready" @click="toggle(app)">
            {{ app.native?.enabled ? 'Suspend app' : 'Enable app' }}</button
          ><button
            :disabled="busy || !ready || !vaultUnlocked || !app.native?.enabled"
            @click="rotate(app)"
          >
            Rotate snapshot key
          </button>
        </div>
      </article>
      <details v-if="admin && activity">
        <summary>Register or update an app</summary>
        <form @submit.prevent="register">
          <label>App ID<input v-model="appId" inputmode="numeric" required /></label
          ><label>App name<input v-model="name" maxlength="80" required /></label
          ><label
            >Approved HTTPS origins<textarea
              v-model="origins"
              placeholder="https://garden.example"
              required
            /></label
          ><label
            >Exact HTTPS login callbacks<textarea
              v-model="callbacks"
              placeholder="https://garden.example/login/callback"
              required
            />
          </label>
          <label
            >Source API base (optional)<input
              v-model="sourceApi"
              type="url"
              placeholder="https://garden.example"
          /></label>
          <p>
            Saving signs a new native configuration revision. Existing app sign-ins and recording
            grants must be renewed.
          </p>
          <button :disabled="busy || !ready">Register app</button>
        </form>
      </details>
      <details>
        <summary>Your app recording grants</summary>
        <p>Revoking a grant stops further recording with that browser key.</p>
        <p
          v-for="credential in scoped?.sessions.filter(
            (c) =>
              c.member_id === member?.memberId &&
              c.permissions.some((p) => p.action === 'recordact'),
          )"
          :key="credential.id"
        >
          Grant {{ credential.id }} · expires
          {{ new Date(credential.expires * 1000).toLocaleString() }}
          <button :disabled="busy || !ready" @click="revoke(credential.id)">Revoke</button>
        </p>
      </details>
      <details v-if="admin">
        <summary>Grant snapshot access</summary>
        <form @submit.prevent="grant">
          <label>App ID<input v-model="grantAppId" required /></label
          ><label>Key epoch<input v-model="grantEpoch" required /></label
          ><label>Recipient member ID<input v-model="grantRecipient" required /></label>
          <p>
            Snapshot access is separate from signing. An authorised member can retain previously
            decrypted history.
          </p>
          <button :disabled="busy || !ready || !vaultUnlocked">Grant encrypted access</button>
        </form>
      </details>
      <h3>Selected activity</h3>
      <p v-if="!modules?.activities.length">No selected activity recorded yet.</p>
      <article v-for="receipt in modules?.activities" :key="receipt.id" class="app-card">
        <h4>
          {{
            apps.find((app) => app.config.appId === receipt.app_id)?.config.name ??
            `App ${receipt.app_id}`
          }}
          · Receipt {{ receipt.id }}
        </h4>
        <p>
          Member {{ receipt.actor }}
          {{ receipt.kind === 1 ? 'completed an item' : 'submitted an item for review' }} ·
          {{ ['Recorded', 'Awaiting review', 'Accepted', 'Rejected'][receipt.status] }}
        </p>
        <p class="mono wrap">
          Source {{ receipt.source_id }} · Revision {{ receipt.source_revision }}
        </p>
        <p v-if="receipt.evidence_cid" class="wrap">
          Encrypted snapshot: {{ receipt.evidence_cid }}
        </p>
        <button
          v-if="apps.find((a) => a.config.appId === receipt.app_id)?.config.sourceApiBase"
          class="secondary"
          :disabled="busy"
          @click="details(receipt)"
        >
          Load current app details
        </button>
        <div v-if="sourceDetails.get(receipt.id)">
          <h5>{{ sourceDetails.get(receipt.id)?.title }}</h5>
          <p>{{ sourceDetails.get(receipt.id)?.details }}</p>
          <p v-if="sourceDetails.get(receipt.id)?.sourceRevision !== receipt.source_revision">
            The app has changed since this receipt. This is current information.
          </p>
        </div>
        <label v-if="receipt.evidence_cid && vaultUnlocked"
          >Open saved encrypted snapshot<input
            type="file"
            accept="application/json"
            :disabled="busy"
            @change="snapshot(receipt, $event)"
        /></label>
        <button
          v-if="
            (member.admin || member.reviewer) &&
            !modules?.activityDecisions.some((link) => link.id === receipt.id)
          "
          :disabled="busy || !ready"
          @click="decision(receipt)"
        >
          Open linked DAO decision
        </button>
        <div
          v-if="
            receipt.kind === 2 &&
            receipt.status === 1 &&
            member.memberId !== receipt.actor &&
            (member.admin || member.reviewer)
          "
          class="actions"
        >
          <button :disabled="busy || !ready" @click="review(receipt, true)">Accept</button
          ><button class="secondary" :disabled="busy || !ready" @click="review(receipt, false)">
            Reject
          </button>
        </div>
        <p v-if="modules?.activityReviews.find((review) => review.id === receipt.id)">
          Reviewed by member
          {{ modules.activityReviews.find((review) => review.id === receipt.id)?.reviewer }}
        </p>
        <RouterLink
          v-if="modules?.activityDecisions.some((link) => link.id === receipt.id)"
          :to="`/dao/${dao.reference.daoId}/decide`"
          >View linked DAO decision</RouterLink
        >
      </article>
      <button v-if="modules?.next.activities" class="secondary" :disabled="busy" @click="more">
        Load more activity
      </button>
    </template>
  </section>
</template>
<style scoped>
.app-card {
  padding: 1rem 0;
  border-top: 1px solid var(--border);
}
.actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}
form {
  display: grid;
  gap: 1rem;
  padding-top: 1rem;
}
textarea {
  min-height: 5rem;
}
</style>
