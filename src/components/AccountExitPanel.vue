<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { z } from 'zod';
import {
  ExitPreflightSchema,
  ExitOperationSchema,
  ExitIntentSchema,
  ExitCapabilitySchema,
  DaoSummarySchema,
  UserMembershipSchema,
  ExitSubmissionSchema,
  formatUnits,
  type ExitPreflight,
  type ExitOperation,
  type ExitReport,
  type ExitIntent,
} from '@daclify/core-protocol';
import { encodeAction, makeInstruction } from '@daclify/core-protocol/sdk';
import { api, friendlyError } from '../api/client';
import { resolveApiUrl } from '../api/networks';
import { useWorkspace } from '../state/workspace';
import {
  buildExitIntent,
  exitMembershipKey,
  newExitCapability,
  signAccountExit,
} from '../auth/account-exit';
import { canUseVaultKey, savedVault, downloadBackup, lockVault } from '../auth/session';
import PrivateHandoverPanel from './PrivateHandoverPanel.vue';
import { prepareExit } from '../content/treasury';
import { selectedSigner } from '../auth/action-signer';
import { nativeWallet, connectNative } from '../auth/telos-zero';
import { evmWallet, connectEvm } from '../auth/telos-evm';
import { dispatchInstruction } from '../auth/action-signer';
function exitApiLocation() {
  return new URL(resolveApiUrl('/v1'), globalThis.location.origin).toString();
}
const state = useWorkspace(),
  preflight = ref<ExitPreflight>(),
  operation = ref<ExitOperation>(),
  report = ref<ExitReport>(),
  busy = ref(false),
  error = ref(''),
  confirmed = ref(false),
  mode = ref<ExitIntent['mode']>('leave-all'),
  choices = ref<Record<string, ExitIntent['memberships'][number]['choice']>>({}),
  kitPassword = ref('');
const reviewedIntent = ref<ExitIntent>(),
  reviewedHandovers = ref<Record<string, string>>({});
const LocalReportSchema = z.strictObject({
  version: z.literal(1),
  api: z.url().max(2048),
  operation: ExitOperationSchema,
  intent: ExitIntentSchema,
  preflight: ExitPreflightSchema,
  daos: z.array(DaoSummarySchema).max(256),
});
let summaryRecords: ReturnType<typeof DaoSummarySchema.parse>[] = [],
  location = exitApiLocation();
const PendingSchema = z.strictObject({
  version: z.literal(1),
  api: z.url().max(2048),
  capability: ExitCapabilitySchema,
  intent: ExitIntentSchema,
  preflight: ExitPreflightSchema,
  daos: z.array(DaoSummarySchema).max(256),
  createdAt: z.iso.datetime(),
});
const PendingSettlementSchema = z.strictObject({
  version: z.literal(1),
  api: z.url().max(2048),
  operationId: z.uuid(),
  memberKey: z.string().max(256),
  packet: ExitSubmissionSchema,
});
const settlement = ref<ReturnType<typeof PendingSettlementSchema.parse>>(),
  settlementState = ref(''),
  destination = ref(''),
  settlementAmount = ref(''),
  settlementKind = ref<'withdraw' | 'unstake'>('withdraw');
