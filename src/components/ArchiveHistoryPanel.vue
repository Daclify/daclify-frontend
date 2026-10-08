<script setup lang="ts">
import { ref, watch, onBeforeUnmount, computed } from 'vue';
import type { DaoRef, UserMembership } from '@daclify/core-protocol';
import {
  ArchiveRoutes,
  verifyAnchoredArchive,
  verifyArchiveChunkDescriptor,
  decodeReleasedArchiveRow,
} from '@daclify/modules/archive';
import type { z } from 'zod';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import { RuntimeTableSchemas, encodeAction, makeInstruction } from '@daclify/core-protocol/sdk';
import { canSignMember } from '../auth/action-signer';
import { relayInstruction } from '../auth/session';
import { downloadFile } from '../content/files';
const workspace = useWorkspace();
const props = defineProps<{ dao: DaoRef; member: UserMembership }>(),
  anchors = ref<z.infer<typeof ArchiveRoutes.history.response>['anchors']>([]),
  next = ref<string | null>(null),
  page = ref<z.infer<typeof ArchiveRoutes.historyPage.response>>(),
  selected = ref<string | null>(null),
  busy = ref(false),
  error = ref('');
const documents = ref<z.infer<typeof RuntimeTableSchemas.documents>[]>([]),
  documentPage = ref(0),
  restored = ref<string[]>([]),
  visibleDocuments = computed(() =>
    documents.value.slice(documentPage.value * 25, (documentPage.value + 1) * 25),
  );
