<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { z } from 'zod';
import {
  ApiRoutes,
  MiniAppListingInputSchema,
  type DaoRef,
  type MiniAppListingSchema,
  type MiniAppOriginProofSchema,
  daoPaymentKey,
} from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
import { resolveApiUrl } from '../api/networks';
import { useWorkspace } from '../state/workspace';
const state = useWorkspace(),
  page = ref<z.infer<typeof ApiRoutes.miniAppDirectory.response>>(),
  mine = ref(false),
  busy = ref(false),
  error = ref(''),
  message = ref(''),
  id = ref(''),
  origin = ref(''),
  title = ref(''),
  description = ref(''),
  documentation = ref(''),
  source = ref(''),
  releases = ref(''),
  successor = ref(''),
  reportReason = ref(''),
  selectedListing = ref(''),
  proof = ref<z.infer<typeof MiniAppOriginProofSchema>>(),
  proofUrl = ref(''),
  reports = ref<z.infer<typeof ApiRoutes.miniAppListingReports.response>>();
const governingDao = ref<DaoRef>(),
  moderator = computed(() => {
    const reference = governingDao.value;
    return (
      !!reference &&
      state.memberships.some(
        (member) =>
          member.active && member.admin && daoPaymentKey(member.dao) === daoPaymentKey(reference),
      )
    );
  });
let generation = 0,
  contextGeneration = 0;
