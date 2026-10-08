<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import type { DaoRef, UserMembership } from '@daclify/core-protocol';
import { ArchiveRoutes, verifyAnchoredArchive } from '@daclify/modules/archive';
import type { z } from 'zod';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import { downloadFile } from '../content/files';
const workspace = useWorkspace();
const props = defineProps<{ dao: DaoRef; member: UserMembership }>(),
  anchors = ref<z.infer<typeof ArchiveRoutes.history.response>['anchors']>([]),
  next = ref<string | null>(null),
  page = ref<z.infer<typeof ArchiveRoutes.historyPage.response>>(),
  selected = ref<string | null>(null),
  busy = ref(false),
  error = ref('');
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
      selected.value = commitment;
    }
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
  () => [
    props.dao.chainId,
    props.dao.contract,
    props.dao.daoId,
    workspace.account?.id,
    props.member.memberId,
    props.member.active,
  ],
  () => {
    sequence++;
    anchors.value = [];
    page.value = undefined;
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
          votes · poll #{{ anchor.manifest.families[0]?.parent_id }}
        </p>
        <button :disabled="busy" @click="browse(anchor.manifest_commitment)">
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
