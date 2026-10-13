<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue';
import { ArrowUpRight, Blocks, Plus, RefreshCw, ShieldCheck } from '@lucide/vue';
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
  loading = ref(false),
  editorOpen = ref(false),
  editorHeading = ref<HTMLHeadingElement>(),
  reportHeading = ref<HTMLHeadingElement>(),
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
  contextGeneration = 0,
  reportGeneration = 0;
async function load(after?: string) {
  const current = ++generation;
  loading.value = true;
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
  } finally {
    if (current === generation) loading.value = false;
  }
}
function resetEditor() {
  id.value =
    origin.value =
    title.value =
    description.value =
    documentation.value =
    source.value =
    releases.value =
    successor.value =
      '';
  proof.value = undefined;
  proofUrl.value = '';
}
watch(
  () => [state.account?.id, state.network?.chainId, state.network?.runtime, resolveApiUrl('/')],
  () => {
    const current = ++contextGeneration;
    generation++;
    mine.value = false;
    page.value = undefined;
    resetEditor();
    editorOpen.value = false;
    busy.value = false;
    message.value = '';
    reports.value = undefined;
    governingDao.value = undefined;
    selectedListing.value = reportReason.value = '';
    void load();
    if (state.account)
      void api
        .platformStatus()
        .then((status) => {
          if (current !== contextGeneration) return;
          governingDao.value = status.chain?.platformDao ?? undefined;
        })
        .catch(() => undefined);
  },
  { immediate: true, flush: 'sync' },
);
watch(mine, () => {
  page.value = undefined;
  void load();
});
watch(
  id,
  () => {
    proof.value = undefined;
    proofUrl.value = '';
  },
  { flush: 'sync' },
);
watch(
  selectedListing,
  () => {
    reportGeneration++;
    reports.value = undefined;
    reportReason.value = '';
  },
  { flush: 'sync' },
);
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
  proofUrl.value = '';
  successor.value = '';
  message.value = '';
  openEditor();
}
function openEditor() {
  editorOpen.value = true;
  void nextTick(() => editorHeading.value?.focus());
}
function startListing() {
  resetEditor();
  openEditor();
}
async function act(operation: (current: number) => Promise<void>) {
  if (busy.value) return;
  const current = contextGeneration;
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    await operation(current);
    if (current !== contextGeneration) return;
    await load();
  } catch (cause) {
    if (current === contextGeneration) error.value = friendlyError(cause);
  } finally {
    if (current === contextGeneration) busy.value = false;
  }
}
function save(withdraw = false) {
  void act(async (current) => {
    const result = id.value
      ? await api.miniAppListingUpdate({ id: id.value, listing: input(), withdraw })
      : await api.miniAppListingSubmit(input());
    if (current !== contextGeneration) return;
    edit(result);
    message.value = withdraw
      ? 'Listing withdrawn.'
      : 'Listing saved. Verify its origin to publish.';
    mine.value = true;
  });
}
function verify(complete = false) {
  void act(async (current) => {
    const result = await api.miniAppListingVerify({ id: id.value, complete });
    if (current !== contextGeneration) return;
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
  void act(async (current) => {
    await api.miniAppListingTransfer({ id: id.value, successorAccountId: successor.value });
    if (current !== contextGeneration) return;
    proof.value = undefined;
    message.value =
      'Transfer offered for ten minutes. Give the listing ID to your successor; they must prove origin control.';
  });
}
function report() {
  void act(async (current) => {
    await api.miniAppListingReport({ id: selectedListing.value, reason: reportReason.value });
    if (current !== contextGeneration) return;
    message.value = 'Report received.';
    reportReason.value = '';
  });
}
function selectReport(listingId: string) {
  selectedListing.value = listingId;
  void nextTick(() => reportHeading.value?.focus());
}
function moderate(decision: 'hide' | 'restore') {
  void act(async (current) => {
    await api.miniAppListingModerate({ id: selectedListing.value, decision });
    if (current !== contextGeneration) return;
    message.value = 'Moderation saved.';
  });
}
function reviewReports(after?: string) {
  const selected = selectedListing.value,
    started = reportGeneration;
  void act(async (current) => {
    const result = await api.miniAppListingReports({
      id: selected,
      ...(after ? { after } : {}),
    });
    if (current !== contextGeneration || started !== reportGeneration) return;
    reports.value =
      after && reports.value
        ? { ...result, reports: [...reports.value.reports, ...result.reports] }
        : result;
  });
}
const publicDescription = computed(() =>
  page.value?.publicationAvailable === false
    ? 'Publication is unavailable until the governing DAO moderation policy is configured.'
    : 'Maintainer verified means HTTPS origin control. Review the app’s policy before connecting.',
);
</script>
<template>
  <section aria-label="Community app directory" class="app-directory">
    <details class="directory-tools">
      <summary>{{ state.account ? 'Manage listings' : 'Directory options' }}</summary>
      <div class="directory-toolbar">
        <label v-if="state.account" class="mine-filter"
          ><input type="checkbox" v-model="mine" :disabled="busy || loading" />My listings</label
        >
        <span v-else class="muted">Community app directory</span>
        <div class="button-row">
          <button class="secondary" :disabled="busy || loading" @click="load()">
            <RefreshCw aria-hidden="true" />Refresh directory
          </button>
          <button v-if="state.account" :disabled="busy" @click="startListing">
            <Plus aria-hidden="true" />List an app
          </button>
        </div>
      </div>
      <RouterLink class="help-link" to="/docs/mini-app-directory"
        >Listing and verification guide ↗</RouterLink
      >
    </details>
    <p class="directory-policy muted">
      {{ publicDescription }} Listings do not grant DAO permissions or certify an app.
    </p>
    <div v-if="error" class="alert" role="alert">
      {{ error }}
      <button class="secondary" :disabled="busy || loading" @click="load()">Retry directory</button>
    </div>
    <p v-if="message" class="notice" role="status">{{ message }}</p>
    <p v-if="loading && !message" class="muted" role="status">Loading apps…</p>
    <div v-if="!loading && !error && page && !page.listings.length" class="panel empty-directory">
      <Blocks aria-hidden="true" />
      <h3>{{ mine ? 'No listings of your own yet.' : 'No apps listed yet.' }}</h3>
      <p>
        {{
          mine
            ? 'List an app to share it with other communities.'
            : 'Published community apps will appear here. You can also connect an app directly to your DAO.'
        }}
      </p>
      <RouterLink v-if="!mine" class="button secondary" :to="{ hash: '#connect' }"
        >Connect an app</RouterLink
      >
    </div>
    <ul class="listing-grid" :aria-busy="loading">
      <li v-for="listing in page?.listings ?? []" :key="listing.id" class="panel app-card">
        <div class="app-card-heading">
          <span class="app-symbol" aria-hidden="true"><Blocks /></span>
          <span class="listing-status"
            ><ShieldCheck v-if="listing.status === 'published'" aria-hidden="true" />{{
              listing.status === 'published' ? 'Maintainer verified' : listing.status
            }}</span
          >
        </div>
        <h3>{{ listing.title }}</h3>
        <p class="app-description">{{ listing.description }}</p>
        <p class="muted app-origin">{{ listing.origin }}</p>
        <div class="button-row app-links">
          <a
            class="button secondary"
            :href="listing.origin"
            target="_blank"
            rel="noopener noreferrer nofollow"
            >Open app <ArrowUpRight aria-hidden="true"
          /></a>
        </div>
        <details class="app-details">
          <summary>App details</summary>
          <div class="button-row">
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
          </div>
          <div class="card-footer">
            <span class="muted">Expires {{ new Date(listing.expires).toLocaleDateString() }}</span>
            <button v-if="mine" class="text-button" :disabled="busy" @click="edit(listing)">
              Edit listing
            </button>
            <button
              v-if="state.account"
              class="text-button"
              :disabled="busy"
              @click="selectReport(listing.id)"
            >
              Report this listing
            </button>
          </div>
        </details>
      </li>
    </ul>
    <button
      v-if="page?.next"
      class="secondary"
      :disabled="busy || loading"
      @click="load(page.next)"
    >
      More listings
    </button>
    <p v-if="!state.account" class="notice">
      <RouterLink :to="{ path: '/account', query: { returnTo: '/mini-apps#discover' } }"
        >Sign in</RouterLink
      >
      to list an app or report a problem.
    </p>
    <template v-else>
      <form
        v-if="editorOpen"
        class="panel listing-editor"
        aria-label="Maintain app listing"
        @submit.prevent="save()"
      >
        <div class="panel-heading">
          <h3 ref="editorHeading" tabindex="-1">
            {{ id ? 'Maintain your listing' : 'List an app' }}
          </h3>
          <button type="button" class="secondary" :disabled="busy" @click="editorOpen = false">
            Close editor
          </button>
        </div>
        <p class="muted">Save your app’s details, then verify its HTTPS origin to publish it.</p>
        <fieldset :disabled="busy">
          <label>App title<input v-model="title" maxlength="120" required /></label>
          <label
            >App description<textarea v-model="description" maxlength="2000" rows="3" required />
          </label>
          <label
            >App HTTPS origin<input
              v-model="origin"
              type="url"
              maxlength="2048"
              placeholder="https://your-app.example"
              required
          /></label>
          <details>
            <summary>Documentation and supported releases</summary>
            <label
              >Documentation HTTPS URL<input v-model="documentation" type="url" maxlength="2048"
            /></label>
            <label>Source HTTPS URL<input v-model="source" type="url" maxlength="2048" /></label>
            <label>Supported release IDs (comma separated)<input v-model="releases" /></label>
          </details>
          <div class="button-row">
            <button>Save listing</button>
            <button type="button" class="secondary" :disabled="!id" @click="verify()">
              Request origin verification
            </button>
          </div>
          <div v-if="proof" class="notice origin-proof">
            <p class="identifier">Publish proof at {{ proofUrl }}</p>
            <pre>{{ JSON.stringify(proof, null, 2) }}</pre>
            <button type="button" :disabled="!page?.publicationAvailable" @click="verify(true)">
              Complete origin verification
            </button>
          </div>
          <details>
            <summary>Existing listing, transfer or withdrawal</summary>
            <label>Listing ID (existing entry or transfer)<input v-model="id" /></label>
            <p class="muted identifier">
              Your account ID for an offered transfer: {{ state.account.id }}. The successor proves
              origin control before ownership changes.
            </p>
            <label>Successor account ID<input v-model="successor" /></label>
            <div class="button-row">
              <button
                type="button"
                class="secondary"
                :disabled="!id || !successor"
                @click="transfer"
              >
                Offer verified transfer
              </button>
              <button type="button" class="secondary danger" :disabled="!id" @click="save(true)">
                Withdraw listing
              </button>
            </div>
          </details>
        </fieldset>
      </form>
      <form
        v-if="selectedListing"
        class="panel"
        aria-label="Report app listing"
        @submit.prevent="report"
      >
        <div class="panel-heading">
          <h3 ref="reportHeading" tabindex="-1">Report a listing</h3>
          <button type="button" class="secondary" :disabled="busy" @click="selectedListing = ''">
            Close report
          </button>
        </div>
        <label>Reported listing ID<input v-model="selectedListing" readonly /></label>
        <label
          >Report reason<textarea
            v-model="reportReason"
            maxlength="500"
            rows="3"
            :disabled="busy"
            required
          />
        </label>
        <button :disabled="busy">Send report</button>
      </form>
      <details v-if="moderator" class="panel">
        <summary>Directory moderation</summary>
        <section aria-label="Directory moderation">
          <p>Governing DAO administrators can review reports and moderate a selected listing.</p>
          <label>Listing to moderate<input v-model="selectedListing" :disabled="busy" /></label>
          <div class="button-row">
            <button class="secondary" :disabled="busy || !selectedListing" @click="reviewReports()">
              Review reports
            </button>
            <button
              class="secondary danger"
              :disabled="busy || !selectedListing"
              @click="moderate('hide')"
            >
              Hide listing
            </button>
            <button
              class="secondary"
              :disabled="busy || !selectedListing"
              @click="moderate('restore')"
            >
              Restore verified listing
            </button>
          </div>
          <p v-if="reports && !reports.reports.length" class="muted">
            No reports for this listing.
          </p>
          <ul>
            <li v-for="(item, index) in reports?.reports ?? []" :key="index">
              {{ item.reason }} · expires {{ new Date(item.expires).toLocaleDateString() }}
            </li>
          </ul>
          <button
            v-if="reports?.next"
            class="secondary"
            :disabled="busy"
            @click="reviewReports(reports.next)"
          >
            More reports
          </button>
        </section>
      </details>
    </template>
  </section>
</template>
<style scoped>
.directory-toolbar,
.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.directory-toolbar {
  margin: 0.75rem 0;
}
.directory-tools {
  margin-bottom: 1rem;
}
.mine-filter {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  min-height: 44px;
}
.mine-filter input {
  width: 18px;
  height: 18px;
  min-height: 0;
}
.listing-grid {
  list-style: none;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.25rem;
}
.app-card {
  min-width: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  overflow-wrap: anywhere;
}
.app-card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.app-symbol {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex: none;
  background: var(--accent-soft);
  color: var(--accent-amber);
  border-radius: var(--radius-md);
}
.listing-status {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--text-secondary);
  font-size: 12px;
}
.listing-status svg {
  width: 14px;
  height: 14px;
  flex: none;
}
.app-description {
  flex: 1;
  white-space: pre-wrap;
}
.app-origin {
  font-size: 12px;
}
.app-links {
  font-size: 13px;
}
.card-footer {
  border-top: 1px solid var(--line);
  margin-top: 1rem;
  padding-top: 0.75rem;
}
.card-footer .muted,
.card-footer button {
  font-size: 12px;
}
.empty-directory {
  text-align: center;
  padding-block: 2.5rem;
}
.empty-directory > svg {
  color: var(--accent-amber);
  margin-bottom: 1rem;
}
.empty-directory p {
  max-width: 34rem;
  margin-inline: auto;
}
.listing-editor {
  margin-top: 1.5rem;
}
.panel-heading {
  margin-bottom: 1rem;
}
.panel-heading h3 {
  margin: 0;
}
fieldset {
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
}
summary {
  padding: 0.75rem 0;
  min-height: 44px;
  font-weight: 600;
  cursor: pointer;
}
details {
  border-top: 1px solid var(--line);
  margin-top: 1rem;
}
fieldset > .button-row {
  margin-top: 1.25rem;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.identifier {
  overflow-wrap: anywhere;
}
.origin-proof {
  margin-top: 1rem;
}
@media (max-width: 700px) {
  .listing-grid {
    grid-template-columns: 1fr;
  }
  .directory-toolbar > .button-row {
    width: 100%;
  }
  .directory-toolbar button {
    flex: 1;
  }
  .panel-heading {
    align-items: flex-start;
    flex-wrap: wrap;
  }
}
</style>