async function load(after?: string) {
  const current = ++generation;
  error.value = '';
  try {
    const result = await api.miniAppDirectory({
      ...(mine.value ? { mine: '1' as const } : {}),
      ...(after ? { after } : {}),
    });
    if (current !== generation) return;
    page.value =
      after && page.value
        ? { ...result, listings: [...page.value.listings, ...result.listings] }
        : result;
  } catch (cause) {
    if (current === generation) error.value = friendlyError(cause);
  }
}
watch(
  () => [state.account?.id, state.network?.chainId, resolveApiUrl('/')],
  () => {
    generation++;
    mine.value = false;
    page.value = undefined;
    proof.value = undefined;
    reports.value = undefined;
    id.value = '';
    governingDao.value = undefined;
    origin.value =
      title.value =
      description.value =
      documentation.value =
      source.value =
      releases.value =
      successor.value =
      reportReason.value =
      selectedListing.value =
        '';
    void load();
    const current = ++contextGeneration;
    if (state.account)
      void api
        .platformStatus()
        .then((status) => {
          if (current !== contextGeneration) return;
          governingDao.value = status.chain?.platformDao ?? undefined;
        })
        .catch(() => undefined);
  },
  { immediate: true },
);
watch(mine, () => {
  page.value = undefined;
  void load();
});
onBeforeUnmount(() => {
  generation++;
  contextGeneration++;
});
function input() {
  return MiniAppListingInputSchema.parse({
    origin: origin.value,
    title: title.value,
    description: description.value,
    ...(documentation.value ? { documentation: documentation.value } : {}),
    ...(source.value ? { source: source.value } : {}),
    releases: releases.value
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  });
}
function edit(value: z.infer<typeof MiniAppListingSchema>) {
  id.value = value.id;
  origin.value = value.origin;
  title.value = value.title;
  description.value = value.description;
  documentation.value = value.documentation ?? '';
  source.value = value.source ?? '';
  releases.value = value.releases.join(',');
  proof.value = undefined;
  message.value = '';
}
async function act(operation: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    await operation();
    await load();
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
function save(withdraw = false) {
  void act(async () => {
    const result = id.value
      ? await api.miniAppListingUpdate({ id: id.value, listing: input(), withdraw })
      : await api.miniAppListingSubmit(input());
    edit(result);
    message.value = withdraw
      ? 'Listing withdrawn.'
      : 'Listing saved. Verify its origin to publish.';
    mine.value = true;
  });
}
function verify(complete = false) {
  void act(async () => {
    const result = await api.miniAppListingVerify({ id: id.value, complete });
    if (result.state === 'challenge') {
      proof.value = result.proof;
      proofUrl.value = result.proofUrl;
      message.value =
        'Publish this exact proof at the supplied HTTPS URL, then complete verification.';
    } else {
      proof.value = undefined;
      message.value =
        result.listing.status === 'published'
          ? 'Maintainer verified. Listing published.'
          : 'Origin verified; moderation keeps this listing hidden.';
    }
  });
}
function transfer() {
  void act(async () => {
    await api.miniAppListingTransfer({ id: id.value, successorAccountId: successor.value });
    proof.value = undefined;
    message.value =
      'Transfer offered for ten minutes. Give the listing ID to your successor; they must prove origin control.';
  });
}
function report() {
  void act(async () => {
    await api.miniAppListingReport({ id: selectedListing.value, reason: reportReason.value });
    message.value = 'Report received.';
    reportReason.value = '';
  });
}
function moderate(decision: 'hide' | 'restore') {
  void act(async () => {
    await api.miniAppListingModerate({ id: selectedListing.value, decision });
    message.value = 'Moderation saved.';
  });
}
function reviewReports(after?: string) {
  void act(async () => {
    const result = await api.miniAppListingReports({
      id: selectedListing.value,
      ...(after ? { after } : {}),
    });
    reports.value =
      after && reports.value
        ? { ...result, reports: [...reports.value.reports, ...result.reports] }
        : result;
  });
}
const publicDescription = computed(() =>
  page.value?.publicationAvailable
    ? 'Maintainer verified means HTTPS origin control. Review the app’s policy before connecting.'
    : 'Publication is unavailable until the governing DAO moderation policy is configured.',
);
</script>
<template>
  <section aria-label="Community app directory">
    <p>{{ publicDescription }}</p>
    <p>
      Listings do not grant DAO permissions or certify an app. Daclify loads no remote app code
      here.
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <label v-if="state.account"><input type="checkbox" v-model="mine" />My listings</label>
    <button class="secondary" :disabled="busy" @click="load()">Refresh directory</button>
    <ul>
      <li v-for="listing in page?.listings ?? []" :key="listing.id">
        <h3>{{ listing.title }}</h3>
        <p>{{ listing.description }}</p>
        <p>
          {{ listing.status === 'published' ? 'Maintainer verified' : listing.status }} · expires
          {{ new Date(listing.expires).toLocaleDateString() }}
        </p>
        <a :href="listing.origin" target="_blank" rel="noopener noreferrer nofollow">Open app ↗</a>
        <a
          v-if="listing.documentation"
          :href="listing.documentation"
          target="_blank"
          rel="noopener noreferrer nofollow"
          >Documentation ↗</a
        >
        <a
          v-if="listing.source"
          :href="listing.source"
          target="_blank"
          rel="noopener noreferrer nofollow"
          >Source ↗</a
        >
        <p class="identifier">Listing {{ listing.id }}</p>
        <button v-if="mine" :disabled="busy" @click="edit(listing)">Edit listing</button
        ><button v-if="state.account" :disabled="busy" @click="selectedListing = listing.id">
          Report this listing
        </button>
      </li>
    </ul>
    <button v-if="page?.next" :disabled="busy" @click="load(page.next)">More listings</button>
    <p v-if="!state.account">
      <RouterLink :to="{ path: '/account', query: { returnTo: '/mini-apps#discover' } }"
        >Sign in</RouterLink
      >
      to list an app or report a problem.
    </p>
    <template v-else>
      <form aria-label="Maintain app listing" @submit.prevent="save()">
        <h3>List or maintain an app</h3>
        <p>
          Your account ID for an offered transfer:
          <span class="identifier">{{ state.account.id }}</span
          >. The successor proves origin control before ownership changes.
        </p>
        <label>Listing ID (existing entry or transfer)<input v-model="id" /></label
        ><label>App HTTPS origin<input v-model="origin" type="url" required /></label
        ><label>App title<input v-model="title" required /></label
        ><label>App description<textarea v-model="description" required /></label
        ><label>Documentation HTTPS URL<input v-model="documentation" type="url" /></label
        ><label>Source HTTPS URL<input v-model="source" type="url" /></label
        ><label>Supported release IDs (comma separated)<input v-model="releases" /></label>
        <button :disabled="busy">Save listing</button
        ><button type="button" :disabled="busy || !id" @click="save(true)">Withdraw listing</button
        ><button type="button" :disabled="busy || !id" @click="verify()">
          Request origin verification
        </button>
        <template v-if="proof"
          ><p class="identifier">Publish proof at {{ proofUrl }}</p>
          <pre>{{ JSON.stringify(proof, null, 2) }}</pre>
          <button
            type="button"
            :disabled="busy || !page?.publicationAvailable"
            @click="verify(true)"
          >
            Complete origin verification
          </button></template
        >
        <label>Successor account ID<input v-model="successor" /></label
        ><button type="button" :disabled="busy || !id || !successor" @click="transfer">
          Offer verified transfer
        </button>
      </form>
      <form aria-label="Report app listing" @submit.prevent="report">
        <label>Reported listing ID<input v-model="selectedListing" required /></label
        ><label>Report reason<textarea v-model="reportReason" required /></label
        ><button :disabled="busy">Send report</button>
      </form>
      <section v-if="moderator" aria-label="Directory moderation">
        <p>Current governing DAO administrators can review reports and moderate this listing.</p>
        <button :disabled="busy || !selectedListing" @click="reviewReports()">
          Review reports
        </button>
        <ul>
          <li v-for="(item, index) in reports?.reports ?? []" :key="index">
            {{ item.reason }} · expires {{ new Date(item.expires).toLocaleDateString() }}
          </li>
        </ul>
        <button v-if="reports?.next" :disabled="busy" @click="reviewReports(reports.next)">
          More reports
        </button>
        <button :disabled="busy || !selectedListing" @click="moderate('hide')">Hide listing</button
        ><button :disabled="busy || !selectedListing" @click="moderate('restore')">
          Restore verified listing
        </button>
      </section>
    </template>
  </section>
</template>
<style scoped>
label {
  display: block;
  margin: 0.5rem 0;
}
input,
textarea {
  display: block;
  max-width: 100%;
  width: 100%;
}
input[type='checkbox'] {
  display: inline;
  width: auto;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.identifier {
  overflow-wrap: anywhere;
}
button {
  margin: 0.25rem;
}
li {
  margin: 1rem 0;
}
</style>
