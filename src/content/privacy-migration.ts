import { z } from 'zod';
import {
  AccountSchema,
  DaoRefSchema,
  IdSchema,
  NativeAccountSchema,
  PrivateMetadataSchema,
  PrivateRecordPayloadSchema,
  daoPaymentKey,
  type DaoRef,
  type PrivateRecordPayload,
  type PrivateRecordReference,
} from '@daclify/core-protocol';
import { encodePayroll } from '@daclify/modules/sdk';
import { makeInstruction } from '@daclify/core-protocol/sdk';
import { api } from '../api/client';
import { resolveApiUrl } from '../api/networks';
import { useWorkspace } from '../state/workspace';
import {
  vaultUnlocked,
  recoveryContextGuard,
  preparePrivateEpoch,
  verifyPrivateEpochs,
  relayWithVault,
} from '../auth/session';
import { sha256Hex } from '../auth/vault';
import { newPrivateRecordId, privateRecordAccess, readPrivateRecord } from './private-records';
import { repreparePrivateRecord } from './reprepare-private-record';
import { publishPrivateRecord, sendPrivateAction } from './publish-private-record';
export type PrivacyMigrationItem = {
  kind: 'dao-identity' | 'agent-description' | 'payroll-label';
  id: string;
  source: string;
  expected: string;
  payload: PrivateRecordPayload;
};
const cursorSchema = z.strictObject({
  offset: z.int().min(0).max(100000),
  schedules: IdSchema.optional(),
  payrollOnly: z.boolean(),
});
export async function previewPrivacyMigration(dao: DaoRef, cursor?: string) {
  DaoRefSchema.parse(dao);
  const page = cursor
    ? cursorSchema.parse(JSON.parse(z.string().max(256).parse(cursor)))
    : { offset: 0, schedules: undefined, payrollOnly: false };
  const offset = page.offset;
  const [summary, identity, governance, modules] = await Promise.all([
    api.dao(dao.daoId),
    api.privateIdentity(dao),
    api.governance(dao.daoId),
    api.moduleState(dao.daoId, page.schedules ? { schedules: page.schedules } : {}),
  ]);
  for (const reference of [summary.reference, identity.dao, governance.dao, modules.dao])
    if (daoPaymentKey(reference) !== daoPaymentKey(dao)) throw Error('DAO_REFERENCE');
  if (summary.privacy === 'public') throw Error('PRIVATE_DAO_REQUIRED');
  // Each page is reviewed separately; a cursor never authorizes an action.
  const items: PrivacyMigrationItem[] = [];
  const metadata = identity.metadata;
  if (!page.payrollOnly && metadata.schemaVersion !== 4)
    items.push({
      kind: 'dao-identity',
      id: dao.daoId,
      source: dao.contract,
      expected: identity.metadataCommitment,
      payload: PrivateRecordPayloadSchema.parse({
        schemaVersion: 1,
        kind: 'dao-identity',
        source: dao.contract,
        recordId: dao.daoId,
        body: {
          title: metadata.title,
          description: metadata.description,
          ...(metadata.schemaVersion === 3 && metadata.branding.summary
            ? { summary: metadata.branding.summary }
            : {}),
        },
      }),
    });
  for (const actor of governance.actors)
    if (
      !page.payrollOnly &&
      actor.kind === 1 &&
      actor.operator_label &&
      actor.operator_label !== 'Agent'
    )
      items.push({
        kind: 'agent-description',
        id: actor.id,
        source: dao.contract,
        expected: await sha256Hex(new TextEncoder().encode(actor.operator_label)),
        payload: PrivateRecordPayloadSchema.parse({
          schemaVersion: 1,
          kind: 'agent-description',
          source: dao.contract,
          recordId: actor.id,
          body: { operatorLabel: actor.operator_label, description: '' },
        }),
      });
  const payroll = modules.modules.find((module) => module.deployment.id === 'payroll');
  for (const control of modules.controls)
    if (payroll && control.label && control.label !== 'Private payroll')
      items.push({
        kind: 'payroll-label',
        id: control.schedule_id,
        source: payroll.deployment.account,
        expected: await sha256Hex(new TextEncoder().encode(control.label)),
        payload: PrivateRecordPayloadSchema.parse({
          schemaVersion: 1,
          kind: 'payroll-label',
          source: payroll.deployment.account,
          recordId: control.schedule_id,
          body: { purpose: 'display', label: control.label },
        }),
      });
  return {
    dao,
    items: items.slice(offset, offset + 25),
    next:
      offset + 25 < items.length
        ? JSON.stringify({ ...page, offset: offset + 25 })
        : modules.next.schedules
          ? JSON.stringify({ offset: 0, schedules: modules.next.schedules, payrollOnly: true })
          : null,
    historicalDisclosure: true,
    publicState: {
      available: summary.available,
      reserved: summary.reserved,
      claims: summary.claims,
      members: summary.members,
      privacy: summary.privacy,
      keyEpoch: summary.keyEpoch,
    },
    retained: { ballots: modules.ballots.length, payrollTerms: modules.payrollTerms.length },
    metadata,
  };
}
const draftSchema = z.strictObject({
  kind: z.enum(['dao-identity', 'agent-description', 'payroll-label']),
  id: IdSchema,
  source: NativeAccountSchema,
  expected: z.string().regex(/^[0-9a-f]{64}$/),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  documentId: IdSchema,
  contentVersion: z.int().min(1).max(4294967295).optional(),
});
export async function applyPrivacyMigrationItem(
  dao: DaoRef,
  memberId: string,
  item: PrivacyMigrationItem,
  reprepare = false,
) {
  if (!vaultUnlocked.value) throw Error('VAULT_LOCKED');
  const account = AccountSchema.parse(useWorkspace().account),
    guard = recoveryContextGuard(account);
  const check = () => {
    guard();
    if (!vaultUnlocked.value) throw Error('VAULT_LOCKED');
  };
  const payload = PrivateRecordPayloadSchema.parse(item.payload);
  if (payload.kind !== item.kind || payload.source !== item.source || payload.recordId !== item.id)
    throw Error('PRIVATE_RECORD_CONTEXT');
  const member = (await api.memberships()).find(
    (row) =>
      row.active &&
      row.admin &&
      row.memberId === memberId &&
      daoPaymentKey(row.dao) === daoPaymentKey(dao),
  );
  check();
  if (!member || member.signingKey !== account.signingKey) throw Error('ACCOUNT_KEY_MISMATCH');
  const summary = await api.dao(dao.daoId);
  check();
  if (daoPaymentKey(summary.reference) !== daoPaymentKey(dao) || summary.privacy === 'public')
    throw Error('PRIVATE_DAO_REQUIRED');
  if (
    !useWorkspace().network?.capabilities.includes('private-dao-identity-v1') ||
    (item.kind === 'payroll-label' &&
      !useWorkspace().network?.capabilities.includes('private-payroll-labels-v1'))
  )
    throw Error('PRIVATE_IDENTITY_UNSUPPORTED');
  const key = JSON.stringify([
    'daclify.privacy-migration.v1',
    resolveApiUrl('/'),
    account.id,
    dao,
    memberId,
    item.kind,
    item.id,
    item.source,
  ]);
  const saved = sessionStorage.getItem(key),
    payloadHash = await sha256Hex(new TextEncoder().encode(JSON.stringify(payload)));
  check();
  const draft = draftSchema.parse(
    saved
      ? JSON.parse(saved)
      : {
          kind: item.kind,
          id: item.id,
          source: item.source,
          expected: item.expected,
          payloadHash,
          documentId: newPrivateRecordId(),
        },
  );
  if (
    draft.kind !== item.kind ||
    draft.id !== item.id ||
    draft.source !== item.source ||
    draft.expected !== item.expected ||
    draft.payloadHash !== payloadHash
  )
    throw Error('PRIVATE_METADATA_CHANGED');
  async function attached(): Promise<PrivateRecordReference | null> {
    if (item.kind === 'dao-identity') return (await api.privateIdentity(dao)).reference;
    if (item.kind === 'agent-description') return (await api.privateAgent(dao, item.id)).reference;
    const record = await api.privatePayroll(dao, item.id);
    if (record.source !== item.source) throw Error('DAO_REFERENCE');
    return record.display;
  }
  const installed = await attached();
  check();
  if (installed) {
    if (
      installed.documentId !== draft.documentId ||
      installed.version !== (draft.contentVersion ?? 1)
    )
      throw Error('PRIVATE_METADATA_CHANGED');
    const content = await api.content(dao.daoId);
    check();
    const opened = await readPrivateRecord(dao, memberId, installed, content, payload);
    check();
    if (JSON.stringify(opened) !== JSON.stringify(payload)) throw Error('PRIVATE_RECORD_CONTEXT');
    sessionStorage.removeItem(key);
    return;
  }
  const snapshot = await api.privateIdentity(dao);
  check();
  if (daoPaymentKey(snapshot.dao) !== daoPaymentKey(dao)) throw Error('DAO_REFERENCE');
  let expected: string | undefined;
  if (item.kind === 'dao-identity')
    expected = snapshot.metadata.schemaVersion === 4 ? undefined : snapshot.metadataCommitment;
  else if (item.kind === 'agent-description') {
    const state = await api.governance(dao.daoId);
    check();
    if (daoPaymentKey(state.dao) !== daoPaymentKey(dao) || item.source !== dao.contract)
      throw Error('DAO_REFERENCE');
    const actor = state.actors.find((actor) => actor.id === item.id && actor.kind === 1);
    if (actor) expected = await sha256Hex(new TextEncoder().encode(actor.operator_label));
  } else {
    const state = await api.moduleState(dao.daoId, { schedules: item.id });
    check();
    if (
      daoPaymentKey(state.dao) !== daoPaymentKey(dao) ||
      !state.modules.some(
        (row) =>
          row.deployment.id === 'payroll' &&
          row.deployment.account === item.source &&
          row.enabled &&
          row.compatible &&
          row.codeVerified,
      )
    )
      throw Error('DAO_REFERENCE');
    const control = state.controls.find((row) => row.schedule_id === item.id);
    if (control) expected = await sha256Hex(new TextEncoder().encode(control.label));
  }
  check();
  if (expected !== item.expected) throw Error('PRIVATE_METADATA_CHANGED');
  sessionStorage.setItem(key, JSON.stringify(draft));
  let records = await api.content(dao.daoId);
  check();
  privateRecordAccess(dao, memberId, records).check();
  if (!records.epochs.some((epoch) => epoch.epoch === summary.keyEpoch)) {
    const epoch = await preparePrivateEpoch(dao, memberId, summary.keyEpoch);
    check();
    try {
      await sendPrivateAction(
        dao,
        memberId,
        'commitepoch',
        {
          runtime: dao.contract,
          dao_id: dao.daoId,
          member_id: memberId,
          epoch: summary.keyEpoch,
          commitment: epoch.commitment,
          self_grant: epoch.selfGrant,
        },
        true,
      );
    } catch (cause) {
      records = await api.content(dao.daoId);
      check();
      if (
        !records.epochs.some(
          (row) => row.epoch === summary.keyEpoch && row.commitment === epoch.commitment,
        )
      )
        throw cause;
    }
    records = await api.content(dao.daoId);
    check();
  }
  await verifyPrivateEpochs(dao, memberId, [summary.keyEpoch], records);
  check();
  const refreshed = reprepare
    ? await repreparePrivateRecord(dao, memberId, payload, draft.documentId)
    : undefined;
  check();
  if (refreshed && JSON.stringify(refreshed.payload) !== JSON.stringify(payload))
    throw Error('PRIVATE_RECORD_CONTEXT');
  const reference =
    refreshed?.reference ??
    (await publishPrivateRecord(
      dao,
      memberId,
      draft.documentId,
      draft.contentVersion ?? 1,
      payload,
      true,
    ));
  check();
  sessionStorage.setItem(key, JSON.stringify({ ...draft, contentVersion: reference.version }));
  if (reference.keyEpoch !== summary.keyEpoch) throw Error('PRIVATE_EPOCH_CHANGED');
  const native = {
    document_id: reference.documentId,
    version: reference.version,
    commitment: reference.commitment,
    key_epoch: reference.keyEpoch,
  };
  try {
    if (item.kind === 'dao-identity') {
      const metadata = snapshot.metadata;
      if (metadata.schemaVersion === 4) throw Error('PRIVATE_METADATA_CHANGED');
      const next = PrivateMetadataSchema.parse({
        schemaVersion: 4,
        title: 'Private DAO',
        description: '',
        purpose: metadata.schemaVersion === 1 ? 'custom' : metadata.purpose,
        setup: metadata.schemaVersion === 1 ? null : metadata.setup,
        privateIdentity: reference,
      });
      await sendPrivateAction(
        dao,
        memberId,
        'setmeta',
        {
          runtime: dao.contract,
          dao_id: dao.daoId,
          member_id: memberId,
          metadata: JSON.stringify(next),
          expected: item.expected,
        },
        true,
      );
    } else if (item.kind === 'agent-description')
      await sendPrivateAction(
        dao,
        memberId,
        'setagentdesc',
        {
          runtime: dao.contract,
          dao_id: dao.daoId,
          member_id: memberId,
          subject: item.id,
          reference: native,
        },
        true,
      );
    else {
      const fresh = (await api.memberships()).find(
        (row) =>
          row.active &&
          row.admin &&
          row.memberId === memberId &&
          daoPaymentKey(row.dao) === daoPaymentKey(dao),
      );
      check();
      if (!fresh || fresh.signingKey !== account.signingKey) throw Error('ACCOUNT_KEY_MISMATCH');
      await relayWithVault(
        makeInstruction(
          dao,
          memberId,
          fresh.nonce,
          Math.floor(Date.now() / 1000) + 300,
          item.source,
          'editpriv',
          encodePayroll('editpriv', {
            runtime: dao.contract,
            dao_id: dao.daoId,
            member_id: memberId,
            schedule_id: item.id,
            label: native,
          }),
        ),
      );
    }
  } catch (cause) {
    const actual = await attached();
    check();
    if (JSON.stringify(actual) !== JSON.stringify(reference)) throw cause;
  }
  const actual = await attached();
  check();
  if (JSON.stringify(actual) !== JSON.stringify(reference)) throw Error('PRIVATE_RECORD_PENDING');
  sessionStorage.removeItem(key);
}
