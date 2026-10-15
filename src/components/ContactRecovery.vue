<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import {
  ContactRecoveryTargetSchema,
  ContactRecoveryOfferSchema,
  ContactIdentitySchema,
  ContactShareDeliverySchema,
  type ContactRecoveryState,
} from '@daclify/core-protocol';
import { useWorkspace } from '../state/workspace';
import { api, friendlyError } from '../api/client';
import { connectNative } from '../auth/telos-zero';
import {
  encodeRecoveryCode,
  decodeRecoveryCode,
  recoveryState,
  myContactCode,
  recoveryOwnerAction,
  createRecoveryOffer,
  contactApproval,
  completeRecovery,
  claimRecovery,
  backupDocumentPacket,
  deliverDocumentShare,
  restoreDocumentPacket,
  parsedPacket,
  pendingRecovery,
  clearRecoverySetup,
  resumeRecoverySetup,
} from '../auth/contact-recovery';
const workspace = useWorkspace();
const code = ref(''),
  offerCode = ref(''),
  identity = ref(''),
  contacts = ref(['', '', '']);
const record = ref<ContactRecoveryState>(),
  documents = ref(false),
  verified = ref(false),
  replaceExisting = ref(false);
const useCurrentVault = ref(false),
  pendingBackupSaved = ref(false);
const password = ref(''),
  nativeAccount = ref(''),
  busy = ref(false),
  error = ref(''),
  notice = ref('');