let sequence = 0;
async function load(cursor?: string) {
  const request = ++sequence;
  busy.value = true;
  error.value = '';
  try {
    const result = await api.archiveHistory(props.dao, cursor);
    if (request === sequence) {
      anchors.value = cursor
        ? [
            ...anchors.value,
            ...result.anchors.filter((a) => !anchors.value.some((old) => old.id === a.id)),
          ]
        : result.anchors;
      next.value = result.next;
    }
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
async function browse(commitment: string, cursor?: string) {
  const request = ++sequence;
  busy.value = true;
  error.value = '';
  try {
    const result = await api.archiveHistoryPage({
      dao: props.dao,
      manifestCommitment: commitment,
      ...(cursor ? { cursor } : {}),
    });
    if (request === sequence) {
      page.value = result;
      documents.value = [];
      selected.value = commitment;
    }
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
async function browseDocuments(
  anchor: z.infer<typeof ArchiveRoutes.history.response>['anchors'][number],
) {
  const request = ++sequence;
  busy.value = true;
  error.value = '';
  documents.value = [];
  page.value = undefined;
  restored.value = [];
  try {
    const bundle = verifyAnchoredArchive(
        await api.archiveRecover({
          dao: props.dao,
          manifestCommitment: anchor.manifest_commitment,
        }),
        anchor,
      ),
      rows: z.infer<typeof RuntimeTableSchemas.documents>[] = [];
    for (const family of bundle.manifest.families) {
      if (family.kind !== 'document-versions') throw new Error('ARCHIVE_FAMILY_PROTECTED');
      for (const chunk of family.chunks) {
        const file = bundle.chunks.find((c) => c.cid === chunk.cid);
        if (!file) throw new Error('ARCHIVE_CONTENTS_INCOMPLETE');
        for (const original of verifyArchiveChunkDescriptor(
          chunk,
          Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0)),
        )) {
          const decoded = decodeReleasedArchiveRow(chunk.domain, original, family.parentId);
          if (decoded.kind !== 'document-versions') throw new Error('ARCHIVE_FAMILY_PROTECTED');
          rows.push(decoded.value);
        }
      }
    }
    if (request === sequence) {
      documents.value = rows;
      documentPage.value = 0;
      selected.value = anchor.manifest_commitment;
    }
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
async function restoreDocument(original: z.infer<typeof RuntimeTableSchemas.documents>) {
  if (busy.value || !props.member.active || !props.member.admin || !canSignMember(props.member))
    return;
  const request = ++sequence,
    member = props.member;
  busy.value = true;
  error.value = '';
  try {
    await relayInstruction(
      makeInstruction(
        member.dao,
        member.memberId,
        member.nonce,
        Math.floor(Date.now() / 1000) + 120,
        member.dao.contract,
        'restoredoc',
        encodeAction('restoredoc', {
          runtime: member.dao.contract,
          dao_id: member.dao.daoId,
          member_id: member.memberId,
          original,
        }),
      ),
    );
    await workspace.refresh();
    if (request === sequence) restored.value.push(original.id);
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
async function download(anchor: z.infer<typeof ArchiveRoutes.history.response>['anchors'][number]) {
  const request = ++sequence;
  busy.value = true;
  error.value = '';
  try {
    const bundle = verifyAnchoredArchive(
      await api.archiveRecover({ dao: props.dao, manifestCommitment: anchor.manifest_commitment }),
      anchor,
    );
    if (request === sequence)
      downloadFile(new TextEncoder().encode(JSON.stringify(bundle)), {
        version: 1,
        filename: `daclify-dao-${props.dao.daoId}-archive-${anchor.id}.json`,
        mediaType: 'application/json',
      });
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
watch(
  () =>
    JSON.stringify([
      props.dao.chainId,
      props.dao.contract,
      props.dao.daoId,
      workspace.account?.id,
      props.member.memberId,
      props.member.active,
    ]),
  () => {
    sequence++;
    anchors.value = [];
    page.value = undefined;
    documents.value = [];
    restored.value = [];
    selected.value = null;
    next.value = null;
    if (props.member.active) void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => sequence++);
</script>
<template>
  <section v-if="member.active" class="panel" aria-labelledby="archive-history-heading">
    <h2 id="archive-history-heading">On-chain archive history</h2>
    <p>
      Discover verified archives from the blockchain, including after a server database is lost.
      Files need surviving IPFS pins or a separately saved recovery bundle.
    </p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="busy" role="status">Verifying archive history…</p>
    <p v-if="!busy && !error && !anchors.length">No on-chain archives for this DAO.</p>
    <ul class="plain-list">
      <li v-for="anchor in anchors" :key="anchor.id">
        <p>
          Archive #{{ anchor.id }} · {{ anchor.manifest.families[0]?.records }} retained historical
          {{
            anchor.manifest.families[0]?.kind === 'document-versions'
              ? 'document versions · document'
              : 'votes · poll'
          }}
          #{{ anchor.manifest.families[0]?.parent_id }}
        </p>
        <button
          v-if="anchor.manifest.families[0]?.kind === 'document-versions'"
          :disabled="busy"
          @click="browseDocuments(anchor)"
        >
          Browse verified document versions
        </button>
        <button v-else :disabled="busy" @click="browse(anchor.manifest_commitment)">
          Browse verified votes
        </button>
        <button class="secondary" :disabled="busy" @click="download(anchor)">
          Recover archive bundle
        </button>
      </li>
    </ul>
    <button v-if="next" class="secondary" :disabled="busy" @click="load(next)">
      Load more on-chain archives
    </button>
    <div v-if="page" class="archive-history-table">
      <h3>Archived votes · poll #{{ page.parentId }}</h3>
      <p>
        {{
          page.liveRowsIncluded
            ? 'Verified archive and current on-chain rows, merged by stable vote ID.'
            : 'Verified archive coverage. Current live rows are unavailable on this deployment.'
        }}
      </p>
      <table>
        <caption class="sr-only">
          Verified archived vote records
        </caption>
        <thead>
          <tr>
            <th scope="col">Vote ID</th>
            <th scope="col">Member</th>
            <th scope="col">Weight</th>
            <th scope="col">Choice</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="vote in page.records" :key="vote.id">
            <td>{{ vote.id }}</td>
            <td>{{ vote.member }}</td>
            <td>{{ vote.weight }}</td>
            <td>{{ vote.choice }}</td>
          </tr>
        </tbody>
      </table>
      <button v-if="page.next && selected" :disabled="busy" @click="browse(selected, page.next)">
        Next archived votes
      </button>
    </div>
    <div v-if="documents.length" class="archive-history-table">
      <h3>Archived document versions</h3>
      <p>
        These rows come from verified original contract bytes. Restoring one consumes ordinary DAO
        RAM and does not change keys or grant access. Private contents stay encrypted; use the DAO's
        content screen after restoration.
      </p>
      <ul class="plain-list">
        <li v-for="document in visibleDocuments" :key="document.id">
          <p>
            Document #{{ document.document_id }} · version {{ document.version }} · author #{{
              document.author
            }}
            · {{ document.envelope_version === 1 ? 'Encrypted content' : 'Public content' }}
          </p>
          <button
            v-if="member.admin"
            :disabled="busy || !canSignMember(member) || restored.includes(document.id)"
            @click="restoreDocument(document)"
          >
            {{
              restored.includes(document.id) ? 'Restored on chain' : 'Sign and restore this version'
            }}
          </button>
        </li>
      </ul>
      <button class="secondary" :disabled="busy || documentPage === 0" @click="documentPage--">
        Previous document versions</button
      ><button
        class="secondary"
        :disabled="busy || (documentPage + 1) * 25 >= documents.length"
        @click="documentPage++"
      >
        Next document versions
      </button>
    </div>
    <RouterLink to="/docs/archive" class="help-link">Archive recovery guide ↗</RouterLink>
  </section>
</template>
<style scoped>
.archive-history-table {
  overflow-x: auto;
}
table {
  width: 100%;
  text-align: left;
}
th,
td {
  padding: 0.5rem;
}
</style>