const storageKey = () => 'daclify.exit.v1:' + location;
const available = computed(() => state.network?.capabilities.includes('account-exit-v1'));
const memberships = computed(() => preflight.value?.memberships ?? []);
function title(member: ExitPreflight['memberships'][number]) {
  return (
    summaryRecords.find(
      (dao) =>
        dao.reference.daoId === member.reference.daoId &&
        dao.reference.contract === member.reference.contract &&
        dao.reference.chainId === member.reference.chainId,
    )?.title ?? 'DAO ' + member.reference.daoId
  );
}
function tokenAmount(member: ExitPreflight['memberships'][number], amount: string) {
  const dao = summaryRecords.find(
    (row) =>
      row.reference.daoId === member.reference.daoId &&
      row.reference.contract === member.reference.contract &&
      row.reference.chainId === member.reference.chainId,
  );
  return dao
    ? formatUnits(BigInt(amount), dao.token.precision) + ' ' + dao.token.symbol
    : amount + ' native base units (token details unavailable)';
}
function save() {
  if (operation.value && preflight.value && reviewedIntent.value)
    localStorage.setItem(
      storageKey(),
      JSON.stringify(
        LocalReportSchema.parse({
          version: 1,
          api: location,
          operation: operation.value,
          intent: reviewedIntent.value,
          preflight: preflight.value,
          daos: summaryRecords,
        }),
      ),
    );
}
async function reviewedHandover(member: ExitPreflight['memberships'][number], commitment: string) {
  reviewedHandovers.value[exitMembershipKey(member)] = commitment;
  await refresh();
}
async function refresh() {
  if (busy.value || operation.value || !state.account || !available.value) return;
  try {
    const account = state.account.id,
      url = exitApiLocation();
    const result = await api.exitPreflight();
    if (account !== state.account?.id || url !== exitApiLocation()) return;
    if (JSON.stringify(result) !== JSON.stringify(preflight.value)) confirmed.value = false;
    preflight.value = result;
    summaryRecords = state.daos
      .filter((dao) =>
        result.memberships.some(
          (member) => JSON.stringify(member.reference) === JSON.stringify(dao.reference),
        ),
      )
      .slice(0, 256);
    for (const member of result.memberships) {
      try {
        const dao = await api.dao(member.reference.daoId);
        if (JSON.stringify(dao.reference) === JSON.stringify(member.reference)) {
          summaryRecords = summaryRecords.filter(
            (row) => JSON.stringify(row.reference) !== JSON.stringify(dao.reference),
          );
          summaryRecords.push(dao);
        }
      } catch {
        /* Offline summaries remain explicitly marked by the native review. */
      }
    }
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
watch(
  () => [state.account?.id, available.value],
  () => void refresh(),
);
function readLocal() {
  try {
    return LocalReportSchema.safeParse(JSON.parse(localStorage.getItem(storageKey()) ?? 'null'));
  } catch {
    return LocalReportSchema.safeParse(null);
  }
}
function readPending() {
  try {
    return PendingSchema.safeParse(
      JSON.parse(localStorage.getItem(storageKey() + ':pending') ?? 'null'),
    );
  } catch {
    return PendingSchema.safeParse(null);
  }
}
onMounted(async () => {
  try {
    const pending = PendingSettlementSchema.safeParse(
      JSON.parse(localStorage.getItem(storageKey() + ':settlement') ?? 'null'),
    );
    if (pending.success && pending.data.api === location) {
      settlement.value = pending.data;
      settlementState.value = 'Awaiting exact transaction reconciliation';
    }
  } catch {
    error.value = 'The saved settlement needs review.';
  }
  const parsed = readLocal();
  if (parsed.success && parsed.data.api === location) {
    operation.value = parsed.data.operation;
    preflight.value = parsed.data.preflight;
    summaryRecords = parsed.data.daos;
    reviewedIntent.value = parsed.data.intent;
    if (Date.parse(parsed.data.operation.expiresAt) > Date.now()) await refreshReport();
    else report.value = { ...parsed.data.operation, state: 'expired' };
  } else {
    localStorage.removeItem(storageKey());
    const pending = readPending();
    if (
      pending.success &&
      pending.data.api === location &&
      Date.parse(pending.data.createdAt) > Date.now() - 30 * 86400000
    ) {
      try {
        const recovered = await api.exitStatus(pending.data.capability);
        operation.value = { ...recovered, statusCapability: pending.data.capability };
        report.value = recovered;
        preflight.value = pending.data.preflight;
        summaryRecords = pending.data.daos;
        reviewedIntent.value = pending.data.intent;
        save();
        localStorage.removeItem(storageKey() + ':pending');
      } catch (cause) {
        error.value = friendlyError(cause);
        await refresh();
      }
    } else {
      localStorage.removeItem(storageKey() + ':pending');
      await refresh();
    }
  }
});
async function refreshReport() {
  const current = operation.value;
  if (!current) return;
  busy.value = true;
  try {
    checkOperator();
    report.value = await api.exitStatus(current.statusCapability);
    operation.value = { ...report.value, statusCapability: current.statusCapability };
    save();
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
function checkOperator() {
  if (location !== exitApiLocation()) throw Error('WALLET_CONTEXT_CHANGED');
}
async function begin() {
  if (!preflight.value || !confirmed.value || operation.value) return;
  busy.value = true;
  error.value = '';
  try {
    checkOperator();
    const latest = await api.exitPreflight();
    if (JSON.stringify(latest) !== JSON.stringify(preflight.value))
      throw Error('EXIT_MEMBERSHIP_CHANGED');
    for (const member of latest.memberships.filter(
      (row) => row.active && row.admin && !row.soleMember,
    )) {
      const dao = summaryRecords.find(
        (row) => JSON.stringify(row.reference) === JSON.stringify(member.reference),
      );
      if (!dao) throw Error('EXIT_DAO_REVIEW_REQUIRED');
      if (dao.privacy !== 'public') {
        const handover = await api.daoHandover(member.reference.daoId);
        if (
          !handover?.accepted ||
          handover.status !== 'ready' ||
          handover.departing !== member.memberId ||
          reviewedHandovers.value[exitMembershipKey(member)] !== handover.commitment
        )
          throw Error('PRIVATE_HANDOVER_REQUIRED');
        choices.value[exitMembershipKey(member)] = 'handover';
      }
    }
    const intent = buildExitIntent(latest, { mode: mode.value, memberships: choices.value });
    reviewedIntent.value = intent;
    const capability = newExitCapability();
    localStorage.setItem(
      storageKey() + ':pending',
      JSON.stringify(
        PendingSchema.parse({
          version: 1,
          api: location,
          capability,
          intent,
          preflight: latest,
          daos: summaryRecords,
          createdAt: new Date().toISOString(),
        }),
      ),
    );
    operation.value = await api.beginExit(intent, capability);
    report.value = operation.value;
    preflight.value = latest;
    save();
    localStorage.removeItem(storageKey() + ':pending');
    if (intent.mode === 'delete-account') {
      state.account = undefined;
      state.memberships = [];
    }
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function nativeStep(
  member: ExitPreflight['memberships'][number],
  action: 'delprofile' | 'leave' | 'startclose' | 'closedao',
) {
  const current = operation.value;
  if (!current) return;
  if (Date.parse(current.expiresAt) <= Date.now()) {
    error.value =
      'This temporary workflow expired. Retained claims and stake still use your original signing credentials through the settlement controls below.';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    checkOperator();
    const records = await api.content(member.reference.daoId),
      person = records.members.find((row) => row.id === member.memberId);
    if (JSON.stringify(records.dao) !== JSON.stringify(member.reference) || !person)
      throw Error('EXIT_SIGNER_REQUIRED');
    const actor = {
      runtime: member.reference.contract,
      dao_id: member.reference.daoId,
      member_id: member.memberId,
    };
    const data =
      action === 'delprofile' ? encodeAction('delprofile', { actor }) : encodeAction(action, actor);
    const request = makeInstruction(
        member.reference,
        member.memberId,
        person.nonce,
        Math.floor(Date.now() / 1000) + 300,
        member.reference.contract,
        action,
        data,
      ),
      stepId = action + '-' + crypto.randomUUID();
    const signed = await signAccountExit(
      current.id,
      stepId,
      request,
      person.signing_key,
      person.native_account,
      kitPassword.value,
    );
    kitPassword.value = '';
    checkOperator();
    report.value = await api.exitStep(current.id, stepId, signed);
    operation.value = { ...report.value, statusCapability: current.statusCapability };
    save();
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function leaveOne(member: ExitPreflight['memberships'][number]) {
  busy.value = true;
  error.value = '';
  try {
    checkOperator();
    const latest = await api.exitPreflight(),
      current = latest.memberships.find(
        (row) => exitMembershipKey(row) === exitMembershipKey(member),
      );
    if (!current?.active) throw Error('EXIT_MEMBERSHIP_CHANGED');
    const actor = {
      runtime: current.reference.contract,
      dao_id: current.reference.daoId,
      member_id: current.memberId,
    };
    await dispatchInstruction(
      makeInstruction(
        current.reference,
        current.memberId,
        current.nonce,
        Math.floor(Date.now() / 1000) + 300,
        current.reference.contract,
        'leave',
        encodeAction('leave', actor),
      ),
    );
    await state.refresh();
    preflight.value = await api.exitPreflight();
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
function downloadReport() {
  if (!operation.value || !preflight.value) return;
  save();
  const file = localStorage.getItem(storageKey());
  if (!file) return;
  const url = URL.createObjectURL(new Blob([file], { type: 'application/json' })),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'daclify-account-exit-report.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function importReport(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const file = target.files?.[0];
  if (!file) return;
  if (file.size > 1048576) {
    error.value = 'The report is too large.';
    return;
  }
  try {
    const value = LocalReportSchema.parse(JSON.parse(await file.text()));
    if (value.api !== exitApiLocation()) throw Error('OPERATOR_DAO');
    operation.value = value.operation;
    preflight.value = value.preflight;
    summaryRecords = value.daos;
    reviewedIntent.value = value.intent;
    save();
    await refreshReport();
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function reviewNativeDuties(member: ExitPreflight['memberships'][number]) {
  busy.value = true;
  try {
    checkOperator();
    const [records, dao] = await Promise.all([
        api.content(member.reference.daoId),
        api.dao(member.reference.daoId),
      ]),
      person = records.members.find((row) => row.id === member.memberId);
    checkOperator();
    if (
      !person ||
      JSON.stringify(records.dao) !== JSON.stringify(member.reference) ||
      JSON.stringify(dao.reference) !== JSON.stringify(member.reference)
    )
      throw Error('EXIT_MEMBERSHIP_CHANGED');
    if (preflight.value)
      preflight.value = {
        ...preflight.value,
        memberships: preflight.value.memberships.map((row) =>
          exitMembershipKey(row) === exitMembershipKey(member)
            ? {
                ...row,
                nonce: person.nonce,
                active: person.active,
                admin: person.admin,
                claim: person.claim,
                stake: person.stake,
                nativeAccount: person.native_account || null,
                soleMember: dao.members === 1,
                lifecycle: dao.lifecycle ?? 'active',
                reason: 'DAO_AVAILABLE',
              }
            : row,
        ),
      };
    summaryRecords = summaryRecords.filter(
      (row) => JSON.stringify(row.reference) !== JSON.stringify(dao.reference),
    );
    summaryRecords.push(dao);
    save();
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function connectExitWallet() {
  busy.value = true;
  try {
    checkOperator();
    if (selectedSigner.value === 'native') {
      if (!state.network) throw Error('NATIVE_WALLET_MISSING');
      await connectNative();
    } else if (selectedSigner.value === 'evm') {
      const chain =
        state.network?.chainId ===
        '1eaa0824707c8c16bd25145493bf062aecddfeb56c736f6ba6397f3195f33c9f'
          ? 41
          : 40;
      await connectEvm(chain);
    }
    checkOperator();
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function settle(member: ExitPreflight['memberships'][number]) {
  const current = operation.value;
  if (!current || settlement.value) return;
  busy.value = true;
  error.value = '';
  try {
    checkOperator();
    const [records, dao] = await Promise.all([
        api.content(member.reference.daoId),
        api.dao(member.reference.daoId),
      ]),
      person = records.members.find((row) => row.id === member.memberId);
    if (
      !person ||
      JSON.stringify(records.dao) !== JSON.stringify(member.reference) ||
      JSON.stringify(dao.reference) !== JSON.stringify(member.reference)
    )
      throw Error('EXIT_SIGNER_REQUIRED');
    const identity = UserMembershipSchema.parse({
      dao: member.reference,
      memberId: person.id,
      nonce: person.nonce,
      active: person.active,
      admin: person.admin,
      reviewer: person.reviewer,
      credits: person.credits,
      claim: person.claim,
      stake: person.stake,
      nativeAccount: person.native_account,
      custody: person.custody === 0 ? 'user-controlled' : 'managed',
      signingKey: person.signing_key,
    });
    const params = prepareExit(
        dao,
        identity,
        settlementKind.value,
        destination.value,
        settlementAmount.value,
      ),
      request = makeInstruction(
        member.reference,
        member.memberId,
        person.nonce,
        Math.floor(Date.now() / 1000) + 300,
        member.reference.contract,
        settlementKind.value,
        encodeAction(settlementKind.value, params),
      ),
      stepId = 'settle-' + crypto.randomUUID();
    const signed = await signAccountExit(
      current.id,
      stepId,
      request,
      person.signing_key,
      person.native_account,
      kitPassword.value,
    );
    kitPassword.value = '';
    checkOperator();
    const packet = await api.prepareExitSettlement(signed);
    checkOperator();
    settlement.value = PendingSettlementSchema.parse({
      version: 1,
      api: location,
      operationId: current.id,
      memberKey: exitMembershipKey(member),
      packet,
    });
    localStorage.setItem(storageKey() + ':settlement', JSON.stringify(settlement.value));
    settlementState.value = 'Prepared';
    await api.submitExitSettlement(packet);
    await reconcileSettlement();
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function reconcileSettlement() {
  const current = settlement.value;
  if (!current) return;
  try {
    checkOperator();
    const receipt = await api.exitSettlementReceipt(current.packet);
    checkOperator();
    current.packet.cursor = receipt.cursor;
    localStorage.setItem(storageKey() + ':settlement', JSON.stringify(current));
    settlementState.value =
      receipt.state === 'confirmed'
        ? 'Settlement confirmed'
        : receipt.state === 'unavailable'
          ? 'Receipt unavailable. Review this exact transaction before preparing another payment.'
          : 'Awaiting irreversible confirmation';
    if (receipt.state === 'confirmed') {
      localStorage.removeItem(storageKey() + ':settlement');
      settlement.value = undefined;
    }
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function retrySettlement() {
  const current = settlement.value;
  if (!current) return;
  busy.value = true;
  try {
    if (current.operationId !== operation.value?.id || current.api !== location)
      throw Error('EXIT_SETTLEMENT_CONTEXT');
    await reconcileSettlement();
    if (!settlement.value || settlementState.value.startsWith('Receipt unavailable')) return;
    checkOperator();
    await api.submitExitSettlement(current.packet);
    await reconcileSettlement();
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
function componentTitle(component: ExitReport['components'][number]): string {
  const names: Record<string, string> = {
    hosted: 'Hosted account',
    native: 'Native DAO memberships',
    profiles: 'Controlled profile-key envelopes',
    apps: 'Independent mini-app cleanup',
    backups: 'Controlled backups',
    'shared-evidence': 'Required shared history',
    'recovery-provider': 'Controlled recovery-provider objects',
  };
  const name = names[component.id];
  if (name) return name;
  const member = memberships.value.find(
    (value) =>
      component.id === 'membership:' + exitMembershipKey(value) ||
      component.id === 'native-profile:' + exitMembershipKey(value) ||
      component.id ===
        'hosted-dao:' +
          [value.reference.chainId, value.reference.contract, value.reference.daoId].join(':') ||
      component.id ===
        'dao-lifecycle:' +
          [value.reference.chainId, value.reference.contract, value.reference.daoId].join(':'),
  );
  if (!member) return component.id;
  return (
    (component.id.startsWith('native-profile:')
      ? 'Current native profile in '
      : component.id.startsWith('hosted-dao:')
        ? 'Hosted services for '
        : component.id.startsWith('dao-lifecycle:')
          ? 'Native closure of '
          : 'Membership in ') + title(member)
  );
}
function selectClosure(event: Event, member: ExitPreflight['memberships'][number]) {
  if (event.target instanceof HTMLInputElement)
    choices.value[exitMembershipKey(member)] = event.target.checked ? 'close' : 'leave';
}
function backup() {
  const kit = savedVault();
  if (kit) downloadBackup(kit);
}
function clearLocal() {
  lockVault();
  localStorage.removeItem('daclify.vault.v1');
  confirmed.value = false;
}
</script>
<template>
  <section class="exit-panel panel" :aria-busy="busy">
    <h1>Leave DAOs and delete your account</h1>
    <p>Leaving, closing a DAO and removing your hosted account are separate choices.</p>
    <p>Keep your recovery kit or linked wallet until all claims and stake are settled.</p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="!available && !operation">This operator has not enabled account erasure yet.</p>
    <div v-if="operation">
      <h2>Account exit report</h2>
      <p>
        Report access expires {{ new Date(operation.expiresAt).toLocaleString() }}. The report
        cannot sign or spend.
      </p>
      <p v-if="Date.parse(operation.expiresAt) <= Date.now()">
        Temporary report lookup and departure tracking expired. Your original native claim and stake
        credentials remain valid; settlement below does not recreate a hosted account.
      </p>
      <ul>
        <li v-for="component in (report ?? operation).components" :key="component.id">
          <strong>{{ componentTitle(component) }}</strong
          >: {{ component.state }} — {{ component.reason.replaceAll('_', ' ').toLowerCase() }}
        </li>
      </ul>
      <button :disabled="busy" @click="refreshReport">Refresh report</button
      ><button @click="downloadReport">Download exit report</button>
      <p>
        Public history, recipient copies and required shared records remain. An app acknowledgment
        is its operator's assertion.
      </p>
      <label
        >Native step signer<select v-model="selectedSigner">
          <option value="vault">Root key in my encrypted recovery kit</option>
          <option value="native">Linked native wallet</option>
          <option value="evm">Linked EVM wallet</option>
        </select></label
      >
      <button v-if="selectedSigner !== 'vault'" :disabled="busy" @click="connectExitWallet">
        Connect linked wallet
      </button>
      <p v-if="nativeWallet || evmWallet">Use the wallet already recorded for this membership.</p>
      <label v-if="selectedSigner === 'vault' && !canUseVaultKey(undefined)"
        >Saved kit password for this native step<input
          v-model="kitPassword"
          type="password"
          autocomplete="off"
      /></label>
      <section v-for="member in memberships" :key="exitMembershipKey(member)" class="exit-dao">
        <h3>{{ title(member) }}</h3>
        <button :disabled="busy" @click="reviewNativeDuties(member)">
          Refresh native duties and balances
        </button>
        <p>
          Claim {{ tokenAmount(member, member.claim) }} · stake
          {{ tokenAmount(member, member.stake) }}
        </p>
        <label>Settlement destination<input v-model="destination" autocomplete="off" /></label
        ><label>Settlement amount<input v-model="settlementAmount" inputmode="decimal" /></label
        ><label
          >Settlement type<select v-model="settlementKind">
            <option value="withdraw">Withdraw claim</option>
            <option value="unstake">Withdraw stake</option>
          </select></label
        ><button :disabled="busy || !!settlement" @click="settle(member)">
          Review in signer and submit settlement
        </button>
        <p>
          Each button requires your own signing key and a fresh native context. Unresolved funds or
          duties keep closure pending.
        </p>
        <button
          v-if="operation.mode === 'delete-account'"
          :disabled="busy"
          @click="nativeStep(member, 'delprofile')"
        >
          Sign current profile removal
        </button>
        <button :disabled="busy" @click="nativeStep(member, 'leave')">Sign departure</button>
        <label v-if="member.active && member.admin && member.soleMember"
          ><input
            type="checkbox"
            :checked="choices[exitMembershipKey(member)] === 'close'"
            @change="selectClosure($event, member)"
          />I now choose closure of this sole-member DAO, subject to its remaining
          liabilities.</label
        >
        <template
          v-if="
            choices[exitMembershipKey(member)] === 'close' ||
            reviewedIntent?.memberships.some(
              (choice) =>
                choice.choice === 'close' &&
                choice.chainId === member.reference.chainId &&
                choice.runtime === member.reference.contract &&
                choice.daoId === member.reference.daoId &&
                choice.memberId === member.memberId,
            )
          "
          ><button :disabled="busy" @click="nativeStep(member, 'startclose')">
            Sign start of DAO closure</button
          ><button :disabled="busy" @click="nativeStep(member, 'closedao')">
            Sign final DAO closure
          </button></template
        >
      </section>
      <p v-if="settlementState" role="status">{{ settlementState }}</p>
      <p v-if="settlement">Transaction {{ settlement.packet.transactionId }}</p>
      <button v-if="settlement" :disabled="busy" @click="reconcileSettlement">
        Check exact settlement receipt</button
      ><button
        v-if="settlement"
        :disabled="busy || settlement.operationId !== operation.id"
        @click="retrySettlement"
      >
        Retry the same signed settlement
      </button>
      <button v-if="savedVault()" @click="backup">Download encrypted recovery kit</button>
      <label class="ack"
        ><input v-model="confirmed" type="checkbox" />I saved my report and recovery credentials and
        understand any remaining rights.</label
      >
      <button :disabled="!confirmed || busy" @click="clearLocal">
        Clear this browser's operational vault
      </button>
    </div>
    <div v-else-if="preflight">
      <button :disabled="busy" @click="refresh">Refresh DAO review</button>
      <label
        >Exit choice<select v-model="mode">
          <option value="leave-all">Leave all DAOs and keep my Daclify account</option>
          <option value="delete-account">Leave all DAOs and delete my hosted account</option>
        </select></label
      >
      <p v-if="!preflight.nativeAvailable">
        The native chain is unavailable. Hosted cleanup can proceed, and native duties remain
        unresolved.
      </p>
      <section v-for="member in memberships" :key="exitMembershipKey(member)" class="exit-dao">
        <h2>{{ title(member) }}</h2>
        <p>
          {{ member.active ? 'Active membership' : 'Native reference requiring review' }} ·
          {{ member.admin ? 'Administrator' : 'Member' }} ·
          {{ member.lifecycle ?? 'Lifecycle unavailable' }}
        </p>
        <p>
          Claim {{ tokenAmount(member, member.claim) }} · stake
          {{ tokenAmount(member, member.stake) }}
        </p>
        <label v-if="member.active && member.soleMember && member.admin"
          ><input
            type="checkbox"
            :checked="choices[exitMembershipKey(member)] === 'close'"
            @change="selectClosure($event, member)"
          />Close this sole-member DAO</label
        >
        <p v-if="member.soleMember">
          Closure requires settled claims, stake, obligations, votes, remaining funds, modules and
          hosted services. This choice never transfers funds.
        </p>
        <PrivateHandoverPanel
          v-if="
            member.active &&
            member.admin &&
            summaryRecords.some(
              (dao) =>
                JSON.stringify(dao.reference) === JSON.stringify(member.reference) &&
                dao.privacy !== 'public',
            )
          "
          :member="member"
          @reviewed="reviewedHandover(member, $event)"
        />
        <router-link :to="'/dao/' + member.reference.daoId + '/content'"
          >Review private access and successor duties</router-link
        >
        <button v-if="member.active" :disabled="busy" @click="leaveOne(member)">
          Sign departure from this DAO only
        </button>
      </section>
      <p>{{ preflight.retained }}</p>
      <label class="ack"
        ><input v-model="confirmed" type="checkbox" />I reviewed every DAO and authorize the
        selected account action.</label
      >
      <button :disabled="busy || !confirmed" @click="begin">
        {{
          mode === 'delete-account' ? 'Confirm hosted account deletion' : 'Start leave-all workflow'
        }}</button
      ><button
        :disabled="busy"
        @click="
          confirmed = false;
          choices = {};
          mode = 'leave-all';
        "
      >
        Cancel review
      </button>
    </div>
    <label
      >Open a saved exit report<input
        type="file"
        accept="application/json,.json"
        @change="importReport"
    /></label>
  </section>
</template>
<style scoped>
.exit-panel {
  max-width: 960px;
  margin-inline: auto;
  overflow-wrap: anywhere;
}
.exit-panel h1 {
  font-size: clamp(1.4rem, 4vw, 2rem);
}
.exit-panel button {
  margin: 0.35rem 0.5rem 0.35rem 0;
}
.exit-panel label {
  display: block;
  margin-block: 1rem;
}
.exit-panel select {
  display: block;
  max-width: 100%;
  margin-top: 0.4rem;
}
.exit-dao {
  border: 1px solid var(--border);
  border-radius: 0.7rem;
  padding: 1rem;
  margin-block: 1rem;
}
.ack {
  display: flex !important;
  gap: 0.5rem;
  align-items: flex-start;
}
.exit-panel li {
  margin-block: 0.5rem;
}
.exit-panel input[type='file'] {
  display: block;
  max-width: 100%;
  margin-top: 0.5rem;
}
</style>