const deliveries = ref(['', '']);
const futureRecipient = ref('');
const selectedPacketId = ref('');
const offerFingerprint = computed(() => {
  try {
    return decodeRecoveryCode(offerCode.value, ContactRecoveryOfferSchema).request.signing_key;
  } catch {
    return 'Invalid or incomplete recovery offer';
  }
});
watch(offerCode, () => {
  verified.value = false;
});
const selectedPacket = computed(() =>
  record.value?.packets.find((p) => p.id === selectedPacketId.value),
);
const decodedPacket = computed(() => {
  try {
    return selectedPacket.value ? parsedPacket(selectedPacket.value.packet) : undefined;
  } catch {
    return undefined;
  }
});
const owner = computed(() => {
  const current = record.value;
  return (
    !!current &&
    workspace.memberships.some(
      (m) =>
        m.dao.chainId === current.target.dao.chainId &&
        m.dao.contract === current.target.dao.contract &&
        m.dao.daoId === current.target.dao.daoId &&
        m.memberId === current.target.memberId &&
        m.signingKey === current.member?.signing_key,
    )
  );
});
const admin = computed(() =>
  workspace.memberships.find((m) => m.dao.daoId === record.value?.target.dao.daoId && m.admin),
);
const contactIndex = computed(
  () =>
    record.value?.policy?.contacts.findIndex(
      (c) => c.signing_key === workspace.account?.signingKey,
    ) ?? -1,
);
const approvals = (mask: number) => [1, 2, 4].filter((bit) => mask & bit).length;
const deadline = computed(() =>
  record.value?.pending?.execute_after
    ? new Date(record.value.pending.execute_after * 1000).toLocaleString()
    : 'After a second contact approves',
);
watch(
  () => [
    workspace.account?.id,
    workspace.account?.signingKey,
    workspace.network?.chainId,
    workspace.network?.runtime,
  ],
  () => {
    record.value = undefined;
    identity.value = '';
    verified.value = false;
    replaceExisting.value = false;
    useCurrentVault.value = false;
    offerCode.value = '';
    deliveries.value = ['', ''];
    password.value = '';
  },
);
const opened = ref(false);
let refreshTimer: ReturnType<typeof setInterval> | undefined;
function togglePanel(event: Event) {
  if (!(event.target instanceof HTMLDetailsElement)) return;
  opened.value = event.target.open;
  if (!opened.value || code.value) return;
  const member = workspace.memberships.find((m) => m.signingKey === workspace.account?.signingKey);
  if (member) {
    code.value = encodeRecoveryCode({ dao: member.dao, memberId: member.memberId });
    void run(load);
  }
}
onMounted(() => {
  refreshTimer = setInterval(() => {
    const current = record.value;
    if (!opened.value || busy.value || !current || document.hidden) return;
    void api
      .contactRecoveryState({ target: current.target })
      .then((updated) => {
        if (record.value !== current || busy.value) return;
        if (updated.pending?.request.request_id !== current.pending?.request.request_id)
          verified.value = false;
        record.value = {
          ...updated,
          packets: current.packets.map((p) => updated.packets.find((row) => row.id === p.id) ?? p),
        };
      })
      .catch((cause) => {
        if (record.value === current) error.value = friendlyError(cause);
      });
  }, 30000);
});
onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
async function load() {
  const updated = await recoveryState(decodeRecoveryCode(code.value, ContactRecoveryTargetSchema));
  if (
    JSON.stringify(record.value?.target) !== JSON.stringify(updated.target) ||
    record.value?.pending?.request.request_id !== updated.pending?.request.request_id
  )
    verified.value = false;
  record.value = updated;
  documents.value = record.value.policy?.documents ?? false;
  if (!record.value.packets.some((p) => p.id === selectedPacketId.value))
    selectedPacketId.value = record.value.packets[0]?.id ?? '';
}
async function run(work: () => Promise<unknown>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await work();
    if (record.value) await load();
    notice.value = 'Updated. Review the current status below.';
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
function selectMembership(value: string) {
  const member = workspace.memberships.find((m) => m.memberId + ':' + m.dao.daoId === value);
  if (member) code.value = encodeRecoveryCode({ dao: member.dao, memberId: member.memberId });
}
async function enroll() {
  const state = record.value;
  if (!state) return;
  await recoveryOwnerAction(state.target, 'setcontacts', {
    runtime: state.target.dao.contract,
    dao_id: state.target.dao.daoId,
    member_id: state.target.memberId,
    contacts: contacts.value.map((c) => {
      const v = decodeRecoveryCode(c, ContactIdentitySchema);
      return { signing_key: v.signingKey, encryption_key: JSON.stringify(v.encryptionKey) };
    }),
    documents: documents.value,
  });
}
async function ownerAction(action: 'cancelrec' | 'setrecpolicy', allowed = false) {
  const state = record.value;
  if (!state) return;
  if (action === 'cancelrec')
    await recoveryOwnerAction(state.target, action, {
      runtime: state.target.dao.contract,
      dao_id: state.target.dao.daoId,
      member_id: state.target.memberId,
    });
  else {
    const member = admin.value;
    if (!member) return;
    await recoveryOwnerAction({ dao: member.dao, memberId: member.memberId }, action, {
      runtime: member.dao.contract,
      dao_id: member.dao.daoId,
      member_id: member.memberId,
      allowed,
    });
  }
}
async function approve() {
  const state = record.value;
  if (!state || !verified.value) return;
  const offer = offerCode.value
    ? decodeRecoveryCode(offerCode.value, ContactRecoveryOfferSchema)
    : undefined;
  if (
    state.pending &&
    offer &&
    JSON.stringify(state.pending.request) !== JSON.stringify(offer.request)
  )
    throw new Error('CONTACT_RECOVERY_BACKUP_PENDING');
  await contactApproval(state, state.pending ? 'approverec' : 'startrecover', offer);
  verified.value = false;
}
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function parseDelivery(value: string) {
  return ContactShareDeliverySchema.parse(JSON.parse(value));
}
async function importReplacement(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return;
  const file = event.target.files?.[0],
    current = record.value;
  if (!file || !current) return;
  if (file.size > 20000) throw new Error('CONTACT_RECOVERY_FILE_SIZE');
  await resumeRecoverySetup(current, JSON.parse(await file.text()), password.value);
}
async function importShare(event: Event, index: number) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 20000) throw new Error('CONTACT_RECOVERY_FILE_SIZE');
  deliveries.value[index] = JSON.stringify(
    ContactShareDeliverySchema.parse(JSON.parse(await file.text())),
  );
}
</script>
<template>
  <section class="panel contact-recovery" aria-labelledby="contact-recovery-title">
    <details @toggle="togglePanel">
      <summary id="contact-recovery-title">
        Trusted-contact recovery<span v-if="record?.pending"> · recovery pending</span>
      </summary>
      <p>
        Choose three people in advance. Any two can replace your Daclify key after a 48-hour wait.
        Your DAO membership and balances stay with you. External wallet keys and funds are separate.
      </p>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <fieldset :disabled="busy">
        <legend>Find a membership</legend>
        <label v-if="workspace.memberships.length"
          >Your membership
          <select @change="selectMembership(($event.target as HTMLSelectElement).value)">
            <option value="">Choose a DAO</option>
            <option
              v-for="m in workspace.memberships"
              :key="m.memberId + ':' + m.dao.daoId"
              :value="m.memberId + ':' + m.dao.daoId"
            >
              DAO {{ m.dao.daoId }} · member {{ m.memberId }}
            </option>
          </select>
        </label>
        <label
          >Membership recovery code<textarea v-model="code" rows="2" spellcheck="false" />
        </label>
        <button type="button" @click="run(load)">Load recovery</button>
        <template v-if="workspace.account?.signingKey">
          <button
            type="button"
            @click="
              run(async () => {
                identity = await myContactCode();
              })
            "
          >
            Show my contact code
          </button>
          <label v-if="identity"
            >Share this public contact code<textarea readonly :value="identity" rows="2" />
          </label>
        </template>
      </fieldset>
      <template v-if="record">
        <p v-if="!record.supported">
          This deployment needs the trusted-contact recovery contract update.
        </p>
        <template v-else>
          <p>
            DAO {{ record.target.dao.daoId }} · member {{ record.target.memberId }}. Share the
            membership code above with your contacts.
          </p>
          <p v-if="record.policy">
            Contacts accepted: {{ approvals(record.policy.accepted) }}/3. Policy revision
            {{ record.policy.revision }}.
          </p>
          <fieldset v-if="owner" :disabled="busy">
            <legend>Your recovery contacts</legend>
            <label v-for="(_, index) in contacts" :key="index"
              >Contact {{ index + 1 }} public code<textarea
                v-model="contacts[index]"
                rows="2"
                spellcheck="false"
              />
            </label>
            <label
              ><input
                v-model="documents"
                type="checkbox"
                :disabled="!record.documentsAllowed"
              />Allow these contacts to recover this DAO’s document keys</label
            >
            <p v-if="documents">
              Any two contacts working together can decrypt backed-up document keys without you. The
              account waiting period cannot prevent that.
            </p>
            <p v-if="!record.documentsAllowed">
              This DAO forbids document recovery. Recovering your account will not restore its old
              private documents.
            </p>
            <button
              type="button"
              :disabled="
                record.member?.custody !== 0 ||
                workspace.account?.signingKey !== record.member?.signing_key
              "
              @click="run(enroll)"
            >
              Save three contacts
            </button>
            <p v-if="record.member?.custody !== 0">
              Contact enrollment requires a user-controlled vault.
            </p>
            <button
              type="button"
              :disabled="workspace.account?.signingKey !== record.member?.signing_key"
              @click="
                run(() =>
                  recoveryOwnerAction(record!.target, 'setcontacts', {
                    runtime: record!.target.dao.contract,
                    dao_id: record!.target.dao.daoId,
                    member_id: record!.target.memberId,
                    contacts: [],
                    documents: false,
                  }),
                )
              "
            >
              Disable contact recovery
            </button>
            <p>
              Unlock the original Daclify keys to change contacts. A paired wallet can still cancel
              a pending recovery.
            </p>
            <button
              v-if="record.policy?.documents"
              type="button"
              @click="run(() => backupDocumentPacket(record!))"
            >
              Back up next document keys
            </button>
            <p>
              Back up again after new document keys are created. Each encrypted packet uses DAO RAM
              and holds up to 16 keys.
            </p>
          </fieldset>
          <fieldset v-if="admin" :disabled="busy">
            <legend>DAO document recovery policy</legend>
            <label
              >Recovered member ID for future document access<input
                v-model="futureRecipient"
                inputmode="numeric"
                pattern="[1-9][0-9]*"
            /></label>
            <p>
              First rotate the DAO document key in its content settings and verify the recovered
              member. This approval allows fresh keys; it does not recover old keys.
            </p>
            <button
              type="button"
              :disabled="!futureRecipient"
              @click="
                run(async () => {
                  const m = admin!;
                  await recoveryOwnerAction({ dao: m.dao, memberId: m.memberId }, 'ackrecgrant', {
                    runtime: m.dao.contract,
                    dao_id: m.dao.daoId,
                    member_id: m.memberId,
                    recipient: futureRecipient,
                  });
                })
              "
            >
              Approve future document access
            </button>
            <p>
              Currently {{ record.documentsAllowed ? 'allowed' : 'forbidden' }}. Forbidding recovery
              rotates the document epoch. Copies already shared cannot be erased.
            </p>
            <button
              type="button"
              @click="run(() => ownerAction('setrecpolicy', !record!.documentsAllowed))"
            >
              {{ record.documentsAllowed ? 'Forbid' : 'Allow' }} document recovery
            </button>
          </fieldset>
          <fieldset v-if="contactIndex >= 0" :disabled="busy">
            <legend>Help as a trusted contact</legend>
            <button
              v-if="record.policy && !(record.policy.accepted & (1 << contactIndex))"
              type="button"
              @click="run(() => contactApproval(record!, 'acceptcont'))"
            >
              Accept being a recovery contact
            </button>
            <label
              >Replacement device’s recovery offer<textarea
                v-model="offerCode"
                rows="3"
                spellcheck="false"
              />
            </label>
            <p v-if="offerCode">
              Replacement fingerprint:
              {{ offerFingerprint }}
            </p>
            <p v-if="record.pending">
              Pending replacement: {{ record.pending.request.signing_key }}
            </p>
            <label
              ><input v-model="verified" type="checkbox" />I verified this person and the full
              replacement fingerprint through another channel.</label
            >
            <button
              type="button"
              :disabled="!verified || (!offerCode && !record.pending)"
              @click="run(approve)"
            >
              Approve replacement device
            </button>
          </fieldset>
          <fieldset :disabled="busy">
            <legend>Recover on this device</legend>
            <label v-if="workspace.account?.signingKey"
              ><input v-model="useCurrentVault" type="checkbox" />Reuse my signed-in replacement
              vault for another membership</label
            >
            <p v-if="record.identity">
              Recovery identity {{ record.identity.id }}. Recover each membership separately; each
              DAO keeps its document rules.
            </p>
            <label
              >New device vault password<input
                v-model="password"
                type="password"
                autocomplete="new-password"
                minlength="12"
            /></label>
            <label
              >Resume an exported replacement backup<input
                type="file"
                accept="application/json,.json"
                @change="run(() => importReplacement($event))"
                :disabled="password.length < 12"
            /></label>
            <p>
              Enter its saved vault password above. This restores the receiving device without
              creating a service profile. After completion, your ordinary recovered vault kit also
              works here if the service database was lost.
            </p>
            <label
              ><input v-model="pendingBackupSaved" type="checkbox" />I exported the pending
              replacement backup and saved its vault password.</label
            >
            <button
              type="button"
              :disabled="!pendingBackupSaved"
              @click="
                run(async () => {
                  clearRecoverySetup(true);
                  offerCode = '';
                  pendingBackupSaved = false;
                })
              "
            >
              Clear this device’s pending setup
            </button>
            <p>
              Clearing this browser does not cancel an on-chain recovery request. Keep its
              replacement backup.
            </p>
            <label
              >Replacement native account (if this membership controls native governance)<input
                v-model="nativeAccount"
                maxlength="12"
            /></label>
            <button
              type="button"
              :disabled="password.length < 12 || record.policy?.accepted !== 7"
              @click="
                run(async () => {
                  offerCode = encodeRecoveryCode(
                    await createRecoveryOffer(record!, password, nativeAccount, useCurrentVault),
                  );
                })
              "
            >
              Prepare replacement device
            </button>
            <label v-if="offerCode"
              >Send this public recovery offer to your contacts<textarea
                readonly
                :value="offerCode"
                rows="3"
              />
            </label>
            <button
              type="button"
              @click="
                run(async () => {
                  const p = pendingRecovery();
                  if (p) download(p, 'daclify-pending-recovery.json');
                  else throw new Error('CONTACT_RECOVERY_OFFER_REQUIRED');
                })
              "
            >
              Export pending replacement backup
            </button>
            <p>
              Keep this browser’s encrypted vault or export its pending backup before clearing
              browser data. Use the same replacement device for your other memberships.
            </p>
            <template v-if="record.pending">
              <p>
                Approvals: {{ approvals(record.pending.approvals) }}/2. Can complete:
                {{ deadline }}. Expires:
                {{ new Date(record.pending.request.expires * 1000).toLocaleString() }}.
              </p>
              <button v-if="owner" type="button" @click="run(() => ownerAction('cancelrec'))">
                Cancel recovery
              </button>
              <button
                v-if="record.pending.request.native_account"
                type="button"
                @click="run(connectNative)"
              >
                Connect replacement native wallet
              </button>
              <button type="button" @click="run(() => completeRecovery(record!))">
                Complete account recovery
              </button>
            </template>
            <template v-if="record.result">
              <button v-if="owner" type="button" @click="run(async () => clearRecoverySetup())">
                Clear completed replacement setup
              </button>
              <p>
                Recovery {{ record.result.request.request_id }} completed. Document keys must be
                restored separately.
              </p>
              <label
                ><input v-model="replaceExisting" type="checkbox" />I backed up any existing vault
                on this browser and agree to replace it.</label
              >
              <button
                type="button"
                :disabled="password.length < 12"
                @click="run(() => claimRecovery(record!, password, replaceExisting))"
              >
                Sign in with recovered identity
              </button>
            </template>
          </fieldset>
          <fieldset v-if="record.packets.length" :disabled="busy">
            <legend>Document key backups</legend>
            <label
              >Encrypted packet<select v-model="selectedPacketId">
                <option v-for="p in record.packets" :key="p.id" :value="p.id">
                  Packet {{ p.id }} · revision {{ p.revision }} ·
                  {{ approvals(p.acknowledged) }} contact acknowledgments
                </option>
              </select></label
            >
            <p v-if="selectedPacket && !decodedPacket" role="alert">
              This packet is unavailable. Select another packet or recreate its backup from
              surviving keys.
            </p>
            <template v-if="selectedPacket && decodedPacket">
              <p>
                Covered key epochs:
                {{
                  parsedPacket(selectedPacket.packet)
                    .context.epochs.map((e) => e.epoch)
                    .join(', ')
                }}.
                {{
                  approvals(selectedPacket.acknowledged) >= 2
                    ? 'Two contacts confirmed their shares.'
                    : 'Waiting for at least two contacts to confirm their shares.'
                }}
              </p>
              <button
                type="button"
                @click="
                  download(parsedPacket(selectedPacket.packet), 'daclify-document-packet.json')
                "
              >
                Export encrypted packet
              </button>
              <button
                v-if="contactIndex >= 0 && selectedPacket.revision === record.policy?.revision"
                type="button"
                @click="
                  run(() =>
                    contactApproval(
                      record!,
                      'ackrecpack',
                      undefined,
                      parsedPacket(selectedPacket!.packet),
                    ),
                  )
                "
              >
                Verify and acknowledge my share
              </button>
              <button
                v-if="contactIndex >= 0 && record.result && record.documentsAllowed"
                type="button"
                @click="
                  run(async () =>
                    download(
                      await deliverDocumentShare(record!, parsedPacket(selectedPacket!.packet)),
                      'daclify-document-share.json',
                    ),
                  )
                "
              >
                Export share for replacement device
              </button>
              <template v-if="owner && record.result && record.documentsAllowed">
                <label v-for="(_, index) in deliveries" :key="index"
                  >Contact {{ index + 1 }} encrypted share<input
                    type="file"
                    accept="application/json,.json"
                    @change="run(() => importShare($event, index))"
                /></label>
                <button
                  type="button"
                  :disabled="deliveries.some((d) => !d)"
                  @click="
                    run(() =>
                      restoreDocumentPacket(
                        record!,
                        parsedPacket(selectedPacket!.packet),
                        deliveries.map(parseDelivery),
                      ),
                    )
                  "
                >
                  Restore this packet’s document keys
                </button>
              </template>
            </template>
          </fieldset>
        </template>
      </template>
    </details>
  </section>
</template>
<style scoped>
.contact-recovery {
  margin-top: 1.5rem;
}
summary {
  cursor: pointer;
  font-weight: 600;
}
fieldset {
  margin: 1rem 0;
  display: grid;
  gap: 0.75rem;
  border: 1px solid var(--border-color, #777);
  border-radius: 0.5rem;
  padding: 1rem;
}
label {
  display: grid;
  gap: 0.35rem;
}
label:has(input[type='checkbox']) {
  display: flex;
  align-items: start;
}
textarea,
select,
input:not([type='checkbox']) {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}
p,
textarea {
  overflow-wrap: anywhere;
}
</style>
